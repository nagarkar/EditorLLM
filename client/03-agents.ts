  // ── Quick-action buttons (below model config) ─────────────────────────────

  function runClearActiveTabAnnotations() {
    _notifyJobStart_();
    setElementStatus('quick-actions-status', 'Clear', 'Clearing annotations…', 'loading');
    google.script.run
      .withSuccessHandler(function() {
        setElementStatus('quick-actions-status', 'Clear', 'Annotations cleared.', 'info');
      })
      .withFailureHandler(function(e) {
        setElementStatus('quick-actions-status', 'Clear', 'Error: ' + e.message, 'error');
      })
      .clearActiveTabAnnotations();
  }

  function runProcessCommentsQuick() {
    _notifyJobStart_();
    setElementStatus('quick-actions-status', 'Comments', 'Processing @comments…', 'loading');
    google.script.run
      .withSuccessHandler(function(result) {
        var msg = result.message ||
          ('Replied: ' + result.replied + ', Skipped: ' + result.skipped);
        setElementStatus('quick-actions-status', 'Comments', msg,
          result.replied > 0 ? 'info' : 'loading');
      })
      .withFailureHandler(function(e) {
        setElementStatus('quick-actions-status', 'Comments', 'Error: ' + e.message, 'error');
      })
      .commentProcessorRun();
  }

  // ── Architect ──────────────────────────────────────────


  async function runArchitectInstructions() {
    _notifyJobStart_();
    setStatus('Architect generating StyleProfile…', 'loading');
    try {
      await runServer('architectGenerateInstructions');
      setStatus('StyleProfile Scratch tab updated. Fetching quality score…', 'info');
      // Fetch and display the StyleProfile quality score (ArchitectAgent.evaluateInstructions).
      var scoreData = await runServer('getStyleProfileScore');
      renderStyleProfileScore(scoreData);
      var scoreMsg = (scoreData && scoreData.score !== null)
        ? ' Quality: ' + scoreData.score + '/5.' : '';
      setStatus('StyleProfile Scratch tab updated.' + scoreMsg, 'info');
      loadInstructionQualityScores();
    } catch (e) {
      console.error('[runArchitectInstructions]', e);
      setStatus('Error: ' + e.message, 'error');
    }
  }

  // ── EarTune ────────────────────────────────────────────


  async function runEarTuneInstructions() {
    _notifyJobStart_();
    setStatus('EarTune generating instructions…', 'loading');
    try {
      await runServer('earTuneGenerateInstructions');
      var scores = await runServer('getInstructionQualityScores');
      renderInstructionQualityRows(scores);
      var e = scores && scores.earTune;
      var scoreMsg = (e && e.score !== null) ? ' Instruction quality: ' + e.score + '/5.' : '';
      setStatus('EarTune Scratch tab updated.' + scoreMsg, 'info');
    } catch (err) {
      console.error('[runEarTuneInstructions]', err);
      setStatus('Error: ' + err.message, 'error');
    }
  }

  // ── Active tab display ─────────────────────────────────────

  async function runAnnotateActiveTab_(runLabel, donePrefix, serverFn) {
    _notifyJobStart_();
    try {
      setStatus('Identifying active tab…', 'loading');
      var tabName = await runServer('getActiveTabName');
      var name = tabName || 'active tab';
      setStatus("Running " + runLabel + " on Tab '" + name + "'…", 'loading');
      await runServer(serverFn);
      setStatus(donePrefix + " to Tab '" + name + "'.", 'info');
    } catch (e) {
      console.error('[runAnnotateActiveTab_] ' + runLabel, e);
      setStatus('Error: ' + e.message, 'error');
    }
  }

  async function runEarTune() {
    return runAnnotateActiveTab_('Ear-Tune', 'Ear-Tune annotations applied', 'earTuneAnnotateTab');
  }

  // ── Auditor ────────────────────────────────────────────


  async function runAuditorInstructions() {
    _notifyJobStart_();
    setStatus('Auditor generating instructions…', 'loading');
    try {
      await runServer('auditorGenerateInstructions');
      var scores = await runServer('getInstructionQualityScores');
      renderInstructionQualityRows(scores);
      var a = scores && scores.audit;
      var scoreMsg = (a && a.score !== null) ? ' Instruction quality: ' + a.score + '/5.' : '';
      setStatus('TechnicalAudit Scratch tab updated.' + scoreMsg, 'info');
    } catch (err) {
      console.error('[runAuditorInstructions]', err);
      setStatus('Error: ' + err.message, 'error');
    }
  }

  async function runAudit() {
    return runAnnotateActiveTab_('Technical Audit', 'Audit annotations applied', 'auditorAnnotateTab');
  }

  // ── Publisher Agent (main panel quick actions) ────────

  async function runPublisherInstructions() {
    _notifyJobStart_();
    setStatus('Publisher generating instructions…', 'loading');
    try {
      await runServer('publisherGenerateInstructions');
      setStatus('Publisher Instructions Scratch tab updated.', 'info');
      refreshPublisherWorkflowState(true);
    } catch (err) {
      console.error('[runPublisherInstructions]', err);
      setStatus('Error: ' + err.message, 'error');
    }
  }

  // ── TTS Agent (main panel) ─────────────────────────────

  async function runTtsAgentInstructions() {
    _notifyJobStart_();
    setStatus('TTS Agent generating instructions…', 'loading');
    try {
      await runServer('ttsGenerateInstructions');
      var scores = await runServer('getInstructionQualityScores');
      renderInstructionQualityRows(scores);
      var t = scores && scores.tts;
      var scoreMsg = (t && t.score !== null) ? ' Instruction quality: ' + t.score + '/5.' : '';
      setStatus('TTS Instructions Scratch tab updated.' + scoreMsg, 'info');
    } catch (err) {
      console.error('[runTtsAgentInstructions]', err);
      setStatus('Error: ' + err.message, 'error');
    }
  }

  async function runTtsAnnotate() {
    return runAnnotateActiveTab_('TTS annotation', 'TTS directives applied', 'ttsAnnotateTab');
  }

  // ── Tether ─────────────────────────────────────────────


  async function runTetherInstructions() {
    _notifyJobStart_();
    setStatus('Tether generating instructions…', 'loading');
    try {
      await runServer('tetherGenerateInstructions');
      var scores = await runServer('getInstructionQualityScores');
      renderInstructionQualityRows(scores);
      var t = scores && scores.tether;
      var scoreMsg = (t && t.score !== null) ? ' Instruction quality: ' + t.score + '/5.' : '';
      setStatus('TetherInstructions Scratch tab updated.' + scoreMsg, 'info');
    } catch (err) {
      console.error('[runTetherInstructions]', err);
      setStatus('Error: ' + err.message, 'error');
    }
  }

  async function runTether() {
    return runAnnotateActiveTab_('Tether Check', 'Tether annotations applied', 'tetherAnnotateTab');
  }

  // ── General Purpose Agent ─────────────────────────────

  function runProcessComments() {
    _notifyJobStart_();
    setStatus('Processing @AI comment threads…', 'loading');
    google.script.run
      .withSuccessHandler(function (result) {
        var msg = result.message ||
          ('Replied: ' + result.replied + ', Skipped: ' + result.skipped);
        setStatus(msg, result.replied > 0 ? 'info' : 'loading');
      })
      .withFailureHandler(function (e) {
        console.error('[runProcessComments]', e);
        setStatus('Error: ' + e.message, 'error');
      })
      .commentProcessorRun();
  }


  async function runCommentInstructions() {
    _notifyJobStart_();
    setStatus('Generating Comment Instructions…', 'loading');
    try {
      await runServer('generalPurposeAgentGenerateInstructions');
      var scores = await runServer('getInstructionQualityScores');
      renderInstructionQualityRows(scores);
      var g = scores && scores.generalPurpose;
      var scoreMsg = (g && g.score !== null) ? ' Instruction quality: ' + g.score + '/5.' : '';
      setStatus('Comment Instructions Scratch tab updated.' + scoreMsg, 'info');
    } catch (err) {
      console.error('[runCommentInstructions]', err);
      setStatus('Error: ' + err.message, 'error');
    }
  }
