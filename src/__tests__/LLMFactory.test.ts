const fs = require('fs');
const path = require('path');

function loadCompiledGlobal(varName: string, fileName: string): void {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'dist', fileName),
    'utf8'
  );
  const patched = src.replace(new RegExp('^const ' + varName + '\\b', 'm'), varName);
  const fn = new Function(patched);
  fn();
}

function loadFactoryStack(): void {
  loadCompiledGlobal('Constants', 'Constants.js');
  loadCompiledGlobal('GeminiService', 'GeminiService.js');
  loadCompiledGlobal('OpenAIService', 'OpenAIService.js');
  loadCompiledGlobal('LLMFactory', 'LLMFactory.js');
}

function resetProps(selectedService: string | null = null) {
  const docGet = jest.fn().mockImplementation((key: string) => {
    if (key === 'LLM_SERVICE') return selectedService;
    return null;
  });
  const docSet = jest.fn();
  (global as any).PropertiesService = {
    getDocumentProperties: jest.fn().mockReturnValue({
      getProperty: docGet,
      setProperty: docSet,
    }),
    getUserProperties: jest.fn().mockReturnValue({
      getProperty: jest.fn().mockReturnValue(null),
      setProperty: jest.fn(),
    }),
    getScriptProperties: jest.fn().mockReturnValue({
      getProperty: jest.fn().mockReturnValue(null),
      setProperty: jest.fn(),
    }),
  };
  return { docGet, docSet };
}

describe('LLMFactory', () => {
  beforeEach(() => {
    resetProps(null);
    (global as any).Tracer = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    (global as any).Utilities = { sleep: jest.fn() };
    (global as any).UrlFetchApp = { fetch: jest.fn() };
    loadFactoryStack();
  });

  it('defaults to Gemini when no document property is set', () => {
    expect((global as any).LLMFactory.getSelectedService()).toBe('gemini');
    expect((global as any).LLMFactory.create()).toBe((global as any).GeminiService);
  });

  it('returns OpenAI when the document property selects it', () => {
    resetProps('openai');
    loadFactoryStack();
    expect((global as any).LLMFactory.getSelectedService()).toBe('openai');
    expect((global as any).LLMFactory.create()).toBe((global as any).OpenAIService);
  });

  it('persists the selected service to document properties', () => {
    const { docSet } = resetProps(null);
    loadFactoryStack();
    (global as any).LLMFactory.saveSelectedService('openai');
    expect(docSet).toHaveBeenCalledWith('LLM_SERVICE', 'openai');
  });
});
