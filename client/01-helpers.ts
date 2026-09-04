  // ── Helpers ────────────────────────────────────────────

  /**
   * Fetches all session log entries from the server and copies them to clipboard.
   * Uses execCommand fallback for the GAS sidebar iframe context.
   */
  function copyAllSessionLogs() {
    setStatus('Fetching session logs…', 'loading');
    runServer('getAllSessionLogs').then(function(entries) {
      if (!entries || !entries.length) {
        setStatus('No session logs found.', 'loading');
        return;
      }
      var lines = entries.map(function(e) {
        return (e.ts || '') + '  ' + (e.level || 'INFO').padEnd(5) + '  ' + (e.msg || '');
      });
      var text = lines.join('\n');
      function fallback() {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          setStatus('Copied ' + lines.length + ' log lines to clipboard.', 'info');
        } catch (copyErr) {
          console.error('[copyLogsToClipboard] execCommand fallback failed', copyErr);
          setStatus('Copy failed — use the log view (≡ Logs) to copy instead.', 'error');
        }
        document.body.removeChild(ta);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function() {
          setStatus('Copied ' + lines.length + ' log lines to clipboard.', 'info');
        }, fallback);
      } else {
        fallback();
      }
    }).catch(function(e) {
      setStatus('Error fetching logs: ' + (e.message || e), 'error');
    });
  }

  /** Max lines kept in Recent activity (sidebar). */
  var RECENT_RUNS_MAX = 25;
  var _toastHideTimer = null;

  function truncateOneLine(text, maxLen) {
    if (!text) return '';
    var parts = String(text).split(/\r?\n/);
    var one = '';
    for (var i = 0; i < parts.length; i++) {
      var s = parts[i].trim();
      if (s) { one = s; break; }
    }
    if (!one) one = String(text).trim();
    if (one.length <= maxLen) return one;
    return one.slice(0, maxLen - 1) + '…';
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function timeHHMMSS() {
    var d = new Date();
    function z(n) { return n < 10 ? '0' + n : '' + n; }
    return z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds());
  }

  /**
   * Prepends a completed or failed run to Recent activity.
   * @param {string} sourceLabel Short tag: Status, Merge, Refresh, Sweep.
   */
  function appendRecentRun(sourceLabel, msg, ok) {
    var list = document.getElementById('recent-runs-list');
    if (!list) return;
    var line = String(msg || '').trim();
    if (!line) return;

    var li = document.createElement('li');
    li.className = 'recent-run-line ' + (ok ? 'recent-run-ok' : 'recent-run-fail');
    if (line.length > 100) li.title = line;

    var t = document.createElement('span');
    t.className = 'recent-run-time';
    t.textContent = timeHHMMSS();

    var mark = document.createElement('span');
    mark.className = 'recent-run-mark';
    mark.textContent = ok ? '✓ ' : '✗ ';

    var src = document.createElement('span');
    src.className = 'recent-run-src';
    src.textContent = '[' + (sourceLabel || 'Task') + '] ';

    var body = document.createElement('span');
    body.textContent = truncateOneLine(line, 220);

    li.appendChild(t);
    li.appendChild(mark);
    li.appendChild(src);
    li.appendChild(body);

    list.insertBefore(li, list.firstChild);
    while (list.children.length > RECENT_RUNS_MAX) {
      list.removeChild(list.lastChild);
    }
  }

  /** Brief toast for success / error so users see feedback without opening logs. */
  function showOutcomeToast(msg, type) {
    var host = document.getElementById('toast-host');
    if (!host) return;
    var line = truncateOneLine(msg, 160);
    if (!line) return;

    if (_toastHideTimer) {
      clearTimeout(_toastHideTimer);
      _toastHideTimer = null;
    }
    host.innerHTML = '';

    var t = document.createElement('div');
    t.className = 'toast ' + (type === 'error' ? 'toast-error' : 'toast-success');
    t.textContent = line;
    host.appendChild(t);

    _toastHideTimer = setTimeout(function() {
      t.classList.add('toast-out');
      setTimeout(function() {
        if (t.parentNode === host) host.removeChild(t);
      }, 280);
      _toastHideTimer = null;
    }, 4800);
  }

  function notifyOutcomeIfTerminal(sourceLabel, msg, type) {
    if (type !== 'info' && type !== 'error') return;
    var line = String(msg || '').trim();
    if (!line) return;
    appendRecentRun(sourceLabel, line, type !== 'error');
    showOutcomeToast(line, type);
  }

  function setElementStatus(elementId, sourceLabel, msg, type) {
    var el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = msg;
    el.className = 'status-box' + (type ? ' ' + type : '');
    if (sourceLabel) notifyOutcomeIfTerminal(sourceLabel, msg, type);
  }

  function setStatus(msg, type) {
    setElementStatus('status', 'Status', msg, type);
  }

  function setMergeStatus(msg, type) {
    setElementStatus('merge-status', 'Merge', msg, type);
  }

  function setMergeProgress(msg) {
    document.getElementById('merge-progress').textContent = msg;
  }

  // ── Busy overlay spinner ────────────────────────────────────────────────────
  // Reference-counted so overlapping calls (rapid clicks, background polls)
  // never hide the spinner while another call is still in flight.

  var _spinnerCount = 0;

  function showSpinner(): void {
    _spinnerCount++;
    if (_spinnerCount === 1) {
      var el = document.getElementById('spinner-overlay');
      if (el) el.style.display = 'flex';
    }
  }

  function hideSpinner(): void {
    _spinnerCount = Math.max(0, _spinnerCount - 1);
    if (_spinnerCount === 0) {
      var el = document.getElementById('spinner-overlay');
      if (el) el.style.display = 'none';
    }
  }

  /**
   * Wraps google.script.run in a Promise.
   * Always shows the busy spinner before the call and hides it in .finally()
   * so the spinner is guaranteed to clear on both success AND failure.
   */
  function runServer(fnName: string, ...args: any[]): Promise<any> {
    showSpinner();
    return new Promise(function (resolve, reject) {
      var call = google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler(reject);
      (call as any)[fnName].apply(call, args);
    }).finally(function () {
      hideSpinner();
    });
  }

