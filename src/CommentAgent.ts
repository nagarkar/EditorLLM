// ============================================================
// CommentAgent.ts — @AI catch-all handler for comment threads.
// Also owns the Comment Instructions tab (generateInstructions /
// generateExample). Per-thread routing is handled by CommentProcessor.
// ============================================================

class CommentAgent extends BaseAgent {

  readonly SYSTEM_PROMPT = `
${BaseAgent.SYSTEM_PREAMBLE}

# Role: Comment Agent (Dialogue Responder)
You respond to in-document comment threads that end with "@AI" on behalf of
the editorial AI assistant. 

## Reply Guidelines
Your replies must be:
1. **Directly responsive** — answer the specific question or act on the request.
2. **Voice-consistent** — match the manuscript tone described in the StyleProfile.
3. **Grounded** — cite or reference specific passages from the document when relevant.
4. **Concise** — replies should be 1–3 sentences unless the question demands more depth.
5. **Signed** — always end the reply with "— AI Editorial Assistant".

Never introduce material that contradicts the Chid Axiom or the manuscript's
established metaphysic. If a question cannot be answered within the manuscript's
framework, say so explicitly.

## Markdown Requirements (instruction_update only)
When generating Comment Instructions, your proposed_full_text MUST be valid
GitHub-Flavored Markdown. Rules:
- Use ## (H2) for top-level sections (e.g. ## Response Style, ## Scope, ## Sign-off)
- Use - bullet points for rules within each section
- Use **bold** for rule keywords and important constraints
- Every section must start with a ## heading
- Include an ## Example Thread section with a concrete example exchange
`.trim();

  protected readonly EXAMPLE_CONTENT = `
# Comment Instructions — Example

You are the AI editorial assistant for this manuscript. When a comment thread
ends with "@AI", respond according to these rules:

## Response Style
- Match the author's voice: intimate, philosophically rigorous, unhurried.
- Do not use bullet points in replies — write in prose.
- Keep replies under 60 words unless the query is complex.

## Scope
- Only reference material present in the current document.
- For factual/physics questions, check consistency with the Chid Axiom first.
- For eartuneic suggestions, defer to the StyleProfile tab.

## Sign-off
End every reply with "— AI Editorial Assistant".

## Example Thread
> User: @AI — Is the phrase "the observer collapses probability" accurate here?
> AI: The phrasing is intentional: within the Chid Axiom framework, the
> observer's attention is itself a physical act that resolves superposition.
> A more precise formulation might be "the observer's attending collapses
> the probability amplitude" — but the shorter form is acceptable for
> general readers. — AI Editorial Assistant
`.trim();

  readonly tags = ['@ai'];

  /**
   * CommentAgent groups threads by the tab they are anchored in.
   * COMMENT_ANCHOR_TAB causes CommentProcessor to resolve anchorTabName per
   * thread; the agent then uses that tab's content as shared context per chunk.
   */
  readonly contextKeys = [COMMENT_ANCHOR_TAB, TAB_NAMES.COMMENT_INSTRUCTIONS];

  private static readonly CHUNK_SIZE = 10;

  generateCommentResponsesPrompt(opts: { anchorContent: string; threads: CommentThread[] }): string {
    return this.buildStandardPrompt({
      'Anchor Passage': opts.anchorContent || undefined,
      'Threads': this.formatThreadsForBatch_(opts.threads),
    }, [
      `For each thread, respond to the request concisely and grounded in the passage context.`,
      `End each reply with "— AI Editorial Assistant".`,
      `Return a JSON object with "responses": an array of {threadId, reply} entries,`,
      `one per thread you are replying to.`
    ].join(' '));
  }

  generateInstructionPrompt(opts: { styleProfile: string; existingInstructions: string }): string {
    return this.buildStandardPrompt({
      'Style Profile': opts.styleProfile,
      'Current Comment Instructions (if any)': opts.existingInstructions,
    }, [
      `Generate an updated Comment Instructions system prompt that guides the AI to`,
      `respond to in-document "@AI" comment threads in a voice consistent with this`,
      `manuscript's StyleProfile.`,
      ``,
      `Return a JSON object with:`,
      `- proposed_full_text: the complete new Comment Instructions`
    ].join('\\n'));
  }

