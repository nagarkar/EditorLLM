// ============================================================
// AuditAgent.ts — Logical Auditor (Technical Audit)
// ============================================================

class AuditAgent extends BaseAgent {

  readonly SYSTEM_PROMPT = `
${SYSTEM_PREAMBLE}

${AUDIT_SYSTEM_PROMPT_BODY}
`.trim();

  readonly tags = ['@audit', '@auditor'];
  readonly contextKeys = [Constants.TAB_NAMES.STYLE_PROFILE, Constants.TAB_NAMES.TECHNICAL_AUDIT, Constants.COMMENT_ANCHOR_TAB];

  private static readonly CHUNK_SIZE = 5;

  protected getAgentId(): string {
    return 'audit';
  }

  protected getInstructionQualityRubric(): string {
    return AUDIT_INSTRUCTION_QUALITY_RUBRIC;
  }

  generateCommentResponsesPrompt(opts: { styleProfile: string; auditInstructions: string; passageContext: string; threads: CommentThread[] }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Technical Audit Instructions': opts.auditInstructions,
      'Passage Context': opts.passageContext,
      'Threads': this.formatThreadsForBatch_(opts.threads),
    }, AUDIT_W3_INSTRUCTIONS);
  }

  generateInstructionPrompt(opts: { styleProfile: string; existingAudit: string; manuscript: string; lastGenerated: string }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Current Technical Audit Instructions (if any)': opts.existingAudit,
      'Last Generated Instructions': opts.lastGenerated,
      'Manuscript Sample (for principle extraction)': opts.manuscript.slice(0, 20000) || 'NOT PROVIDED',
    }, [
      AUDIT_W1_INSTRUCTIONS,
      W1_FORMAT_GUIDELINES,
    ].join('\n'));
  }

  generateTabAnnotationPrompt(opts: { styleProfile: string; auditInstructions: string; passage: string; tabName: string }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Technical Audit Instructions': opts.auditInstructions,
      [W2_PASSAGE_SECTION_TITLE]: opts.passage,
    }, AUDIT_W2_INSTRUCTIONS);
  }

  protected commentChunkSize_() { return AuditAgent.CHUNK_SIZE; }
  protected commentModelTier_() { return Constants.MODEL.THINKING; }
  protected buildCommentPrompt_(chunk: CommentThread[], passageContext: string): string {
    return this.generateCommentResponsesPrompt({
      styleProfile:      this.getTabContent_(Constants.TAB_NAMES.STYLE_PROFILE),
      auditInstructions: this.getTabContent_(Constants.TAB_NAMES.TECHNICAL_AUDIT),
      passageContext,
      threads: chunk,
    });
  }

  /**
   * Refreshes the TechnicalAudit system prompt via instruction_update.
   * Uses extended thinking (High) to reason carefully about axiom constraints.
   */
  generateInstructions(): void {
    super.generateInstructions();
    // W1: read instruction tabs as markdown; manuscript stays plain text
    const styleProfile = this.getTabMarkdown_(Constants.TAB_NAMES.STYLE_PROFILE);
    this.assertStyleProfileValid_(styleProfile);
    const existing = this.getTabMarkdown_(Constants.TAB_NAMES.TECHNICAL_AUDIT);
    const manuscript = this.getTabContent_(Constants.TAB_NAMES.MANUSCRIPT);

    const lastGenerated = this.readLastGeneratedInstructions_(Constants.TAB_NAMES.TECHNICAL_AUDIT);
    const userPrompt = this.generateInstructionPrompt({
      styleProfile,
      existingAudit: existing,
      manuscript,
      lastGenerated,
    });

    // Plain-text Gemini call — no JSON schema — eliminates buffering timeout.
    const rawText = this.callGemini_(
      this.SYSTEM_PROMPT,
      userPrompt,
      { tier: Constants.MODEL.THINKING }  // Technical reasoning — use thinking model
    ) as string;

    const proposedText = extractMarkdownFromJsonWrapper(rawText);
    const update: RootUpdate = {
      workflow_type: 'instruction_update',
      review_tab: Constants.TAB_NAMES.TECHNICAL_AUDIT,
      proposed_full_text: proposedText,
    };

    CollaborationService.processUpdate(update);
    this.evaluateInstructions(proposedText);
  }

  /**
   * Workflow 2: full-tab technical audit sweep.
   * Highlights and comments every passage with an axiom, LaTeX, or constant issue.
   * Clears previous agent annotations on the tab before adding new ones.
   */
  annotateTab(tabName: string): void {
    const agentName = this.constructor.name;
    const passage = this.getTabContent_(tabName);
    if (!passage.trim()) {
      throw new Error(`Tab "${tabName}" is empty. Nothing to audit.`);
    }

    const styleProfile = this.getTabContent_(Constants.TAB_NAMES.STYLE_PROFILE);
    this.assertStyleProfileValid_(styleProfile);
    const auditInstructions = this.getTabContent_(Constants.TAB_NAMES.TECHNICAL_AUDIT);

    const userPrompt = this.generateTabAnnotationPrompt({
      styleProfile,
      auditInstructions,
      passage,
      tabName,
    });

    const geminiResult = this.callGemini_(
      this.SYSTEM_PROMPT,
      userPrompt,
      { schema: this.annotationSchema_(), tier: Constants.MODEL.THINKING }  // Technical task — thinking model
    ) as { operations: Operation[] };

    const validOps = this.validateAndFilterOperations_(geminiResult.operations, passage, agentName);
    const update: RootUpdate = {
      workflow_type: 'content_annotation',
      target_tab: tabName,
      operations: validOps,
      agent_name: '[Auditor]'
    };

    CollaborationService.processUpdate(update);
  }
}
