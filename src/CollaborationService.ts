// ============================================================
// CollaborationService.ts — Matching, highlighting, and
// commenting engine for the Collaborative Tab Update System.
// ============================================================
/// <reference path="./CollaborationHelpers.ts" />

const CollaborationService = (() => {

  // findTextOrFallback_, highlightRangeElement_, highlightNamedRange_,
  // clearNamedRangeHighlights_, matchesAgentPrefix_, buildCommentContent_,
  // and MAX_COMMENT_CHARS live in CollaborationHelpers.ts and are available
  // here via GAS flat scope (no import needed).

  // Named-range key prefix. Every annotation stores its text range under
  // `NAMED_RANGE_PREFIX + bookmarkId` so the deletion path can find and
  // clear exactly the highlighted span without a whole-tab color sweep.
  const NAMED_RANGE_PREFIX = 'annotation_';

  // Per-annotation record built during the Drive comment collect phase and
  // consumed by the per-annotation mutation phase.
  interface AnnotationRecord {
    commentId:    string;
    content:      string;
    bookmarkId:   string | null;   // null → old-style annotation, no named range
    commentTabId: string | undefined;
  }

  // ── Tab map ────────────────────────────────────────────────────────────────

  /**
   * Builds a map of tabId → { docTab, title } by walking the full tab tree.
   * Used by clearAgentAnnotationsBulk_ so it can look up DocumentTab objects
   * when processing comments across multiple tabs in a single pass.
   */
  function buildTabMap_(): Map<string, { docTab: GoogleAppsScript.Document.DocumentTab; title: string }> {
    const map = new Map<string, { docTab: GoogleAppsScript.Document.DocumentTab; title: string }>();
    DocOps.walkTabs(tab => {
      map.set(tab.getId(), { docTab: tab.asDocumentTab(), title: tab.getTitle() });
    });
    return map;
  }

  // ── Comment via Drive API ──────────────────────────────────────────────────

  /**
   * Creates a Drive comment anchored to the given tab.
   * Returns the new comment ID on success, or null on failure (error is logged).
   * Callers MUST check the return value and roll back any already-created
   * document state (bookmark, named range) if null is returned.
   */
  function addTabComment_(
    tabId: string,
    commentBody: string,
    matchText: string,
    agentPrefix: string,
    bookmarkUrl: string,
    docId: string
  ): string | null {
    const { content: finalContent, truncated } = buildCommentContent_(
      agentPrefix, matchText, commentBody, bookmarkUrl
    );
    if (truncated) {
      Tracer.warn(
        `CollaborationService: comment truncated to ${MAX_COMMENT_CHARS} chars.`
      );
    }

    try {
      const result = (Drive.Comments as any).create(
        {
          content: finalContent,
          // Anchor format is reverse-engineered from the Drive API v3 comment
          // response — it is not documented by Google.  The structure is:
          //   r: 'head'      — revision token (always "head" for current revision)
          //   a: [{ lt: { tb: { id: <tabId> } } }]
          //     lt = "location target", tb = "tab", id = the tab's string ID.
          // Tab-level granularity is the finest that the Drive Comments API
          // exposes; finer anchoring (paragraph, character range) would require
          // the undocumented Trix selection format used by the Docs web client.
          anchor: JSON.stringify({
            r: 'head',
            a: [{ lt: { tb: { id: tabId } } }],
          }),
        },
        docId,
        { fields: 'id' }
      ) as { id?: string };
      return result?.id ?? null;
    } catch (e) {
      Tracer.error(`CollaborationService: Drive comment failed — ${e}`);
      return null;
    }
  }

  // --- Clear agent annotations ---

  // ── Shared per-annotation mutation ────────────────────────────────────────

  /**
   * Applies the per-annotation deletion sequence for one AnnotationRecord.
   * Returns true when the Drive comment was successfully deleted, false when a
   * recoverable error aborted the sequence so the caller can retry next run.
   *
   * Structure: three exclusive branches handle named-range cleanup, then a
   * shared bookmark-removal block runs for any annotation that has a bookmarkId,
   * then the Drive comment is always deleted last.
   *
   *   Branch A — bookmarkId + docTab (new-style annotation, normal case)
   *     Named range found → clear highlights, remove range (abort on failure).
   *     Named range absent → set needsColorSweep flag (old-style fallback).
   *     Either way, bookmark removal and Drive deletion proceed below.
   *
   *   Branch B — bookmarkId but docTab=null (orphan: tab unknown)
   *     Named-range work requires a tab → skipped with a warning.
   *     actDoc.getBookmark() IS document-scoped, so bookmark removal still runs.
   *     No color sweep scheduled (no tab name available).
   *
   *   Branch C — no bookmarkId (very old annotation style)
   *     Set needsColorSweep flag. No bookmark to remove.
   *
   * After the branches:
   *   Bookmark removal — attempted whenever bookmarkId is non-null.
   *     actDoc.getBookmark() works across all tabs without a docTab reference.
   *     Abort on failure (leaves comment intact for retry).
   *   Drive comment delete — always the final step; log on failure, ok=false.
   *
   * Returns a result object so callers can accumulate per-pass totals:
   *   ok          — true when the Drive comment was deleted; false = aborted (retry next run).
   *   namedRanges — named ranges removed (0 or 1 per annotation).
   *   bookmarks   — bookmarks removed (0 or 1 per annotation).
   *   highlights  — TEXT element runs whose highlight formatting was cleared.
   */
  function deleteAnnotation_(
    ann: AnnotationRecord,
    docTab: GoogleAppsScript.Document.DocumentTab | null,
    docId: string,
    needsColorSweep: { value: boolean }
  ): { ok: boolean; namedRanges: number; bookmarks: number; highlights: number } {
    const actDoc = DocumentApp.getActiveDocument();
    let namedRangesRemoved = 0;
    let bookmarksRemoved   = 0;
    let highlightsCleared  = 0;

    if (ann.bookmarkId && docTab) {
      const key         = `${NAMED_RANGE_PREFIX}${ann.bookmarkId}`;
      const namedRanges = docTab.getNamedRanges(key);

      if (namedRanges.length > 0) {
        // ── New-style annotation: precise named-range clearing ───────────────
        const nr = namedRanges[0];
        try {
          highlightsCleared = clearNamedRangeHighlights_(nr);
          nr.remove();
          namedRangesRemoved = 1;
        } catch (e) {
          Tracer.error(
            `[CollaborationService] deleteAnnotation_: named-range clear failed ` +
            `for key "${key}" — ${e}. Aborting this annotation; it will be retried on next clear.`
          );
          return { ok: false, namedRanges: namedRangesRemoved, bookmarks: 0, highlights: highlightsCleared };
        }
      } else {
        // Named range is absent — old-style annotation or creation failure.
        // ⚠ FALLBACK path: watch for this in logs. More than the very
        // occasional occurrence indicates a bug in annotation creation.
        Tracer.warn(
          `[CollaborationService] deleteAnnotation_: no named range found for key "${key}". ` +
          `Old-style annotation or creation bug — will fall back to whole-tab color sweep. ` +
          `If this appears frequently, investigate annotateOperation_.`
        );
        needsColorSweep.value = true;
      }
    } else if (ann.bookmarkId && !docTab) {
      // docTab is null (tab unknown — orphan comment). Named-range work cannot
      // proceed without the tab, but actDoc.getBookmark() is document-scoped and
      // will find the bookmark across all tabs. We still clean it up below.
      // No color sweep scheduled — we have no tab name to sweep.
      Tracer.warn(
        `[CollaborationService] deleteAnnotation_: docTab unavailable for comment ` +
        `with bookmarkId=${ann.bookmarkId} — skipping named-range cleanup, will still remove bookmark.`
      );
    } else if (!ann.bookmarkId) {
      // No bookmark URL in comment body → very old annotation style.
      // ⚠ FALLBACK path: watch for this in logs. More than the very
      // occasional occurrence indicates a bug in annotation creation.
      Tracer.warn(
        `[CollaborationService] deleteAnnotation_: comment has no bookmark URL ` +
        `(content: "${ann.content.slice(0, 60)}"). ` +
        `Falling back to whole-tab color sweep. If frequent, indicates a creation bug.`
      );
      needsColorSweep.value = true;
    }

    // Remove the bookmark when one exists.
    // actDoc.getBookmark() is document-scoped — it works regardless of which tab
    // the annotation is on, so we attempt removal even when docTab is null.
    if (ann.bookmarkId) {
      const bookmark = actDoc.getBookmark(ann.bookmarkId);
      if (bookmark) {
        try {
          bookmark.remove();
          bookmarksRemoved = 1;
        } catch (e) {
          Tracer.error(
            `[CollaborationService] deleteAnnotation_: bookmark remove failed for ` +
            `${ann.bookmarkId} — ${e}. Aborting to preserve the comment record for retry.`
          );
          return { ok: false, namedRanges: namedRangesRemoved, bookmarks: 0, highlights: highlightsCleared };
        }
      }
    }

    // Delete the Drive comment.
    try {
      (Drive.Comments as any).remove(docId, ann.commentId);
      return { ok: true, namedRanges: namedRangesRemoved, bookmarks: bookmarksRemoved, highlights: highlightsCleared };
    } catch (e) {
      Tracer.error(
        `[CollaborationService] deleteAnnotation_: Drive comment delete failed ` +
        `for ${ann.commentId} — ${e}`
      );
      return { ok: false, namedRanges: namedRangesRemoved, bookmarks: bookmarksRemoved, highlights: highlightsCleared };
    }
  }

  // ── collect-phase helper ───────────────────────────────────────────────────

  /**
   * Extracts the tab ID for a Drive comment using a two-pass strategy.
   *
   * Pass 1 — bookmark URL embedded in the comment body (new-style annotations):
   *   annotateOperation_ appends the bookmark URL to every comment it creates,
   *   e.g. `…?tab=t.abc123#bookmark=…`.  Parsing `?tab=` from the content is
   *   fast, reliable, and works even when the Drive anchor JSON is absent.
   *
   * Pass 2 — Drive anchor JSON (old-style annotations and fallback):
   *   Drive attaches an `anchor` field to each comment as a JSON blob of the
   *   form `{"r":"head","a":[{"lt":{"tb":{"id":"t.abc123"}}}]}`.  This is the
   *   only source of tab attribution for comments written before the bookmark
   *   URL was embedded in the body.
   *
   * Returns undefined when both passes fail (e.g. document-level comment with
   * no text anchor and no bookmark URL).  Callers treat undefined as an orphan
   * and log a warning before deleting the comment.
   */
  function resolveCommentTabId_(content: string, anchor: string): string | undefined {
    const tabFromBookmark = content.match(/[?&]tab=([^#&\s]+)/);
    if (tabFromBookmark) return tabFromBookmark[1];
    try {
      const parsed = JSON.parse(anchor ?? '{}');
      return parsed?.a?.[0]?.lt?.tb?.id as string | undefined;
    } catch (_) { return undefined; }
  }

  /**
   * @param tabId          Target tab — only comments on this tab are deleted.
   * @param tabName        Tab display name — used for the fallback color sweep.
   * @param docTab         DocumentTab for this tab — used to look up named ranges.
   * @param agentPrefix    Prefix(es) to match per-tab comments against.
   */
  function clearAgentAnnotations_(
    tabId: string,
    tabName: string,
    docTab: GoogleAppsScript.Document.DocumentTab,
    agentPrefix: string | string[]
  ): void {
    const docId      = DocumentApp.getActiveDocument().getId();
    const prefixList = Array.isArray(agentPrefix) ? agentPrefix : [agentPrefix];
    Tracer.info(
      `[CollaborationService] clearAgentAnnotations_: clearing tab ${tabId} ` +
      `prefixes=${JSON.stringify(prefixList)}`
    );

    // ── Collect phase ─────────────────────────────────────────────────────
    // Fetch all comments first to avoid pagination-shift bugs from in-loop deletion.
    let pageToken: string | undefined;
    let skippedWrongTab = 0;
    const skippedExamples: string[] = [];
    const annotations: AnnotationRecord[] = [];

    do {
      const resp = (Drive.Comments as any).list(docId, {
        maxResults: 100,
        pageToken,
        includeDeleted: false,
        fields: 'nextPageToken,comments',
      }) as any;

      for (const comment of resp.comments ?? []) {
        const content = comment.content ?? '';

        if (!matchesAgentPrefix_(content, prefixList)) {
          if (content.slice(0, 25).includes(']')) {
            Tracer.warn(
              `[CollaborationService] clearAgentAnnotations_: ` +
              `skipped near-match comment "${content.slice(0, 120)}" ` +
              `(no prefix matched from ${JSON.stringify(prefixList)})`
            );
          }
          continue;
        }

        const commentTabId = resolveCommentTabId_(content, comment.anchor ?? '');

        if (commentTabId !== undefined && commentTabId !== tabId) {
          skippedWrongTab++;
          if (skippedExamples.length < 5) {
            skippedExamples.push(`[tab=${commentTabId}] ${content.slice(0, 60)}`);
          }
          continue;
        }

        if (commentTabId === undefined) {
          Tracer.warn(
            `[CollaborationService] clearAgentAnnotations_: ` +
            `could not determine tab for comment "${content.slice(0, 80)}…" — deleting as orphan`
          );
        }

        const bm = content.match(/#bookmark=([\w.-]+)/);
        annotations.push({
          commentId:    comment.id,
          content,
          bookmarkId:   bm?.[1] ?? null,
          commentTabId,
        });
      }
      pageToken = resp.nextPageToken;
    } while (pageToken);

    if (skippedWrongTab > 0) {
      Tracer.info(
        `[CollaborationService] clearAgentAnnotations_: skipped ${skippedWrongTab} comment(s) ` +
        `on other tabs — examples: ${JSON.stringify(skippedExamples)}`
      );
    }
    Tracer.info(
      `[CollaborationService] clearAgentAnnotations_: found ${annotations.length} annotation(s) to delete on tab ${tabId}`
    );

    // ── Mutate phase ──────────────────────────────────────────────────────
    // Per-annotation: clear named range highlights → remove named range →
    // remove bookmark → delete Drive comment.  Falls back to color sweep for
    // old-style annotations that predate named ranges.
    const needsColorSweep = { value: false };
    let deleted     = 0;
    let namedRanges = 0;
    let bookmarks   = 0;
    let highlights  = 0;
    for (const ann of annotations) {
      const r = deleteAnnotation_(ann, docTab, docId, needsColorSweep);
      if (r.ok) deleted++;
      namedRanges += r.namedRanges;
      bookmarks   += r.bookmarks;
      highlights  += r.highlights;
    }

    const failed = annotations.length - deleted;
    Tracer.info(
      `[CollaborationService] clearAgentAnnotations_ summary — ` +
      `collected: ${annotations.length}, ` +
      `comments deleted: ${deleted}, ` +
      `named ranges removed: ${namedRanges}, ` +
      `bookmarks removed: ${bookmarks}, ` +
      `highlight runs cleared: ${highlights}` +
      (failed > 0
        ? ` ⚠ ${failed} annotation(s) failed — will be retried on next clear`
        : '')
    );

    if (needsColorSweep.value) {
      Tracer.warn(
        `[CollaborationService] clearAgentAnnotations_: invoking color-sweep fallback for tab "${tabName}". ` +
        `⚠ WATCH FOR THIS IN LOGS — frequent occurrences indicate a bug in annotation creation.`
      );
      clearTabHighlights_(tabName);
    }
  }

  /**
   * Bulk variant: fetches Drive comments ONCE for the whole document, then
   * partitions and deletes across all requested tabIds in a single pass.
   * Use this instead of calling clearAgentAnnotations_ in a per-tab loop —
   * it reduces Drive.Comments.list() calls from O(tabs) to O(1).
   *
   * @param tabIds  Tabs to restrict deletion to.  Pass null to delete matching
   *                comments from ALL tabs — the correct mode for "Clear All
   *                Annotations" because comments may exist on deleted/renamed
   *                tabs whose IDs are no longer in the tab registry.
   */
  function clearAgentAnnotationsBulk_(
    tabIds: string[] | null,
    agentPrefix: string | string[]
  ): void {
    if (tabIds !== null && tabIds.length === 0) return;

    const docId      = DocumentApp.getActiveDocument().getId();
    const tabIdSet   = tabIds ? new Set(tabIds) : null;
    const prefixList = Array.isArray(agentPrefix) ? agentPrefix : [agentPrefix];

    Tracer.info(
      `[CollaborationService] clearAgentAnnotationsBulk_: ` +
      (tabIdSet
        ? `single Drive pass across ${tabIds!.length} tab(s) `
        : `document-wide Drive pass (all tabs) `) +
      `prefixes=${JSON.stringify(prefixList)}`
    );

    // Build tabId → { docTab, title } map once for all annotation lookups.
    const tabMap = buildTabMap_();

    // ── Collect phase ─────────────────────────────────────────────────────
    let pageToken: string | undefined;
    const annotations: AnnotationRecord[] = [];

    do {
      const resp = (Drive.Comments as any).list(docId, {
        maxResults: 100,
        pageToken,
        includeDeleted: false,
        fields: 'nextPageToken,comments',
      }) as any;

      for (const comment of resp.comments ?? []) {
        const content = comment.content ?? '';

        if (!matchesAgentPrefix_(content, agentPrefix)) {
          if (content.slice(0, 25).includes(']')) {
            Tracer.warn(
              `[CollaborationService] clearAgentAnnotationsBulk_: ` +
              `skipped near-match comment "${content.slice(0, 120)}" ` +
              `(no prefix matched from ${JSON.stringify(prefixList)})`
            );
          }
          continue;
        }

        const commentTabId = resolveCommentTabId_(content, comment.anchor ?? '');

        if (tabIdSet !== null && commentTabId !== undefined && !tabIdSet.has(commentTabId)) {
          continue;
        }

        if (commentTabId === undefined) {
          Tracer.warn(
            `[CollaborationService] clearAgentAnnotationsBulk_: ` +
            `could not determine tab for comment "${content.slice(0, 80)}…" — deleting as orphan`
          );
        }

        const bm = content.match(/#bookmark=([\w.-]+)/);
        annotations.push({
          commentId:    comment.id,
          content,
          bookmarkId:   bm?.[1] ?? null,
          commentTabId,
        });
      }
      pageToken = resp.nextPageToken;
    } while (pageToken);

    Tracer.info(
      `[CollaborationService] clearAgentAnnotationsBulk_: found ${annotations.length} annotation(s) to delete`
    );

    // ── Mutate phase ──────────────────────────────────────────────────────
    // Track which tabs need the color-sweep fallback (old-style annotations).
    const tabsNeedingColorSweep = new Map<string, string>(); // tabId → tabTitle
    let deleted     = 0;
    let namedRanges = 0;
    let bookmarks   = 0;
    let highlights  = 0;

    for (const ann of annotations) {
      const tabEntry = ann.commentTabId ? tabMap.get(ann.commentTabId) : undefined;
      const docTab   = tabEntry?.docTab ?? null;
      const needsColorSweep = { value: false };

      const r = deleteAnnotation_(ann, docTab, docId, needsColorSweep);
      if (r.ok) deleted++;
      namedRanges += r.namedRanges;
      bookmarks   += r.bookmarks;
      highlights  += r.highlights;

      if (needsColorSweep.value && ann.commentTabId && tabEntry) {
        tabsNeedingColorSweep.set(ann.commentTabId, tabEntry.title);
      }
    }

    const failed = annotations.length - deleted;
    Tracer.info(
      `[CollaborationService] clearAgentAnnotationsBulk_ summary — ` +
      `collected: ${annotations.length}, ` +
      `comments deleted: ${deleted}, ` +
      `named ranges removed: ${namedRanges}, ` +
      `bookmarks removed: ${bookmarks}, ` +
      `highlight runs cleared: ${highlights}` +
      (failed > 0
        ? ` ⚠ ${failed} annotation(s) failed — will be retried on next clear`
        : '')
    );

    // Fallback color sweep — one call per affected tab.
    if (tabsNeedingColorSweep.size > 0) {
      Tracer.warn(
        `[CollaborationService] clearAgentAnnotationsBulk_: invoking color-sweep fallback ` +
        `for ${tabsNeedingColorSweep.size} tab(s) with old-style annotations: ` +
        `${JSON.stringify([...tabsNeedingColorSweep.values()])}. ` +
        `⚠ WATCH FOR THIS IN LOGS — frequent occurrences indicate a bug in annotation creation.`
      );
      for (const [, title] of tabsNeedingColorSweep) {
        clearTabHighlights_(title);
      }
    }
  }

  // --- Clear highlight formatting (fallback) --------------------------------

  /**
   * Scans every text run in the given tab and clears any run whose background
   * color matches HIGHLIGHT_COLOR (or the user-overridden value).
   *
   * ⚠ FALLBACK METHOD — this is only invoked when an annotation has no named
   * range (i.e. it was created before the named-range approach was introduced,
   * or annotation creation failed to record a named range). New annotations
   * store an exact named range and are cleared precisely without this sweep.
   *
   * WATCH FOR THIS IN LOGS. If clearTabHighlights_ appears more than
   * occasionally it means old-style annotations still exist in the document
   * or there is a bug in annotateOperation_ that is failing to create named
   * ranges. Investigate annotateOperation_ step 1 if you see it frequently.
   *
   * Returns true if the tab was found and swept, false if the tab was not found.
   *
   * NOTE: Bold is always cleared on highlighted ranges. Pre-annotation bold
   * formatting is lost — an accepted limitation since we do not snapshot
   * formatting state before annotation.
   */
  function clearTabHighlights_(tabName: string): boolean {
    const docTab = DocOps.getTabByName(tabName);
    if (!docTab) {
      Tracer.warn(`[CollaborationService] clearTabHighlights_: tab "${tabName}" not found — skipping`);
      return false;
    }
    const body  = docTab.getBody();
    const color = PropertiesService.getUserProperties().getProperty('HIGHLIGHT_COLOR') || Constants.HIGHLIGHT_COLOR;
    let cleared = 0;

    const numChildren = body.getNumChildren();
    for (let p = 0; p < numChildren; p++) {
      const para = body.getChild(p);
      if (para.getType() !== DocumentApp.ElementType.PARAGRAPH &&
          para.getType() !== DocumentApp.ElementType.LIST_ITEM) continue;

      const numTextChildren = (para as any).getNumChildren();
      for (let c = 0; c < numTextChildren; c++) {
        const child = (para as any).getChild(c);
        if (child.getType() !== DocumentApp.ElementType.TEXT) continue;

        const text = child.asText();
        const len  = text.getText().length;
        if (len === 0) continue;

        // getTextAttributeIndices() returns offsets where any attribute changes —
        // one call gives all run boundaries, collapsing O(chars) to O(runs).
        const indices: number[] = (text as any).getTextAttributeIndices();
        for (let k = 0; k < indices.length; k++) {
          const runStart = indices[k];
          const runEnd   = k + 1 < indices.length ? indices[k + 1] - 1 : len - 1;
          if (text.getBackgroundColor(runStart) === color) {
            text.setBackgroundColor(runStart, runEnd, null);
            text.setBold(runStart, runEnd, false);
            cleared++;
          }
        }
      }
    }

    Tracer.info(
      `[CollaborationService] clearTabHighlights_: cleared ${cleared} highlighted range(s) on tab "${tabName}"`
    );
    return true;
  }

  /**
   * Final cleanup pass after annotation + directive clears: removes every
   * named range and bookmark on the tab. Handles stale artefacts from format
   * changes (e.g. undecodable directive names, renamed prefixes) that earlier
   * passes skip. For each named range, highlight formatting is cleared first
   * (same as deleteAnnotation_), then the range is removed.
   */
  function removeOrphanedEntitiesOnTab_(tabName: string): void {
    if (!DocOps.isManagedTab(tabName)) {
      return;
    }
    const docTab = DocOps.getTabByName(tabName);
    if (!docTab) {
      Tracer.warn(
        `[CollaborationService] removeOrphanedEntitiesOnTab_: tab "${tabName}" not found — skipping`
      );
      return;
    }

    const namedRangesSnapshot = docTab.getNamedRanges().slice();
    let namedRangesRemoved = 0;
    let highlightRunsCleared = 0;
    for (const nr of namedRangesSnapshot) {
      try {
        highlightRunsCleared += clearNamedRangeHighlights_(nr);
        nr.remove();
        namedRangesRemoved++;
      } catch (e) {
        Tracer.warn(
          `[CollaborationService] removeOrphanedEntitiesOnTab_: failed to remove named range ` +
            `"${nr.getName()}" — ${e}`
        );
      }
    }

    const bookmarksSnapshot = docTab.getBookmarks().slice();
    let bookmarksRemoved = 0;
    for (const bm of bookmarksSnapshot) {
      try {
        bm.remove();
        bookmarksRemoved++;
      } catch (e) {
        Tracer.warn(
          `[CollaborationService] removeOrphanedEntitiesOnTab_: failed to remove bookmark ` +
            `"${bm.getId()}" — ${e}`
        );
      }
    }

    Tracer.info(
      `[CollaborationService] removeOrphanedEntitiesOnTab_: tab "${tabName}" — ` +
        `named ranges removed: ${namedRangesRemoved}, ` +
        `named-range highlight runs cleared: ${highlightRunsCleared}, ` +
        `bookmarks removed: ${bookmarksRemoved}`
    );
  }

  // --- Per-operation annotation ---

  /**
   * Writes a single annotation for one Operation: creates a bookmark + named
   * range, posts the Drive comment, then applies the highlight.  All three
   * steps are strictly ordered and earlier steps are rolled back on failure so
   * no orphaned artefacts are left behind.
   *
   * NOTE: DocumentTab (returned by Tab.asDocumentTab()) does NOT have getId().
   * Only the parent Tab object does — tabId must be resolved by the caller via
   * DocOps.getTabIdByName() and passed in explicitly.
   *
   * Step 1 — Bookmark + named range (DocumentApp)
   *   The named range key `annotation_<bookmarkId>` records the exact text span
   *   so the deletion path can clear only that range instead of sweeping the
   *   whole tab by color.  If bookmark creation succeeds but addNamedRange
   *   fails, the orphan bookmark is removed and we abort — no comment or
   *   highlight is written.
   *
   * Step 2 — Drive comment (Drive API, most failure-prone step)
   *   Created with the bookmark URL embedded in the body so the deletion path
   *   can recover the bookmarkId from the comment content alone (pass 1 of
   *   resolveCommentTabId_).  On failure the already-created bookmark and named
   *   range are rolled back and we abort.
   *
   * Step 3 — Highlight (DocumentApp)
   *   Applied last so a highlight failure never orphans a bookmark or comment.
   *   On failure we log and continue — the comment + bookmark remain and the
   *   annotation is functionally complete (just missing the visual cue).
   */
  function annotateOperation_(
    docTab: GoogleAppsScript.Document.DocumentTab,
    body: GoogleAppsScript.Document.Body,
    op: Operation,
    tabId: string,
    agentPrefix: string,
    docId: string,
    highlightColor: string
  ): void {
    const rangeEl = findTextOrFallback_(body, op.match_text);
    if (!rangeEl) {
      Tracer.warn(`CollaborationService: no text found in tab for op: "${op.match_text}"`);
      return;
    }

    // ── Step 1: bookmark + named range ──────────────────────────────────────
    let bookmarkObj: GoogleAppsScript.Document.Bookmark | null = null;
    let namedRange:  GoogleAppsScript.Document.NamedRange | null = null;
    try {
      const pos = docTab.newPosition(rangeEl.getElement(), rangeEl.getStartOffset());
      bookmarkObj = docTab.addBookmark(pos);

      // Build a Range spanning the matched text so we can store and later
      // retrieve the exact characters that were highlighted.
      const textEl = rangeEl.getElement().asText();
      const range  = docTab.newRange()
        .addElement(textEl, rangeEl.getStartOffset(), rangeEl.getEndOffsetInclusive())
        .build();
      namedRange = docTab.addNamedRange(
        `${NAMED_RANGE_PREFIX}${bookmarkObj.getId()}`, range
      );
    } catch (e) {
      Tracer.error(
        `CollaborationService: step 1 (bookmark/namedRange) failed for "${op.match_text}" — ${e}. ` +
        `Aborting annotation.`
      );
      try { if (bookmarkObj) bookmarkObj.remove(); } catch (_) { /* best effort */ }
      return;
    }

    const bookmarkUrl =
      `https://docs.google.com/document/d/${docId}/edit?tab=${tabId}` +
      `#bookmark=${bookmarkObj.getId()}`;

    // ── Step 2: Drive comment ────────────────────────────────────────────────
    const commentId = addTabComment_(
      tabId, op.reason, op.match_text, agentPrefix, bookmarkUrl, docId
    );
    if (!commentId) {
      // addTabComment_ already logged the Drive error. Roll back document state.
      try { namedRange.remove();   } catch (_) { /* best effort */ }
      try { bookmarkObj.remove();  } catch (_) { /* best effort */ }
      return;
    }

    // ── Step 3: highlight ────────────────────────────────────────────────────
    // Runs last — a failure here does NOT orphan anything. The comment body
    // contains the bookmark URL, and the named range records the text span, so
    // the deletion path can still clean up completely even without a highlight.
    try {
      highlightNamedRange_(namedRange, highlightColor);
    } catch (e) {
      Tracer.error(
        `CollaborationService: step 3 (highlight) failed for "${op.match_text}" — ${e}. ` +
        `Comment and bookmark are intact; highlight will be missing.`
      );
    }
  }

  // --- Workflow handlers ---

  function processInstructionUpdate_(update: RootUpdate): void {
    if (!update.review_tab) {
      throw new Error('instruction_update requires review_tab');
    }

    if (!update.proposed_full_text || !update.proposed_full_text.trim()) {
      Tracer.info(`[CollaborationService] processInstructionUpdate_: proposed_full_text is empty, skipping update for ${update.review_tab}`);
      return;
    }

    Tracer.info(
      `[CollaborationService] processInstructionUpdate_: review_tab="${update.review_tab}" ` +
      `proposed_full_text length=${update.proposed_full_text.length}`
    );

    // 1. Back up the existing content to the scratch tab
    const oldText = MarkdownService.tabToMarkdown(update.review_tab);
    if (oldText.trim()) {
      const scratchTabName = `${update.review_tab} Scratch`;
      Tracer.info(`[CollaborationService] processInstructionUpdate_: backing up old content to "${scratchTabName}" (${oldText.length} chars)`);
      MarkdownService.markdownToTab(oldText, scratchTabName, Constants.TAB_NAMES.AGENTIC_SCRATCH);
    }

    // 2. Overwrite the main tab with the new proposed text
    Tracer.info(`[CollaborationService] processInstructionUpdate_: writing new content to "${update.review_tab}"`);
    MarkdownService.markdownToTab(update.proposed_full_text, update.review_tab, Constants.TAB_NAMES.AGENTIC_INSTRUCTIONS);
  }

  function processTabGeneration_(update: RootUpdate, parentTab: string): void {
    const tabs = update.generated_tabs ?? [];
    for (const generated of tabs) {
      if (!generated.tab_name) continue;
      MarkdownService.markdownToTab(generated.markdown || '', generated.tab_name, parentTab);
    }
  }

  function processContentAnnotation_(update: RootUpdate): void {
    const targetDocTab = DocOps.getTabByName(update.target_tab!);
    if (!targetDocTab) {
      throw new Error(`content_annotation: target tab "${update.target_tab}" not found`);
    }
    // DocumentTab has no getId(); look up the ID via the parent Tab.
    const targetTabId = DocOps.getTabIdByName(update.target_tab!);
    if (!targetTabId) throw new Error(`content_annotation: tab ID not found for "${update.target_tab}"`);

    // Hoist once — avoids a DocumentApp + PropertiesService round-trip per operation.
    const docId = DocumentApp.getActiveDocument().getId();
    const highlightColor = PropertiesService.getUserProperties().getProperty('HIGHLIGHT_COLOR') || Constants.HIGHLIGHT_COLOR;

    const agentPrefix = update.agent_name || '[Agent]';
    clearAgentAnnotations_(
      targetTabId, update.target_tab!, targetDocTab,
      agentPrefix
    );
    // clearTabHighlights_ is invoked automatically inside clearAgentAnnotations_
    // as a fallback when old-style annotations without named ranges are detected.

    const body = targetDocTab.getBody();

    // Reverse so the first operation's comment appears at the top of the comments panel
    // (Drive shows the last-added comment first)
    const ops = [...(update.operations ?? [])].reverse();
    const commentSummary: string[] = [];
    for (const op of ops) {
      annotateOperation_(targetDocTab, body, op, targetTabId, agentPrefix, docId, highlightColor);
      commentSummary.push(`"${op.match_text}" → ${op.reason}`);
    }
    Tracer.info(
      `[CollaborationService] processContentAnnotation_: ` +
      `added ${commentSummary.length} annotation(s) on tab "${update.target_tab}": ` +
      JSON.stringify(commentSummary)
    );
  }

  function createBookmarkDirectives_(update: RootUpdate): void {
    const targetDocTab = DocOps.getTabByName(update.target_tab!);
    if (!targetDocTab) {
      throw new Error(`bookmark_directives: target tab "${update.target_tab}" not found`);
    }

    const agentPrefix = update.agent_name;
    if (!agentPrefix) {
      throw new Error('bookmark_directives: agent_name is required for directive encoding');
    }

    const ops: DirectiveCreate[] = update.directives ?? [];
    const body = targetDocTab.getBody();
    let count = 0;
    for (const op of ops) {
      const rangeEl = findTextOrFallback_(body, op.match_text);
      if (!rangeEl) {
        Tracer.warn(`[CollaborationService] createBookmarkDirectives_: match_text "${op.match_text}" not found in tab "${update.target_tab}"`);
        continue;
      }

      try {
        const range = targetDocTab.newRange()
          .addElement(rangeEl.getElement().asText(), rangeEl.getStartOffset(), rangeEl.getEndOffsetInclusive())
          .build();
        DirectivePersistence.createDirectiveAtRange(
          targetDocTab,
          agentPrefix,
          op.type,
          op.payload,
          range
        );
      } catch (e) {
        Tracer.error(
          `[CollaborationService] createBookmarkDirectives_: failed to create directive for "${op.match_text}" — ${e}`
        );
        continue;
      }
      count++;
    }

    Tracer.info(`[CollaborationService] createBookmarkDirectives_: added ${count} directive(s) on tab "${update.target_tab}"`);
  }

  // --- Public entry point ---

  /**
   * Routes a RootUpdate payload to the correct workflow handler.
   *
   * @param opts.tabGenerationParent  Required for tab_generation: the parent tab that
   *   generated tabs are written under. This is agent-owned context (not from Gemini)
   *   and therefore lives outside RootUpdate.
   */
  function processUpdate(update: RootUpdate, opts?: { tabGenerationParent?: string }): void {
    if (update.workflow_type === 'instruction_update') {
      processInstructionUpdate_(update);
    } else if (update.workflow_type === 'tab_generation') {
      processTabGeneration_(update, opts?.tabGenerationParent ?? Constants.TAB_NAMES.PUBLISHER_ROOT);
    } else if (update.workflow_type === 'bookmark_directives') {
      createBookmarkDirectives_(update);
    } else {
      processContentAnnotation_(update);
    }
  }

  return {
    processUpdate,
    clearAgentAnnotations:     clearAgentAnnotations_,
    clearAgentAnnotationsBulk: clearAgentAnnotationsBulk_,
    // clearTabHighlights is kept public for explicit safety-net sweeps in
    // clearAllAnnotations (Code.ts). It is also called internally as a fallback
    // for old-style annotations. Returns true if the tab was found, false otherwise.
    clearTabHighlights: clearTabHighlights_,
    /** After clearing annotations and directives on a tab — strips any remaining named ranges and bookmarks. */
    removeOrphanedEntitiesOnTab: removeOrphanedEntitiesOnTab_,
  };
})();
