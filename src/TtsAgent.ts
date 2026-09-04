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

    // Normalise multi-line match_text down to the first non-empty line so
    // body.findText() succeeds — that API does not span paragraph boundaries.
    // Log when truncation actually changes the value so the cause is visible.
    let multiLineFixes = 0;
    const normalizedMatchOps = operations.map(op => {
      if (!op.match_text) return op;
      const single = firstLineForMatchText(op.match_text);
      if (single !== op.match_text) {
        multiLineFixes++;
        return { ...op, match_text: single };
      }
      return op;
    });
    if (multiLineFixes) {
      Tracer.info(`[TtsAgent] annotateTab: collapsed multi-line match_text on ${multiLineFixes} op(s) to first paragraph`);
    }

    // Reject ops with too-short match_text.  Strings like "---", "* * *",
    // single words, and other punctuation-only patterns are not unique
    // enough to resolve to a stable offset — body.findText() returns the
    // FIRST occurrence in the document, so multiple ops anchored on the
    // same short string all collapse onto a single offset and stack on
    // top of each other (last-write-wins for voice).  Drop them with a
    // visible Tracer log so the failed-op count gives the LLM a feedback
    // signal even before the prompt-side rules catch up.
    const MIN_MATCH_TEXT_CHARS = 5;
    let droppedShortCount = 0;
    const droppedShortSamples: string[] = [];
    const lengthFilteredOps = normalizedMatchOps.filter(op => {
      const trimmed = (op.match_text || '').trim();
      if (trimmed.length < MIN_MATCH_TEXT_CHARS) {
        droppedShortCount++;
        if (droppedShortSamples.length < 5) droppedShortSamples.push(JSON.stringify(trimmed));
        return false;
      }
      return true;
    });
    if (droppedShortCount > 0) {
      Tracer.warn(
        `[TtsAgent] annotateTab: dropped ${droppedShortCount} op(s) with match_text shorter than ` +
        `${MIN_MATCH_TEXT_CHARS} chars — these would collapse onto a single offset (e.g. ${droppedShortSamples.join(', ')})`
      );
    }

    const normPassage = passage.replace(/\s+/g, ' ').toLowerCase();
    const validOps = lengthFilteredOps.filter(op => {
      if (!op.match_text) return false;
      const normText = op.match_text.replace(/\s+/g, ' ').toLowerCase();
      return normPassage.includes(normText);
    });

    // Apply project defaults for stability / similarity_boost when the LLM
    // emits 0 / null / undefined under strict-schema pressure.  Done BEFORE
    // dedup so 0 and the default value don't survive as "different" ops.
    let stabFixes = 0;
    let simFixes  = 0;
    const normalizedOps = validOps.map(op => {
      const { op: fixed, appliedStability, appliedSimilarityBoost } = applyTtsOperationDefaults(op);
      if (appliedStability) stabFixes++;
      if (appliedSimilarityBoost) simFixes++;
      return fixed;
    });
    if (stabFixes || simFixes) {
      Tracer.info(
        `[TtsAgent] annotateTab: applied defaults — stability on ${stabFixes} op(s), ` +
        `similarity_boost on ${simFixes} op(s) (LLM emitted 0/null)`
      );
    }

    // Sort by document position then deduplicate consecutive identical TTS params.
    // Logic extracted to agentHelpers.deduplicateTtsOps for testability.
    const deduplicatedOps = deduplicateTtsOps(passage, normalizedOps);
    Tracer.info(
      `[TtsAgent] annotateTab: ${validOps.length} valid op(s) → ` +
      `${deduplicatedOps.length} after dedup (${validOps.length - deduplicatedOps.length} skipped)`
    );

    const directives: DirectiveCreate[] = deduplicatedOps.map(op => ({
      match_text: op.match_text,
      type: 'tts',
      payload: {
        tts_model: op.tts_model,
        voice_id: op.voice_id,
        stability: op.stability,
        similarity_boost: op.similarity_boost,
      },
    }));

    // Heading breaks: walk paragraphs and emit one break per heading-adjacent
    // boundary with per-level duration (H1=3.25s, H2=2.25s, H3+=1.25s).
    // Adjacent headings collapse to a single break with the smaller duration.
    const headingBreaks = this.buildHeadingBreakDirectives_(tabName);
    if (headingBreaks.length) {
      directives.push(...headingBreaks);
      Tracer.info(`[TtsAgent] annotateTab: appended ${headingBreaks.length} heading break(s)`);
    }

    // Ellipsis breaks: always emit both ASCII "..." and Unicode "…" — if the
    // tab contains neither, CollaborationService logs benign warnings and
    // moves on.  No passage scan needed.
    directives.push(...buildEllipsisBreakDirectives());
    Tracer.info('[TtsAgent] annotateTab: appended 1s ellipsis-break directives ("..." and "…", every_occurrence)');

    const update: RootUpdate = {
      workflow_type: 'bookmark_directives',
      target_tab: tabName,
      directives,
      agent_name: '[TtsAgent]'
    };

    CollaborationService.processUpdate(update);
  }

  // ── Heading-break injection ──────────────────────────────────────────────
  // GAS-dependent paragraph walk; pure boundary logic lives in agentHelpers.

  /**
   * Maps a Google Docs ParagraphHeading enum value to a numeric level (1-6),
   * or null when the paragraph is not a heading (NORMAL/TITLE/SUBTITLE).
   * TITLE and SUBTITLE are intentionally excluded — they typically appear
   * once per document and are handled by the wrapper auto-2s silence in
   * elevenLabsTextToSpeechFromDirectives.
   */
  private headingLevelFor_(heading: GoogleAppsScript.Document.ParagraphHeading): number | null {
    switch (heading) {
      case DocumentApp.ParagraphHeading.HEADING1: return 1;
      case DocumentApp.ParagraphHeading.HEADING2: return 2;
      case DocumentApp.ParagraphHeading.HEADING3: return 3;
      case DocumentApp.ParagraphHeading.HEADING4: return 4;
      case DocumentApp.ParagraphHeading.HEADING5: return 5;
      case DocumentApp.ParagraphHeading.HEADING6: return 6;
      default: return null;
    }
  }

  /**
   * Walks the tab body, identifies headings and their adjacent boundaries,
   * and returns one break DirectiveCreate per heading-adjacent paragraph
   * boundary.  Per-boundary duration:
   *   - both sides headings → min(level durations)  [adjacent headings]
   *   - one side heading    → that level's duration
   *
   * `match_text` for each directive is the first non-empty line of the
   * paragraph the break anchors to (i.e. the paragraph AFTER the boundary),
   * truncated to HEADING_MATCH_TEXT_MAX_CHARS.  firstLineForMatchText is
   * applied first because Body.findText cannot span line breaks.
   */
  private buildHeadingBreakDirectives_(tabName: string): DirectiveCreate[] {
    const docTab = DocOps.getTabByName(tabName);
    if (!docTab) return [];

    const body = docTab.getBody();
    const numChildren = body.getNumChildren();
    const paras: Array<{ level: number | null; text: string }> = [];

    for (let i = 0; i < numChildren; i++) {
      const child = body.getChild(i);
      if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) {
        paras.push({ level: null, text: '' });
        continue;
      }
      const para = child.asParagraph();
      paras.push({
        level: this.headingLevelFor_(para.getHeading()),
        text: para.getText(),
      });
    }

    const boundaries = computeHeadingBreakBoundaries(paras.map(p => p.level));
    const out: DirectiveCreate[] = [];
    for (const b of boundaries) {
      const para = paras[b.atParagraphIndex];
      const matchText = firstLineForMatchText(para.text).slice(0, HEADING_MATCH_TEXT_MAX_CHARS).trim();
      if (!matchText) continue;
      out.push({
        match_text: matchText,
        type: 'break',
        payload: { timeMs: b.durationMs },
        apply_to: 'first_occurrence',
      });
    }
    return out;
  }
}
