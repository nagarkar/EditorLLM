// ============================================================
// ArchitectAgent.ts — Structural Architect (Style Mimic)
// ============================================================

class ArchitectAgent extends BaseAgent {

  readonly tags = ['@architect'];
  readonly contextKeys = [Constants.TAB_NAMES.STYLE_PROFILE, Constants.TAB_NAMES.MANUSCRIPT];
  private static readonly CHUNK_SIZE = 5;

  readonly SYSTEM_PROMPT = `
${SYSTEM_PREAMBLE}

${ARCHITECT_SYSTEM_PROMPT_BODY}
`.trim();

  protected getAgentId(): string {
    return 'architect';
  }

  /**
   * Markdown rubric for the fast-tier judge after W1 (mirrors experimental
   * `architectDefinition.instructionQualityRubric`).
   */
  protected getInstructionQualityRubric(): string {
    return ARCHITECT_INSTRUCTION_QUALITY_RUBRIC;
  }

  generateCommentResponsesPrompt(opts: { styleProfile: string; manuscript: string; threads: CommentThread[] }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Manuscript Context': opts.manuscript.slice(0, 20000),
      'Threads': this.formatThreadsForBatch_(opts.threads),
    }, ARCHITECT_W3_INSTRUCTIONS);
  }

  generateInstructionPrompt(opts: { manuscript: string; styleProfile: string; lastGenerated: string }): string {
    return this.buildStandardPrompt({
      'Manuscript (excerpt)': opts.manuscript.slice(0, 20000),
      'Current Style Profile (if any)': opts.styleProfile,
      'Last Generated Instructions': opts.lastGenerated,
    }, [
      ARCHITECT_W1_INSTRUCTIONS,
      ARCHITECT_STYLEPROFILE_SCHEMA,
      W1_FORMAT_GUIDELINES,
    ].join('\n'));
  }

  protected commentChunkSize_() { return ArchitectAgent.CHUNK_SIZE; }
  protected commentModelTier_() { return Constants.MODEL.THINKING; }
  protected buildCommentPrompt_(chunk: CommentThread[], _passageContext: string): string {
    // Architect reads its own context — manuscript + styleProfile — rather than
    // the anchor-tab passage context used by other agents.
    return this.generateCommentResponsesPrompt({
      styleProfile: this.getTabContent_(Constants.TAB_NAMES.STYLE_PROFILE),
      manuscript:   this.getTabContent_(Constants.TAB_NAMES.MANUSCRIPT),
      threads: chunk,
    });
  }

  generateInstructions(): void {
    super.generateInstructions();
    const manuscript = this.getTabContent_(Constants.TAB_NAMES.MANUSCRIPT);
    if (!manuscript.trim()) {
      throw new Error('To generate instructions, create a Manuscript tab in EditorLLM first.');
    }
    const styleProfile = this.getTabMarkdown_(Constants.TAB_NAMES.STYLE_PROFILE);

    const lastGenerated = this.readLastGeneratedInstructions_(Constants.TAB_NAMES.STYLE_PROFILE);
    const userPrompt = this.generateInstructionPrompt({ manuscript, styleProfile, lastGenerated });

    // Plain-text Gemini call — no JSON schema — eliminates buffering timeout.
    // extractMarkdownFromJsonWrapper guards against models that wrap anyway.
    const rawText = this.callGemini_(
      this.SYSTEM_PROMPT,
      userPrompt,
      { tier: Constants.MODEL.THINKING }
    ) as string;

    const proposedText = extractMarkdownFromJsonWrapper(rawText);

    const update: RootUpdate = {
      workflow_type: 'instruction_update',
      review_tab: Constants.TAB_NAMES.STYLE_PROFILE,
      proposed_full_text: proposedText,
    };

    CollaborationService.processUpdate(update);

    // §4.1 LLM-as-judge — score reflects generated content; persisted for sidebar.
    this.evaluateInstructions(proposedText);
  }
}
