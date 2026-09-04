  // ── StyleProfile quality score ─────────────────────────

  /**
   * Renders the LLM-as-judge StyleProfile score badge.
   * Colour: green ≥ 4, amber 3, red ≤ 2, grey when null (not yet run).
   */
  function renderStyleProfileScore(data) {
    renderOneInstructionScoreRow('style-profile-score', data);
  }

  function loadStyleProfileScore() {
    google.script.run
      .withSuccessHandler(renderStyleProfileScore)
      .withFailureHandler(function () { /* silent */ })
      .getStyleProfileScore();
  }

  /** Row prefix matches Sidebar ids: `{prefix}-row`, `{prefix}-badge`, `{prefix}-rationale`. */
  function renderOneInstructionScoreRow(rowPrefix, data) {
    var row = document.getElementById(rowPrefix + '-row');
    var badge = document.getElementById(rowPrefix + '-badge');
    var rationale = document.getElementById(rowPrefix + '-rationale');
    if (!row || !badge) return;
    if (!data || data.score === null) {
      row.style.display = 'none';
      return;
    }
    var score = data.score;
    var color = score >= 4 ? '#81C784' : score >= 3 ? '#FFB74D' : '#EF9A9A';
    var bg = score >= 4 ? '#1B3B2A' : score >= 3 ? '#3B2C15' : '#3B1B1B';
    badge.textContent = score + '/5';
    badge.style.color = color;
    badge.style.background = bg;
    if (rationale) rationale.textContent = data.rationale || '';
    row.style.display = 'block';
  }

  function renderInstructionQualityRows(scores) {
    if (!scores) return;
    renderOneInstructionScoreRow('eartune-instr-score', scores.earTune);
    renderOneInstructionScoreRow('audit-instr-score', scores.audit);
    renderOneInstructionScoreRow('tether-instr-score', scores.tether);
    renderOneInstructionScoreRow('gp-instr-score', scores.generalPurpose);
    renderOneInstructionScoreRow('tts-instr-score', scores.tts);
  }

  function loadInstructionQualityScores() {
    google.script.run
      .withSuccessHandler(renderInstructionQualityRows)
      .withFailureHandler(function () { /* silent */ })
      .getInstructionQualityScores();
  }

