// ============================================================
// ElevenLabsService.ts — ElevenLabs TTS API wrapper
//
// Mirrors the GeminiService module pattern:
//   • IIFE closure — one global constant, all internals private.
//   • API key resolved from env → DocumentProperties.
//   • Key is always sent in an HTTP header (xi-api-key), never in the URL,
//     to avoid exposure in server logs or proxy logs.
//   • Execution-scoped caching for the API key avoids repeated IPC calls
//     within a single GAS execution.
// ============================================================

const ElevenLabsService = (() => {

  const API_BASE        = 'https://api.elevenlabs.io/v1';
  const PROP_KEY_API    = 'ELEVENLABS_API_KEY';
  const PROP_KEY_MODEL  = 'ELEVENLABS_MODEL_ID';
  const PROP_KEY_VOICE  = 'ELEVENLABS_VOICE_ID';
  const PROP_KEY_LASTGEN = 'ELEVENLABS_LAST_GEN';
  /** Used when no model has been saved in Properties. */
  const DEFAULT_MODEL   = 'eleven_multilingual_v2';
  const CACHE_KEY_VOICE_MAP  = 'ELEVENLABS_VOICE_MAPPING';
  const CACHE_KEY_PRON_DICTS = 'ELEVENLABS_PRON_DICTS';
  /** Document property key for the user-selected pronunciation dictionary ID. */
  const PROP_KEY_PRON_DICT   = 'ELEVENLABS_PRON_DICT_ID';
  /** TTL for voice mapping and pronunciation dictionary caches: 1 hour. */
  const CACHE_TTL_VOICE_MAP  = 3600;
  const CACHE_TTL_PRON_DICTS = 3600;

  // ── Execution-scoped cache ───────────────────────────────────────────────
  // undefined = not yet resolved;  null = resolved but absent.
  let cachedApiKey_: string | null | undefined = undefined;

  // ── API key helpers ──────────────────────────────────────────────────────

  /**
   * Resolution order (mirrors GeminiService.resolveApiKey_):
   *   1. process.env.ELEVENLABS_API_KEY  (test / CI environments only)
   *   2. DocumentProperties              (shared across document collaborators)
   */
  function resolveApiKey_(): string | null {
    if (typeof process !== 'undefined' && process.env.ELEVENLABS_API_KEY) {
      return process.env.ELEVENLABS_API_KEY;
    }
    return PropertiesService.getDocumentProperties().getProperty(PROP_KEY_API) || null;
  }

  function getApiKey_(): string {
    if (cachedApiKey_ === undefined) {
      cachedApiKey_ = resolveApiKey_();
    }
    if (!cachedApiKey_) {
      throw new Error(
        'ElevenLabs API key not set. Open the TTS dialog and enter your API key.'
      );
    }
    return cachedApiKey_;
  }

  /** Persists the key to DocumentProperties and invalidates the execution cache. */
  function saveApiKey(key: string): void {
    PropertiesService.getDocumentProperties().setProperty(PROP_KEY_API, key.trim());
    cachedApiKey_ = undefined;
  }

  function hasApiKey(): boolean {
    return !!(resolveApiKey_());
  }

  // ── Model helpers ────────────────────────────────────────────────────────

  function resolveModel_(): string {
    return (
      PropertiesService.getDocumentProperties().getProperty(PROP_KEY_MODEL) ||
      DEFAULT_MODEL
    );
  }

  /** Persists the preferred model ID to DocumentProperties. */
  function saveModelId(modelId: string): void {
    PropertiesService.getDocumentProperties().setProperty(PROP_KEY_MODEL, modelId.trim());
  }

  function getModelId(): string {
    return resolveModel_();
  }

  // ── Voice-ID preference ──────────────────────────────────────────────────

  /** Persists the preferred voice ID to DocumentProperties. */
  function saveVoiceId(voiceId: string): void {
    PropertiesService.getDocumentProperties().setProperty(PROP_KEY_VOICE, voiceId.trim());
  }

  /**
   * Returns the last-saved voice ID from DocumentProperties,
   * or null if no preferred voice has been saved for this document.
   */
  function getSavedVoiceId(): string | null {
    return PropertiesService.getDocumentProperties().getProperty(PROP_KEY_VOICE) || null;
  }

  // ── Last-generation metadata ─────────────────────────────────────────────

  /**
   * Persists metadata about the most-recent successful TTS generation so the
   * dialog can surface it the next time it is opened.
   */
  function saveLastGeneration(meta: ElevenLabsLastGenMeta): void {
    PropertiesService.getDocumentProperties()
      .setProperty(PROP_KEY_LASTGEN, JSON.stringify(meta));
  }

  /**
   * Returns the persisted last-generation metadata, or null if none exists or
   * the stored JSON is malformed.
   */
  function getLastGeneration(): ElevenLabsLastGenMeta | null {
    const raw = PropertiesService.getDocumentProperties().getProperty(PROP_KEY_LASTGEN);
    if (!raw) return null;
    try { return JSON.parse(raw) as ElevenLabsLastGenMeta; } catch (_) { return null; }
  }

  function getCache_(): GoogleAppsScript.Cache.Cache {
    return CacheService.getDocumentCache();
  }

  // ── Error parsing ────────────────────────────────────────────────────────

  /**
   * Extracts a human-readable message from an ElevenLabs error response body.
   *
   * ElevenLabs returns errors in two shapes:
   *   { "detail": "plain string" }
   *   { "detail": { "status": "quota_exceeded", "message": "..." } }
   *
   * Both are flattened to a single string so callers see a clean sentence
   * rather than a raw JSON blob.  Falls back to the raw text if parsing fails.
   */
  function parseApiError_(raw: string): string {
    try {
      const body = JSON.parse(raw);
      if (!body.detail) return raw;
      if (typeof body.detail === 'string') return body.detail;
      if (typeof body.detail === 'object') {
        const msg    = body.detail.message ?? '';
        const status = body.detail.status  ?? '';
        return (msg || status) ? [status, msg].filter(Boolean).join(': ') : raw;
      }
    } catch (_) { /* fall through */ }
    return raw;
  }

  // ── Shared fetch helper ──────────────────────────────────────────────────

  /**
   * Builds UrlFetchApp options, injecting the API key as the `xi-api-key`
   * header instead of a URL query parameter (OWASP sensitive data exposure).
   */
  function buildOptions_(
    apiKey: string,
    extra: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {}
  ): GoogleAppsScript.URL_Fetch.URLFetchRequestOptions {
    return {
      ...extra,
      headers: {
        ...(extra.headers as object | undefined ?? {}),
        'xi-api-key': apiKey,
      },
      muteHttpExceptions: true,
    };
  }

  // ── Public: voice listing ────────────────────────────────────────────────

  /**
   * Returns all voices available to the authenticated user (the "My Voices"
   * library in the ElevenLabs UI), normalised to {@link ElevenLabsVoice}.
   *
   * ElevenLabs voice objects carry a `labels` map that may include a
   * `"use case"` key with values such as `"narration"`, `"conversational"`,
   * or `"characters"`.  When `useCase` is supplied the list is filtered to
   * voices whose use-case label contains that string (case-insensitive).
   * Pass an empty string or omit the argument to get all voices.
   *
   * Results are sorted alphabetically by name.
   */
  function listVoices(useCase?: string): ElevenLabsVoice[] {
    const apiKey = getApiKey_();
    const resp = UrlFetchApp.fetch(`${API_BASE}/voices`, buildOptions_(apiKey));

    const code = resp.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error(`ElevenLabs listVoices error ${code}: ${parseApiError_(resp.getContentText())}`);
    }

    const data = JSON.parse(resp.getContentText());
    let voices: ElevenLabsVoice[] = ((data.voices ?? []) as any[]).map((v: any) => ({
      voice_id: String(v.voice_id ?? ''),
      name:     String(v.name ?? ''),
      category: String(v.category ?? ''),
      use_case: String((v.labels && v.labels['use case']) ? v.labels['use case'] : ''),
      labels:   (v.labels as Record<string, string>) ?? {},
    }));

    if (useCase && useCase.trim()) {
      const filter = useCase.trim().toLowerCase();
      voices = voices.filter(v => v.use_case.toLowerCase().includes(filter));
    }

    return voices.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ── Public: model listing ────────────────────────────────────────────────

  /**
   * Returns all TTS-capable models from the ElevenLabs `/v1/models` endpoint.
   *
   * The API returns a bare JSON array (not wrapped in an object).  Models that
   * have `can_do_text_to_speech: false` are excluded from the result.
   */
  function listModels(): ElevenLabsModel[] {
    const apiKey = getApiKey_();
    const resp = UrlFetchApp.fetch(`${API_BASE}/models`, buildOptions_(apiKey));

    const code = resp.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error(`ElevenLabs listModels error ${code}: ${parseApiError_(resp.getContentText())}`);
    }

    const data = JSON.parse(resp.getContentText());
    return ((Array.isArray(data) ? data : []) as any[])
      .filter((m: any) => m.can_do_text_to_speech !== false)
      .map((m: any) => ({
        model_id:    String(m.model_id    ?? ''),
        name:        String(m.name        ?? ''),
        description: String(m.description ?? ''),
      }));
  }

  // ── Public: text-to-speech synthesis ────────────────────────────────────

  /**
   * Synthesises `text` with the given voice and model and returns the
   * resulting audio as a **base64-encoded MP3** string.
   *
   * ElevenLabs accepts up to ≈5 000 characters per request on the standard
   * tier.  Callers are responsible for truncating or chunking longer texts
   * before calling this method.
   *
   * @param text     Plain text to convert (max ≈5 000 chars).
   * @param voiceId  ElevenLabs `voice_id` — required.
   * @param modelId  Optional model override; falls back to the user's saved
   *                 preference or `eleven_multilingual_v2`.
   * @returns        Base64-encoded MP3 audio data.
   */
  function textToSpeech(text: string, voiceId: string, modelId?: string): string {
    if (!text.trim())    throw new Error('textToSpeech: text is empty.');
    if (!voiceId.trim()) throw new Error('textToSpeech: voiceId is required.');

    const apiKey = getApiKey_();
    const model  = (modelId && modelId.trim()) ? modelId.trim() : resolveModel_();

    const url =
      `${API_BASE}/text-to-speech/${encodeURIComponent(voiceId)}` +
      `?output_format=mp3_44100_128`;

    const payload: Record<string, unknown> = {
      text,
      model_id: model,
      voice_settings: {
        stability:        0.6,
        similarity_boost: 0.75,
      },
    };

    const locators = getPronunciationDictionaryLocators_(text);
    if (locators.length > 0) {
      payload['pronunciation_dictionary_locators'] = locators;
    }

    const resp = UrlFetchApp.fetch(url, buildOptions_(apiKey, {
      method:      'post',
      contentType: 'application/json',
      payload:     JSON.stringify(payload),
    }));

    const code = resp.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error(`ElevenLabs TTS error ${code}: ${parseApiError_(resp.getContentText())}`);
    }

    return Utilities.base64Encode(resp.getBlob().getBytes());
  }

  // ── Request-stitching TTS ────────────────────────────────────────────────

  /**
   * Synthesises `text` and returns the raw audio bytes along with the
   * `request-id` response header that ElevenLabs uses for prosody stitching.
   *
   * Pass `previousRequestIds` (from prior calls) to have ElevenLabs continue
   * prosody across voice-change boundaries.  An empty array means no stitching.
   *
   * Used by `elevenLabsTextToSpeechFromDirectives` to build multi-voice audio.
   */
  function textToSpeechWithStitching(
    text: string,
    voiceId: string,
    modelId: string,
    previousRequestIds: string[],
    voiceSettings?: { stability: number; similarity_boost: number }
  ): { audioBytes: GoogleAppsScript.Byte[]; requestId: string } {
    if (!text.trim())    throw new Error('textToSpeechWithStitching: text is empty.');
    if (!voiceId.trim()) throw new Error('textToSpeechWithStitching: voiceId is required.');

    const apiKey = getApiKey_();
    const model  = (modelId && modelId.trim()) ? modelId.trim() : resolveModel_();
    const url    = `${API_BASE}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;

    const payload: Record<string, unknown> = {
      text,
      model_id: model,
      voice_settings: voiceSettings ?? { stability: 0.6, similarity_boost: 0.75 },
    };
    if (previousRequestIds.length > 0) {
      payload['previous_request_ids'] = previousRequestIds;
    }
    const locators = getPronunciationDictionaryLocators_(text);
    if (locators.length > 0) {
      payload['pronunciation_dictionary_locators'] = locators;
    }

    const resp = UrlFetchApp.fetch(url, buildOptions_(apiKey, {
      method:      'post',
      contentType: 'application/json',
      payload:     JSON.stringify(payload),
    }));

    const code = resp.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error(`ElevenLabs TTS error ${code}: ${parseApiError_(resp.getContentText())}`);
    }

    const headers  = resp.getHeaders() as Record<string, string>;
    const requestId = headers['request-id'] ?? headers['Request-Id'] ?? '';
    return { audioBytes: resp.getBlob().getBytes(), requestId };
  }

  // ── Pronunciation dictionary cache ───────────────────────────────────────

  /**
   * Fetches the list of pronunciation dictionaries the authenticated user owns
   * from the ElevenLabs `/v1/pronunciation-dictionaries` endpoint.
   *
   * Returns id, version_id, and name for each dictionary so callers can later
   * download the PLS lexicon and build TTS locators.
   */
  function listPronunciationDictionaries_(): Array<{ id: string; version_id: string; name: string }> {
    const apiKey = getApiKey_();
    Logger.log('[ElevenLabsService] listPronunciationDictionaries_: fetching list');
    const resp = UrlFetchApp.fetch(`${API_BASE}/pronunciation-dictionaries`, buildOptions_(apiKey));
    const code = resp.getResponseCode();
    Logger.log(`[ElevenLabsService] listPronunciationDictionaries_: response code=${code}`);
    if (code < 200 || code >= 300) {
      throw new Error(
        `ElevenLabs listPronunciationDictionaries error ${code}: ${parseApiError_(resp.getContentText())}`
      );
    }
    const data = JSON.parse(resp.getContentText());
    const dicts = ((data.pronunciation_dictionaries ?? []) as any[]).map((d: any) => {
      // ElevenLabs list endpoint returns `latest_version_id`, not `version_id`.
      // Accept either field so the code is robust to future API changes.
      const versionId = String(d.latest_version_id ?? d.version_id ?? '');
      Logger.log(`[ElevenLabsService] listPronunciationDictionaries_: dict raw fields — id=${d.id} latest_version_id=${d.latest_version_id} version_id=${d.version_id} name=${d.name}`);
      return {
        id:         String(d.id   ?? ''),
        version_id: versionId,
        name:       String(d.name ?? ''),
      };
    });
    Logger.log(`[ElevenLabsService] listPronunciationDictionaries_: found ${dicts.length} dict(s): ${dicts.map((d: any) => `${d.name}(v=${d.version_id})`).join(', ')}`);
    return dicts;
  }

  /**
   * Fetches the detail for a single pronunciation dictionary and returns its
   * rules as `{grapheme, phoneme}` pairs.
   *
   * Endpoint: GET /v1/pronunciation-dictionaries/{id}
   * Response shape (JSON):
   *   { "rules": [ { "string_to_replace": "...", "type": "alias"|"phoneme",
   *                  "alias": "...", "phoneme": "..." }, ... ] }
   *
   * The field `string_to_replace` is the grapheme.  For `type:"alias"` the
   * target is `alias`; for `type:"phoneme"` the target is `phoneme`.
   *
   * NOTE: there is a separate `/download` endpoint that returns PLS XML, but
   * it requires a different API-key permission scope.  The detail endpoint used
   * here returns JSON and works with the standard `pronunciation_dictionaries_read`
   * scope.
   *
   * Returns an empty array if the request fails — TTS is not blocked by a
   * missing or inaccessible dictionary.
   */
  function fetchDictionaryRules_(
    id: string,
  ): ElevenLabsPronunciationRule[] {
    const apiKey = getApiKey_();
    const url = `${API_BASE}/pronunciation-dictionaries/${encodeURIComponent(id)}`;

    Logger.log(`[ElevenLabsService] fetchDictionaryRules_: GET ${url}`);

    const resp = UrlFetchApp.fetch(url, buildOptions_(apiKey));
    const code = resp.getResponseCode();
    const body = resp.getContentText();

    Logger.log(`[ElevenLabsService] fetchDictionaryRules_: code=${code} body(300)=${body.substring(0, 300)}`);

    if (code < 200 || code >= 300) {
      throw new Error(
        `ElevenLabs fetchDictionaryRules error ${code}: ${parseApiError_(body)}`
      );
    }

    const data = JSON.parse(body);
    const rawRules: any[] = data.rules ?? [];

    Logger.log(`[ElevenLabsService] fetchDictionaryRules_: ${rawRules.length} raw rule(s) in dict id=${id}`);

    const rules: ElevenLabsPronunciationRule[] = rawRules
      .map((r: any) => ({
        string_to_replace: String(r.string_to_replace ?? ''),
        replace_with:      r.type === 'alias' ? String(r.alias ?? '') : String(r.phoneme ?? ''),
        alphabet:          r.type === 'phoneme' ? String(r.alphabet ?? 'ipa') : '',
      }))
      .filter(r => r.string_to_replace.length > 0);

    Logger.log(`[ElevenLabsService] fetchDictionaryRules_: ${rules.length} valid rule(s) after filter`);
    if (rules.length > 0) {
      Logger.log(`[ElevenLabsService] fetchDictionaryRules_: first rule = ${JSON.stringify(rules[0])}`);
    }

    return rules;
  }

  /**
   * Fetches all pronunciation dictionaries owned by the authenticated user,
   * extracts grapheme strings from each PLS lexicon file, and caches the
   * result in DocumentCache for {@link CACHE_TTL_PRON_DICTS} seconds.
   *
   * Called when the UI needs pronunciation dictionaries and when the API key
   * is saved. Subsequent lookups use {@link getCachedPronunciationDictionaries}.
   *
   * Individual dictionary download failures are swallowed — they produce an
   * empty `graphemes` array for that entry rather than aborting the whole
   * prefetch.  This ensures one bad dictionary does not prevent the others
   * from being available at generation time.
   */
  function prefetchPronunciationDictionaries(): void {
    const dicts = listPronunciationDictionaries_();
    const cached: ElevenLabsPronunciationDictionary[] = [];
    for (const d of dicts) {
      let rules: ElevenLabsPronunciationRule[] = [];
      try {
        rules = fetchDictionaryRules_(d.id);
      } catch (_) {
        // Non-fatal: skip this dictionary's rules if download fails.
      }
      cached.push({ id: d.id, version_id: d.version_id, name: d.name, rules });
    }
    getCache_().put(
      CACHE_KEY_PRON_DICTS,
      JSON.stringify(cached),
      CACHE_TTL_PRON_DICTS,
    );
  }

  /**
   * Returns the pronunciation dictionaries previously cached by
   * {@link prefetchPronunciationDictionaries}, or `null` if the cache has
   * expired or the prefetch has not run (e.g. no API key at startup).
   */
  function getCachedPronunciationDictionaries(): ElevenLabsPronunciationDictionary[] | null {
    const raw = getCache_().get(CACHE_KEY_PRON_DICTS);
    if (!raw) return null;
    try { return JSON.parse(raw) as ElevenLabsPronunciationDictionary[]; } catch (_) { return null; }
  }

  // ── Selected pronunciation dictionary preference ─────────────────────────

  /**
   * Persists the selected pronunciation dictionary ID to
   * DocumentProperties (shared across this document).
   */
  function saveSelectedDictionaryId(id: string): void {
    PropertiesService.getDocumentProperties().setProperty(PROP_KEY_PRON_DICT, id);
  }

  /**
   * Returns the user-selected pronunciation dictionary ID from
   * DocumentProperties, or null if none has been saved.
   */
  function getSelectedDictionaryId(): string | null {
    return PropertiesService.getDocumentProperties().getProperty(PROP_KEY_PRON_DICT) || null;
  }

  /**
   * Returns the single cached pronunciation dictionary the user has selected
   * (falls back to the first cached dict when nothing has been saved).
   * Returns null when the cache is empty.
   */
  function getSelectedDictionary_(): ElevenLabsPronunciationDictionary | null {
    const dicts = getCachedPronunciationDictionaries();
    if (!dicts || dicts.length === 0) return null;
    const savedId = getSelectedDictionaryId();
    if (savedId) {
      const found = dicts.find(d => d.id === savedId);
      if (found) return found;
    }
    return dicts[0]; // default to first
  }

  /**
   * Returns at most one TTS pronunciation dictionary locator for the
   * user-selected dictionary, when `text` contains at least one matching
   * `string_to_replace` entry (case-insensitive).
   *
   * The ElevenLabs TTS endpoint silently ignores empty `pronunciation_dictionary_locators`,
   * so callers simply omit the field when this returns `[]`.
   */
  function getPronunciationDictionaryLocators_(
    text: string,
  ): ElevenLabsPronunciationDictionaryLocator[] {
    const dict = getSelectedDictionary_();
    if (!dict) return [];
    const lower = text.toLowerCase();
    const hasMatch = dict.rules.some(
      r => r.string_to_replace && lower.includes(r.string_to_replace.toLowerCase())
    );
    if (!hasMatch) return [];
    return [{ pronunciation_dictionary_id: dict.id, version_id: dict.version_id }];
  }

  // ── Voice mapping cache ──────────────────────────────────────────────────

  /**
   * Fetches all voices and stores a {voiceId → voiceName} mapping in
   * DocumentCache so directives can display human-readable names without an
   * additional API round-trip at view time.
   *
   * Called lazily from the TTS UI when voice names are needed.
   * Subsequent reads use getVoiceMappings().
   */
  function prefetchVoiceMappings(): void {
    const voices = listVoices();
    const map: Record<string, string> = {};
    for (const v of voices) {
      map[v.voice_id] = v.name;
    }
    getCache_().put(
      CACHE_KEY_VOICE_MAP,
      JSON.stringify(map),
      CACHE_TTL_VOICE_MAP,
    );
  }

  /**
   * Returns the cached {voiceId → voiceName} mapping, or null if it has not
   * been populated yet (API key absent at startup or cache expired).
   */
  function getVoiceMappings(): Record<string, string> | null {
    const raw = getCache_().get(CACHE_KEY_VOICE_MAP);
    if (!raw) return null;
    try { return JSON.parse(raw) as Record<string, string>; } catch (_) { return null; }
  }

  /**
   * Returns cached voice mappings when available; otherwise fetches voices,
   * seeds the cache, and returns the fresh map. Safe for lazy UI initialization.
   */
  function ensureVoiceMappings(): Record<string, string> | null {
    const cached = getVoiceMappings();
    if (cached) return cached;
    if (!hasApiKey()) return null;
    prefetchVoiceMappings();
    return getVoiceMappings();
  }

  /** Returns true when voice mappings have been stored in CacheService. */
  function hasVoiceMappings(): boolean {
    return getCache_().get(CACHE_KEY_VOICE_MAP) !== null;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  return {
    saveApiKey,
    hasApiKey,
    saveModelId,
    getModelId,
    saveVoiceId,
    getSavedVoiceId,
    saveLastGeneration,
    getLastGeneration,
    listVoices,
    listModels,
    textToSpeech,
    textToSpeechWithStitching,
    prefetchVoiceMappings,
    getVoiceMappings,
    ensureVoiceMappings,
    hasVoiceMappings,
    prefetchPronunciationDictionaries,
    getCachedPronunciationDictionaries,
    saveSelectedDictionaryId,
    getSelectedDictionaryId,
  };

})();
