// ============================================================
// GeminiService.ts — Gemini API wrapper with model-tier support
// ============================================================

const GeminiService = (() => {
  const API_BASE     = 'https://generativelanguage.googleapis.com/v1beta/models';
  const PROP_KEY_API = 'GEMINI_API_KEY';

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
    const key = resolveApiKey_();
    if (!key) {
      throw new Error(
        `Gemini API key not set. Open the ${EXTENSION_NAME} sidebar and click Set API Key.`
      );
    }
    return key;
  }

  // ── Model resolution ───────────────────────────────────────────────────────

  function resolveModel_(tier: ModelTier): string {
    const key = `GEMINI_${tier.toUpperCase()}_MODEL`;

    if (typeof process !== 'undefined') {
      if (tier === MODEL.FAST && process.env.GEMINI_FAST_MODEL) return process.env.GEMINI_FAST_MODEL;
      if (tier === MODEL.THINKING && process.env.GEMINI_THINKING_MODEL) return process.env.GEMINI_THINKING_MODEL;
      if (tier === MODEL.DEEPSEEK && process.env.GEMINI_DEEPSEEK_MODEL) return process.env.GEMINI_DEEPSEEK_MODEL;
    }

    const userProp = PropertiesService.getUserProperties().getProperty(key);
    if (userProp) return userProp;

    const scriptProp = PropertiesService.getScriptProperties().getProperty(key);
    if (scriptProp) return scriptProp;

    return DEFAULT_MODELS[tier];
  }

  // ── Payload construction ───────────────────────────────────────────────────

  function buildPayload_(
    systemPrompt: string,
    userPrompt: string,
    schema: object,
    tier: ModelTier
  ): object {
    const payload: any = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userPrompt }], role: 'user' }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
      },
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
  function callApi_(apiKey: string, model: string, payload: object): any {
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

      return JSON.parse(textPart.text);
    }

    // Should never reach here — the loop always returns or throws.
    throw new Error('[GeminiService] callApi_: exhausted retries without resolving');
  }

  // ── Public: generateJson ───────────────────────────────────────────────────

  /**
   * Calls Gemini with structured JSON output.
   *
   * @param modelOverride  When provided (e.g. from a BaseAgent ModelConfig),
   *                       this model name is used directly instead of going
   *                       through the script-property / DEFAULT_MODELS chain.
   *                       This lets tests inject cheaper models without touching
   *                       script properties or changing any prompt code.
   */
  function generateJson(
    systemPrompt: string,
    userPrompt: string,
    schema: object,
    tier: ModelTier = MODEL.FAST,
    modelOverride?: string
  ): any {
    const apiKey = getApiKey_();
    const model  = modelOverride || resolveModel_(tier);
    const payload = buildPayload_(systemPrompt, userPrompt, schema, tier);
    return callApi_(apiKey, model, payload);
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
  }

  function hasApiKey(): boolean {
    const key = resolveApiKey_();
    return !!key && key.length > 0;
  }

  return {
    generateJson,
    saveApiKey,
    hasApiKey,
    listGenerateContentModels,
    saveModelConfig,
    getModelConfig,
  };
})();
