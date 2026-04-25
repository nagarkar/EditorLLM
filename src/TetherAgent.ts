// ============================================================
// TetherAgent.ts — External Anchor (source validation & alignment)
// ============================================================

class TetherAgent extends BaseAgent {


  readonly SYSTEM_PROMPT = `${SYSTEM_PREAMBLE}

${TETHER_SYSTEM_PROMPT_BODY}
`.trim();

  readonly tags = ['@tether', '@ref'];
  readonly contextKeys = [Constants.TAB_NAMES.STYLE_PROFILE, Constants.TAB_NAMES.TETHER_INSTRUCTIONS, Constants.COMMENT_ANCHOR_TAB];

  private static readonly CHUNK_SIZE = 5;

  protected getAgentId(): string {
    return 'tether';
  }

  protected getInstructionQualityRubric(): string {
    return TETHER_INSTRUCTION_QUALITY_RUBRIC;
  }

  generateCommentResponsesPrompt(opts: { styleProfile: string; tetherInstructions: string; passageContext: string; threads: CommentThread[] }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Tether Instructions': opts.tetherInstructions,
      'Passage Context': opts.passageContext,
      'Threads': this.formatThreadsForBatch_(opts.threads),
    }, TETHER_W3_INSTRUCTIONS);
  }

  generateInstructionPrompt(opts: { styleProfile: string; existingTether: string; manuscript: string; lastGenerated: string }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Manuscript Sample (for Fact-Checking Context)': opts.manuscript.slice(0, 6000) || 'NOT PROVIDED',
      'Current Tether Instructions (if any)': opts.existingTether,
      'Last Generated Instructions': opts.lastGenerated,
    }, [
      TETHER_W1_INSTRUCTIONS,
      W1_FORMAT_GUIDELINES,
    ].join('\n'));
  }

  generateTabAnnotationPrompt(opts: { styleProfile: string; tetherInstructions: string; passage: string; tabName: string }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Tether Instructions': opts.tetherInstructions,
      [W2_PASSAGE_SECTION_TITLE]: opts.passage,
    }, TETHER_W2_INSTRUCTIONS);
  }

  protected commentChunkSize_() { return TetherAgent.CHUNK_SIZE; }
  protected commentModelTier_() { return Constants.MODEL.THINKING; }
  protected buildCommentPrompt_(chunk: CommentThread[], passageContext: string): string {
    return this.generateCommentResponsesPrompt({
      styleProfile:        this.getTabContent_(Constants.TAB_NAMES.STYLE_PROFILE),
      tetherInstructions:  this.getTabContent_(Constants.TAB_NAMES.TETHER_INSTRUCTIONS),
      passageContext,
      threads: chunk,
    });
  }

  /**
   * Refreshes the TetherInstructions system prompt via instruction_update.
   * Uses extended thinking to reason carefully about historical validation rules.
   */
  generateInstructions(): void {
    super.generateInstructions();
    // W1: read instruction tabs as markdown; manuscript stays plain text
    const styleProfile = this.getTabMarkdown_(Constants.TAB_NAMES.STYLE_PROFILE);
    this.assertStyleProfileValid_(styleProfile);
    const existing = this.getTabMarkdown_(Constants.TAB_NAMES.TETHER_INSTRUCTIONS);
    const manuscript = this.getTabContent_(Constants.TAB_NAMES.MANUSCRIPT);

    const lastGenerated = this.readLastGeneratedInstructions_(Constants.TAB_NAMES.TETHER_INSTRUCTIONS);
    const userPrompt = this.generateInstructionPrompt({
      styleProfile,
      existingTether: existing,
      manuscript,
      lastGenerated,
    });

    // Plain-text Gemini call — no JSON schema — eliminates buffering timeout.
    const rawText = this.callGemini_(
      this.SYSTEM_PROMPT,
      userPrompt,
      { tier: Constants.MODEL.THINKING }
    ) as string;

    const proposedText = extractMarkdownFromJsonWrapper(rawText);
    const update: RootUpdate = {
      workflow_type: 'instruction_update',
      review_tab: Constants.TAB_NAMES.TETHER_INSTRUCTIONS,
      proposed_full_text: proposedText,
    };

    CollaborationService.processUpdate(update);
    this.evaluateInstructions(proposedText);
  }

  /**
   * Workflow 2: full-tab tether validation sweep.
   * Highlights and comments every passage with a reference issue or alignment opportunity.
   * Clears previous agent annotations on the tab before adding new ones.
   */
  annotateTab(tabName: string): void {
    const agentName = this.constructor.name;
    const passage = this.getTabContent_(tabName);
    if (!passage.trim()) {
      throw new Error(`Tab "${tabName}" is empty. Nothing to validate.`);
    }

    const styleProfile = this.getTabContent_(Constants.TAB_NAMES.STYLE_PROFILE);
    this.assertStyleProfileValid_(styleProfile);
    const tetherInstructions = this.getTabContent_(Constants.TAB_NAMES.TETHER_INSTRUCTIONS);

    const userPrompt = this.generateTabAnnotationPrompt({
      styleProfile,
      tetherInstructions,
      passage,
      tabName,
    });

    const geminiResult = this.callGemini_(
      this.SYSTEM_PROMPT,
      userPrompt,
      { schema: this.annotationSchema_(), tier: Constants.MODEL.THINKING }
    ) as { operations: Operation[] };

    const validOps = this.validateAndFilterOperations_(geminiResult.operations, passage, agentName);
    const update: RootUpdate = {
      workflow_type: 'content_annotation',
      target_tab: tabName,
      operations: validOps,
      agent_name: '[Tether]'
    };

    CollaborationService.processUpdate(update);
  }
}
