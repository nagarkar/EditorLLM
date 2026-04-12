// ============================================================
// StylistAgent.ts — Audio Stylist (Ear-Tune)
// ============================================================

class StylistAgent extends BaseAgent {

  readonly tags = ['@eartune', '@stylist'];
  readonly contextKeys = [TAB_NAMES.STYLE_PROFILE, TAB_NAMES.EAR_TUNE, COMMENT_ANCHOR_TAB];

  private static readonly CHUNK_SIZE = 10;

  handleCommentThreads(threads: CommentThread[]): ThreadReply[] {
    const agentName = this.constructor.name;
    Logger.log(`[${agentName}] handleCommentThreads: received ${threads.length} thread(s)`);

    // Shared instruction context — same for every subgroup.
    const styleProfile = this.getTabContent_(TAB_NAMES.STYLE_PROFILE);
    const earTune      = this.getTabContent_(TAB_NAMES.EAR_TUNE);

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
      // Null anchor → no shared passage; agent falls back to per-thread selectedText.
      const passageContext = anchorTabName
        ? this.getTabContent_(anchorTabName).slice(0, 4000)
        : '';

      for (let i = 0; i < subThreads.length; i += StylistAgent.CHUNK_SIZE) {
        const chunk = subThreads.slice(i, i + StylistAgent.CHUNK_SIZE);
        const chunkNum = Math.floor(i / StylistAgent.CHUNK_SIZE) + 1;
        Logger.log(
          `[${agentName}] handleCommentThreads: anchor=${anchorTabName ?? '(none)'} ` +
          `chunk ${chunkNum} size=${chunk.length}`
        );

        try {
          const passageSection = passageContext
            ? `PASSAGE CONTEXT:\n---\n${passageContext}\n---\n\n`
            : '';

          const userPrompt = (
            `STYLE PROFILE:\n` +
            `---\n` +
            `${styleProfile.slice(0, 2000)}\n` +
            `---\n\n` +
            `EAR-TUNE INSTRUCTIONS:\n` +
            `---\n` +
            `${earTune.slice(0, 2000)}\n` +
            `---\n\n` +
            `${passageSection}` +
            `THREADS:\n` +
            `---\n` +
            `${this.formatThreadsForBatch_(chunk)}\n` +
            `---\n\n` +
            `For each thread, analyse the selected text for rhythmic, phonetic, and cadence issues\n` +
            `per the Ear-Tune instructions. End each reply with "— AI Editorial Assistant".\n` +
            `Return a JSON object with "responses": an array of {threadId, reply} entries, ` +
            `one per thread you are replying to.`
          ).trim();

          const raw = this.callGemini_(
            STYLIST_SYSTEM_PROMPT,
            userPrompt,
            this.batchReplySchema_(),
            MODEL.FAST
          );
          const replies = this.normaliseBatchReplies_(chunk, raw, agentName);
          allReplies.push(...replies);
        } catch (e: any) {
          Logger.log(
            `[${agentName}] handleCommentThreads: anchor=${anchorTabName ?? '(none)'} ` +
            `chunk ${chunkNum} failed — ${e.message}`
          );
        }
      }
    }

    Logger.log(`[${agentName}] handleCommentThreads: returning ${allReplies.length} reply/replies`);
    return allReplies;
  }

  /**
   * Refreshes the EarTune system prompt via instruction_update.
   * Bases the new prompt on the current StyleProfile.
   */
  generateInstructions(): void {
    // W1: read instruction tabs as markdown for clean structured context
    const styleProfile = this.getTabMarkdown_(TAB_NAMES.STYLE_PROFILE);
    const existing = this.getTabMarkdown_(TAB_NAMES.EAR_TUNE);

    const userPrompt = `
STYLE PROFILE:
---
${styleProfile.slice(0, 4000)}
---

CURRENT EAR-TUNE INSTRUCTIONS (if any):
---
${existing.slice(0, 2000)}
---

Generate an updated EarTune system prompt that:
1. Incorporates the rhythm and cadence patterns from the StyleProfile.
2. Provides specific rules for consonant flow, syllabic stress, and sentence-length
   variation suitable for this manuscript.

Return a JSON object with:
- proposed_full_text: the complete new EarTune instructions
- operations: one per section being changed or added, each with a verbatim
  match_text from proposed_full_text and a reason.
`.trim();

    const geminiResult = this.callGemini_(
      STYLIST_SYSTEM_PROMPT,
      userPrompt,
      this.instructionUpdateSchema_(),
      MODEL.FAST
    ) as { proposed_full_text: string; operations: Operation[] };

    const update: RootUpdate = {
      workflow_type: 'instruction_update',
      review_tab: TAB_NAMES.EAR_TUNE,
      proposed_full_text: geminiResult.proposed_full_text,
      operations: geminiResult.operations,
    };

    CollaborationService.processUpdate(update);
  }

  /**
   * Writes example EarTune instructions to the EarTune tab.
   */
  generateExample(): void {
    DocOps.ensureStandardTabs();
    const earTab = DocOps.getOrCreateTab(TAB_NAMES.EAR_TUNE, TAB_NAMES.AGENTIC_INSTRUCTIONS);
    DocOps.overwriteTabContent(earTab, STYLIST_EXAMPLE_CONTENT);
  }

  /**
   * Workflow 2: full-tab Ear-Tune sweep.
   * Highlights and comments every passage with rhythmic issues.
   * Clears previous agent annotations on the tab before adding new ones.
   */
  annotateTab(tabName: string): void {
    const passage = this.getTabContent_(tabName);
    if (!passage.trim()) {
      throw new Error(`Tab "${tabName}" is empty. Nothing to Ear-Tune.`);
    }

    const styleProfile = this.getTabContent_(TAB_NAMES.STYLE_PROFILE);
    const earTuneInstructions = this.getTabContent_(TAB_NAMES.EAR_TUNE);

    const userPrompt = `
STYLE PROFILE:
---
${styleProfile.slice(0, 3000)}
---

EAR-TUNE INSTRUCTIONS:
---
${earTuneInstructions.slice(0, 2000)}
---

PASSAGE TO SWEEP (from tab: "${tabName}"):
---
${passage.slice(0, 8000)}
---

Identify every passage with a rhythmic, phonetic, or cadence problem.
Return a JSON object with:
- operations: one per problem found. Each must have:
    - match_text: verbatim 3–4-word phrase from the passage above
    - reason: description of the issue and suggested improvement
`.trim();

    const geminiResult = this.callGemini_(
      STYLIST_SYSTEM_PROMPT,
      userPrompt,
      this.annotationSchema_(),
      MODEL.FAST
    ) as { operations: Operation[] };

    const update: RootUpdate = {
      workflow_type: 'content_annotation',
      target_tab: tabName,
      operations: geminiResult.operations,
    };

    CollaborationService.processUpdate(update);
  }
}
