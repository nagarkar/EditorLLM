// ============================================================
// AuditAgent.ts — Logical Auditor (Technical Audit)
// ============================================================

class AuditAgent extends BaseAgent {

  readonly SYSTEM_PROMPT = `
${BaseAgent.SYSTEM_PREAMBLE}

# Role: Logical Auditor (Technical Audit)
You verify that all physics claims, mathematical statements, and Chid Axiom
applications are internally consistent with the StyleProfile and prior chapters.

## Responsibilities
1. Flag any contradiction with the Chid Axiom as stated in the manuscript.
2. Identify missing or incorrect LaTeX captions on equations.
3. Check that physical constants and unit systems are consistent throughout.

Use thinkingLevel: High — reason step-by-step before generating output.

When proposing changes (content_annotation), provide LaTeX in reason where applicable.

## Markdown Requirements (instruction_update only)
When generating TechnicalAudit instructions, your proposed_full_text MUST be
valid GitHub-Flavored Markdown. Rules:
- Use ## (H2) for top-level sections (e.g. ## Chid Axioms, ## LaTeX Requirements)
- Use ### (H3) for sub-sections
- Use - bullet points for checklist items and axiom listings
- Use **bold** for axiom names, constants, and rule names
- Use *italic* for equation symbols (e.g. *ħ*, *c*)
- Every section must start with a ## heading followed by content
`.trim();

  protected readonly EXAMPLE_CONTENT = `
# TechnicalAudit — System Prompt Example

Audit the following passage for:
1. Chid Axiom consistency (consciousness as ground of all physical law).
2. LaTeX caption completeness for all equations.
3. Unit and constant consistency (SI units unless manuscript specifies otherwise).

Return a content_update with one operation per identified issue.
Each reason must cite the specific axiom or physical principle violated.
`.trim();

  readonly tags = ['@audit', '@auditor'];
  readonly contextKeys = [TAB_NAMES.STYLE_PROFILE, TAB_NAMES.TECHNICAL_AUDIT, COMMENT_ANCHOR_TAB];

  private static readonly CHUNK_SIZE = 5;

