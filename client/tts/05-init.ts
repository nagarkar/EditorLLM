  function initTtsTab() {
    if (_ttsInitialized) {
      var existingSel = document.getElementById('tts-tab-select');
      if (_cachedActiveTabName && existingSel) existingSel.value = _cachedActiveTabName;
      loadTtsDirectives();
      return;
    }
    _ttsInitialized = true;

    setTtsStatus('Initializing TTS tab…', 'loading');
    renderDirectiveListSkeleton_();
    setSelectLoading_('tts-voiceSelect', 'Loading voices…');
    setSelectLoading_('tts-modelSelect', 'Loading models…');
    if (_cachedTabNames && _cachedTabNames.length) {
      applyCachedTabNames_(_cachedTabNames);
      var sel = document.getElementById('tts-tab-select');
      if (_cachedActiveTabName && sel) sel.value = _cachedActiveTabName;
      loadTtsDirectives();
    } else {
      google.script.run
        .withSuccessHandler(function(tabs) {
          applyCachedTabNames_(tabs || []);
          var sel = document.getElementById('tts-tab-select');
          if (_cachedActiveTabName && sel) sel.value = _cachedActiveTabName;
          loadTtsDirectives();
        })
        .withFailureHandler(function(e) {
          setTtsStatus('Error loading tabs: ' + e.message, 'error');
        })
        .getTabNames();
    }

    google.script.run
      .withSuccessHandler(function(activeTab) {
        _cachedActiveTabName = activeTab || null;
        var sel = document.getElementById('tts-tab-select');
        if (activeTab && sel) {
          sel.value = activeTab;
          loadTtsDirectives();
        }
      })
      .getActiveTabName();

    // Init ElevenLabs audio controls in parallel.
    checkTtsApiKey();
  }

  function onTtsTabChange() {
    var tabName = document.getElementById('tts-tab-select').value;
    _cachedActiveTabName = tabName || null;
    google.script.run.setActiveTabByName(tabName);
    loadTtsDirectives();
  }

  function setTtsStatus(msg, type) {
    setElementStatus('tts-status', null, msg, type);
  }

  function setTtsProgress(fraction) {
    var bar  = document.getElementById('tts-progress-bar');
    var fill = document.getElementById('tts-progress-fill');
    if (!bar || !fill) return;
    bar.style.display     = 'block';
    fill.style.width      = Math.round(fraction * 100) + '%';
  }

  function hideTtsProgress() {
    var bar  = document.getElementById('tts-progress-bar');
    var fill = document.getElementById('tts-progress-fill');
    if (!bar || !fill) return;
    fill.style.width  = '0%';
    bar.style.display = 'none';
  }

  function loadTtsDirectives(forceRefresh?) {
    var tabName = document.getElementById('tts-tab-select').value;
    if (!tabName) return;

    if (!forceRefresh && _ttsDirectiveCache[tabName]) {
      var cached = _ttsDirectiveCache[tabName];
      _currentTtsDirectives = cached;
      renderTtsDirectives(cached);
      setTtsStatus(cached.length + ' directive(s) (cached).', 'info');
      return;
    }

    // Proceed even when _ttsVoiceMappings is null (no ElevenLabs API key set):
    // directives still load; voice names are omitted and only voice IDs are shown.
    setTtsStatus('Loading directives for ' + tabName + '…', 'loading');
    renderDirectiveListSkeleton_();
    google.script.run
      .withSuccessHandler(function(directives) {
        _currentTtsDirectives = directives || [];
        _ttsDirectiveCache[tabName] = _currentTtsDirectives;
        renderTtsDirectives(_currentTtsDirectives);
        setTtsStatus(_currentTtsDirectives.length + ' directive(s) found.', 'info');
      })
      .withFailureHandler(function(e) {
        setTtsStatus('Error loading directives: ' + e.message, 'error');
      })
      .getTabDirectives(tabName);
  }

  function refreshTtsDirectives() {
    var tabName = document.getElementById('tts-tab-select').value;
    if (tabName) delete _ttsDirectiveCache[tabName];
    loadTtsDirectives(true);
  }

  /**
   * Opens the Clear & Reprocess confirmation overlay for the currently
   * selected TTS tab.  Wired to the "Clear & Reprocess" button next to the
   * tab selector.  Actual work happens in confirmClearAndReprocessTts_ when
   * the user clicks the overlay's primary button.
   */
  function clearAndReprocessTtsTab() {
    var tabName = (document.getElementById('tts-tab-select') as HTMLSelectElement).value;
    if (!tabName) {
      setTtsStatus('No tab selected.', 'error');
      return;
    }
    var label = document.getElementById('tts-clear-confirm-tab');
    if (label) label.textContent = '"' + tabName + '"';
    var overlay = document.getElementById('tts-clear-confirm-overlay');
    if (overlay) overlay.style.display = 'flex';
  }

  function closeClearReprocessOverlay() {
    var overlay = document.getElementById('tts-clear-confirm-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  /**
   * Executes the clear-and-reprocess flow for the currently selected TTS tab.
   * Filter argument 'TtsAgent' matches the sanitised agent prefix written by
   * DirectivePersistence.encodeDirectiveNamedRangeName (brackets stripped).
   */
  async function confirmClearAndReprocessTts_() {
    var tabName = (document.getElementById('tts-tab-select') as HTMLSelectElement).value;
    closeClearReprocessOverlay();
    if (!tabName) {
      setTtsStatus('No tab selected.', 'error');
      return;
    }
    _notifyJobStart_();
    try {
      setTtsStatus('Clearing directives on "' + tabName + '"…', 'loading');
      await runServer('clearDirectivesOnTab', tabName, 'TtsAgent');
      delete _ttsDirectiveCache[tabName];

      setTtsStatus('Re-running TTS annotation on "' + tabName + '"…', 'loading');
      await runServer('ttsAnnotateTab', tabName);

      setTtsStatus('TTS directives regenerated on "' + tabName + '". Reloading…', 'info');
      loadTtsDirectives(true);
    } catch (e) {
      console.error('[confirmClearAndReprocessTts_]', e);
      setTtsStatus('Error: ' + (e && e.message ? e.message : e), 'error');
    }
  }
