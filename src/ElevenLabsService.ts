// ============================================================
// ElevenLabsService.ts — ElevenLabs API wrapper (manifest-building only)
//
// Responsibilities after GAS audio-generation removal:
//   • API key storage / resolution
//   • Model ID storage (for directive defaults)
//   • Voice ID preference storage
//   • Voice listing / caching (for voice-name resolution in directives panel)
//   • Model listing (for directive defaults)
//   • Account subscription query (credits display)
//   • Voice-mapping cache (voiceId → voiceName for directives panel)
//
// Removed (now owned by Tauri desktop app):
//   • textToSpeech / textToSpeechWithStitching
//   • Pronunciation dictionary fetch / cache / locator building
//   • Last-generation / recent-audio metadata
//   • Drive audio save helpers
// ============================================================

const ElevenLabsService = (() => {

  const API_BASE        = 'https://api.elevenlabs.io/v1';
  const PROP_KEY_API    = 'ELEVENLABS_API_KEY';
  const PROP_KEY_MODEL  = 'ELEVENLABS_MODEL_ID';
  const PROP_KEY_VOICE  = 'ELEVENLABS_VOICE_ID';
  /** Used when no model has been saved in Properties. */
  const DEFAULT_MODEL   = 'eleven_multilingual_v2';
  const CACHE_KEY_VOICE_MAP  = 'ELEVENLABS_VOICE_MAPPING';
  /** TTL for voice mapping cache: 1 hour. */
  const CACHE_TTL_VOICE_MAP  = 3600;

  // ── Execution-scoped cache ───────────────────────────────────────────────
  // undefined = not yet resolved;  null = resolved but absent.
  let cachedApiKey_: string | null | undefined = undefined;

  // ── API key helpers ──────────────────────────────────────────────────────

  /**
   * Resolution order:
   *   1. process.env.ELEVENLABS_API_KEY  (test / CI environments only)
   *   2. UserProperties                  (user-specific key, preferred)
   *   3. DocumentProperties              (legacy: shared across document collaborators)
   *   4. ScriptProperties                (legacy: deployment-wide fallback)
   */
  function resolveApiKey_(): string | null {
    if (typeof process !== 'undefined' && process.env.ELEVENLABS_API_KEY) {
      return process.env.ELEVENLABS_API_KEY;
    }
    return (
      PropertiesService.getUserProperties().getProperty(PROP_KEY_API) ||
      PropertiesService.getDocumentProperties().getProperty(PROP_KEY_API) ||
      PropertiesService.getScriptProperties().getProperty(PROP_KEY_API)
    );
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

  /** Persists the key to UserProperties and invalidates the execution cache. */
  function saveApiKey(key: string): void {
    PropertiesService.getUserProperties().setProperty(PROP_KEY_API, key.trim());
    cachedApiKey_ = undefined;
  }

  function hasApiKey(): boolean {
    return !!(resolveApiKey_());
  }

  // ── Model helpers ────────────────────────────────────────────────────────

  function resolveModel_(): string {
    return DocPropsCache.read(PROP_KEY_MODEL) || DEFAULT_MODEL;
  }

  /** Persists the preferred model ID to DocumentProperties. */
  function saveModelId(modelId: string): void {
    DocPropsCache.write(PROP_KEY_MODEL, modelId.trim());
  }

  function getModelId(): string {
    return resolveModel_();
  }

  // ── Voice-ID preference ──────────────────────────────────────────────────

  /** Persists the preferred voice ID to DocumentProperties. */
  function saveVoiceId(voiceId: string): void {
    DocPropsCache.write(PROP_KEY_VOICE, voiceId.trim());
  }

  /**
   * Returns the last-saved voice ID from DocumentProperties,
   * or null if no preferred voice has been saved for this document.
   */
  function getSavedVoiceId(): string | null {
    return DocPropsCache.read(PROP_KEY_VOICE) || null;
  }

  function getCache_(): GoogleAppsScript.Cache.Cache {
    return CacheService.getDocumentCache();
  }

  // ── Error parsing ────────────────────────────────────────────────────────

  /**
   * Extracts a human-readable message from an ElevenLabs error response body.
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
   * header instead of a URL query parameter.
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
   * Returns all voices available to the authenticated user, normalised to
   * {@link ElevenLabsVoice}. Results are sorted alphabetically by name.
   */
  function listVoices(useCase?: string): ElevenLabsVoice[] {
    const apiKey = getApiKey_();
    let allVoices: ElevenLabsVoice[] = [];
    let nextCursor: string | null = null;

    do {
      let url = `${API_BASE}/voices?show_legacy=true`;
      if (nextCursor) url += `&next_cursor=${encodeURIComponent(nextCursor)}`;

      const resp = UrlFetchApp.fetch(url, buildOptions_(apiKey));
      const code = resp.getResponseCode();
      if (code < 200 || code >= 300) {
        throw new Error(`ElevenLabs listVoices error ${code}: ${parseApiError_(resp.getContentText())}`);
      }

      const data = JSON.parse(resp.getContentText());
      const page: ElevenLabsVoice[] = ((data.voices ?? []) as any[]).map((v: any) => ({
        voice_id: String(v.voice_id ?? ''),
        name:     String(v.name ?? ''),
        category: String(v.category ?? ''),
        use_case: String((v.labels && v.labels['use case']) ? v.labels['use case'] : ''),
        labels:   (v.labels as Record<string, string>) ?? {},
      }));
      allVoices = allVoices.concat(page);
      nextCursor = (data.next_cursor && String(data.next_cursor).trim()) ? String(data.next_cursor) : null;
    } while (nextCursor);

    if (useCase && useCase.trim()) {
      const filter = useCase.trim().toLowerCase();
      allVoices = allVoices.filter(v => v.use_case.toLowerCase().includes(filter));
    }

    return allVoices.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ── Public: model listing ────────────────────────────────────────────────

  /**
   * Returns all TTS-capable models from the ElevenLabs `/v1/models` endpoint.
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

  // ── Public: account / quota ─────────────────────────────────────────────

  /**
   * Returns the authenticated user's character usage and limit.
   */
  function getUserSubscription(): ElevenLabsSubscription {
    const apiKey = getApiKey_();
    const resp = UrlFetchApp.fetch(`${API_BASE}/user/subscription`, buildOptions_(apiKey));
    const code = resp.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error(`ElevenLabs subscription error ${code}: ${parseApiError_(resp.getContentText())}`);
    }
    const data = JSON.parse(resp.getContentText());
    return {
      characterCount: Number(data.character_count ?? 0),
      characterLimit: Number(data.character_limit ?? 0),
    };
  }

  // ── Voice mapping cache ──────────────────────────────────────────────────

  /**
   * Fetches all voices and stores a {voiceId → voiceName} mapping in
   * DocumentCache so directives can display human-readable names without an
   * additional API round-trip at view time.
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
   * been populated yet.
   */
  function getVoiceMappings(): Record<string, string> | null {
    const raw = getCache_().get(CACHE_KEY_VOICE_MAP);
    if (!raw) return null;
    try { return JSON.parse(raw) as Record<string, string>; } catch (_) { return null; }
  }

  /**
   * Returns cached voice mappings when available; otherwise fetches voices,
   * seeds the cache, and returns the fresh map.
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
    listVoices,
    listModels,
    getUserSubscription,
    prefetchVoiceMappings,
    getVoiceMappings,
    ensureVoiceMappings,
    hasVoiceMappings,
  };

})();
