  // ── Multi-Tab Sweep Overlay ────────────────────────────

  /** Current agentKey selected in the sweep overlay ('eartune'|'audit'|'tether'). */
  var _sweepAgentKey = '';

  function setSweepStatus(msg, type) {
    setElementStatus('sweep-status', 'Sweep', msg, type);
  }

  /**
   * Opens the sweep overlay for the given agent.
   * Fetches all document tab names, pre-checks those in the saved merge list,
   * then renders a checkbox list for the user to confirm.
   */
  function openSweepOverlay(agentKey, agentLabel) {
    _sweepAgentKey = agentKey;
    document.getElementById('sweep-agent-badge').textContent = agentLabel + ' Annotation Sweep';
    document.getElementById('sweep-tab-list').innerHTML = '<span style="color:#A0A0A0;font-size:11px;">Loading tabs…</span>';
    setSweepStatus('', '');
    document.getElementById('sweep-confirm-btn').disabled = false;
    document.getElementById('sweep-overlay').style.display = 'flex';

    // Load all tab names AND saved merge names in parallel, then render.
    var allTabs = null;
    var mergeNames = null;

    function maybeRender() {
      if (allTabs === null || mergeNames === null) return;
      var mergeSet = new Set(mergeNames);
      var listEl = document.getElementById('sweep-tab-list');
      if (!allTabs.length) {
        listEl.innerHTML = '<span style="color:#A0A0A0;font-size:11px;">No tabs found.</span>';
        return;
      }
      listEl.innerHTML = '';
      allTabs.forEach(function (name) {
        var label = document.createElement('label');
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = name;
        cb.checked = mergeSet.has(name);
        cb.id = 'sweep-cb-' + name.replace(/\s+/g, '-');
        label.appendChild(cb);
        label.appendChild(document.createTextNode(name));
        listEl.appendChild(label);
      });
    }

    // Only show tabs that are eligible for agent operations (not in never-processed
    // subtrees; within the user allowlist when one is configured).
    google.script.run
      .withSuccessHandler(function (tabs) { allTabs = tabs || []; maybeRender(); })
      .withFailureHandler(function (e) {
        document.getElementById('sweep-tab-list').innerHTML =
          '<span style="color:#EF9A9A;font-size:11px;">Error loading tabs: ' + e.message + '</span>';
      })
      .getManageableTabNames();

    google.script.run
      .withSuccessHandler(function (names) { mergeNames = names || []; maybeRender(); })
      .withFailureHandler(function () { mergeNames = []; maybeRender(); })
      .getManuscriptTabNames();
  }

  function closeSweepOverlay() {
    document.getElementById('sweep-overlay').style.display = 'none';
  }

  /** Collects checked tabs and kicks off the annotation sweep via google.script.run. */
  async function confirmSweep() {
    _notifyJobStart_();
    var checkboxes = document.querySelectorAll('#sweep-tab-list input[type=checkbox]:checked');
    var selected = [];
    checkboxes.forEach(function (cb) { selected.push(cb.value); });

    if (!selected.length) {
      setSweepStatus('Select at least one tab.', 'error');
      return;
    }

    var btn = document.getElementById('sweep-confirm-btn');
    btn.disabled = true;
    setSweepStatus('Sweeping ' + selected.length + ' tab(s)… See log view for progress.', 'loading');

    try {
      var result = await runServer('annotateSelectedTabs', _sweepAgentKey, selected);
      if (result && result.ok) {
        setSweepStatus('Sweep complete — ' + selected.length + ' tab(s) annotated.', 'info');
      } else {
        var errs = (result && result.errors) ? result.errors.join('\n') : 'Unknown error';
        setSweepStatus('Sweep finished with errors:\n' + errs, 'error');
      }
    } catch (e) {
      console.error('[runSweep]', e);
      setSweepStatus('Error: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  // ── Log View Toggle ────────────────────────────────────
  // Switches between main panel, tts panel, and log panel (sidebar or dialog-mode).

  var _logInitialized = false;

  function switchTab(tabId) {
    var mainPanel      = document.getElementById('main-panel');
    var logSection     = document.getElementById('log-section');
    var ttsPanel       = document.getElementById('tts-panel');
    var publisherPanel = document.getElementById('publisher-panel');
    var agentsPanel    = document.getElementById('agents-panel');

    mainPanel.style.display = 'none';
    logSection.style.display = 'none';
    ttsPanel.style.display = 'none';
    publisherPanel.style.display = 'none';
    if (agentsPanel) agentsPanel.style.display = 'none';
    document.body.classList.remove('log-view');

    if (tabId === 'logs') {
      logSection.style.display = '';  // remove inline override so CSS display:flex applies
      document.body.classList.add('log-view');
      initLogPanel();
    } else if (tabId === 'tts') {
      ttsPanel.style.display = 'block';
      initTtsTab();
    } else if (tabId === 'publisher') {
      publisherPanel.style.display = 'block';
      initPublisherTab();
    } else if (tabId === 'agents') {
      if (agentsPanel) agentsPanel.style.display = 'block';
      initAgentsPanel();
    } else {
      mainPanel.style.display = 'block';
      initMainTab();
    }

    // Highlight the active tab button; all buttons remain visible.
    ['main', 'tts', 'publisher', 'agents', 'logs'].forEach(function(id) {
      var active = (id === tabId);
      ['sb-tab-', 'dw-tab-'].forEach(function(prefix) {
        var btn = document.getElementById(prefix + id);
        if (btn) btn.classList.toggle('tab-active', active);
      });
    });
  }

  function toggleLogView() {
    var showingLogs = document.body.classList.contains('log-view');
    switchTab(showingLogs ? 'main' : 'logs');
  }

  function openHelpOverlay() {
    var scroller = document.getElementById('help-overlay-scroll');
    if (scroller) scroller.scrollTop = 0;
    document.getElementById('help-overlay').style.display = 'flex';
  }

  function closeHelpOverlay() {
    document.getElementById('help-overlay').style.display = 'none';
  }

