// ============================================================
// CommentAgent.ts — @AI catch-all handler for comment threads.
// Also owns the Comment Instructions tab (generateInstructions /
// generateExample). Per-thread routing is handled by CommentProcessor.
// ============================================================

class CommentAgent extends BaseAgent {

  readonly tags = ['@ai'];
  readonly contextKeys = [TAB_NAMES.MERGED_CONTENT, TAB_NAMES.COMMENT_INSTRUCTIONS];

  // --- Schema ---

  private singleThreadSchema_(): object {
    return {
      type: 'object',
      properties: { response: { type: 'string' } },
      required: ['response'],
    };
  }

  // --- Comment thread handler ---

  handleCommentThread(thread: CommentThread): ThreadReply {
    this.logCommentThread_(thread, 'handleCommentThread');
    const instructions = this.getTabContent_(TAB_NAMES.COMMENT_INSTRUCTIONS).trim();
    const systemPrompt = instructions || COMMENT_AGENT_SYSTEM_PROMPT;

    const convHistory = thread.conversation
      .map(m => `[${m.role}] ${m.authorName}: ${m.content}`)
      .join('\n');

    const userPrompt = `
SELECTED TEXT:
---
${thread.selectedText}
---

CONVERSATION:
---
${convHistory}
---

REQUEST: ${thread.agentRequest}

Respond directly to the request. End your reply with "— AI Editorial Assistant".
`.trim();

    const result = this.callGemini_(systemPrompt, userPrompt, this.singleThreadSchema_(), MODEL.FAST) as { response: string };

    return {
      threadId: thread.threadId,
      content: result.response,
    };
  }

  // --- Instruction management ---

  /**
   * Refreshes the Comment Instructions tab via instruction_update.
   * The new prompt is informed by the current StyleProfile.
   */
  generateInstructions(): void {
    // W1: read instruction tabs as markdown for clean structured context
    const styleProfile = this.getTabMarkdown_(TAB_NAMES.STYLE_PROFILE);
    const existing = this.getTabMarkdown_(TAB_NAMES.COMMENT_INSTRUCTIONS);

    const userPrompt = `
STYLE PROFILE:
---
${styleProfile.slice(0, 3000)}
---

CURRENT COMMENT INSTRUCTIONS (if any):
---
${existing.slice(0, 2000)}
---

Generate an updated Comment Instructions system prompt that guides the AI to
respond to in-document "@AI" comment threads in a voice consistent with this
manuscript's StyleProfile.

Return a JSON object with:
- proposed_full_text: the complete new Comment Instructions
- operations: one per section being added or changed, each with a verbatim
  match_text from proposed_full_text and a reason.
`.trim();

    const geminiResult = this.callGemini_(
      COMMENT_AGENT_SYSTEM_PROMPT,
      userPrompt,
      this.instructionUpdateSchema_(),
      MODEL.FAST
    ) as { proposed_full_text: string; operations: Operation[] };

    const update: RootUpdate = {
      workflow_type: 'instruction_update',
      review_tab: TAB_NAMES.COMMENT_INSTRUCTIONS,
      proposed_full_text: geminiResult.proposed_full_text,
      operations: geminiResult.operations,
    };

    CollaborationService.processUpdate(update);
  }

  /**
   * Writes example Comment Instructions to the Comment Instructions tab.
   */
  generateExample(): void {
    DocOps.ensureStandardTabs();
    const tab = DocOps.getOrCreateTab(
      TAB_NAMES.COMMENT_INSTRUCTIONS,
      TAB_NAMES.AGENTIC_INSTRUCTIONS
    );
    DocOps.overwriteTabContent(tab, COMMENT_AGENT_EXAMPLE_CONTENT);
  }
}
