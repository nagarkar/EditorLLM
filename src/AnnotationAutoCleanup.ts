// ============================================================
// AnnotationAutoCleanup.ts — Time-triggered auto-removal of
// W2 annotation artifacts when their Drive comment is resolved.
//
// Flow:
//   1. A time-based trigger calls autoCleanupAnnotations() (Code.ts).
//   2. That calls AnnotationAutoCleanup.run().
//   3. run() fetches Drive comments modified since the last poll,
//      filters for resolved agent-created ones, then delegates
//      artifact removal to CollaborationService.clearResolvedAnnotations().
//   4. The poll floor timestamp is stored in Document Properties so
//      each poll only fetches comments modified since the last run.
//
// Agent comments are identified by the format written by annotateOperation_:
//   [DisplayName] "match text": reason: https://...#bookmark=...
// ============================================================

const AnnotationAutoCleanup = (() => {

  const LAST_POLL_KEY = 'annotation_auto_cleanup_last_poll';
  const INTERVAL_KEY  = 'annotation_auto_cleanup_interval';
  const HANDLER       = 'autoCleanupAnnotations';

  // All W2 agent comments start with [DisplayName] "<match text>".
  // User-written comments virtually never match this pattern.
  const AGENT_COMMENT_RE = /^\[.+?\] "/;

  // ── Poll floor ────────────────────────────────────────────────────────────

  function getLastPollTime_(docId: string): string {
    const stored = PropertiesService.getDocumentProperties().getProperty(LAST_POLL_KEY);
    if (stored) return stored;
    // First run: use the document's creation time so we catch any annotations
    // that were already resolved before the trigger was installed.
    try {
      const file = (Drive.Files as any).get(docId, { fields: 'createdTime' }) as { createdTime?: string };
      return file.createdTime ?? new Date(0).toISOString();
    } catch (_) {
      return new Date(0).toISOString();
    }
  }

  function setLastPollTime_(iso: string): void {
    PropertiesService.getDocumentProperties().setProperty(LAST_POLL_KEY, iso);
  }

  // ── Core run ──────────────────────────────────────────────────────────────

  /**
   * Polls for resolved agent-created comments since the last run and clears
   * their document-side annotation artifacts.
   *
   * @returns Counts of cleared, skipped (old-style), and error annotations.
   */
  function run(): { cleared: number; skipped: number; errors: number } {
    const docId    = DocumentApp.getActiveDocument().getId();
    const pollFrom = getLastPollTime_(docId);
    const pollNow  = new Date().toISOString();

    // Collect resolved agent comments modified since last poll.
    let pageToken: string | undefined;
    const resolved: Array<{ id: string; content: string; anchor: string }> = [];

    do {
      const resp = (Drive.Comments as any).list(docId, {
        startModifiedTime: pollFrom,
        includeDeleted:    false,
        fields:            'nextPageToken,comments(id,resolved,content,anchor)',
        maxResults:        100,
        ...(pageToken ? { pageToken } : {}),
      }) as any;

      for (const c of resp.comments ?? []) {
        if (c.resolved && AGENT_COMMENT_RE.test(c.content ?? '')) {
          resolved.push({ id: c.id, content: c.content ?? '', anchor: c.anchor ?? '' });
        }
      }
      pageToken = resp.nextPageToken;
    } while (pageToken);

    Tracer.info(
      `[AnnotationAutoCleanup] poll from=${pollFrom} — ` +
      `${resolved.length} resolved agent comment(s) to process`
    );

    const result = resolved.length > 0
      ? CollaborationService.clearResolvedAnnotations(resolved, docId)
      : { cleared: 0, skipped: 0, errors: 0 };

    // Advance the poll floor, minus a 30 s overlap so comments resolved right
    // at the window boundary are re-checked on the next run. deleteAnnotation_
    // is idempotent — re-processing a successfully cleared comment is harmless.
    setLastPollTime_(new Date(Date.parse(pollNow) - 30_000).toISOString());
    return result;
  }

  // ── Trigger management ────────────────────────────────────────────────────

  /**
   * Installs (or reinstalls) the time-based cleanup trigger.
   * Valid intervalMinutes values: 1, 5, 10, 15, 30 (GAS everyMinutes limits).
   */
  function installTrigger(intervalMinutes: number): void {
    removeTrigger(); // idempotent — clear any existing trigger first
    ScriptApp.newTrigger(HANDLER)
      .timeBased()
      .everyMinutes(intervalMinutes)
      .create();
    PropertiesService.getDocumentProperties()
      .setProperty(INTERVAL_KEY, String(intervalMinutes));
    Tracer.info(`[AnnotationAutoCleanup] trigger installed — every ${intervalMinutes} min`);
  }

  /** Removes all cleanup triggers for this user. */
  function removeTrigger(): void {
    ScriptApp.getProjectTriggers()
      .filter(t => t.getHandlerFunction() === HANDLER)
      .forEach(t => ScriptApp.deleteTrigger(t));
    PropertiesService.getDocumentProperties().deleteProperty(INTERVAL_KEY);
  }

  /** Returns whether the trigger is currently installed and at what interval. */
  function status(): { enabled: boolean; intervalMinutes?: number } {
    const enabled = ScriptApp.getProjectTriggers()
      .some(t => t.getHandlerFunction() === HANDLER);
    if (!enabled) return { enabled: false };
    const raw = PropertiesService.getDocumentProperties().getProperty(INTERVAL_KEY);
    return { enabled: true, intervalMinutes: raw ? Number(raw) : undefined };
  }

  return { run, installTrigger, removeTrigger, status };
})();
