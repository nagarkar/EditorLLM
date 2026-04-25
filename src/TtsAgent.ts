// ============================================================
// TtsAgent.ts
// ============================================================

class TtsAgent extends BaseAgent {
  private static readonly CAST_ROLE_POLICY_HEADING = '## Cast Role Policy (do not delete)';

  readonly SYSTEM_PROMPT = `
${SYSTEM_PREAMBLE}

${TTS_SYSTEM_PROMPT_BODY}
`.trim();

  readonly tags = ['@tts'];
  readonly contextKeys = [Constants.TAB_NAMES.STYLE_PROFILE, Constants.TAB_NAMES.TTS_INSTRUCTIONS, Constants.COMMENT_ANCHOR_TAB];

  private static readonly CHUNK_SIZE = 5;

  protected getAgentId(): string {
    return 'tts';
  }

  protected getInstructionQualityRubric(): string {
    return TTS_INSTRUCTION_QUALITY_RUBRIC;
  }

  generateCommentResponsesPrompt(opts: { styleProfile: string; ttsInstructions: string; passageContext: string; threads: CommentThread[] }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'TTS Instructions': opts.ttsInstructions,
      'Passage Context': opts.passageContext,
      'Threads': this.formatThreadsForBatch_(opts.threads),
    }, 'Reply to the TTS comment threads.'); // W3 instructions can be basic or we skip it
  }

  generateInstructionPrompt(opts: {
    styleProfile: string;
    existingTts: string;
    manuscript: string;
    lastGenerated: string;
    cachedVoiceRegistry: string;
  }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Current TTS Instructions (if any)': opts.existingTts,
      'Last Generated Instructions': opts.lastGenerated,
      'Manuscript Sample': opts.manuscript.slice(0, 20000) || 'NOT PROVIDED',
      'Cached ElevenLabs Voice Registry (voice_name => voice_id)': opts.cachedVoiceRegistry,
    }, [
      TTS_W1_INSTRUCTIONS,
      TTS_CAST_ROLE_POLICY_SCHEMA,
      W1_FORMAT_GUIDELINES,
    ].join('\n'));
  }

  generateTabAnnotationPrompt(opts: { styleProfile: string; ttsInstructions: string; passage: string; tabName: string }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'TTS Instructions': opts.ttsInstructions,
      [W2_PASSAGE_SECTION_TITLE]: opts.passage,
    }, TTS_W2_INSTRUCTIONS);
  }

  protected commentChunkSize_() { return TtsAgent.CHUNK_SIZE; }
  protected commentModelTier_() { return Constants.MODEL.FAST; }
  protected buildCommentPrompt_(chunk: CommentThread[], passageContext: string): string {
    return this.generateCommentResponsesPrompt({
      styleProfile:    this.getTabContent_(Constants.TAB_NAMES.STYLE_PROFILE),
      ttsInstructions: this.getTabContent_(Constants.TAB_NAMES.TTS_INSTRUCTIONS),
      passageContext,
      threads: chunk,
    });
  }

  private getCachedVoiceRegistryForPrompt_(): string {
    try {
      if (typeof ElevenLabsService === 'undefined' || !ElevenLabsService.getVoiceMappings) {
        return 'NOT PROVIDED';
      }
      const mappings = ElevenLabsService.getVoiceMappings();
      if (!mappings) return 'NOT PROVIDED';
      const pairs = Object.entries(mappings)
        .filter(([voiceId, voiceName]) => !!voiceId && !!voiceName)
        .sort((a, b) => {
          const nameCompare = String(a[1]).localeCompare(String(b[1]));
          return nameCompare !== 0 ? nameCompare : String(a[0]).localeCompare(String(b[0]));
        });
      if (!pairs.length) return 'NOT PROVIDED';
      return pairs.map(([voiceId, voiceName]) => `- ${voiceName} => ${voiceId}`).join('\n');
    } catch (_) {
      return 'NOT PROVIDED';
    }
  }

  private assertCastRolePolicyPresent_(markdown: string): void {
    const headingPattern = new RegExp(
      `^${TtsAgent.CAST_ROLE_POLICY_HEADING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`,
      'm'
    );
    if (!headingPattern.test(markdown)) {
      throw new Error(
        `TTS instruction generation failed: missing required section "${TtsAgent.CAST_ROLE_POLICY_HEADING}".`
      );
    }
  }

  generateInstructions(): void {
    super.generateInstructions();
    const styleProfile = this.getTabMarkdown_(Constants.TAB_NAMES.STYLE_PROFILE);
    this.assertStyleProfileValid_(styleProfile);

    const existing = this.getTabMarkdown_(Constants.TAB_NAMES.TTS_INSTRUCTIONS);
    const manuscript = this.getTabContent_(Constants.TAB_NAMES.MANUSCRIPT).slice(0, 20000);
    const cachedVoiceRegistry = this.getCachedVoiceRegistryForPrompt_();

    const lastGenerated = this.readLastGeneratedInstructions_(Constants.TAB_NAMES.TTS_INSTRUCTIONS);

    const userPrompt = this.generateInstructionPrompt({
      styleProfile,
      existingTts: existing,
      manuscript,
      lastGenerated,
      cachedVoiceRegistry,
    });

    const rawText = this.callGemini_(
      this.SYSTEM_PROMPT,
      userPrompt,
      { tier: Constants.MODEL.FAST } 
    ) as string;

    const proposedText = extractMarkdownFromJsonWrapper(rawText);
    this.assertCastRolePolicyPresent_(proposedText);
    const update: RootUpdate = {
      workflow_type: 'instruction_update',
      review_tab: Constants.TAB_NAMES.TTS_INSTRUCTIONS,
      proposed_full_text: proposedText,
    };

    CollaborationService.processUpdate(update);
    this.evaluateInstructions(proposedText);
  }

  annotateTab(tabName: string): void {
    const passage = this.getTabContent_(tabName);
    if (!passage.trim()) {
      throw new Error(`Tab "${tabName}" is empty. Nothing to process.`);
    }

    const styleProfile = this.getTabContent_(Constants.TAB_NAMES.STYLE_PROFILE);
    this.assertStyleProfileValid_(styleProfile);
    const ttsInstructions = this.getTabContent_(Constants.TAB_NAMES.TTS_INSTRUCTIONS);

    const userPrompt = this.generateTabAnnotationPrompt({
      styleProfile,
      ttsInstructions,
      passage,
      tabName,
    });

    const geminiResult = this.callGemini_(
      this.SYSTEM_PROMPT,
      userPrompt,
      { schema: ttsDirectivesSchema(), tier: Constants.MODEL.FAST } 
    ) as { operations: TtsOperation[] };

    const operations = geminiResult.operations ?? [];
    const normPassage = passage.replace(/\s+/g, ' ').toLowerCase();
    const validOps = operations.filter(op => {
      if (!op.match_text) return false;
      const normText = op.match_text.replace(/\s+/g, ' ').toLowerCase();
      return normPassage.includes(normText);
    });

    // Sort by document position then deduplicate consecutive identical TTS params.
    // Logic extracted to agentHelpers.deduplicateTtsOps for testability.
    const deduplicatedOps = deduplicateTtsOps(passage, validOps);
    Tracer.info(
      `[TtsAgent] annotateTab: ${validOps.length} valid op(s) → ` +
      `${deduplicatedOps.length} after dedup (${validOps.length - deduplicatedOps.length} skipped)`
    );

    const update: RootUpdate = {
      workflow_type: 'bookmark_directives',
      target_tab: tabName,
      directives: deduplicatedOps.map(op => ({
        match_text: op.match_text,
        type: 'tts',
        payload: {
          tts_model: op.tts_model,
          voice_id: op.voice_id,
          stability: op.stability,
          similarity_boost: op.similarity_boost,
        },
      })),
      agent_name: '[TtsAgent]'
    };

    CollaborationService.processUpdate(update);
  }
}
