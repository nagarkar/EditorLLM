// ============================================================
// ElevenLabsService.test.ts
//
// Loads the REAL compiled ElevenLabsService.js (same technique as
// tracer.test.ts) and exercises it against in-memory GAS mocks.
//
// PREREQUISITE: run `npm run build` (or `npm run build:all`) before
// running this file in isolation, so that dist/ElevenLabsService.js exists.
// When using `npm run build:all` the build step always runs first.
// ============================================================

const fs   = require('fs');
const path = require('path');

// Import the real parsePlsRules so it is available as a global when
// ElevenLabsService.js is loaded via new Function().  ElevenLabsService calls
// parsePlsRules() from the GAS flat scope; in tests we replicate that by
// attaching it to `global` before loadRealService() runs.
import { parsePlsRules } from '../PlsParser';

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Loads the compiled ElevenLabsService into the current global scope,
 * patching `const ElevenLabsService` → `ElevenLabsService` so the IIFE
 * result is assigned to the existing global (same trick as tracer.test.ts).
 */
function loadRealService(): void {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'dist', 'ElevenLabsService.js'),
    'utf8'
  );
  const patched = src.replace(/^const ElevenLabsService\b/m, 'ElevenLabsService');
  const fn = new Function(patched); // new Function used intentionally — same pattern as tracer.test.ts
  fn();
}

/**
 * Resets the PropertiesService mock so each test starts with a clean slate.
 * Returns the underlying jest.fn() handles for targeted assertions.
 *
 * Each parameter maps to the DocumentProperties key of the same name:
 *   apiKey  → ELEVENLABS_API_KEY
 *   modelId → ELEVENLABS_MODEL_ID
 *   voiceId → ELEVENLABS_VOICE_ID
 *   lastGen → ELEVENLABS_LAST_GEN (raw JSON string, or null)
 */
function resetProps(
  apiKey:  string | null = null,
  modelId: string | null = null,
  voiceId: string | null = null,
  lastGen: string | null = null,
) {
  // Key-aware mock: only return the configured value for the property it
  // was meant to represent; everything else returns null so defaults apply.
  const docGet = jest.fn().mockImplementation((key: string) => {
    if (key === 'ELEVENLABS_API_KEY')  return apiKey;
    if (key === 'ELEVENLABS_MODEL_ID') return modelId;
    if (key === 'ELEVENLABS_VOICE_ID') return voiceId;
    if (key === 'ELEVENLABS_LAST_GEN') return lastGen;
    return null;
  });
  const docSet = jest.fn();

  (global as any).PropertiesService = {
    getDocumentProperties: jest.fn().mockReturnValue({
      getProperty: docGet,
      setProperty: docSet,
    }),
  };

  return { docGet, docSet };
}

/** Replaces UrlFetchApp.fetch with a mock that returns the given shape. */
function mockFetch(opts: {
  code?: number;
  text?: string;
  bytes?: number[];
}) {
  const mock = jest.fn().mockReturnValue({
    getResponseCode: jest.fn().mockReturnValue(opts.code ?? 200),
    getContentText:  jest.fn().mockReturnValue(opts.text ?? '{}'),
    getBlob:         jest.fn().mockReturnValue({
      getBytes: jest.fn().mockReturnValue(opts.bytes ?? [1, 2, 3]),
    }),
  });
  (global as any).UrlFetchApp = { fetch: mock };
  return mock;
}

// ── Test suite ──────────────────────────────────────────────────────────────

