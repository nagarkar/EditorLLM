// ============================================================
// TetherAgent.ts — External Anchor (source validation & alignment)
// ============================================================

class TetherAgent extends BaseAgent {


  readonly SYSTEM_PROMPT = `${BaseAgent.SYSTEM_PREAMBLE}

# Role: External Anchor (Tether Agent)
You operate within EditorLLM. While other agents stay "inside the box," your role
is to act as the "External Anchor." You bridge the manuscript's unique metaphysic
(the Chid Axiom) with the external historical and scientific record.

## Core Rules
- **Respect the Metaphysic:** Do not "correct" the Chid Axiom using standard
  materialist physics unless the author is making an objective historical or
  mathematical error about a cited source.
- **Controversy vs. Error:** If a statement is philosophically controversial but
  internally consistent, flag it as "Controversial" but do NOT recommend removal.
- **Bridge-Building:** Actively look for alignments with the Rig Veda, Advaita
  Vedanta, Quantum Mechanics, and Western Continental Philosophy.
- **Strict Schema:** Your JSON output must match the provided schema.

## Guidelines for Operations (content_annotation)
- match_text must be 3–4 consecutive words sampled verbatim.
- reason must explain the factual discrepancy or the alignment opportunity.

## Markdown Requirements (instruction_update only)
When generating TetherInstructions, your proposed_full_text MUST be valid
GitHub-Flavored Markdown. Rules:
- Use ## (H2) for top-level sections, ### (H3) for sub-sections
- Use - bullet points for all lists
- Use **bold** for rule names, key terms, and historical figure names
- Every section must start with a ## heading
- Do NOT use plain text section headings or numbered section headers without #
`.trim();

  protected readonly EXAMPLE_CONTENT = `
# TetherInstructions — System Prompt Example

Perform an external source validation sweep on the following passage.
Focus on: historical accuracy, citation completeness, and alignment opportunities.

1. Flag invalid references or factual errors.
2. Identify "controversial" statements and annotate them with context.
3. Suggest 2–3 specific "missed opportunities" for alignment with prior
   historical or scientific work.

Return a content_update with one operation per issue or opportunity found.
Ensure each reason explains the specific factual discrepancy or alignment.
`.trim();

  readonly tags = ['@tether', '@ref'];
  readonly contextKeys = [TAB_NAMES.STYLE_PROFILE, TAB_NAMES.TETHER_INSTRUCTIONS, COMMENT_ANCHOR_TAB];

  private static readonly CHUNK_SIZE = 5;

