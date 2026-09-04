// ── Custom Agents panel ───────────────────────────────────────────────────────
// Manages the #agents-panel: list, create, edit, delete, share, and
// W2/W3 dispatch for user-defined agents.
// Also owns the manifest overlay and the "Generate Manifest" flow.

// ── State ─────────────────────────────────────────────────────────────────────

var agentsList_: CustomAgentDefinition[] = [];
var currentUserEmail_: string = '';
var currentManifestJson_: string = '';

// ── Initialisation (called by switchTab) ─────────────────────────────────────

function initAgentsPanel(): void {
  refreshAgentsList();
  initAutoCleanup();
  initTeamAnalysisPanel();
}

// ── List ──────────────────────────────────────────────────────────────────────

function refreshAgentsList(): void {
  const statusEl = document.getElementById('agents-status');
  if (statusEl) statusEl.textContent = 'Loading…';
  runServer('listCustomAgents').then(function(resp: CustomAgentsListResponse) {
    agentsList_ = resp.agents || [];
    currentUserEmail_ = resp.currentUserEmail || '';
    renderAgentsList_();
    if (statusEl) statusEl.textContent = '';
  }).catch(function(err: any) {
    if (statusEl) statusEl.textContent = 'Error loading agents: ' + err;
  });
}

function renderAgentsList_(): void {
  const listEl = document.getElementById('agents-list');
  if (!listEl) return;

  if (!agentsList_.length) {
    listEl.innerHTML =
      '<div style="font-size:12px; color:var(--text-secondary); padding:8px 0;">No custom agents yet. Click + New Agent to create one.</div>';
    return;
  }

  listEl.innerHTML = agentsList_.map(function(a) {
    const workflows: string[] = [];
    if (a.workflows.w2) workflows.push('W2');
    if (a.workflows.w3) workflows.push('W3');
    if (a.workflows.w6) workflows.push('W6');
    const workflowBadge = workflows.length
      ? '<span style="font-size:10px; background:#1A3461; color:#8AB4F8; border-radius:3px; padding:1px 5px;">' + workflows.join('+') + '</span>'
      : '';
    const shareBadge = a.storedIn === 'document'
      ? '<span style="font-size:10px; background:#1A3A1A; color:#81c995; border-radius:3px; padding:1px 5px;" title="Shared with document (owner: ' + (a.ownerEmail || 'unknown') + ')">doc</span>'
      : a.storedIn === 'script'
        ? '<span style="font-size:10px; background:#2A1A3A; color:#C58AF8; border-radius:3px; padding:1px 5px;" title="Shared with everyone (owner: ' + (a.ownerEmail || 'unknown') + ')">global</span>'
        : '';

    // Non-owners of shared agents can run but not modify.
    const isOwner = a.storedIn === 'user' || !a.ownerEmail || a.ownerEmail === currentUserEmail_;
    const disabledAttr = isOwner ? '' : ' disabled title="Only the owner can edit this shared agent"';
    const disabledStyle = isOwner ? '' : ' style="opacity:0.4; cursor:not-allowed;"';

    return '<div class="agent-card" style="padding:8px 10px;">' +
      '<div style="display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap;">' +
        '<div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">' +
          '<span style="font-size:13px; font-weight:600;">' + escapeHtml_(a.displayName) + '</span>' +
          '<span style="font-size:11px; color:var(--text-secondary); font-family:monospace;">' + escapeHtml_(a.tag) + '</span>' +
          workflowBadge +
          shareBadge +
        '</div>' +
        '<div style="display:flex; gap:4px; flex-shrink:0;">' +
          (a.workflows.w2
            ? '<button class="btn-green btn-sm" onclick="runAgentAnnotate_(\'' + a.id + '\')" title="Run W2 on active tab">Annotate</button>'
            : '') +
          (a.workflows.w6
            ? '<button class="btn-green btn-sm" onclick="openW6Overlay(\'' + a.id + '\')" title="Run W6 — Run with Context">W6</button>'
            : '') +
          '<button class="btn-ghost btn-sm"' + disabledAttr + disabledStyle + ' onclick="' + (isOwner ? 'openAgentEditor(\'' + a.id + '\')' : '') + '">Edit</button>' +
          (a.storedIn === 'user'
            ? '<button class="btn-ghost btn-sm" onclick="shareAgent_(\'' + a.id + '\')" title="Share with document collaborators">Share</button>'
            : '<button class="btn-ghost btn-sm"' + disabledAttr + disabledStyle + ' onclick="' + (isOwner ? 'unshareAgent_(\'' + a.id + '\')' : '') + '" title="Move back to personal storage">Unshare</button>') +
          '<button class="btn-ghost btn-sm"' + disabledAttr + (isOwner ? ' style="color:var(--warn-fg);"' : disabledStyle) + ' onclick="' + (isOwner ? 'deleteAgent_(\'' + a.id + '\', \'' + escapeHtml_(a.displayName).replace(/'/g, "\\'") + '\')' : '') + '">Delete</button>' +
        '</div>' +
      '</div>' +
      '<div style="margin-top:4px; font-size:11px; color:var(--text-secondary);">' +
        (a.instructionTabName ? 'Instructions: <em>' + escapeHtml_(a.instructionTabName) + '</em>' : '<em>System prompt only</em>') +
        (a.contextTabName ? ' &nbsp;|&nbsp; Context: <em>' + escapeHtml_(a.contextTabName) + '</em>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

function escapeHtml_(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Agent editor ──────────────────────────────────────────────────────────────

function openAgentEditor(agentId?: string): void {
  const overlay = document.getElementById('agent-editor-overlay');
  const titleEl = document.getElementById('agent-editor-title');
  const idInput = document.getElementById('agent-editor-id') as HTMLInputElement;
  const statusEl = document.getElementById('agent-editor-status');
  if (!overlay) return;

  if (statusEl) statusEl.textContent = '';

  if (agentId) {
    const existing = agentsList_.find(function(a) { return a.id === agentId; });
    if (!existing) return;
    if (titleEl) titleEl.textContent = 'Edit Agent';
    idInput.value = existing.id;
    (document.getElementById('agent-name') as HTMLInputElement).value = existing.displayName;
    (document.getElementById('agent-tag') as HTMLInputElement).value = existing.tag;
    (document.getElementById('agent-instruction-tab') as HTMLInputElement).value = existing.instructionTabName || '';
    (document.getElementById('agent-context-tab') as HTMLInputElement).value = existing.contextTabName || '';
    (document.getElementById('agent-system-prompt') as HTMLTextAreaElement).value = existing.systemPrompt;
    (document.getElementById('agent-w2') as HTMLInputElement).checked = existing.workflows.w2;
    (document.getElementById('agent-w3') as HTMLInputElement).checked = existing.workflows.w3;
    (document.getElementById('agent-w6') as HTMLInputElement).checked = existing.workflows.w6 ?? false;
    const storageId = existing.storedIn === 'document' ? 'agent-storage-doc'
      : existing.storedIn === 'script' ? 'agent-storage-script'
      : 'agent-storage-user';
    const storageEl = document.getElementById(storageId) as HTMLInputElement;
    if (storageEl) storageEl.checked = true;
  } else {
    if (titleEl) titleEl.textContent = 'New Agent';
    idInput.value = '';
    (document.getElementById('agent-name') as HTMLInputElement).value = '';
    (document.getElementById('agent-tag') as HTMLInputElement).value = '';
    (document.getElementById('agent-instruction-tab') as HTMLInputElement).value = '';
    (document.getElementById('agent-context-tab') as HTMLInputElement).value = '';
    (document.getElementById('agent-system-prompt') as HTMLTextAreaElement).value = '';
    (document.getElementById('agent-w2') as HTMLInputElement).checked = true;
    (document.getElementById('agent-w3') as HTMLInputElement).checked = false;
    (document.getElementById('agent-w6') as HTMLInputElement).checked = false;
    (document.getElementById('agent-storage-user') as HTMLInputElement).checked = true;
  }

  overlay.style.display = 'flex';
}

function closeAgentEditor(): void {
  const overlay = document.getElementById('agent-editor-overlay');
  if (overlay) overlay.style.display = 'none';
}

function saveAgentFromEditor(): void {
  const statusEl = document.getElementById('agent-editor-status');
  if (statusEl) statusEl.textContent = 'Saving…';

  const id = (document.getElementById('agent-editor-id') as HTMLInputElement).value.trim();
  const storedInEl = document.querySelector('input[name="agent-storage"]:checked') as HTMLInputElement;

  const def: Partial<CustomAgentDefinition> = {
    id:                 id || undefined,
    displayName:        (document.getElementById('agent-name') as HTMLInputElement).value,
    tag:                (document.getElementById('agent-tag') as HTMLInputElement).value,
    instructionTabName: (document.getElementById('agent-instruction-tab') as HTMLInputElement).value,
    contextTabName:     (document.getElementById('agent-context-tab') as HTMLInputElement).value || undefined,
    systemPrompt:       (document.getElementById('agent-system-prompt') as HTMLTextAreaElement).value,
    workflows: {
      w2: (document.getElementById('agent-w2') as HTMLInputElement).checked,
      w3: (document.getElementById('agent-w3') as HTMLInputElement).checked,
      w6: (document.getElementById('agent-w6') as HTMLInputElement).checked,
    },
    storedIn: (storedInEl && storedInEl.value === 'document') ? 'document'
      : (storedInEl && storedInEl.value === 'script') ? 'script'
      : 'user',
  };

  runServer('saveCustomAgent', def).then(function(result: { ok: boolean; agent?: CustomAgentDefinition; error?: string }) {
    if (!result.ok) {
      if (statusEl) statusEl.textContent = result.error || 'Save failed.';
      return;
    }
    closeAgentEditor();
    refreshAgentsList();
  }).catch(function(err: any) {
    if (statusEl) statusEl.textContent = 'Error: ' + err;
  });
}

// ── Delete / share ─────────────────────────────────────────────────────────────

function deleteAgent_(agentId: string, displayName: string): void {
  if (!confirm('Delete agent "' + displayName + '"? This cannot be undone.')) return;
  const statusEl = document.getElementById('agents-status');
  if (statusEl) statusEl.textContent = 'Deleting…';
  runServer('deleteCustomAgent', agentId).then(function(result: { ok: boolean; error?: string }) {
    if (!result.ok) {
      if (statusEl) statusEl.textContent = result.error || 'Delete failed.';
      return;
    }
    refreshAgentsList();
  }).catch(function(err: any) {
    if (statusEl) statusEl.textContent = 'Error: ' + err;
  });
}

function shareAgent_(agentId: string): void {
  const statusEl = document.getElementById('agents-status');
  if (statusEl) statusEl.textContent = 'Sharing…';
  runServer('promoteCustomAgentToDocument', agentId).then(function(result: { ok: boolean; agent?: CustomAgentDefinition; error?: string }) {
    if (!result.ok) {
      if (statusEl) statusEl.textContent = result.error || 'Share failed.';
      return;
    }
    refreshAgentsList();
  }).catch(function(err: any) {
    if (statusEl) statusEl.textContent = 'Error: ' + err;
  });
}

function unshareAgent_(agentId: string): void {
  const statusEl = document.getElementById('agents-status');
  if (statusEl) statusEl.textContent = 'Unsharing…';
  runServer('demoteCustomAgentToUser', agentId).then(function(result: { ok: boolean; agent?: CustomAgentDefinition; error?: string }) {
    if (!result.ok) {
      if (statusEl) statusEl.textContent = result.error || 'Unshare failed.';
      return;
    }
    refreshAgentsList();
  }).catch(function(err: any) {
    if (statusEl) statusEl.textContent = 'Error: ' + err;
  });
}

// ── W2 dispatch ────────────────────────────────────────────────────────────────

function runAgentAnnotate_(agentId: string): void {
  const def = agentsList_.find(function(a) { return a.id === agentId; });
  const label = def ? def.displayName : agentId;
  const statusEl = document.getElementById('agents-status');
  if (statusEl) statusEl.textContent = 'Running ' + label + ' annotation…';
  runServer('runCustomAgentAnnotate', agentId).then(function() {
    if (statusEl) statusEl.textContent = label + ' annotation complete.';
  }).catch(function(err: any) {
    if (statusEl) statusEl.textContent = 'Error: ' + err;
  });
}

// ── Manifest generation ────────────────────────────────────────────────────────

function generateManifest(tabName?: string): void {
  const statusEl = document.getElementById('agents-status');
  if (statusEl) statusEl.textContent = 'Building manifest…';

  if (!tabName) {
    const sel = document.getElementById('tts-tab-select') as HTMLSelectElement | null;
    tabName = sel?.value || undefined;
  }
  const resolveTab: Promise<string> = tabName
    ? Promise.resolve(tabName)
    : runServer('getActiveTabName') as Promise<string>;

  resolveTab.then(function(tab: string) {
    if (!tab) {
      if (statusEl) statusEl.textContent = 'No active tab.';
      return;
    }
    return runServer('exportPartialManifest', tab).then(function(manifest: PartialManifest | null) {
      if (!manifest) {
        if (statusEl) statusEl.textContent = 'No TTS directives found on "' + tab + '".';
        return;
      }
      currentManifestJson_ = JSON.stringify(manifest, null, 2);
      var inner: AudioManifest = (manifest as any).chapter || (manifest as any).openingCredits
        || (manifest as any).closingCredits || (manifest as any).aboutAuthor;
      showManifestOverlay_(tab, inner);
      if (statusEl) statusEl.textContent = '';
    });
  }).catch(function(err: any) {
    if (statusEl) statusEl.textContent = 'Error: ' + err;
  });
}

function showManifestOverlay_(tabName: string, manifest: AudioManifest): void {
  const overlay = document.getElementById('manifest-overlay');
  const tabLabel = document.getElementById('manifest-tab-label');
  const countEl = document.getElementById('manifest-section-count');
  const textarea = document.getElementById('manifest-textarea') as HTMLTextAreaElement;
  const statusEl = document.getElementById('manifest-status');
  if (!overlay) return;

  if (tabLabel) tabLabel.textContent = tabName;
  if (countEl) {
    const speechCount = manifest.sections.filter(function(s) { return s.type === 'speech'; }).length;
    const silenceCount = manifest.sections.filter(function(s) { return s.type === 'silence'; }).length;
    countEl.textContent = '(' + manifest.sections.length + ' sections: ' + speechCount + ' speech, ' + silenceCount + ' silence)';
  }
  if (textarea) textarea.value = currentManifestJson_;
  if (statusEl) statusEl.textContent = '';
  overlay.style.display = 'flex';
}

function closeManifestOverlay(): void {
  const overlay = document.getElementById('manifest-overlay');
  if (overlay) overlay.style.display = 'none';
}

function copyManifest(): void {
  const textarea = document.getElementById('manifest-textarea') as HTMLTextAreaElement;
  const statusEl = document.getElementById('manifest-status');
  if (!textarea || !currentManifestJson_) return;
  textarea.select();
  try {
    document.execCommand('copy');
    if (statusEl) {
      statusEl.textContent = 'Copied to clipboard.';
      setTimeout(function() { if (statusEl) statusEl.textContent = ''; }, 2000);
    }
  } catch (_) {
    if (statusEl) statusEl.textContent = 'Copy failed — select the text manually.';
  }
}

// ── W6 — Run with Context overlay ─────────────────────────────────────────────

var _w6AgentId_ = '';

/** Populates a tab <select> with all manageable tab names. Preserves the current selection. */
function loadW6TabSelect_(selId: string): void {
  const sel = document.getElementById(selId) as HTMLSelectElement;
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">— Loading —</option>';
  runServer('getManageableTabNames').then(function(tabs: string[]) {
    sel.innerHTML = (tabs && tabs.length)
      ? tabs.map(function(n) { return '<option value="' + escapeHtml_(n) + '">' + escapeHtml_(n) + '</option>'; }).join('')
      : '<option value="">— No tabs found —</option>';
    if (prev) sel.value = prev;
  }).catch(function() {
    sel.innerHTML = '<option value="">— Error —</option>';
  });
}

function openW6Overlay(agentId: string): void {
  _w6AgentId_ = agentId;
  const def = agentsList_.find(function(a) { return a.id === agentId; });
  const overlay  = document.getElementById('w6-overlay');
  const titleEl  = document.getElementById('w6-overlay-title');
  const statusEl = document.getElementById('w6-status');
  const btn      = document.getElementById('w6-run-btn') as HTMLButtonElement;
  const textarea = document.getElementById('w6-refine-action') as HTMLTextAreaElement;
  if (!overlay) return;
  if (titleEl)  titleEl.textContent = (def ? def.displayName : 'Agent') + ' — Run with Context';
  if (statusEl) statusEl.textContent = '';
  if (textarea) textarea.value = '';
  if (btn)      btn.disabled = false;
  loadW6TabSelect_('w6-content-tab');
  loadW6TabSelect_('w6-output-tab');
  overlay.style.display = 'flex';
}

function closeW6Overlay(): void {
  const overlay = document.getElementById('w6-overlay');
  if (overlay) overlay.style.display = 'none';
}

async function confirmW6(): Promise<void> {
  const statusEl   = document.getElementById('w6-status');
  const btn        = document.getElementById('w6-run-btn') as HTMLButtonElement;
  const contentSel = document.getElementById('w6-content-tab') as HTMLSelectElement;
  const outputSel  = document.getElementById('w6-output-tab') as HTMLSelectElement;
  const textarea   = document.getElementById('w6-refine-action') as HTMLTextAreaElement;

  const contentTab  = contentSel?.value;
  const outputTab   = outputSel?.value;
  const refineAction = textarea?.value.trim();

  if (!contentTab)   { if (statusEl) statusEl.textContent = 'Select a content tab.'; return; }
  if (!outputTab)    { if (statusEl) statusEl.textContent = 'Select an output tab.'; return; }
  if (!refineAction) { if (statusEl) statusEl.textContent = 'Enter a refine action.'; return; }
  if (outputTab === contentTab) { if (statusEl) statusEl.textContent = 'Output tab must differ from content tab.'; return; }

  _notifyJobStart_();
  if (btn)      btn.disabled = true;
  if (statusEl) statusEl.textContent = 'Running… See Log view for progress.';

  try {
    const result: { ok: boolean; outputTabName: string; error?: string } =
      await runServer('runCustomAgentW6', _w6AgentId_, contentTab, refineAction, outputTab);
    if (!result.ok) {
      if (statusEl) statusEl.textContent = 'Error: ' + (result.error || 'Unknown error');
    } else {
      if (statusEl) statusEl.textContent = 'Done — output written to "' + result.outputTabName + '".';
      setTimeout(function() { closeW6Overlay(); }, 2000);
    }
  } catch (e: any) {
    if (statusEl) statusEl.textContent = 'Error: ' + e.message;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Agent Export / Import ──────────────────────────────────────────────────────

function openAgentExportOverlay(): void {
  const statusEl = document.getElementById('agents-status');
  const overlay  = document.getElementById('agent-export-overlay');
  const textarea = document.getElementById('agent-export-textarea') as HTMLTextAreaElement;
  const exportStatus = document.getElementById('agent-export-status');
  if (!overlay || !textarea) return;

  if (statusEl) statusEl.textContent = 'Exporting…';
  if (exportStatus) exportStatus.textContent = '';

  runServer('exportCustomAgents').then(function(result: { ok: boolean; json?: string; error?: string }) {
    if (!result.ok || !result.json) {
      if (statusEl) statusEl.textContent = 'Export failed: ' + (result.error || 'unknown error');
      return;
    }
    textarea.value = result.json;
    if (statusEl) statusEl.textContent = '';
    overlay.style.display = 'flex';
  }).catch(function(err: any) {
    if (statusEl) statusEl.textContent = 'Error: ' + err;
  });
}

function closeAgentExportOverlay(): void {
  const overlay = document.getElementById('agent-export-overlay');
  if (overlay) overlay.style.display = 'none';
}

function copyAgentExportJson(): void {
  const textarea = document.getElementById('agent-export-textarea') as HTMLTextAreaElement;
  const statusEl = document.getElementById('agent-export-status');
  if (!textarea) return;
  textarea.select();
  try {
    document.execCommand('copy');
    if (statusEl) {
      statusEl.textContent = 'Copied to clipboard.';
      setTimeout(function() { if (statusEl) statusEl.textContent = ''; }, 2000);
    }
  } catch (_) {
    if (statusEl) statusEl.textContent = 'Copy failed — select the text manually.';
  }
}

function openAgentImportOverlay(): void {
  const overlay  = document.getElementById('agent-import-overlay');
  const textarea = document.getElementById('agent-import-textarea') as HTMLTextAreaElement;
  const statusEl = document.getElementById('agent-import-status');
  if (!overlay) return;
  if (textarea) textarea.value = '';
  if (statusEl) statusEl.textContent = '';
  overlay.style.display = 'flex';
}

function closeAgentImportOverlay(): void {
  const overlay = document.getElementById('agent-import-overlay');
  if (overlay) overlay.style.display = 'none';
}

function confirmAgentImport(): void {
  const textarea   = document.getElementById('agent-import-textarea') as HTMLTextAreaElement;
  const statusEl   = document.getElementById('agent-import-status');
  const btn        = document.getElementById('agent-import-btn') as HTMLButtonElement;
  const panelStatus = document.getElementById('agents-status');
  if (!textarea || !statusEl) return;

  const json = textarea.value.trim();
  if (!json) { statusEl.textContent = 'Paste the export JSON first.'; return; }

  if (btn) btn.disabled = true;
  statusEl.textContent = 'Importing…';

  // Non-blocking: close the overlay immediately so the user isn't blocked.
  // The Tracer job created server-side carries the full result — it will
  // appear in the Logs panel and "Copy all logs" output.
  closeAgentImportOverlay();
  if (panelStatus) panelStatus.textContent = 'Importing agents…';

  runServer('importCustomAgents', json).then(function(result: { ok: boolean; imported: number; skipped: string[]; errors: string[] }) {
    var lines: string[] = [];
    if (!result.ok) {
      lines.push('Import failed: ' + (result.errors || []).join('; '));
    } else {
      if (result.imported > 0) lines.push('Imported ' + result.imported + ' agent(s).');
      if (result.skipped && result.skipped.length) {
        lines.push('Skipped (' + result.skipped.length + ' tag collision' + (result.skipped.length > 1 ? 's' : '') + '): ' +
          result.skipped.join(', ') + '. Change the @tag in the JSON to import under a different tag.');
      }
      if (result.errors && result.errors.length) lines.push('Errors: ' + result.errors.join('; '));
      if (result.imported === 0 && (!result.skipped || !result.skipped.length) && (!result.errors || !result.errors.length)) {
        lines.push('No agents found in the import payload.');
      }
    }
    var msg = lines.join(' ');
    if (panelStatus) {
      panelStatus.textContent = msg;
      // Auto-clear the panel status after 12 s so it doesn't linger.
      setTimeout(function() { if (panelStatus) panelStatus.textContent = ''; }, 12000);
    }
    if (result.ok && result.imported > 0) refreshAgentsList();
  }).catch(function(err: any) {
    if (panelStatus) panelStatus.textContent = 'Import error: ' + err;
  }).finally(function() {
    if (btn) btn.disabled = false;
  });
}

function openDesktopApp(): void {
  const statusEl = document.getElementById('manifest-status');
  if (!currentManifestJson_) return;

  // POST the manifest to the desktop app's local HTTP server.
  // If the app is not running, the fetch will fail and we fall back to clipboard guidance.
  fetch('http://localhost:3847/partial-manifest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: currentManifestJson_,
  }).then(function(res) {
    if (res.ok) {
      if (statusEl) {
        statusEl.textContent = 'Manifest sent to desktop app.';
        setTimeout(function() { if (statusEl) statusEl.textContent = ''; }, 2000);
      }
    } else {
      if (statusEl) statusEl.textContent = 'Desktop app returned an error. Copy the manifest and open it manually.';
    }
  }).catch(function() {
    if (statusEl) {
      statusEl.textContent = 'Desktop app not running. Copy the manifest and open it in the EditorLLM desktop app.';
    }
  });
}
