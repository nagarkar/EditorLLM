// ============================================================
// ArchitectAgent.ts — Structural Architect (Style Mimic)
// ============================================================

class ArchitectAgent extends BaseAgent {

  readonly tags = ['@architect'];
  readonly contextKeys = [TAB_NAMES.STYLE_PROFILE, TAB_NAMES.MERGED_CONTENT];
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

  generateInstructionPrompt(opts: { manuscript: string }): string {
    return this.buildStandardPrompt({
      'Manuscript (excerpt)': opts.manuscript.slice(0, 20000),
    }, [
      `Analyse the writing style above and produce a comprehensive StyleProfile.`,
      `Return a JSON object with:`,
      `- proposed_full_text: your full StyleProfile document (markdown)`
    ].join('\\n'));
  }

  handleCommentThreads(threads: CommentThread[]): ThreadReply[] {
    const agentName = this.constructor.name;
    Tracer.info(`[${agentName}] handleCommentThreads: received ${threads.length} thread(s)`);

    // Shared context is the same for every thread — read once, reuse across chunks.
    const manuscript = this.getTabContent_(TAB_NAMES.MERGED_CONTENT);
    const styleProfile = this.getTabContent_(TAB_NAMES.STYLE_PROFILE);

    const allReplies: ThreadReply[] = [];

    for (let i = 0; i < threads.length; i += ArchitectAgent.CHUNK_SIZE) {
      const chunk = threads.slice(i, i + ArchitectAgent.CHUNK_SIZE);
      const chunkNum = Math.floor(i / ArchitectAgent.CHUNK_SIZE) + 1;
      Tracer.info(`[${agentName}] handleCommentThreads: chunk ${chunkNum} size=${chunk.length}`);

      try {
        const userPrompt = this.generateCommentResponsesPrompt({
          styleProfile,
          manuscript,
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
        Tracer.error(`[${agentName}] handleCommentThreads: chunk ${chunkNum} failed — ${e.message}`);
      }
    }

    Tracer.info(`[${agentName}] handleCommentThreads: returning ${allReplies.length} reply/replies`);
    return allReplies;
  }

  /**
   * Reads MergedContent and generates a full StyleProfile via Gemini.
   * Routes the result to StyleProfile Scratch via instruction_update.
   */
  generateInstructions(): void {
    super.generateInstructions();
    const manuscript = this.getTabContent_(TAB_NAMES.MERGED_CONTENT);
    if (!manuscript.trim()) {
      throw new Error('MergedContent tab is empty. Add manuscript content before generating.');
    }

    const userPrompt = this.generateInstructionPrompt({ manuscript });

    const geminiResult = this.callGemini_(
      this.SYSTEM_PROMPT,
      userPrompt,
      this.instructionUpdateSchema_(),
      MODEL.THINKING
    ) as { proposed_full_text: string };

    const update: RootUpdate = {
      workflow_type: 'instruction_update',
      review_tab: TAB_NAMES.STYLE_PROFILE,
      proposed_full_text: geminiResult.proposed_full_text,
    };

    CollaborationService.processUpdate(update);
  }

  /**
   * Populates MergedContent (only when empty) and StyleProfile Scratch with
   * example content so users can see the expected shape of each tab.
   *
   * MergedContent is the user's manuscript — it is never overwritten when it
   * already has content.  StyleProfile Scratch is a generated artefact and is
   * always safe to refresh with a fresh example.
   */
  generateExample(): void {
    super.generateExample();
    MarkdownService.markdownToTab(
      this.EXAMPLE_CONTENT,
      TAB_NAMES.STYLE_PROFILE,
      TAB_NAMES.AGENTIC_INSTRUCTIONS
    );
  }
}
