  function renderTtsDirectives(directives) {
    var list = document.getElementById('tts-directives-list');
    list.innerHTML = '';

    if (!directives.length) {
      list.innerHTML = '<div class="agent-desc" style="font-size:12px;">No directives on this tab.</div>';
      return;
    }


    var table = document.createElement('div');
    table.className = 'tts-directive-table';

    var header = document.createElement('div');
    header.className = 'tts-directive-row tts-directive-row--header';
    ['Text', 'Voice', 'Stab', 'Sim', '', '', ''].forEach(function(label, idx) {
      var head = document.createElement('div');
      head.className = 'tts-directive-cell tts-directive-cell--head' +
        ((idx === 2 || idx === 3) ? ' tts-directive-cell--num' : '');
      head.textContent = label;
      header.appendChild(head);
    });
    table.appendChild(header);

    directives.forEach(function(d) {
      // Break directive \u2014 full-width row spanning all columns
      if (d.type === 'break') {
        var breakRow = document.createElement('div');
        breakRow.className = 'tts-directive-row tts-directive-row--break';
        var durationSec = ((d.payload && d.payload.timeMs) || 0) / 1000;
        var breakCell = document.createElement('div');
        breakCell.className = 'tts-directive-cell tts-directive-cell--break-span';
        var previewSnippet = d._previewText ? ' \u00b7 \u201c' + d._previewText + '\u2026\u201d' : '';
        breakCell.textContent = '\u2014 Break: ' + durationSec.toFixed(1) + 's' + previewSnippet + ' \u2014';
        breakRow.appendChild(breakCell);

        var jumpBtnB = document.createElement('button');
        jumpBtnB.type = 'button';
        jumpBtnB.textContent = '\u2316';
        jumpBtnB.title = 'Jump to break in document';
        jumpBtnB.className = 'tts-icon-btn tts-icon-btn--accent';
        jumpBtnB.onclick = function(e) { e.stopPropagation(); jumpToDirective_(d); };
        breakRow.appendChild(jumpBtnB);

        var delBtnB = document.createElement('button');
        delBtnB.type = 'button';
        delBtnB.textContent = '\u2715';
        delBtnB.title = 'Delete break directive';
        delBtnB.className = 'tts-icon-btn tts-icon-btn--muted';
        delBtnB.onclick = function(e) { e.stopPropagation(); deleteDirective(d); };
        breakRow.appendChild(delBtnB);
        table.appendChild(breakRow);
        return;
      }

      var row = document.createElement('div');
      row.className = 'tts-directive-row tts-directive-row--data';
      row.onclick = function() { openDirectiveEdit(d); };

      // First two words of match text, max 24 chars
      var words = (d.matchText || '').split(/\s+/).slice(0, 2).join(' ');
      var matchDisplay = words.length > 24 ? words.slice(0, 24) + '\u2026' : words;
      var fullVoiceName = voiceNameForId_(d.voice_id);
      var shortVoiceName = firstWord_(fullVoiceName);

      var matchCol = document.createElement('div');
      matchCol.className = 'tts-directive-cell';
      matchCol.textContent = matchDisplay;
      row.title = (d.matchText || '') + (fullVoiceName ? '\nVoice: ' + fullVoiceName : '');
      matchCol.title = row.title;

      var voiceCol = document.createElement('div');
      voiceCol.className = 'tts-directive-cell';
      voiceCol.textContent = shortVoiceName || '\u2014';
      voiceCol.title = fullVoiceName || d.voice_id || '';

      var stabCol = document.createElement('div');
      stabCol.className = 'tts-directive-cell tts-directive-cell--num';
      stabCol.textContent = formatDirectiveNumber_(d.stability);

      var simCol = document.createElement('div');
      simCol.className = 'tts-directive-cell tts-directive-cell--num';
      simCol.textContent = formatDirectiveNumber_(d.similarity_boost);

      // Play (preview) button — ▶
      var playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.textContent = '\u25B6';
      playBtn.title = 'Preview first sentence';
      playBtn.className = 'tts-icon-btn tts-icon-btn--play';
      playBtn.onclick = function(e) {
        e.stopPropagation();
        previewDirective_(d);
      };

      // Jump button — ⌖
      var jumpBtn = document.createElement('button');
      jumpBtn.type = 'button';
      jumpBtn.textContent = '\u2316';
      jumpBtn.title = 'Jump to directive in document';
      jumpBtn.className = 'tts-icon-btn tts-icon-btn--accent';
      jumpBtn.onclick = function(e) {
        e.stopPropagation();
        jumpToDirective_(d);
      };

      // Delete button — ✕
      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = '\u2715';
      delBtn.title = 'Delete directive';
      delBtn.className = 'tts-icon-btn tts-icon-btn--muted';
      delBtn.onclick = function(e) {
        e.stopPropagation();
        deleteDirective(d);
      };

      row.appendChild(matchCol);
      row.appendChild(voiceCol);
      row.appendChild(stabCol);
      row.appendChild(simCol);
      row.appendChild(playBtn);
      row.appendChild(jumpBtn);
      row.appendChild(delBtn);
      table.appendChild(row);
    });

    list.appendChild(table);
  }

  /**
   * Generates a short audio preview for the directive — first sentence from
   * its location in the tab — and plays it in the dedicated preview player.
   * No Drive file is created.
   */
  function previewDirective_(d) {
    var tabName = document.getElementById('tts-tab-select').value;
    if (!tabName || !d || !d.name) return;

    setTtsStatus('Generating preview\u2026', 'loading');
    google.script.run
      .withSuccessHandler(function(result) {
        if (!result || !result.ok) {
          setTtsStatus('Preview error: ' + (result ? result.error : 'unknown'), 'error');
          return;
        }
        var container = document.getElementById('tts-preview-container');
        var player    = document.getElementById('tts-previewPlayer');
        if (result.audioBase64 && player) {
          var binary = atob(result.audioBase64);
          var bytes  = new Uint8Array(binary.length);
          for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          var blob = new Blob([bytes], { type: 'audio/mpeg' });
          player.src = URL.createObjectURL(blob);
          if (container) container.style.display = 'block';
          player.play();
        }
        setTtsStatus('Preview ready.', 'info');
      })
      .withFailureHandler(function(e) {
        setTtsStatus('Preview failed: ' + e.message, 'error');
      })
      .elevenLabsPreviewDirective(tabName, d.name);
  }

  function jumpToDirective_(directive) {
    var tabName = document.getElementById('tts-tab-select').value;
    if (!tabName || !directive || !directive.name) return;
    setTtsStatus('Jumping to directive…', 'loading');
    google.script.run
      .withSuccessHandler(function(ok) {
        if (!ok) {
          setTtsStatus('Could not find that directive location.', 'error');
          return;
        }
        google.script.host.editor.focus();
        setTtsStatus('Directive location focused.', 'info');
      })
      .withFailureHandler(function(e) {
        setTtsStatus('Error jumping to directive: ' + e.message, 'error');
      })
      .jumpToDirective(tabName, directive.name);
  }

  function openDirectiveEdit(d) {
    _currentEditDirective = d;
    _isAddingDirective = false;
    var overlay = document.getElementById('directive-edit-overlay');
    document.getElementById('directive-edit-title').textContent = 'Edit Directive';
    document.getElementById('directive-delete-btn').style.display = '';

    document.getElementById('edit-stability').value = d.stability != null ? d.stability : '';
    document.getElementById('edit-similarity-boost').value = d.similarity_boost != null ? d.similarity_boost : '';
    document.getElementById('edit-bookmark-id').value = d.bookmarkId || '';
    document.getElementById('edit-old-name').value = d.name || '';

    // Populate model dropdown from cached ElevenLabs models.
    var modelSel = document.getElementById('edit-tts-model');
    modelSel.innerHTML = '';
    if (_ttsModels && _ttsModels.length) {
      _ttsModels.forEach(function(m) {
        var opt = document.createElement('option');
        opt.value = m.model_id;
        opt.textContent = m.name;
        if (m.model_id === d.tts_model) opt.selected = true;
        modelSel.appendChild(opt);
      });
    } else {
      // Fallback: single option with current model id.
      var opt = document.createElement('option');
      opt.value = d.tts_model || '';
      opt.textContent = d.tts_model || '(unknown)';
      opt.selected = true;
      modelSel.appendChild(opt);
    }

    // Populate voice dropdown with human-readable names.
    populateVoiceSelect_(document.getElementById('edit-voice-select'), d.voice_id || '');

    overlay.style.display = 'flex';
  }

  // ── Directive export ───────────────────────────────────────────────────

  /**
   * Builds a review-friendly JSON representation of every directive on the
   * currently selected tab.  Returns an array of plain objects (one per
   * directive, ordered by document position) carrying only the meaningful
   * fields — voice id + voice name + model + stability + similarity boost
   * for TTS, or duration for break — plus the resolved match-text and an
   * approximate document offset.  Internal scaffolding fields (named-range
   * id, bookmark id, agent prefix) are intentionally omitted.
   */
  function buildTtsDirectiveExportPayload_(tabName: string) {
    var voiceMap = _ttsVoiceMappings || {};
    var sorted = (_currentTtsDirectives || []).slice().sort(function (a, b) {
      var ap = typeof a._insertPos === 'number' ? a._insertPos : 0;
      var bp = typeof b._insertPos === 'number' ? b._insertPos : 0;
      return ap - bp;
    });

    var entries = sorted.map(function (d, idx) {
      var entry: any = {
        index:       idx,
        type:        d.type,
        match_text:  d.matchText || '',
        insert_pos:  typeof d._insertPos === 'number' ? d._insertPos : null,
      };
      if (d.type === 'tts') {
        var vid = d.voice_id || (d.payload && d.payload.voice_id) || '';
        entry.voice_id        = vid;
        entry.voice_name      = (voiceMap as any)[vid] || null;
        entry.tts_model       = d.tts_model || (d.payload && d.payload.tts_model) || '';
        entry.stability       = (typeof d.stability === 'number') ? d.stability : (d.payload ? d.payload.stability : null);
        entry.similarity_boost = (typeof d.similarity_boost === 'number') ? d.similarity_boost : (d.payload ? d.payload.similarity_boost : null);
      } else if (d.type === 'break') {
        var ms = (d.payload && typeof d.payload.timeMs === 'number') ? d.payload.timeMs : 0;
        entry.duration_ms     = ms;
        entry.duration_sec    = Math.round(ms / 100) / 10;
      }
      if (d.bookmarkUrl) entry.bookmark_url = d.bookmarkUrl;
      return entry;
    });

    return {
      schema:       'EditorLLM.tts-directives.v1',
      tab:          tabName,
      exported_at:  new Date().toISOString(),
      count:        entries.length,
      directives:   entries,
    };
  }

  /**
   * Opens the export overlay populated with the JSON dump of the current
   * tab's directives.  Refuses if no tab is selected or no directives are
   * loaded yet.
   */
  function exportTtsDirectives() {
    var tabName = (document.getElementById('tts-tab-select') as HTMLSelectElement).value;
    if (!tabName) { setTtsStatus('Select a tab first.', 'error'); return; }
    if (!_currentTtsDirectives || !_currentTtsDirectives.length) {
      setTtsStatus('No directives loaded for "' + tabName + '". Refresh first.', 'error');
      return;
    }
    var payload = buildTtsDirectiveExportPayload_(tabName);
    var json = JSON.stringify(payload, null, 2);

    var ta = document.getElementById('tts-directive-export-textarea') as HTMLTextAreaElement;
    if (ta) ta.value = json;

    var tabEl = document.getElementById('tts-directive-export-tab');
    if (tabEl) tabEl.textContent = '"' + tabName + '"';

    var countEl = document.getElementById('tts-directive-export-count');
    if (countEl) countEl.textContent = payload.count + ' directive(s)';

    var overlay = document.getElementById('tts-directive-export-overlay');
    if (overlay) overlay.style.display = 'flex';
  }

  function closeTtsDirectiveExportOverlay() {
    var overlay = document.getElementById('tts-directive-export-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  /**
   * Copies the textarea contents to the clipboard.  Falls back to the
   * select-all + execCommand path on browsers/iframes where the modern
   * clipboard API is unavailable (the GAS sidebar iframe sometimes is).
   */
  function copyTtsDirectiveExport() {
    var ta = document.getElementById('tts-directive-export-textarea') as HTMLTextAreaElement;
    if (!ta) return;
    var text = ta.value;
    var done = function () { setTtsStatus('Directives JSON copied to clipboard.', 'info'); };
    var fail = function (e: any) { setTtsStatus('Copy failed: ' + (e && e.message ? e.message : e), 'error'); };
    try {
      if ((navigator as any).clipboard && (navigator as any).clipboard.writeText) {
        (navigator as any).clipboard.writeText(text).then(done, function () {
          // Fallback for permission-denied in restricted iframes
          ta.focus();
          ta.select();
          try { document.execCommand('copy'); done(); } catch (e) { fail(e); }
        });
      } else {
        ta.focus();
        ta.select();
        document.execCommand('copy');
        done();
      }
    } catch (e) {
      fail(e);
    }
  }

  /**
   * Downloads the textarea contents as a .json file via a synthetic anchor
   * click.  Filename uses the selected tab name and an ISO timestamp.
   */
  function downloadTtsDirectiveExport() {
    var ta = document.getElementById('tts-directive-export-textarea') as HTMLTextAreaElement;
    if (!ta) return;
    var tabName = (document.getElementById('tts-tab-select') as HTMLSelectElement).value || 'directives';
    var safeName = tabName.replace(/[^A-Za-z0-9._-]+/g, '_');
    var stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/T/, '_').slice(0, 19);
    var filename = 'tts-directives_' + safeName + '_' + stamp + '.json';

    try {
      var blob = new Blob([ta.value], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      setTtsStatus('Downloaded ' + filename, 'info');
    } catch (e: any) {
      setTtsStatus('Download failed: ' + (e && e.message ? e.message : e), 'error');
    }
  }

  function addBreakDirective() {
    var tabName = document.getElementById('tts-tab-select').value;
    if (!tabName) { setTtsStatus('Select a tab first.', 'error'); return; }
    document.getElementById('break-duration-input').value = '1.0';
    document.getElementById('directive-break-overlay').style.display = 'flex';
  }

  function closeBreakOverlay() {
    document.getElementById('directive-break-overlay').style.display = 'none';
  }

  function saveBreakDirective() {
    var tabName = document.getElementById('tts-tab-select').value;
    var secs = parseFloat(document.getElementById('break-duration-input').value);
    if (isNaN(secs) || secs <= 0) { setTtsStatus('Enter a positive number of seconds.', 'error'); return; }
    var timeMs = Math.round(secs * 1000);
    closeBreakOverlay();
    setTtsStatus('Adding break directive…', 'loading');
    google.script.run
      .withSuccessHandler(function() {
        setTtsStatus('Break directive added.', 'info');
        loadTtsDirectives(true);
      })
      .withFailureHandler(function(e) {
        setTtsStatus('Error: ' + e.message, 'error');
      })
      .addBreakDirectiveFromSelection(tabName, timeMs);
  }

  function openAddDirectiveOverlay() {
    _currentEditDirective = null;
    _isAddingDirective = true;

    var overlay = document.getElementById('directive-edit-overlay');
    document.getElementById('directive-edit-title').textContent = 'Add Directive';
    document.getElementById('directive-delete-btn').style.display = 'none';
    document.getElementById('edit-bookmark-id').value = '';
    document.getElementById('edit-old-name').value = '';
    document.getElementById('edit-stability').value = '0.6';
    document.getElementById('edit-similarity-boost').value = '0.75';

    var modelSel = document.getElementById('edit-tts-model');
    modelSel.innerHTML = '';
    if (_ttsModels && _ttsModels.length) {
      _ttsModels.forEach(function(m) {
        var opt = document.createElement('option');
        opt.value = m.model_id;
        opt.textContent = m.name;
        if (m.model_id === (_ttsSavedPrefs.modelId || 'eleven_multilingual_v2')) opt.selected = true;
        modelSel.appendChild(opt);
      });
    } else if (document.getElementById('tts-modelSelect').value) {
      var mOpt = document.createElement('option');
      mOpt.value = document.getElementById('tts-modelSelect').value;
      mOpt.textContent = document.getElementById('tts-modelSelect').value;
      mOpt.selected = true;
      modelSel.appendChild(mOpt);
    }

    populateVoiceSelect_(
      document.getElementById('edit-voice-select'),
      _ttsSavedPrefs.voiceId || document.getElementById('tts-voiceSelect').value || ''
    );

    overlay.style.display = 'flex';
  }

  function closeDirectiveEdit() {
    document.getElementById('directive-edit-overlay').style.display = 'none';
    _currentEditDirective = null;
    _isAddingDirective = false;
  }

  function deleteDirectiveFromEdit() {
    if (!_currentEditDirective) return;
    closeDirectiveEdit();
    deleteDirective(_currentEditDirective);
  }

  function saveDirectiveEdit() {
    var modelId = document.getElementById('edit-tts-model').value;
    var voiceId = document.getElementById('edit-voice-select').value;
    var stability = parseFloat(document.getElementById('edit-stability').value);
    var similarityBoost = parseFloat(document.getElementById('edit-similarity-boost').value);
    var bookmarkId = document.getElementById('edit-bookmark-id').value;
    var oldName = document.getElementById('edit-old-name').value;
    var tabName = document.getElementById('tts-tab-select').value;

    var newPayload = {
      tts_model: modelId,
      voice_id: voiceId,
      stability: isNaN(stability) ? 0 : stability,
      similarity_boost: isNaN(similarityBoost) ? 0 : similarityBoost,
    };
    
    if (_isAddingDirective) {
      setTtsStatus('Adding directive from current cursor…', 'loading');
      google.script.run
        .withSuccessHandler(function() {
          setTtsStatus('Directive added.', 'info');
          closeDirectiveEdit();
          loadTtsDirectives(true);
        })
        .withFailureHandler(function(e) {
          setTtsStatus('Error adding directive: ' + e.message, 'error');
        })
        .addTtsDirectiveFromSelection(tabName, newPayload);
      return;
    }

    setTtsStatus('Updating directive…', 'loading');
    google.script.run
      .withSuccessHandler(function() {
        setTtsStatus('Directive updated.', 'info');
        closeDirectiveEdit();
        loadTtsDirectives(true);
      })
      .withFailureHandler(function(e) {
        setTtsStatus('Error updating directive: ' + e.message, 'error');
      })
      .updateTtsDirective(tabName, bookmarkId, oldName, newPayload);
  }

  function deleteDirective(d) {
    if (!confirm('Are you sure you want to delete this directive?')) return;

    var tabName = document.getElementById('tts-tab-select').value;
    setTtsStatus('Deleting directive…', 'loading');
    google.script.run
      .withSuccessHandler(function() {
        setTtsStatus('Directive deleted.', 'info');
        loadTtsDirectives(true);
      })
      .withFailureHandler(function(e) {
        var msg = (e && e.message) ? e.message : (e || 'Unknown error');
        setTtsStatus('Error deleting directive: ' + msg, 'error');
      })
      .deleteTtsDirective(tabName, d.bookmarkId, d.name);
  }

