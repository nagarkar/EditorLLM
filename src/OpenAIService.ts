// ============================================================
// OpenAIService.ts — OpenAI Chat Completions API wrapper
// ============================================================

const OpenAIService = (() => {
  const API_BASE = 'https://api.openai.com/v1';
  const PROP_KEY_API = 'OPENAI_API_KEY';

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
          schema,
        },
      };
    }
    return payload;
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
    const MAX_RETRIES = 2;
    const RETRY_DELAYS = [15000, 30000];
    const url = `${API_BASE}/chat/completions`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const response = UrlFetchApp.fetch(url, buildFetchOptions_(apiKey, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
      }));

      const httpCode = response.getResponseCode();
      const raw = response.getContentText();
      const result = JSON.parse(raw);

      if (result.error) {
        const msg = String(result.error.message ?? '');
        if (attempt < MAX_RETRIES && isRetryableError_(httpCode, msg)) {
          const delay = RETRY_DELAYS[attempt];
          Tracer.warn(
            `[OpenAIService] callApi_: HTTP ${httpCode} — "${msg}" — retrying in ${delay / 1000}s ` +
            `(attempt ${attempt + 1}/${MAX_RETRIES})`
          );
          Utilities.sleep(delay);
          continue;
        }
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

    throw new Error('[OpenAIService] callApi_: exhausted retries without resolving');
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
    saveModelConfig,
    getModelConfig,
    saveApiKey,
    hasApiKey,
    hasUserApiKey,
  };
})();

