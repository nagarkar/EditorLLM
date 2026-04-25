// ============================================================
// PublisherAgent.ts — Publishing metadata, packaging tabs, and structure audit
// ============================================================

class PublisherAgent extends BaseAgent {

  readonly SYSTEM_PROMPT = `
${SYSTEM_PREAMBLE}

${PUBLISHER_SYSTEM_PROMPT_BODY}
`.trim();

  readonly tags = ['@publisher'];
  readonly contextKeys = [Constants.TAB_NAMES.STYLE_PROFILE, Constants.TAB_NAMES.PUBLISHER_INSTRUCTIONS];

  protected readonly tabGenerationParent_ = Constants.TAB_NAMES.PUBLISHER_ROOT;

  protected getAgentId(): string {
    return 'publisher';
  }

  protected getInstructionQualityRubric(): string {
    return PUBLISHER_INSTRUCTION_QUALITY_RUBRIC;
  }

  protected commentChunkSize_() { return 1; }
  protected commentModelTier_() { return Constants.MODEL.THINKING; }
  protected buildCommentPrompt_(_chunk: CommentThread[], _passageContext: string): string {
    throw new Error('PublisherAgent does not handle comment threads.');
  }

  generateInstructionPrompt(opts: {
      styleProfile: string;
      existingInstructions: string;
      manuscript: string;
      lastGenerated: string;
  }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Current Publisher Instructions (if any)': opts.existingInstructions,
      'Last Generated Instructions': opts.lastGenerated,
      'Manuscript Sample': opts.manuscript.slice(0, 20000) || 'NOT PROVIDED',
    }, [
      PUBLISHER_W1_INSTRUCTIONS,
      W1_FORMAT_GUIDELINES,
    ].join('\n'));
  }

  generatePublishingTabsPrompt(opts: {
    styleProfile: string;
    publisherInstructions: string;
    mergedContent: string;
    requestedTabs: string[];
    existingTabContent: Record<string, string>;
  }): string {
    const tabStateLines = [
      'Requested tabs:',
      ...opts.requestedTabs.map(name => `- ${name}`),
      '',
      'Existing publisher tab content (use as preservation guidance; may include author edits):',
      ...PUBLISHER_ALL_OUTPUT_TAB_NAMES.map(name => {
        const value = opts.existingTabContent[name] && opts.existingTabContent[name].trim()
          ? opts.existingTabContent[name]
          : 'EMPTY';
        return `### ${name}\n${value}`;
      }),
    ].join('\n');

    const aboutAuthorTemplate = [
      '## About The Author',
      '- **Short Bio:**',
      '- **Relevant Background:**',
      '- **Why This Author Fits This Book:**',
      '- **Optional Website / Contact Placeholder:**',
    ].join('\n');

    const instructions = [
      'Return a JSON object with `tabs`, where each item contains `tab_name` and `markdown`.',
      `Generate content only for these requested tabs: ${opts.requestedTabs.join(', ')}.`,
      'Do not return any extra tab names.',
      'The markdown for each tab should be ready to write directly into that tab.',
      'For Title: draft a clean title-page tab suitable for front matter.',
      'For Copyright: include placeholders for **ISBN** and **Year**.',
      'For About The Author: use this template structure and fill it as best you can from available context:',
      aboutAuthorTemplate,
      'For Sales: provide 3 distinct sales blurbs aimed at the demographic implied by the StyleProfile.',
      'For Hooks: provide 3 verbatim excerpt candidates from Manuscript. Each option must include the excerpt text, estimated duration, approximate word count, and a short rationale. Hooks must avoid spoilers and explicit language.',
      'For Cover: provide 3 Adobe Express-ready prompt concepts for cover image generation.',
      'Preserve useful existing tab elements when they still fit the current manuscript context, but fully refresh requested tabs when the source material calls for it.',
      'Do not generate Table of Contents in this workflow; it is handled programmatically.',
    ].join('\n');

    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Publisher Instructions': opts.publisherInstructions,
      'Manuscript': opts.mergedContent,
      'Publishing Tab State': tabStateLines,
    }, instructions);
  }

  generateStructuralAuditPrompt(opts: { styleProfile: string; publisherInstructions: string; passage: string }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Publisher Instructions': opts.publisherInstructions,
      [W2_PASSAGE_SECTION_TITLE]: opts.passage,
    }, PUBLISHER_W2_INSTRUCTIONS);
  }

  generateInstructions(): void {
    super.generateInstructions();
    const styleProfile = this.getTabMarkdown_(Constants.TAB_NAMES.STYLE_PROFILE);
    this.assertStyleProfileValid_(styleProfile);
    const existing = this.getTabMarkdown_(Constants.TAB_NAMES.PUBLISHER_INSTRUCTIONS);
    const manuscript = this.getTabContent_(Constants.TAB_NAMES.MANUSCRIPT);
    const lastGenerated = this.readLastGeneratedInstructions_(Constants.TAB_NAMES.PUBLISHER_INSTRUCTIONS);

    const rawText = this.callGemini_(
      this.SYSTEM_PROMPT,
      this.generateInstructionPrompt({
        styleProfile,
        existingInstructions: existing,
        manuscript,
        lastGenerated,
      }),
      { tier: Constants.MODEL.THINKING }
    ) as string;

    const proposedText = extractMarkdownFromJsonWrapper(rawText);
    CollaborationService.processUpdate({
      workflow_type: 'instruction_update',
      review_tab: Constants.TAB_NAMES.PUBLISHER_INSTRUCTIONS,
      proposed_full_text: proposedText,
    });
    this.evaluateInstructions(proposedText);
  }

  generatePublishingTabs(mode: 'all' | 'missing'): {
    requestedTabs: string[];
    writtenTabs: string[];
    missingTabs: string[];
    unexpectedTabs: string[];
  } {
    const styleProfile = this.getTabContent_(Constants.TAB_NAMES.STYLE_PROFILE);
    this.assertStyleProfileValid_(styleProfile);

    const publisherInstructions = this.getTabContent_(Constants.TAB_NAMES.PUBLISHER_INSTRUCTIONS) || this.SYSTEM_PROMPT;
    const mergedContent = this.getTabContent_(Constants.TAB_NAMES.MANUSCRIPT);
    if (!mergedContent.trim()) {
      throw new Error('Manuscript is empty. Nothing to package.');
    }

    const existingTabContent: Record<string, string> = {};
    for (const tabName of PUBLISHER_ALL_OUTPUT_TAB_NAMES) {
      existingTabContent[tabName] = this.getTabContent_(tabName);
    }

    const requestedTabs = determinePublisherTabsToGenerate(mode, existingTabContent);
    if (!requestedTabs.length) {
      return { requestedTabs: [], writtenTabs: [], missingTabs: [], unexpectedTabs: [] };
    }

    const raw = this.callGemini_(
      this.SYSTEM_PROMPT,
      this.generatePublishingTabsPrompt({
        styleProfile,
        publisherInstructions,
        mergedContent,
        requestedTabs,
        existingTabContent,
      }),
      { schema: publisherTabGenerationSchema(requestedTabs), tier: Constants.MODEL.THINKING }
    );

    const validated = validatePublisherTabPayload(raw, requestedTabs);
    if (validated.tabs.length) {
      CollaborationService.processUpdate(
        { workflow_type: 'tab_generation', generated_tabs: validated.tabs },
        { tabGenerationParent: this.tabGenerationParent_ }
      );
    }

    return {
      requestedTabs,
      writtenTabs: validated.tabs.map(t => t.tab_name),
      missingTabs: validated.missing,
      unexpectedTabs: validated.unexpected,
    };
  }

  annotateManuscriptStructure(): void {
    const passage = this.getTabContent_(Constants.TAB_NAMES.MANUSCRIPT);
    if (!passage.trim()) {
      throw new Error('Manuscript is empty. Nothing to audit.');
    }

    const styleProfile = this.getTabContent_(Constants.TAB_NAMES.STYLE_PROFILE);
    this.assertStyleProfileValid_(styleProfile);
    const publisherInstructions = this.getTabContent_(Constants.TAB_NAMES.PUBLISHER_INSTRUCTIONS) || this.SYSTEM_PROMPT;

    const raw = this.callGemini_(
      this.SYSTEM_PROMPT,
      this.generateStructuralAuditPrompt({ styleProfile, publisherInstructions, passage }),
      { schema: this.annotationSchema_(), tier: Constants.MODEL.THINKING }
    ) as { operations: Operation[] };

    const validOps = this.validateAndFilterOperations_(raw.operations ?? [], passage, this.constructor.name);
    CollaborationService.processUpdate({
      workflow_type: 'content_annotation',
      target_tab: Constants.TAB_NAMES.MANUSCRIPT,
      operations: validOps,
      agent_name: '[Publisher]',
    });
  }
}
