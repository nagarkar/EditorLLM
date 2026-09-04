import { loadCompiledGlobal, mockUrlFetch } from './helpers/gasVmContext';

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

describe('OpenAIService', () => {
  beforeEach(() => {
    resetProps(null);
    (global as any).Tracer = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    (global as any).Utilities = { sleep: jest.fn() };
    if ((global as any).CacheService && (global as any).CacheService._createMockCache) {
      const freshCache = (global as any).CacheService._createMockCache();
      (global as any).CacheService.getUserCache.mockReturnValue(freshCache);
      (global as any).CacheService._mockUserCache = freshCache;
    }
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
      const fetch = mockUrlFetch({
        body: {
          choices: [{ message: { content: 'Plain response' } }],
          usage: { total_tokens: 42 },
        },
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
      const fetch = mockUrlFetch({
        body: {
          choices: [{ message: { content: '{"score":4}' } }],
          usage: { total_tokens: 15 },
        },
      });
      loadOpenAiService();

      const result = (global as any).OpenAIService.generate(
        'System prompt',
        'User prompt',
        'thinking',
        { schema: { type: 'object', properties: { score: { type: 'number' } } } }
      );

      expect(result).toEqual({ score: 4 });
      const [, opts] = fetch.mock.calls[0];
      const payload = JSON.parse(opts.payload);
      expect(payload.response_format).toEqual({
        type: 'json_schema',
        json_schema: {
          name: 'editorllm_output',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              score: { type: 'number' },
            },
            required: ['score'],
            additionalProperties: false,
          },
        },
      });
    });

    it('adds additionalProperties false to nested object schemas', () => {
      resetProps('sk-openai', 'gpt-fast-x', 'gpt-think-y');
      const fetch = mockUrlFetch({
        body: {
          choices: [{ message: { content: '{"items":[{"name":"Hook"}]}' } }],
          usage: { total_tokens: 15 },
        },
      });
      loadOpenAiService();

      const result = (global as any).OpenAIService.generate(
        'System prompt',
        'User prompt',
        'thinking',
        {
          schema: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                  },
                  required: ['name'],
                },
              },
            },
            required: ['items'],
          },
        }
      );

      expect(result).toEqual({ items: [{ name: 'Hook' }] });
      const [, opts] = fetch.mock.calls[0];
      const payload = JSON.parse(opts.payload);
      expect(payload.response_format.json_schema.schema).toEqual({
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
              },
              required: ['name'],
              additionalProperties: false,
            },
          },
        },
        required: ['items'],
        additionalProperties: false,
      });
    });

    it('marks all object properties as required in strict mode', () => {
      resetProps('sk-openai', 'gpt-fast-x', 'gpt-think-y');
      const fetch = mockUrlFetch({
        body: {
          choices: [{ message: { content: '{"title":"Doc","subtitle":null}' } }],
          usage: { total_tokens: 15 },
        },
      });
      loadOpenAiService();

      const result = (global as any).OpenAIService.generate(
        'System prompt',
        'User prompt',
        'thinking',
        {
          schema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              subtitle: { type: ['string', 'null'] },
            },
          },
        }
      );

      expect(result).toEqual({ title: 'Doc', subtitle: null });
      const [, opts] = fetch.mock.calls[0];
      const payload = JSON.parse(opts.payload);
      expect(payload.response_format.json_schema.schema).toEqual({
        type: 'object',
        properties: {
          title: { type: 'string' },
          subtitle: { type: ['string', 'null'] },
        },
        required: ['title', 'subtitle'],
        additionalProperties: false,
      });
    });
  });

  describe('listAvailableModels', () => {
    it('returns sorted model ids from the OpenAI models endpoint', () => {
      resetProps('sk-openai');
      const fetch = mockUrlFetch({
        body: {
          data: [
            { id: 'gpt-5.4-mini' },
            { id: 'gpt-5.4' },
            { id: 'o3' },
          ],
        },
      });
      loadOpenAiService();

      const models = (global as any).OpenAIService.listAvailableModels(true);

      expect(models).toEqual(['gpt-5.4', 'gpt-5.4-mini', 'o3']);
      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/models');
      expect(opts.method).toBe('get');
      expect(opts.headers.Authorization).toBe('Bearer sk-openai');
    });

    it('uses cache on repeated non-force calls', () => {
      resetProps('sk-openai');
      const fetch = mockUrlFetch({
        body: { data: [{ id: 'gpt-5.4' }] },
      });
      loadOpenAiService();

      expect((global as any).OpenAIService.listAvailableModels(false)).toEqual(['gpt-5.4']);
      expect((global as any).OpenAIService.listAvailableModels(false)).toEqual(['gpt-5.4']);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });
});
