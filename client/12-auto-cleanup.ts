// ── Annotation auto-cleanup panel ─────────────────────────────────────────────
// Manages the "Auto-clear annotations" card in the Agents panel.

function initAutoCleanup(): void {
  runServer('getAnnotationAutoCleanupStatus').then(function(s: { enabled: boolean; intervalMinutes?: number }) {
    const cb  = document.getElementById('auto-cleanup-enabled') as HTMLInputElement | null;
    const row = document.getElementById('auto-cleanup-interval-row') as HTMLElement | null;
    const sel = document.getElementById('auto-cleanup-interval') as HTMLSelectElement | null;
    if (cb)  cb.checked = s.enabled;
    if (row) row.style.display = s.enabled ? 'flex' : 'none';
    if (sel && s.intervalMinutes) sel.value = String(s.intervalMinutes);
  }).catch(function(err: any) {
    var st = document.getElementById('auto-cleanup-status');
    if (st) st.textContent = 'Error loading status: ' + err;
  });
}

function onAutoCleanupToggle(): void {
  var cb  = document.getElementById('auto-cleanup-enabled') as HTMLInputElement | null;
  var row = document.getElementById('auto-cleanup-interval-row') as HTMLElement | null;
  var sel = document.getElementById('auto-cleanup-interval') as HTMLSelectElement | null;
  var st  = document.getElementById('auto-cleanup-status');
  if (!cb) return;

  var enabled = cb.checked;
  if (row) row.style.display = enabled ? 'flex' : 'none';

  if (enabled) {
    var interval = sel ? Number(sel.value) : 5;
    if (st) st.textContent = 'Enabling…';
    runServer('enableAnnotationAutoCleanup', interval).then(function(r: { ok: boolean; error?: string }) {
      if (st) st.textContent = r.ok
        ? 'Active — checking every ' + interval + ' min.'
        : (r.error || 'Failed to enable.');
      if (!r.ok && cb) { cb.checked = false; if (row) row.style.display = 'none'; }
    }).catch(function(err: any) {
      if (st) st.textContent = 'Error: ' + err;
      if (cb) cb.checked = false;
      if (row) row.style.display = 'none';
    });
  } else {
    if (st) st.textContent = 'Disabling…';
    runServer('disableAnnotationAutoCleanup').then(function(r: { ok: boolean; error?: string }) {
      if (st) st.textContent = r.ok ? 'Disabled.' : (r.error || 'Failed to disable.');
      if (!r.ok && cb) { cb.checked = true; if (row) row.style.display = 'flex'; }
    }).catch(function(err: any) {
      if (st) st.textContent = 'Error: ' + err;
      if (cb) cb.checked = true;
      if (row) row.style.display = 'flex';
    });
  }
}

function onAutoCleanupIntervalChange(): void {
  var cb  = document.getElementById('auto-cleanup-enabled') as HTMLInputElement | null;
  var sel = document.getElementById('auto-cleanup-interval') as HTMLSelectElement | null;
  var st  = document.getElementById('auto-cleanup-status');
  if (!cb || !cb.checked || !sel) return;

  var interval = Number(sel.value);
  if (st) st.textContent = 'Updating…';
  runServer('enableAnnotationAutoCleanup', interval).then(function(r: { ok: boolean; error?: string }) {
    if (st) st.textContent = r.ok
      ? 'Active — checking every ' + interval + ' min.'
      : (r.error || 'Failed to update interval.');
  }).catch(function(err: any) {
    if (st) st.textContent = 'Error: ' + err;
  });
}
