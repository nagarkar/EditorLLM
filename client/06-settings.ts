  // ── Global Setting Functions ───────────────────────────

  function loadHighlightColor() {
    google.script.run
      .withSuccessHandler(function (color) {
        if (color) document.getElementById('highlight-color').value = color;
      })
      .getHighlightColor();
  }

  function saveHighlightColor() {
    var color = document.getElementById('highlight-color').value;
    setColorStatus('Saving…', 'loading');
    google.script.run
      .withSuccessHandler(function () { setColorStatus('Color saved.', 'info'); })
      .withFailureHandler(function (e) { setColorStatus('Error: ' + e.message, 'error'); })
      .saveHighlightColor(color);
  }

  function setColorStatus(msg, type) {
    setElementStatus('color-status', null, msg, type);
  }

  // ── Reusable preference helpers ────────────────────────

  /**
   * Loads a boolean server preference and sets a checkbox element.
   * serverFn must return a boolean. Future boolean prefs need only
   * one call to loadPrefCheckbox + one saveXxx function.
   */
  function loadPrefCheckbox(elementId, serverFn) {
    google.script.run
      .withSuccessHandler(function(val) {
        var el = document.getElementById(elementId);
        if (el) el.checked = !!val;
      })
      .withFailureHandler(function() { /* silent — non-critical */ })
      [serverFn]();
  }

  // ── Debug Mode ─────────────────────────────────────────

  function loadDebugMode() {
    loadPrefCheckbox('debug-mode-toggle', 'getDebugMode');
  }

  function saveDebugMode(enabled) {
    var statusEl = document.getElementById('debug-mode-status');
    google.script.run
      .withSuccessHandler(function() {
        if (statusEl) { statusEl.textContent = 'Saved.'; setTimeout(function(){ statusEl.textContent = ''; }, 1500); }
      })
      .withFailureHandler(function(e) {
        if (statusEl) { statusEl.textContent = 'Error: ' + e.message; statusEl.className = 'status-box error'; }
      })
      .saveDebugMode(enabled);
  }

  // ── Model Configuration ────────────────────────────────

  function refreshApiKeyUi_(inputId, serverFn) {
    var inp = document.getElementById(inputId);
    if (!inp) return;
    google.script.run
      .withSuccessHandler(function (hasUser) {
        inp.value = '';
        inp.placeholder = hasUser ? '**** (set)' : 'unset';
      })
      .withFailureHandler(function () {
        inp.placeholder = 'unset';
      })
      [serverFn]();
  }

  function saveApiKeySettings_(inputId, statusId, serverFn) {
    var inp = document.getElementById(inputId);
    var statusEl = document.getElementById(statusId);
    if (!inp) return;
    var key = inp.value.trim();
    if (!key) {
      if (statusEl) { statusEl.textContent = 'Enter API key.'; statusEl.className = 'status-box error'; }
      return;
    }
    if (statusEl) { statusEl.textContent = 'Saving…'; statusEl.className = 'status-box loading'; }
    google.script.run
      .withSuccessHandler(function () {
        inp.value = '';
        inp.placeholder = '**** (set)';
        if (statusEl) { statusEl.textContent = 'Key saved to your account.'; statusEl.className = 'status-box info'; }
      })
      .withFailureHandler(function (e) {
        if (statusEl) { statusEl.textContent = 'Error: ' + e.message; statusEl.className = 'status-box error'; }
      })
      [serverFn](key);
  }

  /** Gemini key in User Properties only — script/deployment key shows as unset. */
  function refreshGeminiApiKeyUi() { refreshApiKeyUi_('gemini-api-key', 'geminiHasUserApiKey'); }
  function refreshOpenAiApiKeyUi() { refreshApiKeyUi_('openai-api-key', 'openAiHasUserApiKey'); }
  function saveGeminiApiKey() { saveApiKeySettings_('gemini-api-key', 'gemini-api-key-status', 'saveGeminiApiKey'); }
  function saveOpenAiApiKey() { saveApiKeySettings_('openai-api-key', 'openai-api-key-status', 'saveOpenAiApiKey'); }

  function setModelStatus(msg, type) {
    ['model-status', 'model-status-openai'].forEach(function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.textContent = msg;
      el.className = 'status-box' + (type ? ' ' + type : '');
    });
  }

  function getSelectedLlmService() {
    var openAi = document.getElementById('llm-service-openai');
    return openAi && openAi.checked ? 'openai' : 'gemini';
  }

  function onLlmServiceChange() {
    var service = getSelectedLlmService();
    var gemini = document.getElementById('gemini-options');
    var openai = document.getElementById('openai-options');
    if (gemini) gemini.style.display = service === 'gemini' ? 'block' : 'none';
    if (openai) openai.style.display = service === 'openai' ? 'block' : 'none';
    setModelStatus('', '');
  }

  function loadModelConfig() {
    refreshGeminiApiKeyUi();
    refreshOpenAiApiKeyUi();
    google.script.run
      .withSuccessHandler(function (cfg) {
        document.getElementById('llm-service-gemini').checked = cfg.service === 'gemini';
        document.getElementById('llm-service-openai').checked = cfg.service === 'openai';
        onLlmServiceChange();

        document.getElementById('gemini-model-fast').innerHTML = '<option value="' + cfg.gemini.fast + '">' + cfg.gemini.fast + '</option>';
        document.getElementById('gemini-model-fast').value = cfg.gemini.fast;

        document.getElementById('gemini-model-thinking').innerHTML = '<option value="' + cfg.gemini.thinking + '">' + cfg.gemini.thinking + '</option>';
        document.getElementById('gemini-model-thinking').value = cfg.gemini.thinking;

        document.getElementById('gemini-model-deepseek').innerHTML = '<option value="' + cfg.gemini.deepseek + '">' + cfg.gemini.deepseek + '</option>';
        document.getElementById('gemini-model-deepseek').value = cfg.gemini.deepseek;

        document.getElementById('openai-model-fast').value = cfg.openai.fast || '';
        document.getElementById('openai-model-thinking').value = cfg.openai.thinking || '';

        // Auto-load the selected provider's model list from the server cache.
        if (cfg.service === 'gemini' || cfg.service === 'openai') {
          refreshAvailableModels(false);
        }
      })
      .withFailureHandler(function (e) { setModelStatus('Error loading config: ' + e.message, 'error'); })
      .getModelConfig();
  }

  function saveModelConfig() {
    var service = getSelectedLlmService();
    var geminiFast = document.getElementById('gemini-model-fast').value.trim();
    var geminiThinking = document.getElementById('gemini-model-thinking').value.trim();
    var geminiDeepseek = document.getElementById('gemini-model-deepseek').value.trim();
    var openAiFast = document.getElementById('openai-model-fast').value.trim();
    var openAiThinking = document.getElementById('openai-model-thinking').value.trim();

    if (service === 'gemini') {
      if (!geminiFast || !geminiThinking || !geminiDeepseek) {
        setModelStatus('All Gemini model fields are required.', 'error');
        return;
      }
    } else {
      if (!openAiFast || !openAiThinking) {
        setModelStatus('All OpenAI model fields are required.', 'error');
        return;
      }
    }
    setModelStatus('Saving…', 'loading');
    google.script.run
      .withSuccessHandler(function () { setModelStatus('Model configuration saved. Changes apply to the next agent run.', 'info'); })
      .withFailureHandler(function (e) { setModelStatus('Error saving: ' + e.message, 'error'); })
      .saveModelConfig({
        service: service,
        gemini: { fast: geminiFast, thinking: geminiThinking, deepseek: geminiDeepseek },
        openai: { fast: openAiFast, thinking: openAiThinking }
      });
  }

  var cachedModelsByService = { gemini: null, openai: null };

  function refreshAvailableModels(force) {
    var service = getSelectedLlmService();
    var cachedModels = cachedModelsByService[service];
    if (!force && cachedModels) {
      populateModelInputs(service, cachedModels);
      setModelStatus('Loaded from cache. Found ' + cachedModels.length + ' model(s).', 'info');
      return;
    }

    setModelStatus('Fetching available models…', 'loading');
    google.script.run
      .withSuccessHandler(function (models) {
        cachedModelsByService[service] = models;
        populateModelInputs(service, models);
        setModelStatus('Found ' + models.length + ' model(s).', 'info');
      })
      .withFailureHandler(function (e) {
        if (e.message && e.message.includes('API key not set')) {
          setModelStatus(
            'Set a ' + (service === 'openai' ? 'OpenAI' : 'Gemini') + ' API key to load available models.',
            'info'
          );
        } else {
          setModelStatus('Error: ' + e.message, 'error');
        }
      })
      .listAvailableModels(service, !!force);
  }

  function populateModelInputs(service, models) {
    if (service === 'openai') {
      var datalist = document.getElementById('openai-model-options');
      if (!datalist) return;
      datalist.innerHTML = '';
      models.forEach(function (m) {
        var opt = document.createElement('option');
        opt.value = m;
        datalist.appendChild(opt);
      });
      return;
    }

    ['gemini-model-fast', 'gemini-model-thinking', 'gemini-model-deepseek'].forEach(function (id) {
      var select = document.getElementById(id);
      var currentVal = select.value;
      select.innerHTML = '';
      models.forEach(function (m) {
        var opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        select.appendChild(opt);
      });
      if (models.includes(currentVal)) {
        select.value = currentVal;
      }
    });
  }