  generateCommentResponsesPrompt(opts: { styleProfile: string; auditInstructions: string; passageContext: string; threads: CommentThread[] }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Technical Audit Instructions': opts.auditInstructions,
      'Passage Context': opts.passageContext,
      'Threads': this.formatThreadsForBatch_(opts.threads),
    }, [
      `For each thread, perform a targeted technical audit of the selected passage.`,
      `Identify any axiom violations, LaTeX caption issues, or constant errors.`,
      `End each reply with "— AI Editorial Assistant".`,
      `Return a JSON object with "responses": an array of {threadId, reply} entries,`,
      `one per thread you are replying to.`
    ].join(' '));
  }

  generateInstructionPrompt(opts: { styleProfile: string; existingAudit: string; manuscript: string }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Current Technical Audit Instructions (if any)': opts.existingAudit,
      'Manuscript Sample (for axiom extraction)': opts.manuscript.slice(0, 6000),
    }, [
      `Generate a comprehensive TechnicalAudit system prompt that:`,
      `1. Lists all Chid Axioms and physical principles as stated in the manuscript.`,
      `2. Defines LaTeX caption requirements for this document.`,
      `3. Specifies the unit system and physical constants in use.`,
      `4. Provides specific audit checklist items derived from the manuscript.`,
      ``,
      `Return a JSON object with:`,
      `- proposed_full_text: the complete new TechnicalAudit instructions`
    ].join('\\n'));
  }

  generateTabAnnotationPrompt(opts: { styleProfile: string; auditInstructions: string; passage: string; tabName: string }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Technical Audit Instructions': opts.auditInstructions,
      [`Passage To Audit (from tab: "${opts.tabName}")`]: opts.passage,
    }, [
      `Perform a full technical audit. Check every claim against the Chid Axiom,`,
      `all equations for valid LaTeX captions, and all physical constants for`,
      `correct SI values and units.`,
      ``,
      `Return a JSON object with:`,
      `- operations: one per issue found. Each must have:`,
      `    - match_text: verbatim 3–4-word phrase from the passage above`,
      `    - reason: specific axiom, constant, or caption rule violated, plus suggested correction`
    ].join('\\n'));
  }

  handleCommentThreads(threads: CommentThread[]): ThreadReply[] {
    const agentName = this.constructor.name;
    Tracer.info(`[${agentName}] handleCommentThreads: received ${threads.length} thread(s)`);

    // Shared instruction context — same for every subgroup.
    const styleProfile = this.getTabContent_(TAB_NAMES.STYLE_PROFILE);
    const auditInstructions = this.getTabContent_(TAB_NAMES.TECHNICAL_AUDIT);

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

      for (let i = 0; i < subThreads.length; i += AuditAgent.CHUNK_SIZE) {
        const chunk = subThreads.slice(i, i + AuditAgent.CHUNK_SIZE);
        const chunkNum = Math.floor(i / AuditAgent.CHUNK_SIZE) + 1;
        Tracer.info(
          `[${agentName}] handleCommentThreads: anchor=${anchorTabName ?? '(none)'} ` +
          `chunk ${chunkNum} size=${chunk.length}`
        );

        try {
          const userPrompt = this.generateCommentResponsesPrompt({
            styleProfile,
            auditInstructions,
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
   * Refreshes the TechnicalAudit system prompt via instruction_update.
   * Uses extended thinking (High) to reason carefully about axiom constraints.
   */
  generateInstructions(): void {
    super.generateInstructions();
    // W1: read instruction tabs as markdown; manuscript stays plain text
    const styleProfile = this.getTabMarkdown_(TAB_NAMES.STYLE_PROFILE);
    const existing = this.getTabMarkdown_(TAB_NAMES.TECHNICAL_AUDIT);
    const manuscript = this.getTabContent_(TAB_NAMES.MERGED_CONTENT);

    const userPrompt = this.generateInstructionPrompt({
      styleProfile,
      existingAudit: existing,
      manuscript,
    });

    const geminiResult = this.callGemini_(
      this.SYSTEM_PROMPT,
      userPrompt,
      this.instructionUpdateSchema_(),
      MODEL.THINKING  // Technical reasoning — use thinking model
    ) as { proposed_full_text: string };

    const update: RootUpdate = {
      workflow_type: 'instruction_update',
      review_tab: TAB_NAMES.TECHNICAL_AUDIT,
      proposed_full_text: geminiResult.proposed_full_text,
    };

    CollaborationService.processUpdate(update);
  }

  /**
   * Writes example TechnicalAudit instructions to the TechnicalAudit tab.
   */
  generateExample(): void {
    super.generateExample();
    MarkdownService.markdownToTab(
      this.EXAMPLE_CONTENT,
      TAB_NAMES.TECHNICAL_AUDIT,
      TAB_NAMES.AGENTIC_INSTRUCTIONS
    );
  }

  /**
   * Workflow 2: full-tab technical audit sweep.
   * Highlights and comments every passage with an axiom, LaTeX, or constant issue.
   * Clears previous agent annotations on the tab before adding new ones.
   */
  annotateTab(tabName: string): void {
    const passage = this.getTabContent_(tabName);
    if (!passage.trim()) {
      throw new Error(`Tab "${tabName}" is empty. Nothing to audit.`);
    }

    const styleProfile = this.getTabContent_(TAB_NAMES.STYLE_PROFILE);
    const auditInstructions = this.getTabContent_(TAB_NAMES.TECHNICAL_AUDIT);

    const userPrompt = this.generateTabAnnotationPrompt({
      styleProfile,
      auditInstructions,
      passage,
      tabName,
    });

    const geminiResult = this.callGemini_(
      this.SYSTEM_PROMPT,
      userPrompt,
      this.annotationSchema_(),
      MODEL.THINKING  // Technical task — thinking model
    ) as { operations: Operation[] };

    const update: RootUpdate = {
      workflow_type: 'content_annotation',
      target_tab: tabName,
      operations: geminiResult.operations,
      agent_name: '[Auditor]'
    };

    CollaborationService.processUpdate(update);
  }
}
