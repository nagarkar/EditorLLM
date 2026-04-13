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
    // Escape special regex characters in the LLM's matchText before passing to findText
    const escapedMatch = matchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exact = body.findText(escapedMatch);
    if (exact) return exact;

    Tracer.warn(
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
    const color = PropertiesService.getUserProperties().getProperty('HIGHLIGHT_COLOR') || HIGHLIGHT_COLOR;
    textEl.setBackgroundColor(start, end, color);
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
    commentBody: string,
    matchText: string,
    agentPrefix: string,
    bookmarkUrl: string
  ): void {
    const docId = DocumentApp.getActiveDocument().getId();

    const finalContent = bookmarkUrl
      ? `${agentPrefix} "${matchText}": ${commentBody}: ${bookmarkUrl}`
      : `${agentPrefix} "${matchText}": ${commentBody}`;

    try {
      Drive.Comments.create(
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
        } as any,
        docId,
        { fields: 'id' } as any
      );
    } catch (e) {
      Tracer.error(`CollaborationService: Drive comment failed — ${e}`);
    }
  }

  // --- Clear agent annotations ---

  function clearAgentAnnotations_(tabId: string, agentPrefix: string | string[]): void {
    const docId = DocumentApp.getActiveDocument().getId();
    Tracer.info(`[CollaborationService] clearAgentAnnotations_: clearing agent comments on tab ${tabId}`);
    let pageToken: string | undefined;
    let deleted = 0;

    // In order to avoid pagination shift bugs caused by deleting items from
    // the collection synchronously from within a batched paginator, we separate
    // fetching into a pre-loop.
    const commentsToDelete: string[] = [];
    const commentsContent: string[] = [];
    const bookmarksToRemove: string[] = [];

    do {
      // Drive Advanced Service is configured as v3 (appsscript.json).
      const resp = (Drive.Comments as any).list(docId, {
        maxResults: 100,
        pageToken: pageToken,
        includeDeleted: false,
        fields: 'nextPageToken,comments',
      }) as any;

      for (const comment of resp.comments ?? []) {
        const content = comment.content ?? '';

        // Only consider comments written by this agent.
        const matchPrefix = Array.isArray(agentPrefix)
          ? agentPrefix.some(p => content.startsWith(p))
          : content.startsWith(agentPrefix);

        if (!matchPrefix) continue;

        // Determine which tab this comment belongs to.
        const tabFromBookmark = content.match(/[?&]tab=([^#&\s]+)/);
        if (tabFromBookmark) {
          if (tabFromBookmark[1] !== tabId) continue;
        } else {
          // TODO: Remove this. If we are not setting the anchor in this application when 
          // adding comments, we don't expect to see anything here.
          try {
            const anchor = JSON.parse(comment.anchor ?? '{}');
            const anchorTabId = anchor?.a?.[0]?.lt?.tb?.id;
            if (anchorTabId !== tabId) continue;
          } catch (_) {
            continue;
          }
        }

        commentsToDelete.push(comment.id);
        commentsContent.push(content);
        const match = content.match(/#bookmark=([\w.-]+)/);
        if (match && match[1]) {
          bookmarksToRemove.push(match[1]);
        }
      }
      pageToken = resp.nextPageToken;
    } while (pageToken);

    // Log all comments targeted for deletion in one shot
    Tracer.info(
      `[CollaborationService] clearAgentAnnotations_: ` +
      `found ${commentsToDelete.length} comment(s) to delete on tab ${tabId}: ` +
      JSON.stringify(commentsToDelete.map((id, i) => ({ id, content: commentsContent[i] })))
    );

    // Apply the mutations securely mapped to our extracted queue
    const actDoc = DocumentApp.getActiveDocument();
    for (const bId of bookmarksToRemove) {
      try {
        const bookmark = actDoc.getBookmark(bId);
        if (bookmark) bookmark.remove();
      } catch (e) {
        Tracer.warn(`[CollaborationService] clearAgentAnnotations_: failed to clear bookmark - ${e}`);
      }
    }

    for (const cId of commentsToDelete) {
      try {
        (Drive.Comments as any).remove(docId, cId);
        deleted++;
      } catch (e) {
        Tracer.error(`[CollaborationService] clearAgentAnnotations_: failed to delete ${cId} — ${e}`);
      }
    }

    Tracer.info(`[CollaborationService] clearAgentAnnotations_: deleted ${deleted} comment(s)`);
  }

  // --- Clear highlight formatting ---

  /**
   * Removes agent-applied highlight formatting (background color + bold) from
   * every text run in the given tab that matches the configured HIGHLIGHT_COLOR.
   *
   * NOTE: Bold is always cleared on highlighted ranges. If the original text was
   * bold before annotation, the bold will be lost. This is an accepted
   * limitation since we don't track pre-annotation formatting state.
   */
  function clearTabHighlights_(tabName: string): void {
    const docTab = DocOps.getTabByName(tabName);
    if (!docTab) {
      Tracer.warn(`[CollaborationService] clearTabHighlights_: tab "${tabName}" not found — skipping`);
      return;
    }
    const body = docTab.getBody();
    const color = PropertiesService.getUserProperties().getProperty('HIGHLIGHT_COLOR') || HIGHLIGHT_COLOR;
    let cleared = 0;

    const numChildren = body.getNumChildren();
    for (let p = 0; p < numChildren; p++) {
      const para = body.getChild(p);
      // Only Paragraph and ListItem have child Text elements
      if (para.getType() !== DocumentApp.ElementType.PARAGRAPH &&
          para.getType() !== DocumentApp.ElementType.LIST_ITEM) continue;

      const numTextChildren = (para as any).getNumChildren();
      for (let c = 0; c < numTextChildren; c++) {
        const child = (para as any).getChild(c);
        if (child.getType() !== DocumentApp.ElementType.TEXT) continue;

        const text = child.asText();
        const len = text.getText().length;
        let i = 0;
        while (i < len) {
          if (text.getBackgroundColor(i) === color) {
            // Find the contiguous run with this highlight color
            let end = i;
            while (end + 1 < len && text.getBackgroundColor(end + 1) === color) end++;
            text.setBackgroundColor(i, end, null);
            text.setBold(i, end, false);
            cleared++;
            i = end + 1;
          } else {
            i++;
          }
        }
      }
    }

    Tracer.info(`[CollaborationService] clearTabHighlights_: cleared ${cleared} highlighted range(s) on tab "${tabName}"`);
  }

  // --- Per-operation annotation ---

  // DocumentTab (returned by Tab.asDocumentTab()) does NOT have getId().
  // Only the parent Tab object does. tabId must be resolved by the caller
  // via DocOps.getTabIdByName() and passed in explicitly.
  function annotateOperation_(
    docTab: GoogleAppsScript.Document.DocumentTab,
    op: Operation,
    tabId: string,
    agentPrefix: string
  ): void {
    const body = docTab.getBody();
    const rangeEl = findTextOrFallback_(body, op.match_text);
    if (!rangeEl) {
      Tracer.warn(`CollaborationService: no text found in tab for op: ${op.match_text}`);
      return;
    }

    let bookmarkUrl = '';
    try {
      const pos = docTab.newPosition(rangeEl.getElement(), rangeEl.getStartOffset());
      const bookmark = docTab.addBookmark(pos);
      const docId = DocumentApp.getActiveDocument().getId();
      bookmarkUrl = `https://docs.google.com/document/d/${docId}/edit?tab=${tabId}#bookmark=${bookmark.getId()}`;
    } catch (e) {
      Tracer.warn(`CollaborationService: failed to add bookmark - ${e}`);
    }

    highlightRangeElement_(rangeEl);

    addTabComment_(tabId, op.reason, op.match_text, agentPrefix, bookmarkUrl);
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
      MarkdownService.markdownToTab(oldText, scratchTabName, TAB_NAMES.AGENTIC_SCRATCH);
    }

    // 2. Overwrite the main tab with the new proposed text
    Tracer.info(`[CollaborationService] processInstructionUpdate_: writing new content to "${update.review_tab}"`);
    MarkdownService.markdownToTab(update.proposed_full_text, update.review_tab, TAB_NAMES.AGENTIC_INSTRUCTIONS);
  }

  function processContentAnnotation_(update: RootUpdate): void {
    const targetDocTab = DocOps.getTabByName(update.target_tab!);
    if (!targetDocTab) {
      throw new Error(`content_annotation: target tab "${update.target_tab}" not found`);
    }
    // DocumentTab has no getId(); look up the ID via the parent Tab.
    const targetTabId = DocOps.getTabIdByName(update.target_tab!);
    if (!targetTabId) throw new Error(`content_annotation: tab ID not found for "${update.target_tab}"`);

    const agentPrefix = update.agent_name || '[Agent]';
    clearAgentAnnotations_(targetTabId, agentPrefix);
    clearTabHighlights_(update.target_tab!);

    // Reverse so the first operation's comment appears at the top of the comments panel
    // (Drive shows the last-added comment first)
    const ops = [...(update.operations ?? [])].reverse();
    const commentSummary: string[] = [];
    for (const op of ops) {
      annotateOperation_(targetDocTab, op, targetTabId, agentPrefix);
      commentSummary.push(`"${op.match_text}" → ${op.reason}`);
    }
    Tracer.info(
      `[CollaborationService] processContentAnnotation_: ` +
      `added ${commentSummary.length} annotation(s) on tab "${update.target_tab}": ` +
      JSON.stringify(commentSummary)
    );
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

  return { processUpdate, clearAgentAnnotations: clearAgentAnnotations_, clearTabHighlights: clearTabHighlights_ };
})();
