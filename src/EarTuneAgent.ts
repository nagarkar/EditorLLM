// ============================================================
// EarTuneAgent.ts — Ear-Tune style and rhythm agent
// ============================================================

class EarTuneAgent extends BaseAgent {

  readonly SYSTEM_PROMPT = `
${BaseAgent.SYSTEM_PREAMBLE}

# Role: Audio EarTune (Ear-Tune)
You optimize prose for spoken-word clarity and rhythmic listenability.
You work exclusively within the StyleProfile constraints.

## Guidelines
- Eliminate tongue-twisting consonant clusters.
- Ensure each sentence lands on a stressed syllable.
- Vary sentence length to create an ebb-and-flow rhythm.
- Never change meaning; only improve the sonic texture.

When proposing changes (content_annotation), your match_text must be sampled
verbatim from the passage currently being edited.

## Markdown Requirements (instruction_update only)
When generating EarTune instructions, your proposed_full_text MUST be valid
GitHub-Flavored Markdown. Rules:
- Use ## (H2) for top-level sections, ### (H3) for sub-sections
- Use - bullet points for all lists
- Use **bold** for rule names and key terms
- Every section must start with a ## heading
- Do NOT use plain text section headings or numbered section headers without #
`.trim();

  protected readonly EXAMPLE_CONTENT = `
# EarTune — System Prompt Example

Optimize the following passage for spoken delivery.
Focus on: syllabic stress, consonant flow, and paragraph-level rhythm arc.

Return a content_update with one operation per sentence-level rewrite.
Ensure each reason explains the specific sonic improvement achieved.
`.trim();

  readonly tags = ['@eartune'];
  readonly contextKeys = [TAB_NAMES.STYLE_PROFILE, TAB_NAMES.EAR_TUNE, COMMENT_ANCHOR_TAB];

  private static readonly CHUNK_SIZE = 10;