describe('ElevenLabsService', () => {

  // Reload the real service before every test so the execution-scoped
  // cachedApiKey_ closure is reset to `undefined`.
  beforeEach(() => {
    // Make parsePlsRules available as a global — ElevenLabsService calls it
    // from the GAS flat scope; the real function from PlsParser.ts is used
    // so pronunciation-dictionary tests exercise the actual parsing logic.
    (global as any).parsePlsRules = parsePlsRules;
    resetProps(null);
    mockFetch({});
    loadRealService();
  });

  // ── hasApiKey / saveApiKey ───────────────────────────────────────────────

  describe('hasApiKey', () => {
    it('returns false when no key is configured', () => {
      expect((global as any).ElevenLabsService.hasApiKey()).toBe(false);
    });

    it('returns true when DocumentProperties holds a key', () => {
      resetProps('sk_live_abc123');
      loadRealService();
      expect((global as any).ElevenLabsService.hasApiKey()).toBe(true);
    });

    it('returns true when process.env holds a key', () => {
      process.env.ELEVENLABS_API_KEY = 'sk_env_key';
      loadRealService();
      expect((global as any).ElevenLabsService.hasApiKey()).toBe(true);
      delete process.env.ELEVENLABS_API_KEY;
    });
  });

  describe('saveApiKey', () => {
    it('writes the trimmed key to DocumentProperties', () => {
      const { docSet } = resetProps(null);
      loadRealService();
      (global as any).ElevenLabsService.saveApiKey('  sk_new_key  ');
      expect(docSet).toHaveBeenCalledWith('ELEVENLABS_API_KEY', 'sk_new_key');
    });
  });

  // ── getModelId / saveModelId ─────────────────────────────────────────────

  describe('getModelId', () => {
    it('returns the default model when nothing is saved', () => {
      expect((global as any).ElevenLabsService.getModelId()).toBe('eleven_multilingual_v2');
    });

    it('returns the saved document model', () => {
      resetProps(null, 'eleven_turbo_v2_5');
      loadRealService();
      expect((global as any).ElevenLabsService.getModelId()).toBe('eleven_turbo_v2_5');
    });
  });

  describe('saveModelId', () => {
    it('writes trimmed model ID to DocumentProperties', () => {
      const { docSet } = resetProps('sk_test');
      loadRealService();
      (global as any).ElevenLabsService.saveModelId('  eleven_turbo_v2_5  ');
      expect(docSet).toHaveBeenCalledWith('ELEVENLABS_MODEL_ID', 'eleven_turbo_v2_5');
    });
  });

  // ── getSavedVoiceId / saveVoiceId ────────────────────────────────────────

  describe('getSavedVoiceId', () => {
    it('returns null when no voice has been saved', () => {
      expect((global as any).ElevenLabsService.getSavedVoiceId()).toBeNull();
    });

    it('returns the voice ID stored in DocumentProperties', () => {
      resetProps(null, null, 'voice_abc123');
      loadRealService();
      expect((global as any).ElevenLabsService.getSavedVoiceId()).toBe('voice_abc123');
    });
  });

  describe('saveVoiceId', () => {
    it('writes trimmed voice ID to DocumentProperties', () => {
      const { docSet } = resetProps('sk_test');
      loadRealService();
      (global as any).ElevenLabsService.saveVoiceId('  voice_xyz  ');
      expect(docSet).toHaveBeenCalledWith('ELEVENLABS_VOICE_ID', 'voice_xyz');
    });
  });

  // ── getLastGeneration / saveLastGeneration ───────────────────────────────

  describe('getLastGeneration', () => {
    it('returns null when nothing has been saved', () => {
      expect((global as any).ElevenLabsService.getLastGeneration()).toBeNull();
    });

    it('returns null when the stored JSON is malformed', () => {
      resetProps(null, null, null, 'not-json');
      loadRealService();
      expect((global as any).ElevenLabsService.getLastGeneration()).toBeNull();
    });

    it('returns the parsed metadata object when valid JSON is stored', () => {
      const meta = {
        fileId: 'f123', driveUrl: 'https://drive.google.com/uc?id=f123',
        voiceName: 'Alice', modelName: 'Multilingual v2',
        charCount: 500, timestamp: 1700000000000,
      };
      resetProps(null, null, null, JSON.stringify(meta));
      loadRealService();
      const result = (global as any).ElevenLabsService.getLastGeneration();
      expect(result).toEqual(meta);
    });
  });

  describe('saveLastGeneration', () => {
    it('writes JSON-serialised metadata to DocumentProperties', () => {
      const { docSet } = resetProps('sk_test');
      loadRealService();
      const meta = {
        fileId: 'f999', driveUrl: 'https://example.com',
        voiceName: 'Bob', modelName: 'Turbo v2.5',
        charCount: 200, timestamp: 1700000001234,
      };
      (global as any).ElevenLabsService.saveLastGeneration(meta);
      expect(docSet).toHaveBeenCalledWith('ELEVENLABS_LAST_GEN', JSON.stringify(meta));
    });
  });

  // ── listVoices ───────────────────────────────────────────────────────────

  describe('listVoices', () => {
    beforeEach(() => {
      resetProps('sk_test');
      loadRealService();
    });

    it('throws when no API key is set', () => {
      resetProps(null);
      loadRealService();
      expect(() => (global as any).ElevenLabsService.listVoices())
        .toThrow('API key');
    });

    it('returns all voices when no use-case filter is given', () => {
      mockFetch({
        text: JSON.stringify({
          voices: [
            { voice_id: 'v1', name: 'Alice', category: 'premade', labels: { 'use case': 'narration' } },
            { voice_id: 'v2', name: 'Bob',   category: 'premade', labels: { 'use case': 'conversational' } },
          ],
        }),
      });
      const result = (global as any).ElevenLabsService.listVoices();
      expect(result).toHaveLength(2);
    });

    it('filters voices by use case (case-insensitive)', () => {
      mockFetch({
        text: JSON.stringify({
          voices: [
            { voice_id: 'v1', name: 'Alice', category: 'premade', labels: { 'use case': 'narration' } },
            { voice_id: 'v2', name: 'Bob',   category: 'premade', labels: { 'use case': 'conversational' } },
            { voice_id: 'v3', name: 'Carol', category: 'premade', labels: { 'use case': 'Narration' } },
          ],
        }),
      });
      const result = (global as any).ElevenLabsService.listVoices('narration');
      expect(result).toHaveLength(2);
      expect(result.every((v: any) => v.use_case.toLowerCase().includes('narration'))).toBe(true);
    });

    it('returns voices sorted alphabetically by name', () => {
      mockFetch({
        text: JSON.stringify({
          voices: [
            { voice_id: 'v2', name: 'Zara',  category: 'premade', labels: {} },
            { voice_id: 'v1', name: 'Alice', category: 'premade', labels: {} },
          ],
        }),
      });
      const result = (global as any).ElevenLabsService.listVoices();
      expect(result[0].name).toBe('Alice');
      expect(result[1].name).toBe('Zara');
    });

    it('normalises voices to the ElevenLabsVoice shape', () => {
      mockFetch({
        text: JSON.stringify({
          voices: [
            {
              voice_id: 'v99',
              name: 'TestVoice',
              category: 'cloned',
              labels: { 'use case': 'characters', accent: 'British' },
            },
          ],
        }),
      });
      const [v] = (global as any).ElevenLabsService.listVoices();
      expect(v.voice_id).toBe('v99');
      expect(v.name).toBe('TestVoice');
      expect(v.category).toBe('cloned');
      expect(v.use_case).toBe('characters');
      expect(v.labels.accent).toBe('British');
    });

    it('returns empty array (not error) when voices list is absent', () => {
      mockFetch({ text: '{}' });
      const result = (global as any).ElevenLabsService.listVoices();
      expect(result).toEqual([]);
    });

    it('throws on non-2xx HTTP response', () => {
      mockFetch({ code: 401, text: '{"detail": "unauthorized"}' });
      expect(() => (global as any).ElevenLabsService.listVoices())
        .toThrow('ElevenLabs listVoices error 401');
    });
  });

  // ── listModels ───────────────────────────────────────────────────────────

  describe('listModels', () => {
    beforeEach(() => {
      resetProps('sk_test');
      loadRealService();
    });

    it('throws when no API key is set', () => {
      resetProps(null);
      loadRealService();
      expect(() => (global as any).ElevenLabsService.listModels())
        .toThrow('API key');
    });

    it('returns only TTS-capable models', () => {
      mockFetch({
        text: JSON.stringify([
          { model_id: 'eleven_multilingual_v2', name: 'Multilingual v2', description: '', can_do_text_to_speech: true },
          { model_id: 'eleven_turbo_v2_5',      name: 'Turbo v2.5',      description: '', can_do_text_to_speech: true },
          { model_id: 'whisper_stt',             name: 'Whisper STT',     description: '', can_do_text_to_speech: false },
        ]),
      });
      const result = (global as any).ElevenLabsService.listModels();
      expect(result).toHaveLength(2);
      expect(result.find((m: any) => m.model_id === 'whisper_stt')).toBeUndefined();
    });

    it('normalises each model to the ElevenLabsModel shape', () => {
      mockFetch({
        text: JSON.stringify([
          { model_id: 'eleven_multilingual_v2', name: 'Multilingual v2', description: 'Great model', can_do_text_to_speech: true },
        ]),
      });
      const [m] = (global as any).ElevenLabsService.listModels();
      expect(m.model_id).toBe('eleven_multilingual_v2');
      expect(m.name).toBe('Multilingual v2');
      expect(m.description).toBe('Great model');
    });

    it('returns empty array when API returns an empty array', () => {
      mockFetch({ text: '[]' });
      expect((global as any).ElevenLabsService.listModels()).toEqual([]);
    });

    it('throws on non-2xx HTTP response', () => {
      mockFetch({ code: 403, text: '{"detail": "forbidden"}' });
      expect(() => (global as any).ElevenLabsService.listModels())
        .toThrow('ElevenLabs listModels error 403');
    });
  });

  // ── prefetchPronunciationDictionaries / getCachedPronunciationDictionaries ─

  describe('prefetchPronunciationDictionaries', () => {
    beforeEach(() => {
      resetProps('sk_test');
      // Give each test a fresh script-cache so prior entries don't leak.
      (global as any).CacheService.getDocumentCache =
        jest.fn().mockReturnValue((global as any).CacheService._createMockCache());
      loadRealService();
    });

    it('throws when no API key is set', () => {
      resetProps(null);
      loadRealService();
      expect(() => (global as any).ElevenLabsService.prefetchPronunciationDictionaries())
        .toThrow('API key');
    });

    it('stores dictionaries with grapheme+phoneme rules in ScriptCache', () => {
      // The detail endpoint (GET /v1/pronunciation-dictionaries/{id}) returns JSON,
      // not PLS XML. Rules use string_to_replace / alias / phoneme fields.
      const detailJson = JSON.stringify({
        id: 'dict1',
        latest_version_id: 'v1',
        name: 'My Dict',
        rules: [
          { string_to_replace: 'apple',  type: 'phoneme', phoneme: '\u02C8\u00E6p.\u0259l' },
          { string_to_replace: 'tomato', type: 'alias',   alias:   'tuh-MAY-toe' },
        ],
      });

      // Two sequential fetches: list → detail.
      const fetchMock = jest.fn()
        .mockReturnValueOnce({
          getResponseCode: jest.fn().mockReturnValue(200),
          getContentText:  jest.fn().mockReturnValue(JSON.stringify({
            pronunciation_dictionaries: [
              { id: 'dict1', latest_version_id: 'v1', name: 'My Dict' },
            ],
          })),
        })
        .mockReturnValueOnce({
          getResponseCode: jest.fn().mockReturnValue(200),
          getContentText:  jest.fn().mockReturnValue(detailJson),
        });
      (global as any).UrlFetchApp = { fetch: fetchMock };

      (global as any).ElevenLabsService.prefetchPronunciationDictionaries();

      const cached = (global as any).ElevenLabsService.getCachedPronunciationDictionaries();
      expect(cached).toHaveLength(1);
      expect(cached[0].id).toBe('dict1');
      expect(cached[0].version_id).toBe('v1');
      expect(cached[0].name).toBe('My Dict');
      expect(cached[0].rules).toEqual([
        { string_to_replace: 'apple',  replace_with: '\u02C8\u00E6p.\u0259l', alphabet: 'ipa' },
        { string_to_replace: 'tomato', replace_with: 'tuh-MAY-toe',           alphabet: ''    },
      ]);
    });

    it('detail endpoint URL does not include /download (regression: 404 from wrong URL)', () => {
      // Regression: old code called /download?version_id=... which returned 404.
      // Correct URL is GET /v1/pronunciation-dictionaries/{id} (no /download).
      const fetchMock = jest.fn()
        .mockReturnValueOnce({
          getResponseCode: jest.fn().mockReturnValue(200),
          getContentText:  jest.fn().mockReturnValue(JSON.stringify({
            pronunciation_dictionaries: [
              { id: 'dictA', latest_version_id: 'ver42', name: 'Test' },
            ],
          })),
        })
        .mockReturnValueOnce({
          getResponseCode: jest.fn().mockReturnValue(200),
          getContentText:  jest.fn().mockReturnValue(JSON.stringify({
            id: 'dictA', latest_version_id: 'ver42', name: 'Test',
            rules: [{ string_to_replace: 'word', type: 'alias', alias: 'werd' }],
          })),
        });
      (global as any).UrlFetchApp = { fetch: fetchMock };

      (global as any).ElevenLabsService.prefetchPronunciationDictionaries();

      // Confirm the detail call used the correct URL (no /download, no version_id param).
      const detailUrl = fetchMock.mock.calls[1][0] as string;
      expect(detailUrl).not.toContain('/download');
      expect(detailUrl).not.toContain('version_id');
      expect(detailUrl).toContain('/pronunciation-dictionaries/dictA');

      const cached = (global as any).ElevenLabsService.getCachedPronunciationDictionaries();
      expect(cached[0].version_id).toBe('ver42');
      expect(cached[0].rules).toEqual([{ string_to_replace: 'word', replace_with: 'werd', alphabet: '' }]);
    });

    it('caches an empty array when the dictionary list is empty', () => {
      mockFetch({ text: JSON.stringify({ pronunciation_dictionaries: [] }) });

      (global as any).ElevenLabsService.prefetchPronunciationDictionaries();

      const cached = (global as any).ElevenLabsService.getCachedPronunciationDictionaries();
      expect(cached).toEqual([]);
    });

    it('stores empty graphemes and does not throw when a download fails', () => {
      const fetchMock = jest.fn()
        .mockReturnValueOnce({
          getResponseCode: jest.fn().mockReturnValue(200),
          getContentText:  jest.fn().mockReturnValue(JSON.stringify({
            pronunciation_dictionaries: [
              { id: 'dict1', latest_version_id: 'v1', name: 'Bad Dict' },
            ],
          })),
        })
        .mockReturnValueOnce({
          getResponseCode: jest.fn().mockReturnValue(403),
          getContentText:  jest.fn().mockReturnValue('{"detail":"forbidden"}'),
        });
      (global as any).UrlFetchApp = { fetch: fetchMock };

      expect(() =>
        (global as any).ElevenLabsService.prefetchPronunciationDictionaries()
      ).not.toThrow();

      const cached = (global as any).ElevenLabsService.getCachedPronunciationDictionaries();
      expect(cached).toHaveLength(1);
      expect(cached[0].rules).toEqual([]);
    });

    it('throws on non-2xx list response', () => {
      mockFetch({ code: 401, text: '{"detail":"unauthorized"}' });
      expect(() => (global as any).ElevenLabsService.prefetchPronunciationDictionaries())
        .toThrow('ElevenLabs listPronunciationDictionaries error 401');
    });
  });

  describe('getCachedPronunciationDictionaries', () => {
    beforeEach(() => {
      (global as any).CacheService.getDocumentCache =
        jest.fn().mockReturnValue((global as any).CacheService._createMockCache());
      resetProps('sk_test');
      loadRealService();
    });

    it('returns null when the cache is empty', () => {
      expect((global as any).ElevenLabsService.getCachedPronunciationDictionaries()).toBeNull();
    });

    it('returns null when the cached JSON is malformed', () => {
      (global as any).CacheService.getDocumentCache().put('ELEVENLABS_PRON_DICTS', 'not-json', 3600);
      expect((global as any).ElevenLabsService.getCachedPronunciationDictionaries()).toBeNull();
    });

    it('returns the parsed array when valid JSON is cached', () => {
      const dicts = [
        { id: 'dict1', version_id: 'v1', name: 'Test',
          rules: [{ string_to_replace: 'apple', replace_with: '\u02C8\u00E6p.\u0259l', alphabet: 'ipa' }] },
      ];
      (global as any).CacheService.getDocumentCache()
        .put('ELEVENLABS_PRON_DICTS', JSON.stringify(dicts), 3600);

      const result = (global as any).ElevenLabsService.getCachedPronunciationDictionaries();
      expect(result).toEqual(dicts);
    });
  });

  // ── textToSpeech ─────────────────────────────────────────────────────────

  describe('textToSpeech', () => {
    beforeEach(() => {
      resetProps('sk_live_key');
      loadRealService();
    });

    it('throws when text is empty', () => {
      expect(() => (global as any).ElevenLabsService.textToSpeech('', 'voice_abc'))
        .toThrow('text is empty');
    });

    it('throws when text is whitespace only', () => {
      expect(() => (global as any).ElevenLabsService.textToSpeech('   ', 'voice_abc'))
        .toThrow('text is empty');
    });

    it('throws when voiceId is empty', () => {
      expect(() => (global as any).ElevenLabsService.textToSpeech('Hello', ''))
        .toThrow('voiceId is required');
    });

    it('throws when no API key is set', () => {
      resetProps(null);
      loadRealService();
      expect(() => (global as any).ElevenLabsService.textToSpeech('Hello', 'voice_abc'))
        .toThrow('API key');
    });

    it('calls the correct TTS endpoint URL', () => {
      const fetch = mockFetch({ bytes: [72, 101, 108, 108, 111] });
      (global as any).ElevenLabsService.textToSpeech('Hello', 'voice_xyz', 'eleven_multilingual_v2');

      const [url] = fetch.mock.calls[0];
      expect(url).toContain('/v1/text-to-speech/voice_xyz');
      expect(url).toContain('output_format=mp3_44100_128');
    });

    it('sends the xi-api-key header (not in URL)', () => {
      const fetch = mockFetch({ bytes: [1] });
      (global as any).ElevenLabsService.textToSpeech('Hello', 'voice_xyz');

      const [url, opts] = fetch.mock.calls[0];
      expect(url).not.toContain('sk_live_key');
      expect(opts.headers['xi-api-key']).toBe('sk_live_key');
    });

    it('sends correct JSON payload', () => {
      const fetch = mockFetch({ bytes: [1] });
      (global as any).ElevenLabsService.textToSpeech('Hello world', 'voice_xyz', 'eleven_turbo_v2_5');

      const [, opts] = fetch.mock.calls[0];
      const body = JSON.parse(opts.payload);
      expect(body.text).toBe('Hello world');
      expect(body.model_id).toBe('eleven_turbo_v2_5');
      expect(typeof body.voice_settings.stability).toBe('number');
      expect(typeof body.voice_settings.similarity_boost).toBe('number');
    });

    it('falls back to default model when modelId is omitted', () => {
      const fetch = mockFetch({ bytes: [1] });
      (global as any).ElevenLabsService.textToSpeech('Hello', 'voice_xyz');

      const [, opts] = fetch.mock.calls[0];
      const body = JSON.parse(opts.payload);
      expect(body.model_id).toBe('eleven_multilingual_v2');
    });

    it('returns the base64-encoded audio bytes', () => {
      mockFetch({ bytes: [72, 101, 108, 108, 111] });
      (global as any).Utilities.base64Encode = jest.fn().mockReturnValue('SGVsbG8=');

      const result = (global as any).ElevenLabsService.textToSpeech('Hello', 'voice_xyz');
      expect(result).toBe('SGVsbG8=');
    });

    it('throws on non-2xx TTS response', () => {
      mockFetch({ code: 429, text: '{"detail": {"status": "quota_exceeded"}}' });
      expect(() => (global as any).ElevenLabsService.textToSpeech('Hello', 'voice_abc'))
        .toThrow('ElevenLabs TTS error 429');
    });

    it('URL-encodes voice IDs that contain special characters', () => {
      const fetch = mockFetch({ bytes: [1] });
      (global as any).ElevenLabsService.textToSpeech('Hello', 'voice id/with spaces');

      const [url] = fetch.mock.calls[0];
      expect(url).not.toContain('voice id/with spaces');
      expect(url).toContain(encodeURIComponent('voice id/with spaces'));
    });
  });

  // ── Pronunciation dictionary locator injection ────────────────────────────

  describe('pronunciation dictionary locators in textToSpeech', () => {
    let scriptCache: any;

    const makeRule = (str: string, alphabet = '') => ({
      string_to_replace: str, replace_with: '/foo/', alphabet,
    });

    beforeEach(() => {
      // Fresh script-cache per test so locator tests are isolated.
      scriptCache = (global as any).CacheService._createMockCache();
      (global as any).CacheService.getDocumentCache = jest.fn().mockReturnValue(scriptCache);
      // resetProps replaces the entire PropertiesService object, so call it first.
      resetProps('sk_live_key');
      // Preserve the API key while defaulting selected dictionary to null.
      (global as any).PropertiesService.getDocumentProperties = jest.fn().mockReturnValue({
        getProperty: jest.fn().mockImplementation((key: string) => {
          if (key === 'ELEVENLABS_API_KEY') return 'sk_live_key';
          if (key === 'ELEVENLABS_PRON_DICT_ID') return null;
          return null;
        }),
        setProperty: jest.fn(),
      });
      loadRealService();
    });

    it('includes pronunciation_dictionary_locators when text matches a rule', () => {
      scriptCache.put(
        'ELEVENLABS_PRON_DICTS',
        JSON.stringify([{ id: 'dict1', version_id: 'v1', name: 'Dict',
          rules: [makeRule('apple', 'ipa')] }]),
        3600,
      );

      const fetch = mockFetch({ bytes: [1] });
      (global as any).ElevenLabsService.textToSpeech('I like apple pie', 'voice_xyz');

      const body = JSON.parse(fetch.mock.calls[0][1].payload);
      expect(body.pronunciation_dictionary_locators).toEqual([
        { pronunciation_dictionary_id: 'dict1', version_id: 'v1' },
      ]);
    });

    it('omits pronunciation_dictionary_locators when no rule matches', () => {
      scriptCache.put(
        'ELEVENLABS_PRON_DICTS',
        JSON.stringify([{ id: 'dict1', version_id: 'v1', name: 'Dict',
          rules: [makeRule('zyzzyva')] }]),
        3600,
      );

      const fetch = mockFetch({ bytes: [1] });
      (global as any).ElevenLabsService.textToSpeech('Hello world', 'voice_xyz');

      const body = JSON.parse(fetch.mock.calls[0][1].payload);
      expect(body.pronunciation_dictionary_locators).toBeUndefined();
    });

    it('omits pronunciation_dictionary_locators when cache is empty', () => {
      const fetch = mockFetch({ bytes: [1] });
      (global as any).ElevenLabsService.textToSpeech('Hello world', 'voice_xyz');

      const body = JSON.parse(fetch.mock.calls[0][1].payload);
      expect(body.pronunciation_dictionary_locators).toBeUndefined();
    });

    it('uses only the selected dictionary (no longer caps at 3)', () => {
      // Only the first (default-selected) dict is used when no preference is saved.
      const dicts = [1, 2, 3, 4, 5].map(i => ({
        id: `dict${i}`, version_id: `v${i}`, name: `Dict ${i}`,
        rules: [makeRule('hello')],
      }));
      scriptCache.put('ELEVENLABS_PRON_DICTS', JSON.stringify(dicts), 3600);

      const fetch = mockFetch({ bytes: [1] });
      (global as any).ElevenLabsService.textToSpeech('Hello world', 'voice_xyz');

      const body = JSON.parse(fetch.mock.calls[0][1].payload);
      // Single dict returned (the default first one).
      expect(body.pronunciation_dictionary_locators).toHaveLength(1);
      expect(body.pronunciation_dictionary_locators[0].pronunciation_dictionary_id).toBe('dict1');
    });

    it('uses the saved selected dictionary when a preference is set', () => {
      const dicts = [
        { id: 'dictA', version_id: 'vA', name: 'Dict A', rules: [makeRule('hello')] },
        { id: 'dictB', version_id: 'vB', name: 'Dict B', rules: [makeRule('hello')] },
      ];
      scriptCache.put('ELEVENLABS_PRON_DICTS', JSON.stringify(dicts), 3600);
      // Simulate user having selected dictB.
      (global as any).PropertiesService.getDocumentProperties = jest.fn().mockReturnValue({
        getProperty: jest.fn().mockImplementation((key: string) => {
          if (key === 'ELEVENLABS_API_KEY') return 'sk_live_key';
          if (key === 'ELEVENLABS_PRON_DICT_ID') return 'dictB';
          return null;
        }),
        setProperty: jest.fn(),
      });
      loadRealService();

      const fetch = mockFetch({ bytes: [1] });
      (global as any).ElevenLabsService.textToSpeech('Hello world', 'voice_xyz');

      const body = JSON.parse(fetch.mock.calls[0][1].payload);
      expect(body.pronunciation_dictionary_locators).toHaveLength(1);
      expect(body.pronunciation_dictionary_locators[0].pronunciation_dictionary_id).toBe('dictB');
    });

    it('performs case-insensitive matching on string_to_replace', () => {
      scriptCache.put(
        'ELEVENLABS_PRON_DICTS',
        JSON.stringify([{ id: 'dict1', version_id: 'v1', name: 'Dict',
          rules: [makeRule('APPLE', 'ipa')] }]),
        3600,
      );

      const fetch = mockFetch({ bytes: [1] });
      (global as any).ElevenLabsService.textToSpeech('I like apple pie', 'voice_xyz');

      const body = JSON.parse(fetch.mock.calls[0][1].payload);
      expect(body.pronunciation_dictionary_locators).toBeDefined();
      expect(body.pronunciation_dictionary_locators).toHaveLength(1);
    });
  });

});
