  // ── Dialog wrapper log routing ──────────────────────────
  // When a job-starting action is triggered from the dialog wrapper, we switch
  // the dialog to its own Logs tab so the user can see progress without the
  // server opening/switching the sidebar.  `_notifyJobStart_()` is called at
  // the start of every async job function; it is a no-op in sidebar mode.

  function _notifyJobStart_() {
    if (document.body.classList.contains('dialog-mode')) {
      switchTab('logs');
      // Trigger an immediate dashboard refresh so the new job appears without
      // waiting for the 10-second poll interval.
      pollJobDashboard();
    }
  }

  // Tell the server the dialog is open so runTrackedJob_ skips showSidebar().
  // Done once at startup — the 10-minute TTL in UserCache covers a typical session.
  (function() {
    if (document.body.classList.contains('dialog-mode')) {
      google.script.run.setDialogOpen(true);
    }
  })();

