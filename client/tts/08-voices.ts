  // ── ElevenLabs API Integration ──────────────────────────

  function checkTtsApiKey() {
    google.script.run
      .withSuccessHandler(function(keySet) {
        if (keySet) {
          document.getElementById('tts-apiKey').placeholder = '**** (set)';
          loadTtsPreferences_(function() {
            loadTtsVoiceMappings();
            loadTtsVoices();
            loadTtsModels();
          });
        } else {
          setSelectLoading_('tts-voiceSelect', 'Set ElevenLabs key first');
          setSelectLoading_('tts-modelSelect', 'Set ElevenLabs key first');
        }
      })
      .elevenLabsHasApiKey();
  }

  function saveAllTtsSettings() {
    var key     = document.getElementById('tts-apiKey').value.trim();
    var modelId = (document.getElementById('tts-modelSelect') as any)?.value;
    var voiceId = (document.getElementById('tts-voiceSelect') as any)?.value;

    if (modelId) google.script.run.elevenLabsSaveModelPreference(modelId);
    if (voiceId) google.script.run.elevenLabsSaveVoicePreference(voiceId);

    if (!key) {
      setTtsStatus('Settings saved.', 'info');
      setTimeout(function() { setTtsStatus('', ''); }, 2000);
      return;
    }

    var warning = 'You have set the API key. Anyone with access to this document will be able to use related features, but not see your key.\n\nDo you want to continue?';
    if (!confirm(warning)) return;

    setTtsStatus('Saving…', 'loading');
    google.script.run
      .withSuccessHandler(function() {
        document.getElementById('tts-apiKey').value = '';
        document.getElementById('tts-apiKey').placeholder = '**** (set)';
        setTtsStatus('Settings saved.', 'info');
        setTimeout(function() { setTtsStatus('', ''); }, 2000);
        loadTtsPreferences_(function() {
          loadTtsVoiceMappings();
          loadTtsVoices();
          loadTtsModels();
        });
      })
      .withFailureHandler(function(e) {
        setTtsStatus('Error: ' + e.message, 'error');
      })
      .elevenLabsSaveApiKey(key);
  }

  function loadTtsPreferences_(callback) {
    google.script.run
      .withSuccessHandler(function(prefs) {
        if (prefs) _ttsSavedPrefs = prefs;
        if (callback) callback();
      })
      .elevenLabsGetPreferences();
  }

  function loadTtsVoiceMappings() {
    google.script.run
      .withSuccessHandler(function(mappings) {
        _ttsVoiceMappings = mappings || null;
        refreshVoiceDependentUi_();
      })
      .withFailureHandler(function() {
        // Non-fatal: directive list falls back to raw voice IDs.
      })
      .elevenLabsEnsureVoiceMappings();
  }

  function saveTtsVoicePreference() {
    var voiceId = document.getElementById('tts-voiceSelect').value;
    if (!voiceId) return;
    _ttsSavedPrefs.voiceId = voiceId;
    google.script.run.elevenLabsSaveVoicePreference(voiceId);
  }

  function saveTtsModelPreference() {
    var modelId = document.getElementById('tts-modelSelect').value;
    if (!modelId) return;
    _ttsSavedPrefs.modelId = modelId;
    google.script.run.elevenLabsSaveModelPreference(modelId);
  }

  function loadTtsVoices() {
    var useCase = '';
    setSelectLoading_('tts-voiceSelect', 'Loading voices…');
    google.script.run
      .withSuccessHandler(function(list) {
        _ttsVoices = list || [];
        if (_ttsVoices.length) {
          _ttsVoiceMappings = {};
          _ttsVoices.forEach(function(v) {
            _ttsVoiceMappings[v.voice_id] = v.name;
          });
        }
        refreshVoiceDependentUi_();
      })
      .withFailureHandler(function(e) {
        if (_ttsVoiceMappings && Object.keys(_ttsVoiceMappings).length) {
          _ttsVoices = null;
          refreshVoiceDependentUi_();
          setTtsStatus('Voice list unavailable; using cached voice names.', 'info');
          return;
        }
        var msg = (e && e.message) ? e.message : 'Could not load voices';
        var selectMsg = isVoicePermissionError_(e)
          ? 'Please give the Eleven Labs API sufficient permissions'
          : 'Could not load voices';
        setSelectLoading_('tts-voiceSelect', selectMsg);
        setTtsStatus(msg, 'error');
      })
      .elevenLabsListVoices(useCase);
  }

  function loadTtsModels() {
    setSelectLoading_('tts-modelSelect', 'Loading models…');
    google.script.run
      .withSuccessHandler(function(list) {
        _ttsModels = list;
        var sel = document.getElementById('tts-modelSelect');
        sel.disabled = false;
        sel.innerHTML = '';
        if (!(list || []).length) {
          var empty = document.createElement('option');
          empty.value = '';
          empty.textContent = '(no models)';
          sel.appendChild(empty);
        }
        (list || []).forEach(function(m) {
          var opt = document.createElement('option');
          opt.value = m.model_id;
          opt.textContent = m.name;
          if (m.model_id === (_ttsSavedPrefs.modelId || 'eleven_multilingual_v2')) opt.selected = true;
          sel.appendChild(opt);
        });
      })
      .withFailureHandler(function() {
        setSelectLoading_('tts-modelSelect', 'Could not load models');
      })
      .elevenLabsListModels();
  }
