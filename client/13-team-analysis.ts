// ── Agentic Team Analysis panel ───────────────────────────────────────────────
// Manages team CRUD, analysis launch, and continuation polling.

// ── State ─────────────────────────────────────────────────────────────────────

var _teamsList: AgentTeamDefinition[] = [];
var _teamsAgentsList: CustomAgentDefinition[] = [];
var _teamsAnalysisRunning = false;

// ── Initialisation ────────────────────────────────────────────────────────────

function initTeamAnalysisPanel(): void {
  refreshTeamsList();
  loadTeamTabDropdown();
}

// ── Team list ─────────────────────────────────────────────────────────────────

function refreshTeamsList(): void {
  var statusEl = document.getElementById('teams-status');

  // Load teams and agents in parallel
  Promise.all([
    runServer('listAgentTeams') as Promise<AgentTeamDefinition[]>,
    runServer('listCustomAgents') as Promise<CustomAgentsListResponse>,
  ]).then(function(results) {
    _teamsList = results[0] || [];
    _teamsAgentsList = (results[1] && results[1].agents) ? results[1].agents : [];
    renderTeamsList_();
    refreshTeamDropdown_();
    if (statusEl) statusEl.textContent = '';
  }).catch(function(err: any) {
    if (statusEl) statusEl.textContent = 'Error loading teams: ' + err;
  });
}