  generateCommentResponsesPrompt(opts: { styleProfile: string; tetherInstructions: string; passageContext: string; threads: CommentThread[] }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Tether Instructions': opts.tetherInstructions,
      'Passage Context': opts.passageContext,
      'Threads': this.formatThreadsForBatch_(opts.threads),
    }, [
      `For each thread, provide an investigative response grounded in historical`,
      `or scientific fact. Validate references, flag errors vs. controversies,`,
      `and suggest alignment opportunities where applicable.`,
      `End each reply with "— AI Editorial Assistant".`,
      `Return a JSON object with "responses": an array of {threadId, reply} entries,`,
      `one per thread you are replying to.`
    ].join(' '));
  }

  generateInstructionPrompt(opts: { styleProfile: string; existingTether: string; manuscript: string }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Manuscript Sample (for Fact-Checking Context)': opts.manuscript.slice(0, 6000),
      'Current Tether Instructions (if any)': opts.existingTether,
    }, [
      `Generate a comprehensive TetherInstructions system prompt that:`,
      `1. Identifies key historical figures and texts cited in the manuscript`,
      `   (e.g., Schrödinger, Epictetus, Rig Veda).`,
      `2. Outlines the "External Facts" that must remain unyielding even within`,
      `   the Chid Axiom framework.`,
      `3. Provides a checklist for "Alignment Opportunities" based on the`,
      `   manuscript's core themes.`,
      ``,
      `Return a JSON object with:`,
      `- proposed_full_text: the complete new TetherInstructions`
    ].join('\\n'));
  }

  generateTabAnnotationPrompt(opts: { styleProfile: string; tetherInstructions: string; passage: string; tabName: string }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Tether Instructions': opts.tetherInstructions,
      [`Passage To Validate (from tab: "${opts.tabName}")`]: opts.passage,
    }, [
      `Perform an external source validation sweep.`,
      `1. Flag invalid references or factual errors.`,
      `2. Identify "controversial" statements and annotate them with context.`,
      `3. Suggest 2–3 specific "missed opportunities" for alignment with prior`,
      `   historical or scientific work.`,
      ``,
      `Return a JSON object with:`,
      `- operations: one per issue or opportunity found. Each must have:`,
      `    - match_text: verbatim 3–4-word phrase from the passage above`,
      `    - reason: description of the factual discrepancy or alignment opportunity`
    ].join('\\n'));
  }

  handleCommentThreads(threads: CommentThread[]): ThreadReply[] {
    const agentName = this.constructor.name;
    Tracer.info(`[${agentName}] handleCommentThreads: received ${threads.length} thread(s)`);

    // Shared instruction context — same for every subgroup.
    const styleProfile = this.getTabContent_(TAB_NAMES.STYLE_PROFILE);
    const tetherInstructions = this.getTabContent_(TAB_NAMES.TETHER_INSTRUCTIONS);

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

      for (let i = 0; i < subThreads.length; i += TetherAgent.CHUNK_SIZE) {
        const chunk = subThreads.slice(i, i + TetherAgent.CHUNK_SIZE);
        const chunkNum = Math.floor(i / TetherAgent.CHUNK_SIZE) + 1;
        Tracer.info(
          `[${agentName}] handleCommentThreads: anchor=${anchorTabName ?? '(none)'} ` +
          `chunk ${chunkNum} size=${chunk.length}`
        );

        try {
          const userPrompt = this.generateCommentResponsesPrompt({
            styleProfile,
            tetherInstructions,
            passageContext,
            threads: chunk,
          });

          const raw = this.callGemini_(
            this.SYSTEM_PROMPT,
            userPrompt,
            this.batchReplySchema_(),
            MODEL.THINKING
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
   * Refreshes the TetherInstructions system prompt via instruction_update.
   * Uses extended thinking to reason carefully about historical validation rules.
   */
  generateInstructions(): void {
    super.generateInstructions();
    // W1: read instruction tabs as markdown; manuscript stays plain text
    const styleProfile = this.getTabMarkdown_(TAB_NAMES.STYLE_PROFILE);
    const existing = this.getTabMarkdown_(TAB_NAMES.TETHER_INSTRUCTIONS);
    const manuscript = this.getTabContent_(TAB_NAMES.MERGED_CONTENT);

    const userPrompt = this.generateInstructionPrompt({
      styleProfile,
      existingTether: existing,
      manuscript,
    });

    const geminiResult = this.callGemini_(
      this.SYSTEM_PROMPT,
      userPrompt,
      this.instructionUpdateSchema_(),
      MODEL.THINKING
    ) as { proposed_full_text: string };

    const update: RootUpdate = {
      workflow_type: 'instruction_update',
      review_tab: TAB_NAMES.TETHER_INSTRUCTIONS,
      proposed_full_text: geminiResult.proposed_full_text,
    };

    CollaborationService.processUpdate(update);
  }

  /**
   * Writes example TetherInstructions to the TetherInstructions tab.
   */
  generateExample(): void {
    super.generateExample();
    MarkdownService.markdownToTab(
      this.EXAMPLE_CONTENT,
      TAB_NAMES.TETHER_INSTRUCTIONS,
      TAB_NAMES.AGENTIC_INSTRUCTIONS
    );
  }

  /**
   * Workflow 2: full-tab tether validation sweep.
   * Highlights and comments every passage with a reference issue or alignment opportunity.
   * Clears previous agent annotations on the tab before adding new ones.
   */
  annotateTab(tabName: string): void {
    const passage = this.getTabContent_(tabName);
    if (!passage.trim()) {
      throw new Error(`Tab "${tabName}" is empty. Nothing to validate.`);
    }

    const styleProfile = this.getTabContent_(TAB_NAMES.STYLE_PROFILE);
    const tetherInstructions = this.getTabContent_(TAB_NAMES.TETHER_INSTRUCTIONS);

    const userPrompt = this.generateTabAnnotationPrompt({
      styleProfile,
      tetherInstructions,
      passage,
      tabName,
    });

    const geminiResult = this.callGemini_(
      this.SYSTEM_PROMPT,
      userPrompt,
      this.annotationSchema_(),
      MODEL.THINKING
    ) as { operations: Operation[] };

    const update: RootUpdate = {
      workflow_type: 'content_annotation',
      target_tab: tabName,
      operations: geminiResult.operations,
      agent_name: '[Tether]'
    };

    CollaborationService.processUpdate(update);
  }
}
