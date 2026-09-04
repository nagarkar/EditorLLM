  // ── TTS Tab Logic ──────────────────────────────────────

  var _ttsInitialized = false;
  var _ttsSavedPrefs = { voiceId: null, modelId: null };
  /** {voiceId: voiceName} map prefetched at startup; null = not yet loaded. */
  var _ttsVoiceMappings = null;
  /** Array of {voice_id, name} from ElevenLabs; null = not yet loaded. */
  var _ttsVoices = null;
  /** Array of {model_id, name} from ElevenLabs; null = not yet loaded. */
  var _ttsModels = null;
  /** Directive currently open in the edit overlay (used by deleteDirectiveFromEdit). */
  var _currentEditDirective = null;
  /** True when the directive overlay is creating a new directive rather than editing an existing one. */
  var _isAddingDirective = false;
  /** Client-side cache of tab names for fast TTS-tab switching. */
  var _cachedTabNames = null;
  /** Client-side cache of the current active tab name. */
  var _cachedActiveTabName = null;
  /** Last-rendered TTS directives for progressive voice-name upgrades. */
  var _currentTtsDirectives = [];
  /** Per-tab directive cache. Key: tab name, value: directive array. */
  var _ttsDirectiveCache = {};

  function setSelectLoading_(id, label) {
    var sel = document.getElementById(id);
    if (!sel) return;
    sel.disabled = true;
    sel.innerHTML = '';
    var opt = document.createElement('option');
    opt.value = '';
    opt.textContent = label;
    sel.appendChild(opt);
  }

  function setSelectReady_(id) {
    var sel = document.getElementById(id);
    if (sel) sel.disabled = false;
  }

  function renderDirectiveListSkeleton_() {
    var list = document.getElementById('tts-directives-list');
    if (!list) return;
    list.innerHTML =
      '<div class="tts-skeleton-row"></div>' +
      '<div class="tts-skeleton-row"></div>' +
      '<div class="tts-skeleton-row"></div>';
  }

  function applyCachedTabNames_(tabs) {
    _cachedTabNames = tabs || [];
    var sel = document.getElementById('tts-tab-select');
    if (!sel) return;
    sel.innerHTML = '';
    (_cachedTabNames || []).forEach(function(t) {
      var opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      sel.appendChild(opt);
    });
  }

  function primeTabCache_() {
    if (!_cachedTabNames) {
      google.script.run
        .withSuccessHandler(function(tabs) { applyCachedTabNames_(tabs || []); })
        .getTabNames();
    }
    if (!_cachedActiveTabName) {
      google.script.run
        .withSuccessHandler(function(activeTab) { _cachedActiveTabName = activeTab || null; })
        .getActiveTabName();
    }
  }

