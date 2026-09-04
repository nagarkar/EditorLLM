  // ── MultiSelectTabs instances ──────────────────────────────
  // Created lazily on first initMainTab() so the DOM is ready.
  var _manuscriptMultiselect = null;
  var _managedMultiselect    = null;

  /**
   * Initialise both multiselect widgets and load the document tab list
   * into them as the available option set.
   */
  function initMultiselects() {
    var manuscriptContainer = document.getElementById('manuscript-multiselect');
    var managedContainer    = document.getElementById('managed-multiselect');
    if (!manuscriptContainer || !managedContainer) return;

    if (!_manuscriptMultiselect) {
      _manuscriptMultiselect = MultiSelectTabs.create({
        container:   manuscriptContainer,
        placeholder: 'Add tab to manuscript…',
      });
    }
    if (!_managedMultiselect) {
      _managedMultiselect = MultiSelectTabs.create({
        container:   managedContainer,
        placeholder: 'Add managed tab…',
      });
    }

    // Populate option lists from live document tab names.
    google.script.run
      .withSuccessHandler(function(tabNames) {
        if (_manuscriptMultiselect) _manuscriptMultiselect.setOptions(tabNames);
        if (_managedMultiselect)    _managedMultiselect.setOptions(tabNames);
      })
      .getTabNames();
  }

  // ── Create or Overwrite Manuscript ──────────────────────────

  function loadSavedManuscriptTabNames() {
    google.script.run
      .withSuccessHandler(function (names) {
        if (_manuscriptMultiselect) _manuscriptMultiselect.setValues(names);
        setMergeProgress(names.length ? 'Loaded ' + names.length + ' saved tab name(s).' : 'No saved names found.');
      })
      .withFailureHandler(function (e) { setMergeStatus('Error loading: ' + e.message, 'error'); })
      .getManuscriptTabNames();
  }

  function saveManuscriptTabNames(silent?) {
    var names = _manuscriptMultiselect ? _manuscriptMultiselect.getValues() : [];
    var csv   = names.join(', ');
    google.script.run
      .withSuccessHandler(function () {
        if (!silent) setMergeProgress('Tab names saved.');
      })
      .withFailureHandler(function (e) { setMergeStatus('Error saving: ' + e.message, 'error'); })
      .saveManuscriptTabNames(csv);
  }

  // ── Managed Tabs ────────────────────────────────────────────

  function setManagedTabsStatus(msg, type) {
    var el = document.getElementById('managed-tabs-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'status-box' + (type ? ' ' + type : '');
  }

  function loadSavedManagedTabNames() {
    google.script.run
      .withSuccessHandler(function(names) {
        if (_managedMultiselect) _managedMultiselect.setValues(names);
        setManagedTabsStatus(names.length ? 'Loaded ' + names.length + ' tab(s).' : 'No saved managed tabs found.', 'info');
      })
      .withFailureHandler(function(e) { setManagedTabsStatus('Error loading: ' + e.message, 'error'); })
      .getManagedTabNamesList();
  }

  function saveManagedTabNames() {
    var names = _managedMultiselect ? _managedMultiselect.getValues() : [];
    var csv   = names.join(', ');
    google.script.run
      .withSuccessHandler(function() { setManagedTabsStatus('Managed tabs saved.', 'info'); })
      .withFailureHandler(function(e) { setManagedTabsStatus('Error saving: ' + e.message, 'error'); })
      .saveManagedTabNamesList(csv);
  }

  async function createOrOverwriteManuscript() {
    _notifyJobStart_();
    var names = _manuscriptMultiselect ? _manuscriptMultiselect.getValues() : [];
    if (!names.length) {
      setMergeStatus('Enter at least one tab name.', 'error');
      return;
    }

    // Auto-save the names before merging (silently to avoid masking progress).
    saveManuscriptTabNames(true);

    var btn = document.getElementById('manuscriptBtn');
    btn.disabled = true;
    setMergeStatus('', '');
    setMergeProgress('Creating manuscript from ' + names.length + ' tab(s)… Please wait.');

    try {
      var res = await runServer('createOrOverwriteManuscript', names);
      if (res && res.ok) {
        setMergeProgress('');
        setMergeStatus('Manuscript created from ' + res.successes + ' tab(s).', 'info');
      } else {
        setMergeProgress('');
        var errMsg = 'Completed with errors.\nOK: ' + (res.successes || 0) +
          '  Failed: ' + (res.errors ? res.errors.length : 1) +
          '\n\n' + (res.errors ? res.errors.join('\n') : 'Unknown error');
        setMergeStatus(errMsg, 'error');
      }
    } catch (err) {
      console.error('[createOrOverwriteManuscript]', err);
      setMergeProgress('');
      setMergeStatus('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  var _mainInitialized = false;
  function initMainTab() {
    if (_mainInitialized) return;
    _mainInitialized = true;
    loadModelConfig();
    loadHighlightColor();
    loadDebugMode();
    try {
      initMultiselects();      // create multiselect widgets + populate tab options
    } catch (e) {
      // Guard: if MultiSelectTabs is unavailable (e.g. script load order issue),
      // don't let the exception abort quality-score loading below.
      console.error('[initMainTab] initMultiselects failed:', e);
    }
    loadSavedManuscriptTabNames(); // pre-select saved manuscript tab names
    loadSavedManagedTabNames();    // pre-select saved managed tab names
    loadStyleProfileScore();
    loadInstructionQualityScores();
  }

  initMainTab();