  generateCommentResponsesPrompt(opts: { styleProfile: string; earTuneInstructions: string; passageContext: string; threads: CommentThread[] }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Ear-Tune Instructions': opts.earTuneInstructions,
      'Passage Context': opts.passageContext,
      'Threads': this.formatThreadsForBatch_(opts.threads),
    }, [
      `For each thread, analyse the selected text for rhythmic, phonetic, and cadence issues`,
      `per the Ear-Tune instructions. End each reply with "— AI Editorial Assistant".`,
      `Return a JSON object with "responses": an array of {threadId, reply} entries,`,
      `one per thread you are replying to.`
    ].join(' '));
  }

  generateInstructionPrompt(opts: { styleProfile: string; existingEarTune: string }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Current Ear-Tune Instructions (if any)': opts.existingEarTune,
    }, [
      `Generate an updated EarTune system prompt that:`,
      `1. Incorporates the rhythm and cadence patterns from the StyleProfile.`,
      `2. Provides specific rules for consonant flow, syllabic stress, and sentence-length`,
      `   variation suitable for this manuscript.`,
      ``,
      `Return a JSON object with:`,
      `- proposed_full_text: the complete new EarTune instructions`
    ].join('\\n'));
  }

  generateTabAnnotationPrompt(opts: { styleProfile: string; earTuneInstructions: string; passage: string; tabName: string }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Ear-Tune Instructions': opts.earTuneInstructions,
      [`Passage To Sweep (from tab: "${opts.tabName}")`]: opts.passage,
    }, [
      `Identify every passage with a rhythmic, phonetic, or cadence problem.`,
      `Return a JSON object with:`,
      `- operations: one per problem found. Each must have:`,
      `    - match_text: verbatim 3–4-word phrase from the passage above`,
      `    - reason: description of the issue and suggested improvement`
    ].join('\\n'));
  }

  handleCommentThreads(threads: CommentThread[]): ThreadReply[] {
    const agentName = this.constructor.name;
    Tracer.info(`[${agentName}] handleCommentThreads: received ${threads.length} thread(s)`);

    // Shared instruction context — same for every subgroup.
    const styleProfile = this.getTabContent_(TAB_NAMES.STYLE_PROFILE);
    const earTune = this.getTabContent_(TAB_NAMES.EAR_TUNE);

    // Subgroup by anchorTabName so each chunk shares one passage context.
    const subgroups = new Map<string | null, CommentThread[]>();
    for (const thread of threads) {
      const key = thread.anchorTabName;
      if (!subgroups.has(key)) subgroups.set(key, []);
      subgroups.get(key)!.push(thread);
    }

    Tracer.info(`[${agentName}] handleCommentThreads: ${subgroups.size} subgroup(s) by anchor tab`);

    const allReplies: ThreadReply[] = [];

    for (const [anchorTabName, subThreads] of subgroups) {
      // Null anchor → no shared passage; agent falls back to per-thread selectedText.
      const passageContext = anchorTabName
        ? this.getTabContent_(anchorTabName)
        : '';

      for (let i = 0; i < subThreads.length; i += EarTuneAgent.CHUNK_SIZE) {
        const chunk = subThreads.slice(i, i + EarTuneAgent.CHUNK_SIZE);
        const chunkNum = Math.floor(i / EarTuneAgent.CHUNK_SIZE) + 1;
        Tracer.info(
          `[${agentName}] handleCommentThreads: anchor=${anchorTabName ?? '(none)'} ` +
          `chunk ${chunkNum} size=${chunk.length}`
        );

        try {
          const userPrompt = this.generateCommentResponsesPrompt({
            styleProfile,
            earTuneInstructions: earTune,
            passageContext,
            threads: chunk,
          });

          const raw = this.callGemini_(
            this.SYSTEM_PROMPT,
            userPrompt,
            this.batchReplySchema_(),
            MODEL.FAST
          );
          const replies = this.normaliseBatchReplies_(chunk, raw, agentName);
          allReplies.push(...replies);
        } catch (e: any) {
          Tracer.error(
            `[${agentName}] handleCommentThreads: anchor=${anchorTabName ?? '(none)'} ` +
            `chunk ${chunkNum} failed — ${e.message}`
          );
        }
      }
    }

    Tracer.info(`[${agentName}] handleCommentThreads: returning ${allReplies.length} reply/replies`);
    return allReplies;
  }

  /**
   * Refreshes the EarTune system prompt via instruction_update.
   * Bases the new prompt on the current StyleProfile.
   */
  generateInstructions(): void {
    super.generateInstructions();
    const styleProfile = this.getTabMarkdown_(TAB_NAMES.STYLE_PROFILE);
    const existing = this.getTabMarkdown_(TAB_NAMES.EAR_TUNE);

    const userPrompt = this.generateInstructionPrompt({
      styleProfile,
      existingEarTune: existing,
    });

    const geminiResult = this.callGemini_(
      this.SYSTEM_PROMPT,
      userPrompt,
      this.instructionUpdateSchema_(),
      MODEL.FAST
    ) as { proposed_full_text: string };

    const update: RootUpdate = {
      workflow_type: 'instruction_update',
      review_tab: TAB_NAMES.EAR_TUNE,
      proposed_full_text: geminiResult.proposed_full_text,
    };

    CollaborationService.processUpdate(update);
  }

  /**
   * Writes example EarTune instructions to the EarTune tab.
   */
  generateExample(): void {
    super.generateExample();
    MarkdownService.markdownToTab(
      this.EXAMPLE_CONTENT,
      TAB_NAMES.EAR_TUNE,
      TAB_NAMES.AGENTIC_INSTRUCTIONS
    );
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

    const userPrompt = this.generateTabAnnotationPrompt({
      styleProfile,
      earTuneInstructions,
      passage,
      tabName,
    });

    const geminiResult = this.callGemini_(
      this.SYSTEM_PROMPT,
      userPrompt,
      this.annotationSchema_(),
      MODEL.FAST
    ) as { operations: Operation[] };

    const update: RootUpdate = {
      workflow_type: 'content_annotation',
      target_tab: tabName,
      operations: geminiResult.operations,
      agent_name: '[EarTune]'
    };

    CollaborationService.processUpdate(update);
  }
}
