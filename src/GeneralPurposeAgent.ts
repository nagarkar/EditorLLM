// ============================================================
// GeneralPurposeAgent.ts — GeneralPurposeAgent: @AI catch-all handler.
// Also owns the General Purpose Instructions tab (generateInstructions).
// Per-thread routing is handled by CommentProcessor.
// ============================================================

class GeneralPurposeAgent extends BaseAgent {

  readonly SYSTEM_PROMPT = `
${SYSTEM_PREAMBLE}

${GENERALPURPOSE_SYSTEM_PROMPT_BODY}
`.trim();

  readonly tags = ['@ai'];

  /**
   * GeneralPurposeAgent groups threads by the tab they are anchored in.
   * Constants.COMMENT_ANCHOR_TAB causes CommentProcessor to resolve anchorTabName per
   * thread; the agent then uses that tab's content as shared context per chunk.
   */
  readonly contextKeys = [Constants.COMMENT_ANCHOR_TAB, Constants.TAB_NAMES.GENERAL_PURPOSE_INSTRUCTIONS];

  private static readonly CHUNK_SIZE = 10;

  protected getAgentId(): string {
    return 'general-purpose';
  }

  protected getInstructionQualityRubric(): string {
    return GENERALPURPOSE_INSTRUCTION_QUALITY_RUBRIC;
  }

  generateCommentResponsesPrompt(opts: { anchorContent: string; threads: CommentThread[] }): string {
    return this.buildStandardPrompt({
      'Anchor Passage': opts.anchorContent || undefined,
      'Threads': this.formatThreadsForBatch_(opts.threads),
    }, GENERALPURPOSE_W3_INSTRUCTIONS);
  }

  generateInstructionPrompt(opts: { styleProfile: string; existingInstructions: string; lastGenerated: string }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Current General Purpose Instructions (if any)': opts.existingInstructions,
      'Last Generated Instructions': opts.lastGenerated,
    }, [
      GENERALPURPOSE_W1_INSTRUCTIONS,
      W1_FORMAT_GUIDELINES,
    ].join('\n'));
  }

  // --- Comment thread batch handler ---

  protected commentChunkSize_() { return GeneralPurposeAgent.CHUNK_SIZE; }
  protected commentModelTier_() { return Constants.MODEL.FAST; }
  protected commentSystemPrompt_(): string {
    // Use the tab-authored instructions when present; fall back to the hardcoded SYSTEM_PROMPT.
    const instructions = this.getTabContent_(Constants.TAB_NAMES.GENERAL_PURPOSE_INSTRUCTIONS).trim();
    return instructions || this.SYSTEM_PROMPT;
  }
  protected buildCommentPrompt_(chunk: CommentThread[], anchorContent: string): string {
    return this.generateCommentResponsesPrompt({ anchorContent, threads: chunk });
  }

  // --- Instruction management ---

  /**
   * Refreshes the General Purpose Instructions tab.
   * Returns plain markdown directly from Gemini — no JSON schema — to avoid
   * JSON-parse failures on long instruction content (seen with Constants.MODEL.FAST at 44s).
   */
  generateInstructions(): void {
    super.generateInstructions();
    const styleProfile = this.getTabMarkdown_(Constants.TAB_NAMES.STYLE_PROFILE);
    this.assertStyleProfileValid_(styleProfile);
    const existing = this.getTabMarkdown_(Constants.TAB_NAMES.GENERAL_PURPOSE_INSTRUCTIONS);

    const lastGenerated = this.readLastGeneratedInstructions_(Constants.TAB_NAMES.GENERAL_PURPOSE_INSTRUCTIONS);
    const userPrompt = this.generateInstructionPrompt({
      styleProfile,
      existingInstructions: existing,
      lastGenerated,
    });

    // Use plain-text Gemini call — no JSON schema — to avoid parse errors on
    // long markdown responses. The raw response IS the proposed_full_text.
    const rawText = this.callGemini_(
      this.SYSTEM_PROMPT,
      userPrompt,
      { tier: Constants.MODEL.FAST }
    ) as string;

    // Guard: strip JSON wrapper if the LLM ignores the "plain markdown" instruction.
    const proposedText = extractMarkdownFromJsonWrapper(rawText);

    const update: RootUpdate = {
      workflow_type: 'instruction_update',
      review_tab: Constants.TAB_NAMES.GENERAL_PURPOSE_INSTRUCTIONS,
      proposed_full_text: proposedText,
    };

    CollaborationService.processUpdate(update);
    this.evaluateInstructions(proposedText);
  }
}
