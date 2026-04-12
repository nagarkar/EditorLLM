// ============================================================
// CommentAgent.ts — @AI catch-all handler for comment threads.
// Also owns the Comment Instructions tab (generateInstructions /
// generateExample). Per-thread routing is handled by CommentProcessor.
// ============================================================

class CommentAgent extends BaseAgent {

  readonly tags = ['@ai'];

  /**
   * CommentAgent groups threads by the tab they are anchored in.
   * COMMENT_ANCHOR_TAB causes CommentProcessor to resolve anchorTabName per
   * thread; the agent then uses that tab's content as shared context per chunk.
   */
  readonly contextKeys = [COMMENT_ANCHOR_TAB, TAB_NAMES.COMMENT_INSTRUCTIONS];

  private static readonly CHUNK_SIZE = 10;

  // --- Comment thread batch handler ---

  handleCommentThreads(threads: CommentThread[]): ThreadReply[] {
    const agentName = this.constructor.name;
    Logger.log(`[${agentName}] handleCommentThreads: received ${threads.length} thread(s)`);

    const instructions = this.getTabContent_(TAB_NAMES.COMMENT_INSTRUCTIONS).trim();
    const systemPrompt = instructions || COMMENT_AGENT_SYSTEM_PROMPT;

    // Subgroup by anchorTabName so each chunk shares one passage context.
    const subgroups = new Map<string | null, CommentThread[]>();
    for (const thread of threads) {
      const key = thread.anchorTabName;
      if (!subgroups.has(key)) subgroups.set(key, []);
      subgroups.get(key)!.push(thread);
    }

    Logger.log(`[${agentName}] handleCommentThreads: ${subgroups.size} subgroup(s) by anchor tab`);

    const allReplies: ThreadReply[] = [];

    for (const [anchorTabName, subThreads] of subgroups) {
      const anchorContent = anchorTabName
        ? this.getTabContent_(anchorTabName).slice(0, 4000)
        : '';

      for (let i = 0; i < subThreads.length; i += CommentAgent.CHUNK_SIZE) {
        const chunk = subThreads.slice(i, i + CommentAgent.CHUNK_SIZE);
        const chunkNum = Math.floor(i / CommentAgent.CHUNK_SIZE) + 1;
        Logger.log(
          `[${agentName}] handleCommentThreads: anchor=${anchorTabName ?? '(none)'} ` +
          `chunk ${chunkNum} size=${chunk.length}`
        );

        try {
          const userPrompt = this.buildBatchPrompt_(anchorContent, chunk);
          const raw = this.callGemini_(systemPrompt, userPrompt, this.batchReplySchema_(), MODEL.FAST);
          const replies = this.normaliseBatchReplies_(chunk, raw, agentName);
          allReplies.push(...replies);
        } catch (e: any) {
          Logger.log(`[${agentName}] handleCommentThreads: chunk ${chunkNum} failed — ${e.message}`);
        }
      }
    }

    Logger.log(`[${agentName}] handleCommentThreads: returning ${allReplies.length} reply/replies`);
    return allReplies;
  }

  private buildBatchPrompt_(anchorContent: string, threads: CommentThread[]): string {
    const anchorSection = anchorContent
      ? `ANCHOR PASSAGE:\n---\n${anchorContent}\n---\n\n`
      : '';

    return (
      `${anchorSection}` +
      `THREADS:\n` +
      `---\n` +
      `${this.formatThreadsForBatch_(threads)}\n` +
      `---\n\n` +
      `For each thread, respond to the request concisely and grounded in the passage context.\n` +
      `End each reply with "— AI Editorial Assistant".\n` +
      `Return a JSON object with "responses": an array of {threadId, reply} entries, ` +
      `one per thread you are replying to.`
    ).trim();
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
