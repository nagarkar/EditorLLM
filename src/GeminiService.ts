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
        `Gemini API key not set. Open the ${EXTENSION_NAME} sidebar and click Set API Key.`
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
      if (tier === MODEL.FAST && process.env.GEMINI_FAST_MODEL) {
        resolved = process.env.GEMINI_FAST_MODEL;
        cachedModels_[tier] = resolved;
        return resolved;
      }
      if (tier === MODEL.THINKING && process.env.GEMINI_THINKING_MODEL) {
        resolved = process.env.GEMINI_THINKING_MODEL;
        cachedModels_[tier] = resolved;
        return resolved;
      }
      if (tier === MODEL.DEEPSEEK && process.env.GEMINI_DEEPSEEK_MODEL) {
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

    cachedModels_[tier] = DEFAULT_MODELS[tier];
    return DEFAULT_MODELS[tier];
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
    schema?: object
  ): object {
    const payload: any = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userPrompt }], role: 'user' }],
      generationConfig: schema
        ? { responseMimeType: 'application/json', responseSchema: schema }
        : {},
    };
    if (tier === MODEL.THINKING) {
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
   * Returns true for error codes/messages that are worth retrying:
   *   429 — rate limited (quota exceeded or too many requests)
   *   503 — service unavailable / overloaded
   */
  function isRetryableError_(httpCode: number, msg: string): boolean {
    if (httpCode === 429 || httpCode === 503) return true;
    if (msg.includes('quota') || msg.includes('rate') || msg.includes('overloaded')) return true;
    return false;
  }

  /**
   * Calls the Gemini generateContent endpoint.
   * Retries up to MAX_RETRIES times with exponential back-off when the API
   * returns a rate-limit (429) or overload (503) error, which can occur when
   * two consecutive thinking-tier calls are made in rapid succession.
   */
  /**
   * Calls the Gemini generateContent endpoint with retry / back-off.
   *
   * When `parseJson` is true the text part is parsed with `JSON.parse` and the
   * resulting object is returned; when false the raw text string is returned.
   * Both code paths were previously separate functions (callApi_ / callTextApi_)
   * with identical retry logic.
   */
  function callApi_(apiKey: string, model: string, payload: object, parseJson: boolean): any {
    const MAX_RETRIES = 2;
    // Back-off delays in ms: first retry after 15 s, second after 30 s.
    const RETRY_DELAYS = [15000, 30000];

    // API key travels in the x-goog-api-key header — NOT in the URL.
    const url = `${API_BASE}/${model}:generateContent`;

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
        const msg: string = result.error.message ?? '';

        if (attempt < MAX_RETRIES && isRetryableError_(httpCode, msg)) {
          const delay = RETRY_DELAYS[attempt];
          Tracer.warn(
            `[GeminiService] callApi_: HTTP ${httpCode} — "${msg}" — ` +
            `retrying in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`
          );
          Utilities.sleep(delay);
          continue;
        }

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
            `\n\nUpdate your model configuration in the ${EXTENSION_NAME} sidebar → Setup → Configure Models.`
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

      return parseJson ? JSON.parse(textPart.text) : (textPart.text as string);
    }

    // Should never reach here — the loop always returns or throws.
    throw new Error('[GeminiService] callApi_: exhausted retries without resolving');
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
    tier: ModelTier = MODEL.FAST,
    opts: { schema?: object; modelOverride?: string } = {}
  ): any {
    const apiKey  = getApiKey_();
    const model   = opts.modelOverride || resolveModel_(tier);
    const payload = buildPayload_(systemPrompt, userPrompt, tier, opts.schema);
    return callApi_(apiKey, model, payload, /* parseJson */ !!opts.schema);
  }

  /** @deprecated Use `generate()` with a `schema` option instead. */
  function generateJson(
    systemPrompt: string,
    userPrompt: string,
    schema: object,
    tier: ModelTier = MODEL.FAST,
    modelOverride?: string
  ): any {
    return generate(systemPrompt, userPrompt, tier, { schema, modelOverride });
  }

  /** @deprecated Use `generate()` without a `schema` option instead. */
  function generateText(
    systemPrompt: string,
    userPrompt: string,
    tier: ModelTier = MODEL.FAST,
    modelOverride?: string
  ): string {
    return generate(systemPrompt, userPrompt, tier, { modelOverride });
  }

  // ── Public: model management ───────────────────────────────────────────────

  /**
   * Calls the Gemini ListModels endpoint and returns the names of every model
   * that supports generateContent, sorted alphabetically.
   */
  function listGenerateContentModels(): string[] {
    const apiKey = resolveApiKey_();
    if (!apiKey) throw new Error('API key not set. Cannot list models.');

    // API key travels in the x-goog-api-key header — NOT in the URL.
    const resp = UrlFetchApp.fetch(
      `${API_BASE}?pageSize=100`,
      buildFetchOptions_(apiKey)
    );
    const result = JSON.parse(resp.getContentText());
    if (result.error) {
      throw new Error(`ListModels error: ${result.error.message}`);
    }

    return ((result.models ?? []) as any[])
      .filter((m: any) =>
        (m.supportedGenerationMethods ?? []).includes('generateContent')
      )
      .map((m: any) => (m.name as string).replace('models/', ''))
      .sort() as string[];
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
      fast:     resolveModel_(MODEL.FAST),
      thinking: resolveModel_(MODEL.THINKING),
      deepseek: resolveModel_(MODEL.DEEPSEEK),
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

  return {
    generate,
    generateJson,
    generateText,
    saveApiKey,
    hasApiKey,
    listGenerateContentModels,
    saveModelConfig,
    getModelConfig,
  };
})();
