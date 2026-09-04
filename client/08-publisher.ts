  // ── Publisher Panel ─────────────────────────────────────

  var _publisherInitialized = false;
  var _publisherAudioFiles = [];
  var _publisherSelectedIndex = -1;
  var _publisherWorkflowState = null;
  var _publisherLastAuditResults = null;

  function clearPublisherStatusLinks() {
    var host = document.getElementById('publisher-status-links');
    if (!host) return;
    host.innerHTML = '';
    host.style.display = 'none';
  }

  function setPublisherStatusLinks(links) {
    var host = document.getElementById('publisher-status-links');
    if (!host) return;
    host.innerHTML = '';
    if (!links || !links.length) {
      host.style.display = 'none';
      return;
    }
    host.style.display = 'flex';
    links.forEach(function(link) {
      var a = document.createElement('a');
      a.href = link.href || '#';
      a.textContent = link.label;
      a.className = 'btn-secondary btn-sm';
      a.style.textDecoration = 'none';
      if (link.href) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      } else if (link.action === 'showPublisherAuditResults') {
        a.addEventListener('click', function(evt) {
          evt.preventDefault();
          openPublisherAuditOverlay();
        });
      }
      host.appendChild(a);
    });
  }

  function setPublisherStatus(msg, kind) {
    setElementStatus('publisher-status', 'Publisher', msg, kind);
    if (kind !== 'info') clearPublisherStatusLinks();
  }

  function initPublisherTab() {
    if (!_publisherInitialized) _publisherInitialized = true;
    refreshPublisherWorkflowState(true);
    refreshPublisherAudioFiles(true);
  }

  function refreshPublisherWorkflowState(silent) {
    google.script.run
      .withSuccessHandler(function(state) {
        _publisherWorkflowState = state || null;
        renderPublisherWorkflowState();
        if (!silent && state) {
          setPublisherStatus('Publisher workflow status refreshed.', 'info');
        }
      })
      .withFailureHandler(function(e) {
        renderPublisherWorkflowError(e && e.message ? e.message : String(e || 'Unknown error'));
        if (!silent) {
          setPublisherStatus('Error loading workflow status: ' + (e.message || e), 'error');
        }
      })
      .getPublisherWorkflowState();
  }

  function renderPublisherWorkflowError(message) {
    var html = '<div class="publisher-workflow-empty">Error loading workflow: ' + escapeHtml(message) + '</div>';
    ['publisher-workflow-main', 'publisher-workflow-panel'].forEach(function(id) {
      var host = document.getElementById(id);
      if (host) host.innerHTML = html;
    });
  }

  function renderPublisherWorkflowState() {
    var state = _publisherWorkflowState;
    var hosts = ['publisher-workflow-main', 'publisher-workflow-panel'];
    if (!state) {
      hosts.forEach(function(id) {
        var host = document.getElementById(id);
        if (host) host.innerHTML = '<div class="publisher-workflow-empty">Publisher workflow state has not been loaded yet.</div>';
      });
      return;
    }

    var steps = [
      {
        title: 'Generate Instructions',
        status: state.instructions && state.instructions.done ? 'done' : 'pending',
        detail: state.instructions && state.instructions.done
          ? 'Publisher Instructions tab is present.'
          : (state.instructions && state.instructions.missingReason) || 'Publisher Instructions is missing.',
        pills: []
      },
      {
        title: 'Generate All Tabs',
        status: state.tabs && state.tabs.done ? 'done' : ((state.tabs && state.tabs.present && state.tabs.present.length) ? 'partial' : 'pending'),
        detail: state.tabs && state.tabs.done
          ? 'All required publisher tabs are present.'
          : 'Missing publisher tabs prevent full packaging coverage.',
        pills: (state.tabs && state.tabs.missing || []).map(function(name) {
          return { label: name, kind: 'missing' };
        }).concat((state.tabs && state.tabs.present || []).slice(0, 3).map(function(name) {
          return { label: name, kind: 'present' };
        }))
      },
      (function() {
        // Priority 1: results from an audit run in this sidebar session.
        if (_publisherLastAuditResults) {
          return {
            title: 'Structural Audit',
            status: (_publisherLastAuditResults.summary && _publisherLastAuditResults.summary.epubOk && _publisherLastAuditResults.summary.audioOk) ? 'done' : 'partial',
            detail: 'Last audit: EPUB ' + ((_publisherLastAuditResults.summary && _publisherLastAuditResults.summary.epubOk) ? 'ready' : 'not ready') +
              ' • Audio ' + ((_publisherLastAuditResults.summary && _publisherLastAuditResults.summary.audioOk) ? 'ready' : 'not ready') + '.',
            pills: [
              { label: 'V' + escapeHtml(_publisherLastAuditResults.versionLabel || '0'), kind: (_publisherLastAuditResults.hasExplicitActiveVersion ? 'present' : 'missing') }
            ]
          };
        }
        // Priority 2: last audit result persisted in DocumentProperties (survives sidebar reloads).
        var la = state.structuralAudit && state.structuralAudit.lastAudit;
        if (la) {
          var ts = '';
          try { ts = la.ts ? new Date(la.ts).toLocaleString() : ''; } catch (_) {}
          return {
            title: 'Structural Audit',
            status: (la.epubOk && la.audioOk) ? 'done' : 'partial',
            detail: (ts ? 'Last run ' + ts + ': ' : '') +
              'Common ' + ((la.epubOk || la.audioOk) ? 'ok' : 'issues') +
              ' • EPUB ' + (la.epubOk ? 'ready' : 'not ready') +
              ' • Audio ' + (la.audioOk ? 'ready' : 'not ready') + '.',
            pills: [
              { label: 'V' + escapeHtml(la.versionLabel || '0'), kind: la.hasExplicitActiveVersion ? 'present' : 'missing' }
            ]
          };
        }
        // Priority 3: generic pre-audit status (tab/instruction presence check).
        return {
          title: 'Structural Audit',
          status: state.structuralAudit && state.structuralAudit.done ? 'done' : 'pending',
          detail: (state.structuralAudit && state.structuralAudit.detail) || 'Publisher package readiness has not been checked.',
          pills: []
        };
      })(),
      {
        title: 'Publish To ACX / EPUB',
        status: (state.publish && state.publish.status) || 'pending',
        detail: (state.publish && state.publish.detail) || 'Packaging prerequisites are incomplete.',
        pills: [
          { label: 'EPUB ' + ((state.publish && state.publish.epubReady) ? 'ready' : 'not ready'), kind: (state.publish && state.publish.epubReady) ? 'present' : 'missing' },
          { label: 'ACX ' + ((state.publish && state.publish.acxReady) ? 'ready' : 'needs audio'), kind: (state.publish && state.publish.acxReady) ? 'present' : 'missing' }
        ]
      }
    ];

    var html = steps.map(function(step) {
      var pills = (step.pills || []).length
        ? '<div class="publisher-workflow-pills">' + step.pills.map(function(pill) {
            return '<span class="publisher-workflow-pill publisher-workflow-pill--' + escapeHtml(pill.kind) + '">' + escapeHtml(pill.label) + '</span>';
          }).join('') + '</div>'
        : '';
      return '' +
        '<div class="publisher-workflow-step publisher-workflow-step--' + escapeHtml(step.status) + '">' +
          '<div class="publisher-workflow-marker"></div>' +
          '<div>' +
            '<div class="publisher-workflow-title">' + escapeHtml(step.title) + '</div>' +
            '<div class="publisher-workflow-detail">' + escapeHtml(step.detail) + '</div>' +
            pills +
          '</div>' +
        '</div>';
    }).join('');

    hosts.forEach(function(id) {
      var host = document.getElementById(id);
      if (host) host.innerHTML = html;
    });
  }

  function renderPublisherAuditOverlay() {
    var host = document.getElementById('publisher-audit-overlay-body');
    if (!host) return;
    if (!_publisherLastAuditResults) {
      host.innerHTML = '<div class="publisher-workflow-empty">No audit results are available yet.</div>';
      return;
    }

    var result = _publisherLastAuditResults;
    var summaryCards = (result.commonChecks || []).map(function(check) {
      var value = '';
      var label = check.label;
      if (check.label.indexOf('Active Version:') === 0) {
        label = result.hasExplicitActiveVersion ? 'Active Version' : 'Active Version (Default)';
        value = 'V' + escapeHtml(result.versionLabel || '0');
      } else if (check.label.indexOf('Version Folder:') === 0) {
        label = 'Version Folder';
        value = check.ok ? 'Found' : 'Missing';
      }
      return {
        label: label,
        ok: !!check.ok,
        value: value,
        detail: check.detail || ''
      };
    }).concat([
      {
        label: 'EPUB',
        ok: !!(result.summary && result.summary.epubOk),
        value: (result.summary && result.summary.epubOk) ? 'Ready' : 'Needs fixes',
        detail: (result.epub && result.epub.folderExists) ? 'EPUB folder found.' : 'EPUB folder missing.'
      },
      {
        label: 'Audio',
        ok: !!(result.summary && result.summary.audioOk),
        value: (result.summary && result.summary.audioOk) ? 'Ready' : 'Needs files',
        detail: (result.audio && result.audio.folderExists) ? 'Audio folder found.' : 'Audio folder missing.'
      }
    ]).map(function(card) {
      return '' +
        '<div style="flex:1 1 180px; border:1px solid var(--border); border-radius:8px; padding:10px; background:#1B1B1B;">' +
          '<div style="display:flex; align-items:center; gap:8px; font-weight:600;">' +
            '<span>' + (card.ok ? '&#10003;' : '&#10007;') + '</span>' +
            '<span>' + escapeHtml(card.label) + '</span>' +
          '</div>' +
          '<div style="margin-top:6px; font-size:18px; font-weight:700;">' + card.value + '</div>' +
          '<div style="margin-top:4px; color:#A0A0A0; font-size:12px;">' + escapeHtml(card.detail) + '</div>' +
        '</div>';
    }).join('');

    function renderAuditColumn(title, resultGroup) {
      var folderLine = resultGroup && resultGroup.folderExists
        ? '<div style="margin-bottom:10px; color:#A0A0A0; font-size:12px;">Folder present' +
            (resultGroup.folderUrl ? ' • <a href="' + escapeHtml(resultGroup.folderUrl) + '" target="_blank" rel="noopener noreferrer">Open Drive Folder</a>' : '') +
          '</div>'
        : '<div style="margin-bottom:10px; color:#A0A0A0; font-size:12px;">Folder missing.</div>';
      var checks = (resultGroup && resultGroup.checks || []).map(function(check) {
        return '' +
          '<div style="padding:8px 0; border-top:1px solid rgba(255,255,255,0.06);">' +
            '<div style="display:flex; align-items:center; gap:8px; font-weight:600;">' +
              '<span>' + (check.ok ? '&#10003;' : '&#10007;') + '</span>' +
              '<span>' + escapeHtml(check.label) + '</span>' +
            '</div>' +
            '<div style="margin-top:3px; color:#A0A0A0; font-size:12px;">' + escapeHtml(check.detail || '') + '</div>' +
          '</div>';
      }).join('');
      var actualFiles = title === 'Audio' && result.audio && result.audio.actualFiles && result.audio.actualFiles.length
        ? '<div style="margin-top:10px; color:#A0A0A0; font-size:12px;">Found files: ' + escapeHtml(result.audio.actualFiles.join(', ')) + '</div>'
        : '';
      return '' +
        '<div style="flex:1 1 320px; border:1px solid var(--border); border-radius:8px; padding:12px; background:#1B1B1B;">' +
          '<div style="font-weight:700; margin-bottom:6px;">' + escapeHtml(title) + '</div>' +
          folderLine +
          (checks || '<div class="publisher-workflow-empty">No checks available.</div>') +
          actualFiles +
        '</div>';
    }

    host.innerHTML = '' +
      '<div style="display:flex; gap:10px; flex-wrap:wrap;">' + summaryCards + '</div>' +
      '<div style="display:flex; gap:12px; flex-wrap:wrap; margin-top:14px;">' +
        renderAuditColumn('EPUB', result.epub) +
        renderAuditColumn('Audio', result.audio) +
      '</div>';
  }

  function openPublisherAuditOverlay() {
    renderPublisherAuditOverlay();
    document.getElementById('publisher-audit-overlay').style.display = 'flex';
  }

  function closePublisherAuditOverlay() {
    document.getElementById('publisher-audit-overlay').style.display = 'none';
  }

  function openPublisherConfirm() {
    document.getElementById('publisher-confirm-overlay').style.display = 'flex';
  }

  function closePublisherConfirm() {
    document.getElementById('publisher-confirm-overlay').style.display = 'none';
  }

  function confirmPublisherGenerateAll() {
    closePublisherConfirm();
    _notifyJobStart_();
    setPublisherStatus('Generating all publishing tabs…', 'loading');
    google.script.run
      .withSuccessHandler(function(result) {
        var parts = [];
        if ((result.writtenTabs || []).length) parts.push('Written: ' + result.writtenTabs.join(', '));
        if ((result.missingTabs || []).length) parts.push('Missing from Gemini response: ' + result.missingTabs.join(', '));
        if ((result.unexpectedTabs || []).length) parts.push('Unexpected tabs ignored: ' + result.unexpectedTabs.join(', '));
        setPublisherStatus(parts.join(' | ') || 'No tabs were generated.', (result.missingTabs || []).length ? 'error' : 'info');
        refreshPublisherWorkflowState(true);
      })
      .withFailureHandler(function(e) {
        setPublisherStatus('Error: ' + e.message, 'error');
      })
      .publisherGenerateAllTabs();
  }

  function runPublisherGenerateMissing() {
    _notifyJobStart_();
    setPublisherStatus('Generating missing publishing tabs…', 'loading');
    google.script.run
      .withSuccessHandler(function(result) {
        if (!(result.requestedTabs || []).length) {
          setPublisherStatus('No missing publisher tabs were found.', 'info');
          refreshPublisherWorkflowState(true);
          return;
        }
        var parts = [];
        if ((result.writtenTabs || []).length) parts.push('Written: ' + result.writtenTabs.join(', '));
        if ((result.missingTabs || []).length) parts.push('Missing from Gemini response: ' + result.missingTabs.join(', '));
        if ((result.unexpectedTabs || []).length) parts.push('Unexpected tabs ignored: ' + result.unexpectedTabs.join(', '));
        setPublisherStatus(parts.join(' | '), (result.missingTabs || []).length ? 'error' : 'info');
        refreshPublisherWorkflowState(true);
      })
      .withFailureHandler(function(e) {
        setPublisherStatus('Error: ' + e.message, 'error');
      })
      .publisherGenerateMissingTabs();
  }

  function runPublisherStructuralAudit() {
    _notifyJobStart_();
    setPublisherStatus('Checking publisher package readiness…', 'loading');
    google.script.run
      .withSuccessHandler(function(result) {
        _publisherLastAuditResults = result || null;
        var epubChecks = (result && result.epub && result.epub.checks) || [];
        var audioChecks = (result && result.audio && result.audio.checks) || [];
        var epubOkCount = epubChecks.filter(function(check) { return !!check.ok; }).length;
        var audioOkCount = audioChecks.filter(function(check) { return !!check.ok; }).length;
        var ok = !!(result && result.summary && result.summary.epubOk && result.summary.audioOk);
        setPublisherStatus(
          'Audit complete. EPUB ' + epubOkCount + '/' + epubChecks.length + ' checks passed • Audio ' + audioOkCount + '/' + audioChecks.length + ' checks passed.',
          ok ? 'info' : 'error'
        );
        setPublisherStatusLinks([
          { label: 'Last Audit Results', action: 'showPublisherAuditResults' }
        ]);
        renderPublisherWorkflowState();
        refreshPublisherWorkflowState(true);
      })
      .withFailureHandler(function(e) {
        setPublisherStatus('Error: ' + e.message, 'error');
      })
      .publisherRunStructuralAudit();
  }

  function runPublisherGenerateCoverImages() {
    _notifyJobStart_();
    clearPublisherStatusLinks();
    setPublisherStatus('Generating cover images via Nano Banana Pro…', 'loading');
    google.script.run
      .withSuccessHandler(function(result) {
        if (!result || !result.ok) {
          setPublisherStatus('Error: ' + ((result && result.error) || 'Cover image generation failed.'), 'error');
          return;
        }
        var results = result.results || [];
        var generated = results.filter(function(r) { return r.status === 'generated'; });
        var skipped   = results.filter(function(r) { return r.status === 'skipped'; });
        var failed    = results.filter(function(r) { return r.status === 'failed'; });
        var summary = 'Generated ' + generated.length + ' image(s).' +
          (skipped.length ? ' Skipped ' + skipped.length + '.' : '') +
          (failed.length ? ' Failed ' + failed.length + ': ' + failed.map(function(r) {
            return (r.conceptName || ('Concept ' + (r.conceptNumber || '?'))) + ' (' + (r.error || 'error') + ')';
          }).join('; ') : '');
        setPublisherStatus(summary, failed.length ? 'error' : 'info');
        setPublisherStatusLinks([
          { label: 'Open Drive Folder', href: result.folderUrl }
        ]);
      })
      .withFailureHandler(function(e) {
        setPublisherStatus('Error: ' + e.message, 'error');
      })
      .publisherGenerateCoverImages();
  }

  function runPublisherBuildEpub() {
    _notifyJobStart_();
    clearPublisherStatusLinks();
    setPublisherStatus('Building EPUB package…', 'loading');
    google.script.run
      .withSuccessHandler(function(result) {
        if (!result || !result.ok) {
          setPublisherStatus('Error: ' + ((result && result.error) || 'EPUB packaging failed.'), 'error');
          return;
        }
        setPublisherStatus('EPUB package created in "' + result.folderName + '" as ' + result.fileName + '.', 'info');
        setPublisherStatusLinks([
          { label: 'Open Drive Folder', href: result.folderUrl },
          { label: 'Open EPUB Reader', href: 'https://epub-reader.online' }
        ]);
        refreshPublisherWorkflowState(true);
      })
      .withFailureHandler(function(e) {
        setPublisherStatus('Error: ' + e.message, 'error');
      })
      .publisherBuildEpubPackage();
  }

  function refreshPublisherAudioFiles(silent) {
    if (!silent) setPublisherStatus('Loading audio files…', 'loading');
    google.script.run
      .withSuccessHandler(function(files) {
        _publisherAudioFiles = files || [];
        _publisherSelectedIndex = _publisherAudioFiles.length ? 0 : -1;
        renderPublisherAudioFiles();
        if (!silent) {
          setPublisherStatus(_publisherAudioFiles.length
            ? (_publisherAudioFiles.length + ' audio file(s) available.')
            : 'No `.mp3` files found in EditorLLM/Audio.', 'info');
        }
      })
      .withFailureHandler(function(e) {
        setPublisherStatus('Error loading audio files: ' + e.message, 'error');
      })
      .listEditorLLMAudioFiles();
  }

  function renderPublisherAudioFiles() {
    var host = document.getElementById('publisher-audio-list');
    if (!host) return;
    host.innerHTML = '';
    if (!_publisherAudioFiles.length) {
      host.innerHTML = '<div class="agent-desc" style="margin:0;">No `.mp3` files found.</div>';
      return;
    }

    _publisherAudioFiles.forEach(function(file, idx) {
      var row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '8px';
      row.style.padding = '6px 4px';
      row.style.cursor = 'pointer';
      row.style.borderBottom = idx === _publisherAudioFiles.length - 1 ? 'none' : '1px solid var(--border)';
      row.style.background = idx === _publisherSelectedIndex ? 'rgba(138,180,248,0.12)' : 'transparent';
      row.onclick = function() {
        _publisherSelectedIndex = idx;
        renderPublisherAudioFiles();
      };

      var num = document.createElement('div');
      num.textContent = String(idx + 1);
      num.style.width = '20px';
      num.style.textAlign = 'right';
      num.style.color = 'var(--text-secondary)';

      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = file.selected !== false;
      checkbox.onclick = function(ev) { ev.stopPropagation(); };
      checkbox.onchange = function() {
        file.selected = checkbox.checked;
      };

      var name = document.createElement('div');
      name.textContent = file.name;
      name.style.flex = '1';
      name.style.minWidth = '0';
      name.style.fontSize = '12px';

      row.appendChild(num);
      row.appendChild(checkbox);
      row.appendChild(name);
      host.appendChild(row);
    });
  }

  function movePublisherAudioSelection(dir) {
    var idx = _publisherSelectedIndex;
    if (idx < 0) {
      setPublisherStatus('Select an audio row first.', 'error');
      return;
    }
    var target = idx + dir;
    if (target < 0 || target >= _publisherAudioFiles.length) return;
    var tmp = _publisherAudioFiles[idx];
    _publisherAudioFiles[idx] = _publisherAudioFiles[target];
    _publisherAudioFiles[target] = tmp;
    _publisherSelectedIndex = target;
    renderPublisherAudioFiles();
  }

  function runPublisherBuildAcx() {
    _notifyJobStart_();
    var selectedIds = _publisherAudioFiles
      .filter(function(file) { return file.selected !== false; })
      .map(function(file) { return file.id; });

    if (!selectedIds.length) {
      setPublisherStatus('Select at least one audio file.', 'error');
      return;
    }

    setPublisherStatus('Building ACX package…', 'loading');
    google.script.run
      .withSuccessHandler(function(result) {
        if (!result || !result.ok) {
          setPublisherStatus('Error: ' + ((result && result.error) || 'ACX packaging failed.'), 'error');
          return;
        }
        setPublisherStatus('ACX package created in "' + result.folderName + '" with ' + (result.copied || []).length + ' file(s).', 'info');
        refreshPublisherWorkflowState(true);
      })
      .withFailureHandler(function(e) {
        setPublisherStatus('Error: ' + e.message, 'error');
      })
      .publisherBuildAcxPackage(selectedIds);
  }

  // ── Open in Dialog ─────────────────────────────────────

  function openInDialog() {
    google.script.run.openAsDialog('Sidebar', 'EditorLLM');
  }

