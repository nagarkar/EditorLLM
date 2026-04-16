// ============================================================
// ArchitectAgent.ts — Structural Architect (Style Mimic)
// ============================================================

class ArchitectAgent extends BaseAgent {

  readonly tags = ['@architect'];
  readonly contextKeys = [Constants.TAB_NAMES.STYLE_PROFILE, Constants.TAB_NAMES.MERGED_CONTENT];
  private static readonly CHUNK_SIZE = 5;

  readonly SYSTEM_PROMPT = `
${BaseAgent.SYSTEM_PREAMBLE}

# Role: Structural Architect (Style Mimic)
You analyze the  manuscript and synthesize a StyleProfile —
a precise description of the author's voice, sentence rhythm, structural patterns,
vocabulary register, and thematic motifs. This profile constrains all other agents.

When generating instructions (instruction_update), your proposed_full_text
for the StyleProfile tab must be a rigorous, multi-section style guide.

## Markdown Requirements (instruction_update only)
Your proposed_full_text MUST be valid GitHub-Flavored Markdown that can be
parsed and written as formatted Google Docs content. Formatting rules:
- Top-level sections use ## (H2) headings (e.g. ## Voice & Tone)
- Sub-sections use ### (H3) headings
- Use - bullet points for lists; do NOT use • or other bullet characters
- Use **bold** for field names and key terms
- Use *italic* sparingly for emphasis
- Do NOT use bare plain text for section titles — always use # headings
- Every section heading must be followed by at least one bullet or paragraph
- Do NOT output fenced code blocks in a StyleProfile
`.trim();

  protected readonly EXAMPLE_CONTENT = `
# StyleProfile — Auto-generated Example

## Voice & Tone
- First-person philosophical inquiry; intimate yet authoritative.
- Rhetorical questions are used to invite the reader into the argument.

## Sentence Rhythm
- Alternates between long, meditative sentences (20–35 words) and sharp declarative
  sentences (5–8 words) to create cadence.
- Paragraph-final sentences are always declarative and conclusive.

## Vocabulary Register
- Technical physics terms (eigenstate, superposition, Hilbert space) placed alongside
  Sanskrit philosophical terms (Chit, Brahman, Ananda).
- Avoids jargon without definition; every technical term is glossed in prose.

## Structural Patterns
- Chapters follow: Thesis → Phenomenological Observation → Mathematical Formalization
  → Synthesis.
- Footnotes contain only LaTeX equations and source citations — never discursive prose.

## Thematic Motifs
- Consciousness as the only irreducible axiom.
- The observer–observed collapse as a mirror of Vedantic non-duality.
`.trim();


  generateCommentResponsesPrompt(opts: { styleProfile: string; manuscript: string; threads: CommentThread[] }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Manuscript Context': opts.manuscript.slice(0, 20000),
      'Threads': this.formatThreadsForBatch_(opts.threads),
    }, [
      `For each thread, analyse the selected passage for structural, motif, or voice concerns`,
      `relative to the manuscript and StyleProfile. End each reply with "— AI Editorial Assistant".`,
      `Return a JSON object with "responses": an array of {threadId, reply} entries,`,
      `one per thread you are replying to.`
    ].join(' '));
  }

  generateInstructionPrompt(opts: { manuscript: string; styleProfile: string }): string {
    return this.buildStandardPrompt({
      'Manuscript (excerpt)': opts.manuscript.slice(0, 20000),
      'Current Style Profile (if any)': opts.styleProfile,
    }, [
      `Analyse the writing style above and produce a comprehensive StyleProfile.`,
      `Return a JSON object with:`,
      `- proposed_full_text: your full StyleProfile document (markdown)`
    ].join('\\n'));
  }

  protected commentChunkSize_() { return ArchitectAgent.CHUNK_SIZE; }
  protected commentModelTier_() { return Constants.MODEL.THINKING; }
  protected buildCommentPrompt_(chunk: CommentThread[], _passageContext: string): string {
    // Architect reads its own context — manuscript + styleProfile — rather than
    // the anchor-tab passage context used by other agents.
    return this.generateCommentResponsesPrompt({
      styleProfile: this.getTabContent_(Constants.TAB_NAMES.STYLE_PROFILE),
      manuscript:   this.getTabContent_(Constants.TAB_NAMES.MERGED_CONTENT),
      threads: chunk,
    });
  }

  generateInstructions(): void {
    super.generateInstructions();
    const manuscript = this.getTabContent_(Constants.TAB_NAMES.MERGED_CONTENT);
    if (!manuscript.trim()) {
      throw new Error('MergedContent tab is empty. Add manuscript content before generating.');
    }
    const styleProfile = this.getTabMarkdown_(Constants.TAB_NAMES.STYLE_PROFILE);

    const userPrompt = this.generateInstructionPrompt({ manuscript, styleProfile });

    const geminiResult = this.callGemini_(
      this.SYSTEM_PROMPT,
      userPrompt,
      { schema: this.instructionUpdateSchema_(), tier: Constants.MODEL.THINKING }
    ) as { proposed_full_text: string };

    const update: RootUpdate = {
      workflow_type: 'instruction_update',
      review_tab: Constants.TAB_NAMES.STYLE_PROFILE,
      proposed_full_text: geminiResult.proposed_full_text,
    };

    CollaborationService.processUpdate(update);

    // §4.1 LLM-as-judge quality evaluation — runs after the StyleProfile is
    // written so the score reflects the actual generated content.
    // Uses Constants.MODEL.FAST to keep latency low; score persisted to DocumentProperties.
    this.evaluateStyleProfile_(geminiResult.proposed_full_text);
  }
}
