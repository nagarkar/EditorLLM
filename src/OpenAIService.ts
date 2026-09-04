// ============================================================
// OpenAIService.ts — OpenAI Chat Completions API wrapper
// ============================================================

const OpenAIService = (() => {
  const API_BASE = 'https://api.openai.com/v1';
  const PROP_KEY_API = 'OPENAI_API_KEY';
  const MODELS_CACHE_KEY_ = 'openai_available_models_v1';
  const MODELS_CACHE_TTL_ = 3600; // 1 hour

  let cachedApiKey_: string | null | undefined = undefined;
  let cachedModels_: Partial<Record<ModelTier, string>> = {};

  function resolveApiKey_(): string | null {
    if (typeof process !== 'undefined' && process.env.OPENAI_API_KEY) {
      return process.env.OPENAI_API_KEY;
    }
    return (
      PropertiesService.getUserProperties().getProperty(PROP_KEY_API) ||
      PropertiesService.getScriptProperties().getProperty(PROP_KEY_API)
    );
  }

  function getApiKey_(): string {
    if (cachedApiKey_ === undefined) {
      cachedApiKey_ = resolveApiKey_();
    }
    if (!cachedApiKey_) {
      throw new Error(
        `OpenAI API key not set. Open Extensions → ${Constants.EXTENSION_NAME} → Settings and save your OpenAI API key.`
      );
    }
    return cachedApiKey_;
  }

  function resolveModel_(tier: ModelTier): string {
    if (cachedModels_[tier] !== undefined) return cachedModels_[tier]!;

    if (typeof process !== 'undefined') {
      if (tier === Constants.MODEL.FAST && process.env.OPENAI_FAST_MODEL) {
        cachedModels_[tier] = process.env.OPENAI_FAST_MODEL;
        return cachedModels_[tier]!;
      }
      if (
        (tier === Constants.MODEL.THINKING || tier === Constants.MODEL.DEEPSEEK) &&
        process.env.OPENAI_THINKING_MODEL
      ) {
        cachedModels_[tier] = process.env.OPENAI_THINKING_MODEL;
        return cachedModels_[tier]!;
      }
    }

    const key = tier === Constants.MODEL.FAST ? 'OPENAI_FAST_MODEL' : 'OPENAI_THINKING_MODEL';
    const userProp = PropertiesService.getUserProperties().getProperty(key);
    if (userProp) {
      cachedModels_[tier] = userProp;
      return userProp;
    }

    const scriptProp = PropertiesService.getScriptProperties().getProperty(key);
    if (scriptProp) {
      cachedModels_[tier] = scriptProp;
      return scriptProp;
    }

    const fallback = tier === Constants.MODEL.FAST ? 'gpt-5.4-mini' : 'gpt-5.4';
    cachedModels_[tier] = fallback;
    return fallback;
  }

  function buildFetchOptions_(
    apiKey: string,
    extra: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {}
  ): GoogleAppsScript.URL_Fetch.URLFetchRequestOptions {
    return {
      ...extra,
      headers: {
        ...(extra.headers as object | undefined ?? {}),
        Authorization: `Bearer ${apiKey}`,
      },
      muteHttpExceptions: true,
    };
  }

  function listAvailableModels(force = false): string[] {
    const apiKey = resolveApiKey_();
    if (!apiKey) throw new Error('API key not set. Cannot list models.');

    if (!force) {
      try {
        const cached = CacheService.getUserCache().get(MODELS_CACHE_KEY_);
        if (cached) return JSON.parse(cached) as string[];
      } catch (_) { /* treat as cache miss */ }
    }

    const response = UrlFetchApp.fetch(
      `${API_BASE}/models`,
      buildFetchOptions_(apiKey, { method: 'get' })
    );
    const result = JSON.parse(response.getContentText());
    if (result.error) {
      throw new Error(`ListModels error: ${result.error.message}`);
    }

    const models = ((result.data ?? []) as any[])
      .map((item: any) => String(item?.id || '').trim())
      .filter((id: string) => !!id)
      .sort((a: string, b: string) => a.localeCompare(b));

    try {
      CacheService.getUserCache().put(MODELS_CACHE_KEY_, JSON.stringify(models), MODELS_CACHE_TTL_);
    } catch (_) { /* non-fatal */ }

    return models;
  }

  function buildPayload_(
    systemPrompt: string,
    userPrompt: string,
    model: string,
    schema?: object
  ): object {
    const payload: any = {
      model,
      messages: [
        { role: 'developer', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    };
    if (schema) {
      payload.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'editorllm_output',
          strict: true,
          schema: normalizeSchemaForStructuredOutputs_(schema),
        },
      };
    }
    return payload;
  }

  /**
   * OpenAI structured outputs require every object schema to declare
   * `additionalProperties: false`. Normalise the caller-provided schema here
   * so existing Gemini-oriented schema helpers remain usable.
   */
  function normalizeSchemaForStructuredOutputs_(schema: any): any {
    if (Array.isArray(schema)) {
      return schema.map(normalizeSchemaForStructuredOutputs_);
    }
    if (!schema || typeof schema !== 'object') {
      return schema;
    }

    const normalized: any = {};
    for (const [key, value] of Object.entries(schema)) {
      if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
        const normalizedProps: any = {};
        for (const [propName, propSchema] of Object.entries(value)) {
          normalizedProps[propName] = normalizeSchemaForStructuredOutputs_(propSchema);
        }
        normalized.properties = normalizedProps;
        continue;
      }
      normalized[key] = normalizeSchemaForStructuredOutputs_(value);
    }

    if (normalized.type === 'object') {
      normalized.additionalProperties = false;
      if (normalized.properties && typeof normalized.properties === 'object' && !Array.isArray(normalized.properties)) {
        normalized.required = Object.keys(normalized.properties);
      }
    }
    return normalized;
  }

  function estimateTokens_(result: any, raw: string, payload: object): number {
    const t = result?.usage?.total_tokens;
    if (typeof t === 'number' && t > 0) return t;
    return Math.max(1, Math.ceil((JSON.stringify(payload).length + raw.length) / 4));
  }

  function isRetryableError_(httpCode: number, msg: string): boolean {
    if (httpCode === 429 || httpCode === 503) return true;
    return /rate|quota|overload|temporar/i.test(msg);
  }

  function extractText_(message: any): string {
    if (!message) return '';
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
        .map((part: any) => part.text)
        .join('');
    }
    return '';
  }

  function callApi_(apiKey: string, model: string, payload: object, parseJson: boolean): any {
    const url        = `${API_BASE}/chat/completions`;
    const payloadStr = JSON.stringify(payload);
    const fetchOpts  = buildFetchOptions_(apiKey, {
      method:       'post',
      contentType:  'application/json',
      payload:      payloadStr,
    });
    const baseMs = httpComputeBaseMs(payloadStr.length);
    Tracer.info(
      `[OpenAIService] callApi_ model=${model} payload=${payloadStr.length}B retry-base=${baseMs}ms`
    );

    const response = httpFetchWithRetry(url, fetchOpts, {
      maxRetries:  3,
      baseMs,
      label:       'OpenAIService',
      shouldRetry: (resp, _attempt) => {
        const code = resp.getResponseCode();
        let msg = '';
        try {
          const parsed = JSON.parse(resp.getContentText());
          if (parsed && parsed.error) msg = String(parsed.error.message ?? '');
        } catch (_) { /* unparseable body → fall through to status-only check */ }
        // Hard-quota short-circuit (insufficient_quota = paid plan exhausted; do not retry)
        if (/insufficient_quota/i.test(msg)) return false;
        return isRetryableError_(code, msg);
      },
    });

    const raw = response.getContentText();
    const result = JSON.parse(raw);

    if (result.error) {
      const msg = String(result.error.message ?? '');
      throw new Error(`OpenAI API error: ${msg}`);
    }

    const message = result?.choices?.[0]?.message;
    if (message?.refusal) {
      throw new Error(`OpenAI API refusal: ${message.refusal}`);
    }

    const text = extractText_(message);
    if (!text) {
      throw new Error('OpenAI returned no usable content. Full response: ' + raw);
    }

    Tracer.info(`OPENAI MODEL USED: ${model} | ~${estimateTokens_(result, raw, payload)} tokens (est.)`);
    return parseJson ? JSON.parse(text) : text;
  }

  function generate(
    systemPrompt: string,
    userPrompt: string,
    tier: ModelTier = Constants.MODEL.FAST,
    opts: LlmGenerateOptions = {}
  ): any {
    const apiKey = getApiKey_();
    const model = opts.modelOverride || resolveModel_(tier);
    const payload = buildPayload_(systemPrompt, userPrompt, model, opts.schema);
    return callApi_(apiKey, model, payload, !!opts.schema);
  }

  function saveModelConfig(fast: string, thinking: string): void {
    const props = PropertiesService.getUserProperties();
    props.setProperty('OPENAI_FAST_MODEL', fast.trim());
    props.setProperty('OPENAI_THINKING_MODEL', thinking.trim());
    cachedModels_ = {};
  }

  function getModelConfig(): { fast: string; thinking: string } {
    return {
      fast: resolveModel_(Constants.MODEL.FAST),
      thinking: resolveModel_(Constants.MODEL.THINKING),
    };
  }

  function saveApiKey(key: string): void {
    PropertiesService.getUserProperties().setProperty(PROP_KEY_API, key.trim());
    cachedApiKey_ = undefined;
  }

  function hasApiKey(): boolean {
    const key = resolveApiKey_();
    return !!key && key.length > 0;
  }

  function hasUserApiKey(): boolean {
    const raw = PropertiesService.getUserProperties().getProperty(PROP_KEY_API);
    return !!(raw && String(raw).trim().length > 0);
  }

  return {
    generate,
    listAvailableModels,
    saveModelConfig,
    getModelConfig,
    saveApiKey,
    hasApiKey,
    hasUserApiKey,
  };
})();
