// ============================================================
// GeminiService.ts — Gemini API wrapper with model-tier support
// ============================================================

const GeminiService = (() => {
  const API_BASE     = 'https://generativelanguage.googleapis.com/v1beta/models';
  const PROP_KEY_API = 'GEMINI_API_KEY';

  // ── API key helpers ────────────────────────────────────────────────────────

  /**
   * Script properties take precedence (shared/admin key).
   * User properties are the per-user override fallback.
   */
  function resolveApiKey_(): string | null {
    return (
      PropertiesService.getScriptProperties().getProperty(PROP_KEY_API) ||
      PropertiesService.getUserProperties().getProperty(PROP_KEY_API)
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
    const props = PropertiesService.getScriptProperties();
    const key = tier === MODEL.FAST     ? MODEL_PROP_KEYS.FAST
              : tier === MODEL.THINKING ? MODEL_PROP_KEYS.THINKING
              :                          MODEL_PROP_KEYS.DEEPSEEK;
    return props.getProperty(key) || DEFAULT_MODELS[tier];
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

  function callApi_(apiKey: string, model: string, payload: object): any {
    const url = `${API_BASE}/${model}:generateContent?key=${apiKey}`;
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
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

    const resp = UrlFetchApp.fetch(
      `${API_BASE}?key=${apiKey}&pageSize=100`,
      { muteHttpExceptions: true }
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
   * Persists the three model names to script properties.
   * Script properties are shared across all users of this bound script.
   */
  function saveModelConfig(fast: string, thinking: string, deepseek: string): void {
    const props = PropertiesService.getScriptProperties();
    props.setProperty(MODEL_PROP_KEYS.FAST,     fast.trim());
    props.setProperty(MODEL_PROP_KEYS.THINKING, thinking.trim());
    props.setProperty(MODEL_PROP_KEYS.DEEPSEEK, deepseek.trim());
  }

  /**
   * Returns the currently configured model names (or defaults if not yet set).
   */
  function getModelConfig(): { fast: string; thinking: string; deepseek: string } {
    const props = PropertiesService.getScriptProperties();
    return {
      fast:     props.getProperty(MODEL_PROP_KEYS.FAST)     || DEFAULT_MODELS.fast,
      thinking: props.getProperty(MODEL_PROP_KEYS.THINKING) || DEFAULT_MODELS.thinking,
      deepseek: props.getProperty(MODEL_PROP_KEYS.DEEPSEEK) || DEFAULT_MODELS.deepseek,
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
