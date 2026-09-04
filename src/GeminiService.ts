// ============================================================
// GeminiService.ts — Gemini API wrapper with model-tier support
// ============================================================

const GeminiService = (() => {
  const API_BASE     = 'https://generativelanguage.googleapis.com/v1beta/models';
  const PROP_KEY_API = 'GEMINI_API_KEY';

  // ── Execution-scoped caches ────────────────────────────────────────────────
  // GAS executions are short-lived (one doPost / one menu call). Caching
  // PropertiesService lookups here avoids 2–4 IPC round-trips per Gemini call.
  // undefined = not yet resolved; null = resolved but absent.
  let cachedApiKey_: string | null | undefined = undefined;
  let cachedModels_: Partial<Record<string, string>> = {};

  // ── API key helpers ────────────────────────────────────────────────────────

  /**
   * Environment variables take precedence (only available during tests).
   * User properties are the per-user override.
   * Script properties are the fallback (shared/admin key).
   */
  function resolveApiKey_(): string | null {
    if (typeof process !== 'undefined' && process.env.GEMINI_API_KEY) {
      return process.env.GEMINI_API_KEY;
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
        `Gemini API key not set. Open Extensions → ${Constants.EXTENSION_NAME} → Settings and save your Gemini API key.`
      );
    }
    return cachedApiKey_;
  }

  // ── Model resolution ───────────────────────────────────────────────────────

  function resolveModel_(tier: ModelTier): string {
    if (cachedModels_[tier] !== undefined) return cachedModels_[tier]!;

    const key = `GEMINI_${tier.toUpperCase()}_MODEL`;
    let resolved: string;

    if (typeof process !== 'undefined') {
      if (tier === Constants.MODEL.FAST && process.env.GEMINI_FAST_MODEL) {
        resolved = process.env.GEMINI_FAST_MODEL;
        cachedModels_[tier] = resolved;
        return resolved;
      }
      if (tier === Constants.MODEL.THINKING && process.env.GEMINI_THINKING_MODEL) {
        resolved = process.env.GEMINI_THINKING_MODEL;
        cachedModels_[tier] = resolved;
        return resolved;
      }
      if (tier === Constants.MODEL.DEEPSEEK && process.env.GEMINI_DEEPSEEK_MODEL) {
        resolved = process.env.GEMINI_DEEPSEEK_MODEL;
        cachedModels_[tier] = resolved;
        return resolved;
      }
    }

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

    cachedModels_[tier] = Constants.DEFAULT_MODELS[tier];
    return Constants.DEFAULT_MODELS[tier];
  }

  /**
   * Vertex rejects generationConfig.thinkingConfig on models that do not
   * support thinking. Keep the check model-aware instead of assuming every
   * "thinking" tier selection maps to a thinking-capable model.
   *
   * Supported families are taken from the Vertex AI thinking docs:
   * Gemini 3 Flash Preview, Gemini 3 Pro Preview, Gemini 3 Pro Image Preview,
   * Gemini 2.5 Pro, Gemini 2.5 Flash / Flash-Lite, and their preview variants.
   */
  function supportsThinkingConfig_(model: string): boolean {
    const normalized = model.trim().toLowerCase();
    if (!normalized) return false;

    return [
      /^gemini-2\.5-pro(?:-|$)/,
      /^gemini-2\.5-flash(?:-lite)?(?:-|$)/,
      /^gemini-3(?:\.\d+)?-flash-preview(?:-|$)/,
      /^gemini-3(?:\.\d+)?-pro-preview(?:-|$)/,
      /^gemini-3(?:\.\d+)?-pro-image-preview(?:-|$)/,
    ].some(rx => rx.test(normalized));
  }

  // ── Payload construction ───────────────────────────────────────────────────

  /**
   * Builds a Gemini generateContent payload.
   * When `schema` is provided the response is constrained to JSON
   * (`responseMimeType` + `responseSchema`); omitting it requests plain text.
   */
  function buildPayload_(
    systemPrompt: string,
    userPrompt: string,
    tier: ModelTier,
    model: string,
    schema?: object
  ): object {
    const payload: any = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userPrompt }], role: 'user' }],
      generationConfig: schema
        ? { responseMimeType: 'application/json', responseSchema: schema }
        : {},
    };
    if (tier === Constants.MODEL.THINKING && supportsThinkingConfig_(model)) {
      payload.generationConfig.thinkingConfig = { thinkingBudget: 8192 };
    }
    return payload;
  }

  // ── Core API call ──────────────────────────────────────────────────────────

  /**
   * Builds UrlFetchApp options, injecting the API key as an HTTP header
   * (x-goog-api-key) instead of a URL query parameter.
   * Keeping the key out of the URL prevents it from appearing in server logs,
   * proxy logs, and browser history (OWASP API2:2023 / Sensitive Data Exposure).
   */
  function buildFetchOptions_(apiKey: string, extra: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {}): GoogleAppsScript.URL_Fetch.URLFetchRequestOptions {
    return {
      ...extra,
      headers: {
        ...(extra.headers as object | undefined ?? {}),
        'x-goog-api-key': apiKey,
      },
      muteHttpExceptions: true,
    };
  }

  /**
   * Token count for logging: prefers API usageMetadata.totalTokenCount; otherwise
   * ~1 token per 4 UTF-16 code units of request+response JSON (rough upper-ish bound).
   */
  function estimateGeminiTokens_(result: any, raw: string, payload: object): number {
    const t = result?.usageMetadata?.totalTokenCount;
    if (typeof t === 'number' && t > 0) return t;
    return Math.max(1, Math.ceil((JSON.stringify(payload).length + raw.length) / 4));
  }

  /**
   * Returns true when the HTTP code or error message indicates a transient
   * condition worth retrying, AND the error is NOT a hard quota exhaustion
   * (which retrying cannot help — fail fast in that case).
   *
   *   429 / 503                 → retryable
   *   message contains:
   *     "quota" / "rate" / "overloaded" → retryable
   *   message contains:
   *     "RESOURCE_EXHAUSTED" with "daily" or "PerDay" → NOT retryable (hard cap)
   */
  function isGeminiRetryable_(httpCode: number, msg: string): boolean {
    if (/RESOURCE_EXHAUSTED.*(daily|PerDay)/i.test(msg)) return false; // hard quota
    if (httpCode === 429 || httpCode === 503) return true;
    if (msg.includes('quota') || msg.includes('rate') || msg.includes('overloaded')) return true;
    return false;
  }

  /**
   * Calls the Gemini generateContent endpoint with retry / back-off.
   *
   * Backoff is delegated to `HttpRetry.fetchWithRetry`, which:
   *   - sleeps `baseMs * 2^attempt` between attempts (exponential)
   *   - honours any `Retry-After` response header in preference to the
   *     computed delay (capped at HttpRetry.RETRY_AFTER_MAX_MS)
   *   - logs a uniform `[GeminiService] retryable HTTP …` Tracer.warn line
   *
   * Base delay is sized to the request payload bytes via
   * `HttpRetry.computeBaseMs` — bigger payloads warrant longer waits because
   * they consume more of Gemini's per-minute token quota and a 429 means
   * the per-minute window must roll over before the next call succeeds.
   *
   * When `parseJson` is true the text part is parsed with `JSON.parse` and
   * the resulting object is returned; when false the raw text string is
   * returned.
   */

  function callApi_(apiKey: string, model: string, payload: object, parseJson: boolean): any {
    const url        = `${API_BASE}/${model}:generateContent`;
    const payloadStr = JSON.stringify(payload);
    const fetchOpts  = buildFetchOptions_(apiKey, {
      method:       'post',
      contentType:  'application/json',
      payload:      payloadStr,
    });
    const baseMs = httpComputeBaseMs(payloadStr.length);
    Tracer.info(
      `[GeminiService] callApi_ model=${model} payload=${payloadStr.length}B retry-base=${baseMs}ms`
    );

    const response = httpFetchWithRetry(url, fetchOpts, {
      maxRetries:  3,
      baseMs,
      label:       'GeminiService',
      shouldRetry: (resp, _attempt) => {
        const code = resp.getResponseCode();
        // Cheap path — if the body parses to an `error` block, peek for retryability.
        let msg = '';
        try {
          const parsed = JSON.parse(resp.getContentText());
          if (parsed && parsed.error) msg = String(parsed.error.message ?? '');
        } catch (_) { /* unparseable body → fall through to status-only check */ }
        return isGeminiRetryable_(code, msg);
      },
    });

    const raw = response.getContentText();
    const result = JSON.parse(raw);

    if (result.error) {
      const msg: string = result.error.message ?? '';

      // Enrich model-not-found errors with the live list of available models
      if (msg.includes('is not found') || msg.includes('not supported for generateContent')) {
        let modelList = '';
        try {
          const available = listGenerateContentModels();
          modelList = '\n\nAvailable models that support generateContent:\n  ' +
            available.join('\n  ');
        } catch (_) {
          modelList = '\n\n(Could not fetch available models — check your API key.)';
        }
        throw new Error(
          `Model "${model}" is not available or has been deprecated.${modelList}` +
          `\n\nUpdate your model configuration in the ${Constants.EXTENSION_NAME} sidebar → Setup → Configure Models.`
        );
      }
      throw new Error(`Gemini API error: ${msg}`);
    }

    // Skip thought parts; find the first text part that is not a thinking trace
    const parts: any[] = result.candidates?.[0]?.content?.parts ?? [];
    const textPart = parts.find((p: any) => !p.thought && p.text);
    if (!textPart) {
      throw new Error('Gemini returned no usable content. Full response: ' + raw);
    }

    const est = estimateGeminiTokens_(result, raw, payload);
    const finishReason: string = result.candidates?.[0]?.finishReason ?? 'unknown';
    Tracer.info(`GEMINI MODEL USED: ${model} | ~${est} tokens (est.) | finishReason=${finishReason}`);
    if (finishReason === 'MAX_TOKENS') {
      Tracer.warn(`[GeminiService] response truncated — output token limit reached (MAX_TOKENS)`);
    }

    if (!parseJson) return textPart.text as string;

    try {
      return JSON.parse(textPart.text);
    } catch (parseErr) {
      if (finishReason === 'MAX_TOKENS') {
        throw new Error(
          `[GeminiService] JSON response truncated — model hit output token limit (finishReason=MAX_TOKENS). ` +
          `Reduce the passage size or switch to a model with a higher output token limit.`
        );
      }
      throw parseErr;
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Unified Gemini call.
   *
   * - Pass `schema` to receive a structured JSON object back.
   * - Omit `schema` (or pass `undefined`) to receive a plain text string.
   *
   * @param modelOverride  Optional model name bypassing the tier-resolution
   *                       chain. Useful for tests or per-agent overrides.
   */
  function generate(
    systemPrompt: string,
    userPrompt: string,
    tier: ModelTier = Constants.MODEL.FAST,
    opts: { schema?: object; modelOverride?: string } = {}
  ): any {
    const apiKey  = getApiKey_();
    const model   = opts.modelOverride || resolveModel_(tier);
    const payload = buildPayload_(systemPrompt, userPrompt, tier, model, opts.schema);
    return callApi_(apiKey, model, payload, /* parseJson */ !!opts.schema);
  }

  // ── Public: image generation (Nano Banana Pro) ─────────────────────────────

  /**
   * Calls a Gemini image-capable model (Nano Banana Pro family) and returns
   * the first generated image as a Blob.
   *
   * Either `prompt` or `sourceBlob` (or both) must be supplied.  The request
   * shape mirrors the working Apps Script reference: the source image is sent
   * as `inline_data` (snake_case — REST tolerates both casings on input).
   * Returned blobs honour the model's reported MIME type, defaulting to PNG.
   */
  function generateImage(
    prompt: string,
    sourceBlob: GoogleAppsScript.Base.Blob | null,
    opts: { modelOverride?: string; aspectRatio?: string; imageSize?: string } = {}
  ): GoogleAppsScript.Base.Blob {
    const apiKey = getApiKey_();
    const model = opts.modelOverride
      || PropertiesService.getUserProperties().getProperty('GEMINI_IMAGE_MODEL')
      || PropertiesService.getScriptProperties().getProperty('GEMINI_IMAGE_MODEL')
      || 'gemini-3-pro-image-preview';
    const aspectRatio = opts.aspectRatio || '1:1';
    const imageSize = opts.imageSize || '1K';

    const parts: any[] = [];
    if (prompt && prompt.trim()) parts.push({ text: prompt });
    if (sourceBlob) {
      parts.push({
        inline_data: {
          mime_type: sourceBlob.getContentType() || 'image/png',
          data: Utilities.base64Encode(sourceBlob.getBytes()),
        },
      });
    }
    if (!parts.length) {
      throw new Error('generateImage: must supply at least a prompt or a source image.');
    }

    const payload: any = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio, imageSize },
      },
    };

    const url = `${API_BASE}/${model}:generateContent`;
    const response = UrlFetchApp.fetch(url, buildFetchOptions_(apiKey, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
    }));

    const httpCode = response.getResponseCode();
    const raw = response.getContentText();
    if (httpCode !== 200) {
      throw new Error(`Gemini image API HTTP ${httpCode}: ${raw.substring(0, 500)}`);
    }
    const data = JSON.parse(raw);
    if (data.error) {
      throw new Error(`Gemini image API error: ${data.error.message || raw.substring(0, 500)}`);
    }

    const respParts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
    for (const p of respParts) {
      const inline = p?.inlineData || p?.inline_data;
      if (inline?.data) {
        const mime = inline.mimeType || inline.mime_type || 'image/png';
        return Utilities.newBlob(Utilities.base64Decode(inline.data), mime);
      }
    }
    throw new Error('Gemini image API returned no image: ' + raw.substring(0, 300));
  }

  // ── Public: model management ───────────────────────────────────────────────

  /**
   * Calls the Gemini ListModels endpoint and returns the names of every model
   * that supports generateContent, sorted alphabetically.
   */
  const MODELS_CACHE_KEY_ = 'gemini_available_models_v1';
  const MODELS_CACHE_TTL_ = 3600; // 1 hour

  /**
   * Returns the list of Gemini models that support generateContent.
   * Results are cached in UserCache for 1 hour to avoid a live API call on
   * every sidebar/dialog open.  Pass `force=true` to bypass the cache and
   * re-fetch from the API (used by the "Refresh List" button).
   */
  function listGenerateContentModels(force = false): string[] {
    const apiKey = resolveApiKey_();
    if (!apiKey) throw new Error('API key not set. Cannot list models.');

    // Try cache first (unless force-refresh requested).
    if (!force) {
      try {
        const cached = CacheService.getUserCache().get(MODELS_CACHE_KEY_);
        if (cached) return JSON.parse(cached) as string[];
      } catch (_) { /* treat as cache miss */ }
    }

    // API key travels in the x-goog-api-key header — NOT in the URL.
    const resp = UrlFetchApp.fetch(
      `${API_BASE}?pageSize=100`,
      buildFetchOptions_(apiKey)
    );
    const result = JSON.parse(resp.getContentText());
    if (result.error) {
      throw new Error(`ListModels error: ${result.error.message}`);
    }

    const models = ((result.models ?? []) as any[])
      .filter((m: any) =>
        (m.supportedGenerationMethods ?? []).includes('generateContent')
      )
      .map((m: any) => (m.name as string).replace('models/', ''))
      .sort() as string[];

    // Store in cache for subsequent calls.
    try {
      CacheService.getUserCache().put(MODELS_CACHE_KEY_, JSON.stringify(models), MODELS_CACHE_TTL_);
    } catch (_) { /* non-fatal */ }

    return models;
  }

  /**
   * Persists the three model names to user properties.
   * Keys provided by the user are stored exclusively per-user.
   */
  function saveModelConfig(fast: string, thinking: string, deepseek: string): void {
    const props = PropertiesService.getUserProperties();
    props.setProperty('GEMINI_FAST_MODEL',     fast.trim());
    props.setProperty('GEMINI_THINKING_MODEL', thinking.trim());
    props.setProperty('GEMINI_DEEPSEEK_MODEL', deepseek.trim());
    // Invalidate execution-scoped cache so the new models are used immediately.
    cachedModels_ = {};
  }

  /**
   * Returns the currently configured model names (or defaults if not yet set).
   * Models resolve hierarchically: Environment -> User Properties -> Script Properties.
   */
  function getModelConfig(): { fast: string; thinking: string; deepseek: string } {
    return {
      fast:     resolveModel_(Constants.MODEL.FAST),
      thinking: resolveModel_(Constants.MODEL.THINKING),
      deepseek: resolveModel_(Constants.MODEL.DEEPSEEK),
    };
  }

  // ── Public: API key management ─────────────────────────────────────────────

  function saveApiKey(key: string): void {
    PropertiesService.getUserProperties().setProperty(PROP_KEY_API, key.trim());
    // Invalidate so the new key is picked up on the next Gemini call.
    cachedApiKey_ = undefined;
  }

  function hasApiKey(): boolean {
    const key = resolveApiKey_();
    return !!key && key.length > 0;
  }

  /** True only when GEMINI_API_KEY is stored in the current user's UserProperties (not script-only). */
  function hasUserApiKey(): boolean {
    const raw = PropertiesService.getUserProperties().getProperty(PROP_KEY_API);
    return !!(raw && String(raw).trim().length > 0);
  }

  return {
    generate,
    generateImage,
    saveApiKey,
    hasApiKey,
    hasUserApiKey,
    listAvailableModels: listGenerateContentModels,
    listGenerateContentModels,
    saveModelConfig,
    getModelConfig,
  };
})();
