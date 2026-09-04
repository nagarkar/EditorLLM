  /** Truncates a string to at most maxLen chars, appending '…' if trimmed. */
  function truncate_(s, maxLen) {
    if (!s) return '';
    return s.length <= maxLen ? s : s.slice(0, maxLen) + '…';
  }

  function voiceNameForId_(voiceId) {
    if (!voiceId) return '';
    if (_ttsVoices && _ttsVoices.length) {
      for (var i = 0; i < _ttsVoices.length; i++) {
        if (_ttsVoices[i].voice_id === voiceId) return _ttsVoices[i].name;
      }
    }
    if (_ttsVoiceMappings && _ttsVoiceMappings[voiceId]) return _ttsVoiceMappings[voiceId];
    return voiceId;
  }

  function firstWord_(s) {
    var trimmed = (s || '').trim();
    if (!trimmed) return '';
    return trimmed.split(/\s+/)[0];
  }

  function formatDirectiveNumber_(n) {
    var value = Number(n);
    if (!isFinite(value)) return '\u2014';
    return value.toFixed(2).replace(/\.?0+$/, '');
  }

  function isVoicePermissionError_(err) {
    var msg = err && err.message ? String(err.message) : String(err || '');
    return msg.indexOf('missing_permissions') >= 0 || msg.indexOf('voices_read') >= 0;
  }

  function populateVoiceSelect_(selectEl, selectedVoiceId) {
    if (!selectEl) return;
    selectEl.innerHTML = '';

    var voices = _ttsVoices && _ttsVoices.length
      ? _ttsVoices.map(function(v) { return { id: v.voice_id, name: v.name }; })
      : (_ttsVoiceMappings
        ? Object.keys(_ttsVoiceMappings).map(function(voiceId) {
            return { id: voiceId, name: _ttsVoiceMappings[voiceId] };
          })
        : []);

    if (!voices.length) {
      var empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '(no voices)';
      selectEl.appendChild(empty);
      return;
    }

    var hasSelectedVoice = false;
    voices.forEach(function(v) {
      var opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = v.name;
      if (v.id === selectedVoiceId) {
        opt.selected = true;
        hasSelectedVoice = true;
      }
      selectEl.appendChild(opt);
    });

    if (selectedVoiceId && !hasSelectedVoice) {
      var fallback = document.createElement('option');
      fallback.value = selectedVoiceId;
      fallback.textContent = voiceNameForId_(selectedVoiceId);
      fallback.selected = true;
      selectEl.appendChild(fallback);
    }
  }

  function refreshVoiceDependentUi_() {
    var defaultVoiceSel = document.getElementById('tts-voiceSelect');
    if (defaultVoiceSel) {
      var selectedVoiceId = defaultVoiceSel.value || _ttsSavedPrefs.voiceId || '';
      populateVoiceSelect_(defaultVoiceSel, selectedVoiceId);
      setSelectReady_('tts-voiceSelect');
    }

    var editVoiceSel = document.getElementById('edit-voice-select');
    if (editVoiceSel && editVoiceSel.offsetParent !== null) {
      var editSelectedVoiceId = editVoiceSel.value
        || (_currentEditDirective && _currentEditDirective.voice_id)
        || _ttsSavedPrefs.voiceId
        || '';
      populateVoiceSelect_(editVoiceSel, editSelectedVoiceId || '');
    }

    if (_currentTtsDirectives && _currentTtsDirectives.length) {
      renderTtsDirectives(_currentTtsDirectives);
    }
  }