function renderTeamsList_(): void {
  var listEl = document.getElementById('teams-list');
  if (!listEl) return;

  if (!_teamsList.length) {
    listEl.innerHTML =
      '<div style="font-size:12px; color:var(--text-secondary); padding:8px 0;">No teams yet. Click + New Team to create one.</div>';
    return;
  }

  listEl.innerHTML = _teamsList.map(function(t) {
    var agentNames = t.agentIds.map(function(id) {
      var def = _teamsAgentsList.find(function(a) { return a.id === id; });
      return def ? def.displayName : id;
    }).join(', ');

    var shareBadge = t.storedIn === 'document'
      ? '<span style="font-size:10px; background:#1A3A1A; color:#81c995; border-radius:3px; padding:1px 5px;" title="Shared with document">doc</span>'
      : '';

    return '<div class="agent-card" style="padding:8px 10px;">' +
      '<div style="display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap;">' +
        '<div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">' +
          '<span style="font-size:13px; font-weight:600;">' + escapeHtml_(t.name) + '</span>' +
          shareBadge +
        '</div>' +
        '<div style="display:flex; gap:4px;">' +
          '<button class="btn-ghost btn-sm" onclick="openTeamEditor(\'' + t.id + '\')">Edit</button>' +
          (t.storedIn === 'user'
            ? '<button class="btn-ghost btn-sm" onclick="shareTeam_(\'' + t.id + '\')" title="Share with document collaborators">Share</button>'
            : '') +
          '<button class="btn-ghost btn-sm" style="color:var(--warn-fg);" onclick="deleteTeam_(\'' + t.id + '\', \'' + escapeHtml_(t.name).replace(/'/g, "\\'") + '\')">Delete</button>' +
        '</div>' +
      '</div>' +
      '<div style="margin-top:4px; font-size:11px; color:var(--text-secondary);">Agents: ' + escapeHtml_(agentNames || '(none)') + '</div>' +
    '</div>';
  }).join('');
}

function refreshTeamDropdown_(): void {
  var sel = document.getElementById('team-analysis-team-select') as HTMLSelectElement;
  if (!sel) return;
  var prev = sel.value;
  sel.innerHTML = _teamsList.length
    ? _teamsList.map(function(t) {
        return '<option value="' + escapeHtml_(t.id) + '">' + escapeHtml_(t.name) + '</option>';
      }).join('')
    : '<option value="">— No teams —</option>';
  if (prev) sel.value = prev;
}

// ── Tab dropdown ──────────────────────────────────────────────────────────────

function loadTeamTabDropdown(): void {
  var sourceSel = document.getElementById('team-analysis-tab-select') as HTMLSelectElement;
  var outputSel = document.getElementById('team-analysis-output-tab-select') as HTMLSelectElement;
  if (!sourceSel) return;

  runServer('getManageableTabNames').then(function(tabs: string[]) {
    var prevSource = sourceSel.value;
    var prevOutput = outputSel ? outputSel.value : '';
    var options = (tabs && tabs.length)
      ? tabs.map(function(n) { return '<option value="' + escapeHtml_(n) + '">' + escapeHtml_(n) + '</option>'; }).join('')
      : '<option value="">— No tabs —</option>';
    sourceSel.innerHTML = options;
    if (outputSel) outputSel.innerHTML = options;
    if (prevSource) sourceSel.value = prevSource;
    if (prevOutput && outputSel) outputSel.value = prevOutput;
  }).catch(function() {
    sourceSel.innerHTML = '<option value="">— Error loading tabs —</option>';
    if (outputSel) outputSel.innerHTML = '<option value="">— Error loading tabs —</option>';
  });
}

// ── Team editor overlay ───────────────────────────────────────────────────────

function openTeamEditor(teamId?: string): void {
  var overlay  = document.getElementById('team-editor-overlay');
  var titleEl  = document.getElementById('team-editor-title');
  var idInput  = document.getElementById('team-editor-id') as HTMLInputElement;
  var nameInput = document.getElementById('team-name') as HTMLInputElement;
  var statusEl = document.getElementById('team-editor-status');
  if (!overlay) return;

  if (statusEl) statusEl.textContent = '';

  // Populate agent checkboxes
  renderAgentCheckboxes_(teamId ? (_teamsList.find(function(t) { return t.id === teamId; })?.agentIds || []) : []);

  if (teamId) {
    var existing = _teamsList.find(function(t) { return t.id === teamId; });
    if (!existing) return;
    if (titleEl) titleEl.textContent = 'Edit Team';
    idInput.value = existing.id;
    nameInput.value = existing.name;
    // Check storage
    var docRadio = document.getElementById('team-storage-doc') as HTMLInputElement;
    var userRadio = document.getElementById('team-storage-user') as HTMLInputElement;
    if (existing.storedIn === 'document') { if (docRadio) docRadio.checked = true; }
    else { if (userRadio) userRadio.checked = true; }
  } else {
    if (titleEl) titleEl.textContent = 'New Team';
    idInput.value = '';
    nameInput.value = '';
    var userRadio2 = document.getElementById('team-storage-user') as HTMLInputElement;
    if (userRadio2) userRadio2.checked = true;
  }

  overlay.style.display = 'flex';
}

function renderAgentCheckboxes_(selectedIds: string[]): void {
  var container = document.getElementById('team-agent-list');
  if (!container) return;

  if (!_teamsAgentsList.length) {
    container.innerHTML = '<div style="font-size:11px; color:var(--text-secondary);">No custom agents defined yet.</div>';
    return;
  }

  container.innerHTML = _teamsAgentsList.map(function(a, i) {
    var checked = selectedIds.includes(a.id) ? ' checked' : '';
    var order = selectedIds.indexOf(a.id);
    return '<label style="display:flex; align-items:center; gap:6px; cursor:pointer; margin-bottom:4px;">' +
      '<input type="checkbox" class="team-agent-cb" value="' + escapeHtml_(a.id) + '"' + checked +
      ' style="accent-color:#8AB4F8;" data-order="' + (order >= 0 ? order : 999 + i) + '">' +
      '<span style="font-size:12px;">' + escapeHtml_(a.displayName) + '</span>' +
      '<span style="font-size:11px; color:var(--text-secondary); font-family:monospace;">' + escapeHtml_(a.tag) + '</span>' +
    '</label>';
  }).join('');
}

function closeTeamEditor(): void {
  var overlay = document.getElementById('team-editor-overlay');
  if (overlay) overlay.style.display = 'none';
}

function saveTeamFromEditor(): void {
  var statusEl  = document.getElementById('team-editor-status');
  var nameInput = document.getElementById('team-name') as HTMLInputElement;
  var idInput   = document.getElementById('team-editor-id') as HTMLInputElement;
  var storedInEl = document.querySelector('input[name="team-storage"]:checked') as HTMLInputElement;

  if (!nameInput || !nameInput.value.trim()) {
    if (statusEl) statusEl.textContent = 'Team name is required.';
    return;
  }

  // Collect checked agents in document order (DOM order = display order)
  var checkboxes = document.querySelectorAll('.team-agent-cb:checked');
  var agentIds: string[] = [];
  checkboxes.forEach(function(cb) { agentIds.push((cb as HTMLInputElement).value); });

  if (!agentIds.length) {
    if (statusEl) statusEl.textContent = 'Select at least one agent.';
    return;
  }

  if (statusEl) statusEl.textContent = 'Saving…';

  var def: Partial<AgentTeamDefinition> = {
    id:       idInput.value.trim() || undefined,
    name:     nameInput.value.trim(),
    agentIds: agentIds,
    storedIn: (storedInEl && storedInEl.value === 'document') ? 'document' : 'user',
  };

  runServer('saveAgentTeam', def).then(function(result: { ok: boolean; team?: AgentTeamDefinition; error?: string }) {
    if (!result.ok) {
      if (statusEl) statusEl.textContent = result.error || 'Save failed.';
      return;
    }
    closeTeamEditor();
    refreshTeamsList();
  }).catch(function(err: any) {
    if (statusEl) statusEl.textContent = 'Error: ' + err;
  });
}

function deleteTeam_(teamId: string, name: string): void {
  if (!confirm('Delete team "' + name + '"?')) return;
  var statusEl = document.getElementById('teams-status');
  runServer('deleteAgentTeam', teamId).then(function(result: { ok: boolean; error?: string }) {
    if (!result.ok && statusEl) statusEl.textContent = result.error || 'Delete failed.';
    refreshTeamsList();
  }).catch(function(err: any) {
    if (statusEl) statusEl.textContent = 'Error: ' + err;
  });
}

function shareTeam_(teamId: string): void {
  var statusEl = document.getElementById('teams-status');
  if (statusEl) statusEl.textContent = 'Sharing…';
  runServer('promoteAgentTeamToDocument', teamId).then(function(result: { ok: boolean; team?: AgentTeamDefinition; error?: string }) {
    if (!result.ok && statusEl) statusEl.textContent = result.error || 'Share failed.';
    else refreshTeamsList();
  }).catch(function(err: any) {
    if (statusEl) statusEl.textContent = 'Error: ' + err;
  });
}

// ── Team export / import overlay ──────────────────────────────────────────────

function openTeamExportOverlay(): void {
  var overlay  = document.getElementById('team-export-overlay');
  var textarea = document.getElementById('team-export-textarea') as HTMLTextAreaElement;
  var statusEl = document.getElementById('teams-status');
  var exportStatus = document.getElementById('team-export-status');
  if (!overlay) return;
  if (exportStatus) exportStatus.textContent = '';
  if (statusEl) statusEl.textContent = 'Exporting…';

  runServer('exportAgentTeams').then(function(result: { ok: boolean; json?: string; error?: string }) {
    if (!result.ok || !result.json) {
      if (statusEl) statusEl.textContent = 'Export failed: ' + (result.error || 'unknown error');
      return;
    }
    if (textarea) textarea.value = result.json;
    if (statusEl) statusEl.textContent = '';
    overlay.style.display = 'flex';
  }).catch(function(err: any) {
    if (statusEl) statusEl.textContent = 'Error: ' + err;
  });
}

function closeTeamExportOverlay(): void {
  var overlay = document.getElementById('team-export-overlay');
  if (overlay) overlay.style.display = 'none';
}

function copyTeamExportJson(): void {
  var textarea = document.getElementById('team-export-textarea') as HTMLTextAreaElement;
  var statusEl = document.getElementById('team-export-status');
  if (!textarea) return;
  textarea.select();
  try {
    document.execCommand('copy');
    if (statusEl) { statusEl.textContent = 'Copied.'; setTimeout(function() { if (statusEl) statusEl.textContent = ''; }, 2000); }
  } catch (_) {
    if (statusEl) statusEl.textContent = 'Copy failed — select the text manually.';
  }
}

function openTeamImportOverlay(): void {
  var overlay  = document.getElementById('team-import-overlay');
  var textarea = document.getElementById('team-import-textarea') as HTMLTextAreaElement;
  var statusEl = document.getElementById('team-import-status');
  if (!overlay) return;
  if (textarea) textarea.value = '';
  if (statusEl) statusEl.textContent = '';
  overlay.style.display = 'flex';
}

function closeTeamImportOverlay(): void {
  var overlay = document.getElementById('team-import-overlay');
  if (overlay) overlay.style.display = 'none';
}

function confirmTeamImport(): void {
  var textarea = document.getElementById('team-import-textarea') as HTMLTextAreaElement;
  var statusEl = document.getElementById('team-import-status');
  var btn      = document.getElementById('team-import-btn') as HTMLButtonElement;
  if (!textarea || !statusEl) return;

  var json = textarea.value.trim();
  if (!json) { statusEl.textContent = 'Paste the export JSON first.'; return; }

  if (btn) btn.disabled = true;
  statusEl.textContent = 'Importing…';

  runServer('importAgentTeams', json).then(function(result: { ok: boolean; imported: number; skipped: string[]; errors: string[] }) {
    var msg = result.ok
      ? 'Imported ' + result.imported + ' team(s).'
      : 'Import failed.';
    if (result.skipped && result.skipped.length) msg += ' Skipped: ' + result.skipped.join('; ');
    if (result.errors  && result.errors.length)  msg += ' Errors: ' + result.errors.join('; ');
    statusEl.textContent = msg;
    if (result.ok) { closeTeamImportOverlay(); refreshTeamsList(); }
  }).catch(function(err: any) {
    statusEl.textContent = 'Error: ' + err;
  }).finally(function() {
    if (btn) btn.disabled = false;
  });
}

// ── Analysis launch ───────────────────────────────────────────────────────────

function setTeamAnalysisStatus_(msg: string, type?: string): void {
  setElementStatus('team-analysis-status', 'Analysis', msg, type);
}

async function startTeamAnalysis(): Promise<void> {
  if (_teamsAnalysisRunning) return;

  var teamSel   = document.getElementById('team-analysis-team-select') as HTMLSelectElement;
  var tabSel    = document.getElementById('team-analysis-tab-select') as HTMLSelectElement;
  var outputSel = document.getElementById('team-analysis-output-tab-select') as HTMLSelectElement;
  var teamId    = teamSel?.value;
  var tabName   = tabSel?.value;
  var outputTab = outputSel?.value;

  if (!teamId)    { setTeamAnalysisStatus_('Select a team first.', 'error'); return; }
  if (!tabName)   { setTeamAnalysisStatus_('Select a source tab first.', 'error'); return; }
  if (!outputTab) { setTeamAnalysisStatus_('Select an output tab first.', 'error'); return; }
  if (outputTab === tabName) { setTeamAnalysisStatus_('Output tab must differ from source tab.', 'error'); return; }

  _notifyJobStart_();
  _teamsAnalysisRunning = true;
  var btn = document.getElementById('team-analysis-start-btn') as HTMLButtonElement;
  if (btn) btn.disabled = true;
  setTeamAnalysisStatus_('Starting analysis… see Log view for progress.', 'loading');

  try {
    var keepGoing = true;
    while (keepGoing) {
      var result: TeamAnalysisResult = await runServer('startOrContinueTeamAnalysis', teamId, tabName, outputTab);

      if (result.status === 'complete') {
        setTeamAnalysisStatus_(
          'Analysis complete — ' + result.processedCount + ' paragraph(s). Output in "' + result.outputTabName + '".',
          'info'
        );
        keepGoing = false;
      } else if (result.status === 'continuing') {
        setTeamAnalysisStatus_(
          'Processed ' + result.processedCount + '/' + result.totalCount + ' paragraphs — continuing…',
          'loading'
        );
        // Brief pause to let the event loop breathe and avoid hammering the server.
        await new Promise<void>(function(resolve) { setTimeout(resolve, 1500); });
      } else {
        setTeamAnalysisStatus_('Error: ' + (result.error || 'Unknown error'), 'error');
        keepGoing = false;
      }
    }
  } catch (e: any) {
    console.error('[startTeamAnalysis]', e);
    setTeamAnalysisStatus_('Error: ' + e.message, 'error');
  } finally {
    _teamsAnalysisRunning = false;
    if (btn) btn.disabled = false;
  }
}
