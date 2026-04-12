// ============================================================
// CollaborationService.ts — Matching, highlighting, and
// commenting engine for the Collaborative Tab Update System.
// ============================================================

const CollaborationService = (() => {

  // --- Matching logic ---

  /**
   * Tries to find matchText in the body.
   * Falls back to the very first non-whitespace word if not found.
   */
  function findTextOrFallback_(
    body: GoogleAppsScript.Document.Body,
    matchText: string
  ): GoogleAppsScript.Document.RangeElement | null {
    const exact = body.findText(matchText);
    if (exact) return exact;

    Logger.log(
      `CollaborationService: match_text "${matchText}" not found — falling back to first word.`
    );
    return body.findText('\\S+');
  }

  // --- Highlighting ---

  function highlightRangeElement_(
    rangeEl: GoogleAppsScript.Document.RangeElement
  ): void {
    const el = rangeEl.getElement();
    if (el.getType() !== DocumentApp.ElementType.TEXT) return;

    const textEl = el.asText();
    const start = rangeEl.getStartOffset();
    const end = rangeEl.getEndOffsetInclusive();
    textEl.setBackgroundColor(start, end, HIGHLIGHT_COLOR);
    textEl.setBold(start, end, true);
  }

  // --- Comment via Drive API ---

  /**
   * Adds a Drive comment anchored to the given tab.
   * Every agent comment is prefixed with AGENT_COMMENT_PREFIX so it can be
   * distinguished from user comments when clearing annotations.
   */
  function addTabComment_(
    tabId: string,
    commentBody: string
  ): void {
    const docId = DocumentApp.getActiveDocument().getId();
    try {
      Drive.Comments.create(
        {
          content: AGENT_COMMENT_PREFIX + commentBody,
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
        } as any,
        docId,
        { fields: 'id' } as any
      );
    } catch (e) {
      Logger.log(`CollaborationService: Drive comment failed — ${e}`);
    }
  }

  // --- Clear agent annotations ---

  /**
   * Deletes all Drive comments on the given tab that start with AGENT_COMMENT_PREFIX.
   * Preserves user-added comments.
   */
  function clearAgentAnnotations_(tabId: string): void {
    const docId = DocumentApp.getActiveDocument().getId();
    Logger.log(`[CollaborationService] clearAgentAnnotations_: clearing agent comments on tab ${tabId}`);
    let pageToken: string | undefined;
    let deleted = 0;
    do {
      // Drive Advanced Service is configured as v3 (appsscript.json).
      // In v3 the list response uses `comments` (not v2's `items`), and the
      // `fields` parameter is required. The parenthesis sub-selection notation
      // `comments(id,content,anchor)` is rejected, so we request the bare
      // `comments` token to get all comment fields.
      const resp = (Drive.Comments as any).list(docId, {
        maxResults: 100,
        pageToken: pageToken,
        includeDeleted: false,
        fields: 'nextPageToken,comments',
      }) as any;
      for (const comment of resp.comments ?? []) {
        try {
          const anchor = JSON.parse(comment.anchor ?? '{}');
          const anchorTabId = anchor?.a?.[0]?.lt?.tb?.id;
          if (anchorTabId !== tabId) continue;
        } catch (_) {
          continue;
        }
        if (!(comment.content ?? '').startsWith(AGENT_COMMENT_PREFIX)) continue;
        try {
          (Drive.Comments as any).remove(docId, comment.id);
          deleted++;
        } catch (e) {
          Logger.log(`[CollaborationService] clearAgentAnnotations_: failed to delete ${comment.id} — ${e}`);
        }
      }
      pageToken = resp.nextPageToken;
    } while (pageToken);
    Logger.log(`[CollaborationService] clearAgentAnnotations_: deleted ${deleted} comment(s)`);
  }

  // --- Per-operation annotation ---

  // DocumentTab (returned by Tab.asDocumentTab()) does NOT have getId().
  // Only the parent Tab object does. tabId must be resolved by the caller
  // via DocOps.getTabIdByName() and passed in explicitly.
  function annotateOperation_(
    docTab: GoogleAppsScript.Document.DocumentTab,
    op: Operation,
    tabId: string
  ): void {
    const body = docTab.getBody();
    const rangeEl = findTextOrFallback_(body, op.match_text);
    if (!rangeEl) {
      Logger.log(`CollaborationService: no text found in tab for op: ${op.match_text}`);
      return;
    }

    highlightRangeElement_(rangeEl);
    addTabComment_(tabId, op.reason);
  }

  // --- Workflow handlers ---

  function processInstructionUpdate_(update: RootUpdate): void {
    if (!update.review_tab) {
      throw new Error('instruction_update requires review_tab');
    }

    const scratchTabName = `${update.review_tab} Scratch`;

    // 1. Ensure the Scratch review tab exists and get a stable reference.
    const reviewDocTab = DocOps.createScratchTab(update.review_tab);

    // 2. Write proposed text as structured markdown.
    MarkdownService.markdownToTab(update.proposed_full_text || '', scratchTabName);

    // 3. Resolve the scratch tab's ID via the parent Tab object (DocumentTab has no getId).
    const scratchTabId = DocOps.getTabIdByName(scratchTabName);
    if (!scratchTabId) throw new Error(`processInstructionUpdate_: scratch tab "${scratchTabName}" not found after creation`);

    for (const op of update.operations) {
      annotateOperation_(reviewDocTab, op, scratchTabId);
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

    clearAgentAnnotations_(targetTabId);
    for (const op of update.operations) {
      annotateOperation_(targetDocTab, op, targetTabId);
    }
  }

  // --- Public entry point ---

  /**
   * Routes a RootUpdate payload to the correct workflow handler.
   */
  function processUpdate(update: RootUpdate): void {
    if (update.workflow_type === 'instruction_update') {
      processInstructionUpdate_(update);
    } else {
      processContentAnnotation_(update);
    }
  }

  return { processUpdate };
})();
