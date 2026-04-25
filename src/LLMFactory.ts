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
    return normalizeService_(
      PropertiesService.getDocumentProperties().getProperty(PROP_KEY_SERVICE)
    );
  }

  function saveSelectedService(service: LlmServiceName): void {
    PropertiesService.getDocumentProperties().setProperty(PROP_KEY_SERVICE, normalizeService_(service));
  }

  function create(service?: LlmServiceName): LlmClient {
    const resolved = normalizeService_(service || getSelectedService());
    if (resolved === Constants.LLM_SERVICE.OPENAI) return OpenAIService;
    return GeminiService;
  }

  function hasApiKeyForSelectedService(): boolean {
    return (create() as any).hasApiKey();
  }

  return {
    create,
    getSelectedService,
    saveSelectedService,
    hasApiKeyForSelectedService,
  };
})();
