// ============================================================
// ArchitectAgent.ts — Structural Architect (Style Mimic)
// ============================================================

class ArchitectAgent extends BaseAgent {

  readonly tags = ['@architect'];
  readonly contextKeys = [TAB_NAMES.MERGED_CONTENT, TAB_NAMES.STYLE_PROFILE];

  private static readonly CHUNK_SIZE = 5;

  handleCommentThreads(threads: CommentThread[]): ThreadReply[] {
    const agentName = this.constructor.name;
    Logger.log(`[${agentName}] handleCommentThreads: received ${threads.length} thread(s)`);

    // Shared context is the same for every thread — read once, reuse across chunks.
    const manuscript  = this.getTabContent_(TAB_NAMES.MERGED_CONTENT);
    const styleProfile = this.getTabContent_(TAB_NAMES.STYLE_PROFILE);

    const allReplies: ThreadReply[] = [];

    for (let i = 0; i < threads.length; i += ArchitectAgent.CHUNK_SIZE) {
      const chunk = threads.slice(i, i + ArchitectAgent.CHUNK_SIZE);
      const chunkNum = Math.floor(i / ArchitectAgent.CHUNK_SIZE) + 1;
      Logger.log(`[${agentName}] handleCommentThreads: chunk ${chunkNum} size=${chunk.length}`);

      try {
        const userPrompt = (
          `STYLE PROFILE:\n` +
          `---\n` +
          `${styleProfile.slice(0, 2000)}\n` +
          `---\n\n` +
          `MANUSCRIPT CONTEXT:\n` +
          `---\n` +
          `${manuscript.slice(0, 20000)}\n` +
          `---\n\n` +
          `THREADS:\n` +
          `---\n` +
          `${this.formatThreadsForBatch_(chunk)}\n` +
          `---\n\n` +
          `For each thread, analyse the selected passage for structural, motif, or voice concerns\n` +
          `relative to the manuscript and StyleProfile. End each reply with "— AI Editorial Assistant".\n` +
          `Return a JSON object with "responses": an array of {threadId, reply} entries, ` +
          `one per thread you are replying to.`
        ).trim();

        const raw = this.callGemini_(
          ARCHITECT_SYSTEM_PROMPT,
          userPrompt,
          this.batchReplySchema_(),
          MODEL.THINKING
        );
        const replies = this.normaliseBatchReplies_(chunk, raw, agentName);
        allReplies.push(...replies);
      } catch (e: any) {
        Logger.log(`[${agentName}] handleCommentThreads: chunk ${chunkNum} failed — ${e.message}`);
      }
    }

    Logger.log(`[${agentName}] handleCommentThreads: returning ${allReplies.length} reply/replies`);
    return allReplies;
  }

  /**
   * Reads MergedContent and generates a full StyleProfile via Gemini.
   * Routes the result to StyleProfile Scratch via instruction_update.
   */
  generateInstructions(): void {
    const manuscript = this.getTabContent_(TAB_NAMES.MERGED_CONTENT);
    if (!manuscript.trim()) {
      throw new Error('MergedContent tab is empty. Add manuscript content before generating.');
    }

    const userPrompt = `
MANUSCRIPT (excerpt):
---
${manuscript.slice(0, 20000)}
---

Analyse the writing style above and produce a comprehensive StyleProfile.
Return a JSON object with:
- proposed_full_text: your full StyleProfile document (markdown)
- operations: one per major style dimension updated (voice, rhythm, vocabulary,
  structure, motifs). Each match_text must be a verbatim 3–4-word phrase from
  proposed_full_text.
`.trim();

    const geminiResult = this.callGemini_(
      ARCHITECT_SYSTEM_PROMPT,
      userPrompt,
      this.instructionUpdateSchema_(),
      MODEL.THINKING
    ) as { proposed_full_text: string; operations: Operation[] };

    const update: RootUpdate = {
      workflow_type: 'instruction_update',
      review_tab: TAB_NAMES.STYLE_PROFILE,
      proposed_full_text: geminiResult.proposed_full_text,
      operations: geminiResult.operations,
    };

    CollaborationService.processUpdate(update);
  }

  /**
   * Populates MergedContent (only when empty) and StyleProfile Scratch with
   * example content so users can see the expected shape of each tab.
   *
   * MergedContent is the user's manuscript — it is never overwritten when it
   * already has content.  StyleProfile Scratch is a generated artefact and is
   * always safe to refresh with a fresh example.
   */
  generateExample(): void {
    DocOps.ensureStandardTabs();

    // Guard: preserve any existing manuscript content.
    const mergedTab = DocOps.getOrCreateTab(TAB_NAMES.MERGED_CONTENT);
    const existingMerged = DocOps.getTabContent(TAB_NAMES.MERGED_CONTENT);
    if (existingMerged.trim()) {
      Logger.log(
        '[ArchitectAgent] generateExample: MergedContent already has content — leaving it untouched.'
      );
    } else {
      DocOps.overwriteTabContent(mergedTab, ARCHITECT_EXAMPLE_CONTENT);
    }

    // StyleProfile Scratch is always safe to overwrite — it is regenerated
    // via generateInstructions() whenever the manuscript changes.
    const styleTab = DocOps.getOrCreateTab(
      TAB_NAMES.STYLE_PROFILE,
      TAB_NAMES.AGENTIC_INSTRUCTIONS
    );
    DocOps.overwriteTabContent(styleTab, ARCHITECT_EXAMPLE_CONTENT);
  }
}
