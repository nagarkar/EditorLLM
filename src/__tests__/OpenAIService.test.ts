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

function loadOpenAiService(): void {
  loadCompiledGlobal('Constants', 'Constants.js');
  loadCompiledGlobal('OpenAIService', 'OpenAIService.js');
}

function resetProps(
  apiKey: string | null = null,
  fastModel: string | null = null,
  thinkingModel: string | null = null
) {
  const userGet = jest.fn().mockImplementation((key: string) => {
    if (key === 'OPENAI_API_KEY') return apiKey;
    if (key === 'OPENAI_FAST_MODEL') return fastModel;
    if (key === 'OPENAI_THINKING_MODEL') return thinkingModel;
    return null;
  });
  const scriptGet = jest.fn().mockReturnValue(null);
  const userSet = jest.fn();

  (global as any).PropertiesService = {
    getUserProperties: jest.fn().mockReturnValue({
      getProperty: userGet,
      setProperty: userSet,
    }),
    getScriptProperties: jest.fn().mockReturnValue({
      getProperty: scriptGet,
      setProperty: jest.fn(),
    }),
  };

  return { userGet, userSet, scriptGet };
}

function mockFetchResponse(body: object, code = 200) {
  const fetch = jest.fn().mockReturnValue({
    getResponseCode: jest.fn().mockReturnValue(code),
    getContentText: jest.fn().mockReturnValue(JSON.stringify(body)),
  });
  (global as any).UrlFetchApp = { fetch };
  return fetch;
}

describe('OpenAIService', () => {
  beforeEach(() => {
    resetProps(null);
    (global as any).Tracer = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    (global as any).Utilities = { sleep: jest.fn() };
    loadOpenAiService();
  });

  describe('hasApiKey', () => {
    it('returns false when no key is configured', () => {
      expect((global as any).OpenAIService.hasApiKey()).toBe(false);
    });

    it('returns true when a user key exists', () => {
      resetProps('sk-openai');
      loadOpenAiService();
      expect((global as any).OpenAIService.hasApiKey()).toBe(true);
    });
  });

  describe('saveApiKey', () => {
    it('trims and persists the key to user properties', () => {
      const { userSet } = resetProps(null);
      loadOpenAiService();
      (global as any).OpenAIService.saveApiKey('  sk-openai  ');
      expect(userSet).toHaveBeenCalledWith('OPENAI_API_KEY', 'sk-openai');
    });
  });

  describe('getModelConfig', () => {
    it('returns defaults when no overrides are present', () => {
      const cfg = (global as any).OpenAIService.getModelConfig();
      expect(cfg.fast).toBe('gpt-5.4-mini');
      expect(cfg.thinking).toBe('gpt-5.4');
    });

    it('returns stored user model overrides', () => {
      resetProps('sk-openai', 'gpt-fast-x', 'gpt-think-y');
      loadOpenAiService();
      const cfg = (global as any).OpenAIService.getModelConfig();
      expect(cfg.fast).toBe('gpt-fast-x');
      expect(cfg.thinking).toBe('gpt-think-y');
    });
  });

  describe('generate', () => {
    it('sends developer and user messages for plain text calls', () => {
      resetProps('sk-openai', 'gpt-fast-x', 'gpt-think-y');
      const fetch = mockFetchResponse({
        choices: [{ message: { content: 'Plain response' } }],
        usage: { total_tokens: 42 },
      });
      loadOpenAiService();

      const result = (global as any).OpenAIService.generate(
        'System prompt',
        'User prompt',
        'fast',
        {}
      );

      expect(result).toBe('Plain response');
      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(opts.headers.Authorization).toBe('Bearer sk-openai');
      const payload = JSON.parse(opts.payload);
      expect(payload.model).toBe('gpt-fast-x');
      expect(payload.messages).toEqual([
        { role: 'developer', content: 'System prompt' },
        { role: 'user', content: 'User prompt' },
      ]);
      expect(payload.response_format).toBeUndefined();
    });

    it('parses structured output when a schema is provided', () => {
      resetProps('sk-openai', 'gpt-fast-x', 'gpt-think-y');
      mockFetchResponse({
        choices: [{ message: { content: '{"score":4}' } }],
        usage: { total_tokens: 15 },
      });
      loadOpenAiService();

      const result = (global as any).OpenAIService.generate(
        'System prompt',
        'User prompt',
        'thinking',
        { schema: { type: 'object', properties: { score: { type: 'number' } } } }
      );

      expect(result).toEqual({ score: 4 });
    });
  });
});
