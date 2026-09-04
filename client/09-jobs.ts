  // ── Log Panel Init ─────────────────────────────────────
  // Called lazily when the user first opens the log view (sidebar or dialog).

  function initLogPanel() {
    if (_logInitialized) return;
    _logInitialized = true;
    setLogFooter('Connecting…', '');
    document.getElementById('autoscroll-btn').classList.add('active');
    pollJobDashboard();
    listTimer = setInterval(pollJobDashboard, JOB_DASHBOARD_MS);
  }

  // ── Log Panel State ────────────────────────────────────

  var jobs             = [];
  var activeJobId      = null;
  var lastSeq          = 0;
  var entryCount       = 0;
  var autoScroll       = true;
  var pollTimer        = null;
  var listTimer        = null;
  var LOG_POLL_MS      = 1500;
  var JOB_DASHBOARD_MS = 10000;

  // ── Log DOM Helpers ────────────────────────────────────

  function logPanel()   { return document.getElementById('log-panel'); }
  function logEmpty()   { return document.getElementById('log-empty'); }
  function logFooterEl(){ return document.getElementById('log-footer'); }
  function logSpinner() { return document.getElementById('spinner'); }
  function logCountEl() { return document.getElementById('log-count'); }
  function jobSelectEl(){ return document.getElementById('job-select'); }

  function setLogFooter(msg, cls) {
    var el = logFooterEl();
    el.textContent = msg;
    el.className = 'log-footer' + (cls ? ' ' + cls : '');
  }

  // ── Log Rendering ──────────────────────────────────────

  function appendEntries(entries) {
    if (!entries || !entries.length) return;
    var p       = logPanel();
    var emptyEl = logEmpty();

    entries.forEach(function(entry) {
      if (emptyEl) emptyEl.style.display = 'none';

      var div     = document.createElement('div');
      div.className = 'log-entry ' + (entry.level || 'INFO');

      var tsSpan  = document.createElement('span');
      tsSpan.className = 'log-ts';
      tsSpan.textContent = entry.ts || '';

      var lvlSpan = document.createElement('span');
      lvlSpan.className = 'log-level';
      lvlSpan.textContent = (entry.level || 'INFO').toUpperCase();

      div.appendChild(tsSpan);
      div.appendChild(lvlSpan);
      div.appendChild(document.createTextNode(entry.msg || ''));

      p.appendChild(div);
      entryCount++;

      if (entry.seq > lastSeq) lastSeq = entry.seq;
    });

    logCountEl().textContent = entryCount + (entryCount === 1 ? ' entry' : ' entries');
    if (autoScroll) p.scrollTop = p.scrollHeight;
  }

  function clearLogPanel() {
    var p = logPanel();
    while (p.lastChild && p.lastChild !== logEmpty()) {
      p.removeChild(p.lastChild);
    }
    var emptyEl = logEmpty();
    if (emptyEl) emptyEl.style.display = '';
    entryCount = 0;
    logCountEl().textContent = '0 entries';
  }

  function toggleAutoScroll() {
    autoScroll = !autoScroll;
    var btn = document.getElementById('autoscroll-btn');
    btn.textContent = autoScroll ? '↓' : '▶';
    btn.title = autoScroll
      ? 'Auto-scroll ON — click to pause'
      : 'Auto-scroll OFF — click to resume';
    if (autoScroll) btn.classList.add('active');
    else            btn.classList.remove('active');
  }

  // ── Job Dropdown ───────────────────────────────────────

  function statusIcon(jobId) {
    var meta = jobs.find(function(j) { return j.id === jobId; });
    if (!meta) return '⟳';
    if (meta._done && meta._error) return '✕';
    if (meta._done)                return '✓';
    return '⟳';
  }

  function renderJobDropdown() {
    var sel = jobSelectEl();
    sel.innerHTML = '';
    if (!jobs.length) {
      var opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '— No jobs yet —';
      sel.appendChild(opt);
      return;
    }
    // Show all jobs (running and completed) so recently-finished jobs remain visible.
    jobs.forEach(function(job) {
      var opt = document.createElement('option');
      opt.value = job.id;
      opt.textContent = statusIcon(job.id) + ' ' + job.label + '  (' + job.startedAt + ')';
      if (job.id === activeJobId) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function onJobSelectChange() {
    var sel   = jobSelectEl();
    var jobId = sel.value;
    if (jobId && jobId !== activeJobId) selectJob(jobId);
  }

  // ── Job Selection ──────────────────────────────────────

  function selectJob(jobId) {
    if (activeJobId === jobId) return;
    activeJobId = jobId;
    lastSeq     = 0;
    entryCount  = 0;
    clearLogPanel();
    renderJobDropdown();
    stopLogPolling();

    setLogFooter('Loading logs…', '');
    logSpinner().classList.remove('hidden');
    google.script.run
      .withSuccessHandler(function(entries) {
        appendEntries(entries);
        google.script.run
          .withSuccessHandler(function(status) {
            updateJobMeta(jobId, status);
            renderJobDropdown();
            if (status && status.done) {
              showJobDone(status);
            } else {
              setLogFooter('Live polling…', '');
              startLogPolling();
            }
          })
          .withFailureHandler(function() {
            setLogFooter('Polling…', '');
            startLogPolling();
          })
          .getJobStatus(jobId);
      })
      .withFailureHandler(function(e) {
        setLogFooter('Error loading logs: ' + (e.message || e), 'error');
      })
      .getLogsSince(jobId, 0);
  }

  function showJobDone(status) {
    logSpinner().classList.add('hidden');
    if (status.error) {
      setLogFooter('Error: ' + status.error, 'error');
    } else {
      setLogFooter('Completed successfully.', 'success');
    }
  }

  function updateJobMeta(jobId, status) {
    if (!status) return;
    var job = jobs.find(function(j) { return j.id === jobId; });
    if (job) {
      job._done  = status.done;
      job._error = status.error;
    }
  }

  // ── Close Completed Jobs ───────────────────────────────

  function closeCompletedJobs() {
    setLogFooter('Removing completed jobs…', '');
    google.script.run
      .withSuccessHandler(function(remainingJobs) {
        var oldMap = {};
        jobs.forEach(function(j) { oldMap[j.id] = j; });
        remainingJobs.forEach(function(j) {
          if (oldMap[j.id]) {
            j._done  = oldMap[j.id]._done;
            j._error = oldMap[j.id]._error;
          }
        });
        jobs = remainingJobs;

        var activeStillExists = jobs.some(function(j) { return j.id === activeJobId; });
        if (!activeStillExists) {
          activeJobId = null;
          clearLogPanel();
          stopLogPolling();
          var runningJobs = jobs.filter(function(j) { return !j._done; });
          if (runningJobs.length) {
            selectJob(runningJobs[0].id);
          } else {
            setLogFooter('No running jobs.', '');
          }
        }
        renderJobDropdown();
        setLogFooter('Completed jobs removed.', 'success');
      })
      .withFailureHandler(function(e) {
        setLogFooter('Error: ' + (e.message || e), 'error');
      })
      .removeCompletedJobs();
  }

  // ── Log Polling ────────────────────────────────────────

  function stopLogPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    logSpinner().classList.add('hidden');
  }

  function startLogPolling() {
    stopLogPolling();
    logSpinner().classList.remove('hidden');
    pollTimer = setInterval(pollLogs, LOG_POLL_MS);
  }

  function pollLogs() {
    if (!activeJobId) return;
    var jid         = activeJobId;
    var capturedSeq = lastSeq;
    google.script.run
      .withSuccessHandler(function(entries) {
        if (jid !== activeJobId) return;
        if (entries && entries.length) appendEntries(entries);
      })
      .withFailureHandler(function() { /* ignore */ })
      .getLogsSince(jid, capturedSeq);
  }

  function pollJobDashboard() {
    google.script.run
      .withSuccessHandler(function(serverJobs) {
        if (!serverJobs || !serverJobs.length) {
          jobs = [];
          renderJobDropdown();
          setLogFooter('No jobs yet. Enable Debug Mode and run an agent to see logs.', '');
          return;
        }
        serverJobs.forEach(function(j) {
          j._done  = j.done;
          j._error = j.error;
        });

        var previousNewest = jobs.length ? jobs[0].id : null;
        jobs = serverJobs;
        renderJobDropdown();

        var newestId = serverJobs[0] ? serverJobs[0].id : null;
        if (newestId && (!activeJobId || newestId !== previousNewest)) {
          selectJob(newestId);
        }

        var current = jobs.find(function(j) { return j.id === activeJobId; });
        if (current) {
          if (current._done) {
            if (pollTimer) { stopLogPolling(); showJobDone(current); }
          } else {
            if (!pollTimer) startLogPolling();
          }
        }
      })
      .withFailureHandler(function() { /* ignore */ })
      .getJobDashboard();
  }

  function refreshJobs() {
    setLogFooter('Refreshing…', '');
    pollJobDashboard();
  }

  // ── Log Copy Helpers ───────────────────────────────────

  function formatLogsAsText(entries) {
    return entries.map(function(e) {
      return (e.ts || '') + '  ' + (e.level || 'INFO').padEnd(5) + '  ' + (e.msg || '');
    }).join('\n');
  }

  function copyToClipboard(text, label) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setLogFooter((label || 'Logs') + ' copied (' + text.split('\n').length + ' lines).', 'success');
      } catch (copyErr) {
        console.error('[copyLogs] execCommand fallback failed', copyErr);
        setLogFooter('Copy failed — select text manually.', 'error');
      }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() {
        setLogFooter((label || 'Logs') + ' copied (' + text.split('\n').length + ' lines).', 'success');
      }, fallback);
    } else {
      fallback();
    }
  }

  function copyJobLogs() {
    var entries = logPanel().querySelectorAll('.log-entry');
    if (!entries.length) { setLogFooter('No log entries to copy.', ''); return; }
    var lines = [];
    entries.forEach(function(div) {
      var ts  = div.querySelector('.log-ts')    ? div.querySelector('.log-ts').textContent    : '';
      var lvl = div.querySelector('.log-level') ? div.querySelector('.log-level').textContent : '';
      var msg = '';
      div.childNodes.forEach(function(node) {
        if (node.nodeType === 3) msg += node.textContent;
      });
      lines.push(ts + '  ' + lvl.padEnd(5) + '  ' + msg.trim());
    });
    copyToClipboard(lines.join('\n'), 'Job logs');
  }

  function copyAllLogs() {
    setLogFooter('Fetching all session logs…', '');
    google.script.run
      .withSuccessHandler(function(entries) {
        if (!entries || !entries.length) { setLogFooter('No session logs found.', ''); return; }
        copyToClipboard(formatLogsAsText(entries), 'All session logs');
      })
      .withFailureHandler(function(e) {
        setLogFooter('Error fetching logs: ' + (e.message || e), 'error');
      })
      .getAllSessionLogs();
  }

  // ── Auto log-view (server-requested via showSidebar(true)) ─
  // body.auto-log-view is set by the Sidebar.html template when
  // showSidebar(true) is called from runTrackedJob_.

  (function() {
    var initialTab = 'main';
    primeTabCache_();
    if (document.body.classList.contains('auto-log-view')) {
      document.body.classList.remove('auto-log-view');
      initialTab = 'logs';
    }
    switchTab(initialTab); // sets initial panel visibility and hides the active tab button
  })();

