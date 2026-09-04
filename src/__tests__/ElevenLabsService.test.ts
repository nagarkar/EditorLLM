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

import { loadCompiledGlobal, mockUrlFetch } from './helpers/gasVmContext';

// ── Helpers ────────────────────────────────────────────────────────────────

function loadRealService(): void {
  loadCompiledGlobal('ElevenLabsService', 'ElevenLabsService.js');
}

/**
 * Resets the PropertiesService mock so each test starts with a clean slate.
 * Returns the underlying jest.fn() handles for targeted assertions.
 *
 * Key resolution order: UserProperties → DocumentProperties → ScriptProperties.
 *   apiKey  → ELEVENLABS_API_KEY   (UserProperties — primary store)
 *   modelId → ELEVENLABS_MODEL_ID  (DocumentProperties — doc-scoped preference)
 *   voiceId → ELEVENLABS_VOICE_ID  (DocumentProperties — doc-scoped preference)
 */
function resetProps(
  apiKey:  string | null = null,
  modelId: string | null = null,
  voiceId: string | null = null,
) {
  const userGet = jest.fn().mockImplementation((key: string) => {
    if (key === 'ELEVENLABS_API_KEY') return apiKey;
    return null;
  });
  const userSet = jest.fn();

  // DocumentProperties holds doc-scoped preferences (model, voice).
  // ELEVENLABS_API_KEY is null here — it lives in UserProperties now.
  const docGet = jest.fn().mockImplementation((key: string) => {
    if (key === 'ELEVENLABS_MODEL_ID') return modelId;
    if (key === 'ELEVENLABS_VOICE_ID') return voiceId;
    return null;
  });
  const docSet = jest.fn();

  (global as any).PropertiesService = {
    getUserProperties: jest.fn().mockReturnValue({
      getProperty: userGet,
      setProperty: userSet,
    }),
    getDocumentProperties: jest.fn().mockReturnValue({
      getProperty: docGet,
      setProperty: docSet,
    }),
    getScriptProperties: jest.fn().mockReturnValue({
      getProperty: jest.fn().mockReturnValue(null),
      setProperty: jest.fn(),
    }),
  };

  return { userGet, userSet, docGet, docSet };
}

/** Replaces UrlFetchApp.fetch with a mock that returns the given shape. */
const mockFetch = mockUrlFetch;

// ── Test suite ──────────────────────────────────────────────────────────────

describe('ElevenLabsService', () => {

  // Reload the real service before every test so the execution-scoped
  // cachedApiKey_ closure is reset to `undefined`.
  beforeEach(() => {
    resetProps(null);
    mockFetch({});
    loadRealService();
  });

  // ── hasApiKey / saveApiKey ───────────────────────────────────────────────

  describe('hasApiKey', () => {
    it('returns false when no key is configured', () => {
      expect((global as any).ElevenLabsService.hasApiKey()).toBe(false);
    });

    it('returns true when UserProperties holds a key', () => {
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
    it('writes the trimmed key to UserProperties', () => {
      const { userSet } = resetProps(null);
      loadRealService();
      (global as any).ElevenLabsService.saveApiKey('  sk_new_key  ');
      expect(userSet).toHaveBeenCalledWith('ELEVENLABS_API_KEY', 'sk_new_key');
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

  // ── getUserSubscription ──────────────────────────────────────────────────

  describe('getUserSubscription', () => {
    beforeEach(() => {
      resetProps('sk_test');
      loadRealService();
    });

    it('throws when no API key is set', () => {
      resetProps(null);
      loadRealService();
      expect(() => (global as any).ElevenLabsService.getUserSubscription())
        .toThrow('API key');
    });

    it('returns characterCount and characterLimit from the subscription endpoint', () => {
      mockFetch({
        text: JSON.stringify({
          tier: 'creator',
          character_count: 12500,
          character_limit: 100000,
        }),
      });
      const result = (global as any).ElevenLabsService.getUserSubscription();
      expect(result).toEqual({ characterCount: 12500, characterLimit: 100000 });
    });

    it('coerces missing counts to 0', () => {
      mockFetch({ text: '{}' });
      const result = (global as any).ElevenLabsService.getUserSubscription();
      expect(result).toEqual({ characterCount: 0, characterLimit: 0 });
    });

    it('sends the xi-api-key header (not in URL)', () => {
      const fetchMock = mockFetch({
        text: JSON.stringify({ character_count: 0, character_limit: 0 }),
      });
      (global as any).ElevenLabsService.getUserSubscription();
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.elevenlabs.io/v1/user/subscription');
      expect(url).not.toContain('sk_test');
      expect(opts.headers['xi-api-key']).toBe('sk_test');
    });

    it('throws on non-2xx HTTP response', () => {
      mockFetch({ code: 401, text: '{"detail": "unauthorized"}' });
      expect(() => (global as any).ElevenLabsService.getUserSubscription())
        .toThrow('ElevenLabs subscription error 401');
    });
  });

});
