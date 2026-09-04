// ============================================================
// LLMFactory.ts — provider selection and dispatch
// ============================================================

const LLMFactory = (() => {
  const PROP_KEY_SERVICE = 'LLM_SERVICE';

  function normalizeService_(raw: string | null | undefined): LlmServiceName {
    return raw === Constants.LLM_SERVICE.OPENAI
      ? Constants.LLM_SERVICE.OPENAI
      : Constants.LLM_SERVICE.GEMINI;
  }

  function getSelectedService(): LlmServiceName {
    if (typeof process !== 'undefined' && process.env.LLM_SERVICE) {
      return normalizeService_(process.env.LLM_SERVICE);
    }
    return normalizeService_(DocPropsCache.read(PROP_KEY_SERVICE));
  }

  function saveSelectedService(service: LlmServiceName): void {
    DocPropsCache.write(PROP_KEY_SERVICE, normalizeService_(service));
  }

  function create(service?: LlmServiceName): LlmClient {
    const resolved = normalizeService_(service || getSelectedService());
    if (resolved === Constants.LLM_SERVICE.OPENAI) return OpenAIService;
    return GeminiService;
  }

  function hasApiKeyForSelectedService(): boolean {
    return create().hasApiKey();
  }

  function listAvailableModelsForService(force = false, service?: LlmServiceName): string[] {
    return create(service).listAvailableModels(force);
  }

  return {
    create,
    getSelectedService,
    saveSelectedService,
    hasApiKeyForSelectedService,
    listAvailableModelsForService,
  };
})();