  // --- Comment thread batch handler ---

  handleCommentThreads(threads: CommentThread[]): ThreadReply[] {
    const agentName = this.constructor.name;
    Tracer.info(`[${agentName}] handleCommentThreads: received ${threads.length} thread(s)`);

    const instructions = this.getTabContent_(TAB_NAMES.COMMENT_INSTRUCTIONS).trim();
    const systemPrompt = instructions || this.SYSTEM_PROMPT;

    // Subgroup by anchorTabName so each chunk shares one passage context.
    const subgroups = new Map<string | null, CommentThread[]>();
    for (const thread of threads) {
      const key = thread.anchorTabName;
      if (!subgroups.has(key)) subgroups.set(key, []);
      subgroups.get(key)!.push(thread);
    }

    Tracer.info(`[${agentName}] handleCommentThreads: ${subgroups.size} subgroup(s) by anchor tab`);

    const allReplies: ThreadReply[] = [];

    for (const [anchorTabName, subThreads] of subgroups) {
      const anchorContent = anchorTabName
        ? this.getTabContent_(anchorTabName)
        : '';

      for (let i = 0; i < subThreads.length; i += CommentAgent.CHUNK_SIZE) {
        const chunk = subThreads.slice(i, i + CommentAgent.CHUNK_SIZE);
        const chunkNum = Math.floor(i / CommentAgent.CHUNK_SIZE) + 1;
        Tracer.info(
          `[${agentName}] handleCommentThreads: anchor=${anchorTabName ?? '(none)'} ` +
          `chunk ${chunkNum} size=${chunk.length}`
        );

        try {
          const userPrompt = this.generateCommentResponsesPrompt({
            anchorContent,
            threads: chunk,
          });
          const raw = this.callGemini_(systemPrompt, userPrompt, this.batchReplySchema_(), MODEL.FAST);
          const replies = this.normaliseBatchReplies_(chunk, raw, agentName);
          allReplies.push(...replies);
        } catch (e: any) {
          Tracer.error(`[${agentName}] handleCommentThreads: chunk ${chunkNum} failed — ${e.message}`);
        }
      }
    }

    Tracer.info(`[${agentName}] handleCommentThreads: returning ${allReplies.length} reply/replies`);
    return allReplies;
  }

  // --- Instruction management ---

  /**
   * Refreshes the Comment Instructions tab via instruction_update.
   * The new prompt is informed by the current StyleProfile.
   */
  generateInstructions(): void {
    // W1: read instruction tabs as markdown for clean structured context
    const styleProfile = this.getTabMarkdown_(TAB_NAMES.STYLE_PROFILE);
    const existing = this.getTabMarkdown_(TAB_NAMES.COMMENT_INSTRUCTIONS);

    const userPrompt = this.generateInstructionPrompt({
      styleProfile,
      existingInstructions: existing,
    });

    const geminiResult = this.callGemini_(
      this.SYSTEM_PROMPT,
      userPrompt,
      this.instructionUpdateSchema_(),
      MODEL.FAST
    ) as { proposed_full_text: string };

    const update: RootUpdate = {
      workflow_type: 'instruction_update',
      review_tab: TAB_NAMES.COMMENT_INSTRUCTIONS,
      proposed_full_text: geminiResult.proposed_full_text,
    };

    CollaborationService.processUpdate(update);
  }

  /**
   * Writes example Comment Instructions to the Comment Instructions tab.
   */
  generateExample(): void {
    DocOps.ensureStandardTabs();
    MarkdownService.markdownToTab(
      this.EXAMPLE_CONTENT,
      TAB_NAMES.COMMENT_INSTRUCTIONS,
      TAB_NAMES.AGENTIC_INSTRUCTIONS
    );
  }
}
