// ============================================================
// EarTuneAgent.ts — Ear-Tune style and rhythm agent
// ============================================================

class EarTuneAgent extends BaseAgent {

  readonly SYSTEM_PROMPT = `
${SYSTEM_PREAMBLE}

${EARTUNE_SYSTEM_PROMPT_BODY}
`.trim();

  readonly tags = ['@eartune'];
  readonly contextKeys = [Constants.TAB_NAMES.STYLE_PROFILE, Constants.TAB_NAMES.EAR_TUNE, Constants.COMMENT_ANCHOR_TAB];

  private static readonly CHUNK_SIZE = 10;

  protected getAgentId(): string {
    return 'eartune';
  }

  protected getInstructionQualityRubric(): string {
    return EARTUNE_INSTRUCTION_QUALITY_RUBRIC;
  }

  generateCommentResponsesPrompt(opts: { styleProfile: string; earTuneInstructions: string; passageContext: string; threads: CommentThread[] }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Ear-Tune Instructions': opts.earTuneInstructions,
      'Passage Context': opts.passageContext,
      'Threads': this.formatThreadsForBatch_(opts.threads),
    }, EARTUNE_W3_INSTRUCTIONS);
  }

  generateInstructionPrompt(opts: { styleProfile: string; existingEarTune: string; lastGenerated: string }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Manual Innovation Preservation Contract': EARTUNE_MANUAL_INNOVATION_PRESERVATION,
      'Current Ear-Tune Instructions (if any)': opts.existingEarTune,
      'Last Generated Instructions': opts.lastGenerated,
    }, [
      EARTUNE_W1_INSTRUCTIONS,
      W1_FORMAT_GUIDELINES,
    ].join('\n'));
  }

  generateTabAnnotationPrompt(opts: { styleProfile: string; earTuneInstructions: string; passage: string; tabName: string }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Ear-Tune Instructions': opts.earTuneInstructions,
      [W2_PASSAGE_SECTION_TITLE]: opts.passage,
    }, EARTUNE_W2_INSTRUCTIONS);
  }

  protected commentChunkSize_() { return EarTuneAgent.CHUNK_SIZE; }
  protected commentModelTier_() { return Constants.MODEL.FAST; }
  protected buildCommentPrompt_(chunk: CommentThread[], passageContext: string): string {
    return this.generateCommentResponsesPrompt({
      styleProfile:        this.getTabContent_(Constants.TAB_NAMES.STYLE_PROFILE),
      earTuneInstructions: this.getTabContent_(Constants.TAB_NAMES.EAR_TUNE),
      passageContext,
      threads: chunk,
    });
  }

  generateInstructions(): void {
    super.generateInstructions();
    const styleProfile = this.getTabMarkdown_(Constants.TAB_NAMES.STYLE_PROFILE);
    this.assertStyleProfileValid_(styleProfile);
    const existing = this.getTabMarkdown_(Constants.TAB_NAMES.EAR_TUNE);

    const lastGenerated = this.readLastGeneratedInstructions_(Constants.TAB_NAMES.EAR_TUNE);
    const userPrompt = this.generateInstructionPrompt({
      styleProfile,
      existingEarTune: existing,
      lastGenerated,
    });

    // Plain-text Gemini call — no JSON schema — eliminates buffering timeout.
    const rawText = this.callGemini_(
      this.SYSTEM_PROMPT,
      userPrompt,
      { tier: Constants.MODEL.FAST }
    ) as string;

    const proposedText = extractMarkdownFromJsonWrapper(rawText);
    const update: RootUpdate = {
      workflow_type: 'instruction_update',
      review_tab: Constants.TAB_NAMES.EAR_TUNE,
      proposed_full_text: proposedText,
    };

    CollaborationService.processUpdate(update);
    this.evaluateInstructions(proposedText);
  }

  /**
   * Workflow 2: full-tab Ear-Tune sweep.
   * Highlights and comments every passage with rhythmic issues.
   * Clears previous agent annotations on the tab before adding new ones.
   */
  annotateTab(tabName: string): void {
    const agentName = this.constructor.name;
    const passage = this.getTabContent_(tabName);
    if (!passage.trim()) {
      throw new Error(`Tab "${tabName}" is empty. Nothing to Ear-Tune.`);
    }

    const styleProfile = this.getTabContent_(Constants.TAB_NAMES.STYLE_PROFILE);
    this.assertStyleProfileValid_(styleProfile);
    const earTuneInstructions = this.getTabContent_(Constants.TAB_NAMES.EAR_TUNE);

    const userPrompt = this.generateTabAnnotationPrompt({
      styleProfile,
      earTuneInstructions,
      passage,
      tabName,
    });

    const geminiResult = this.callGemini_(
      this.SYSTEM_PROMPT,
      userPrompt,
      { schema: this.annotationSchema_(), tier: Constants.MODEL.FAST }
    ) as { operations: Operation[] };

    const validOps = this.validateAndFilterOperations_(geminiResult.operations, passage, agentName);
    const update: RootUpdate = {
      workflow_type: 'content_annotation',
      target_tab: tabName,
      operations: validOps,
      agent_name: '[EarTune]'
    };

    CollaborationService.processUpdate(update);
  }
}
