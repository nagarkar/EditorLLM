// ============================================================
// GeneralPurposeAgent.ts — GeneralPurposeAgent: @AI catch-all handler.
// Also owns the General Purpose Instructions tab (generateInstructions).
// Per-thread routing is handled by CommentProcessor.
// ============================================================

class GeneralPurposeAgent extends BaseAgent {

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

## Markdown Requirements (instruction generation only)
When generating General Purpose Instructions, return valid
GitHub-Flavored Markdown directly (no JSON wrapper). Rules:
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
   * GeneralPurposeAgent groups threads by the tab they are anchored in.
   * COMMENT_ANCHOR_TAB causes CommentProcessor to resolve anchorTabName per
   * thread; the agent then uses that tab's content as shared context per chunk.
   */
  readonly contextKeys = [COMMENT_ANCHOR_TAB, TAB_NAMES.GENERAL_PURPOSE_INSTRUCTIONS];

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
      'Current General Purpose Instructions (if any)': opts.existingInstructions,
    }, [
      `Generate an updated General Purpose Instructions system prompt that guides the AI to`,
      `respond to in-document "@AI" comment threads in a voice consistent with this`,
      `manuscript's StyleProfile.`,
      ``,
      `Return the complete instructions as plain GitHub-Flavored Markdown, starting directly`,
      `with the first ## heading. Do NOT wrap the response in JSON or any other format.`,
      `Required sections (## H2 headings): ## Response Style, ## Scope, ## Sign-off, ## Example Thread.`,
      `Use - bullet points for rules, **bold** for key constraints.`,
      `Include a concrete example exchange in ## Example Thread using > blockquotes.`,
    ].join('\n'));
  }

  // --- Comment thread batch handler ---

  protected commentChunkSize_() { return GeneralPurposeAgent.CHUNK_SIZE; }
  protected commentModelTier_() { return MODEL.FAST; }
  protected commentSystemPrompt_(): string {
    // Use the tab-authored instructions when present; fall back to the hardcoded SYSTEM_PROMPT.
    const instructions = this.getTabContent_(TAB_NAMES.GENERAL_PURPOSE_INSTRUCTIONS).trim();
    return instructions || this.SYSTEM_PROMPT;
  }
  protected buildCommentPrompt_(chunk: CommentThread[], anchorContent: string): string {
    return this.generateCommentResponsesPrompt({ anchorContent, threads: chunk });
  }

  // --- Instruction management ---

  /**
   * If the LLM ignores the "no JSON wrapper" instruction and returns the
   * markdown inside a JSON code fence (e.g. ```json\n{"markdown":"..."}\n```),
   * extract the markdown value. Returns the original string on any parse
   * failure so callers always receive something usable.
   */
  private static extractMarkdownFromJsonWrapper_(raw: string): string {
    const trimmed = raw.trim();
    // Fast-path: already plain markdown
    if (trimmed.startsWith('#') || !trimmed.startsWith('```')) return trimmed;

    // Strip the opening code fence (```json or ```) and closing ```
    const withoutFence = trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    try {
      const parsed = JSON.parse(withoutFence);
      // Accept a bare string or the first string value under any key name —
      // the LLM uses inconsistent keys ("markdown", "updated_instructions", etc.)
      if (typeof parsed === 'string') return parsed;
      if (parsed && typeof parsed === 'object') {
        for (const val of Object.values(parsed)) {
          if (typeof val === 'string' && (val as string).trim().length > 0) return val as string;
        }
      }
    } catch (_) { /* not JSON — fall through */ }

    return trimmed;
  }

  /**
   * Refreshes the General Purpose Instructions tab.
   * Returns plain markdown directly from Gemini — no JSON schema — to avoid
   * JSON-parse failures on long instruction content (seen with MODEL.FAST at 44s).
   */
  generateInstructions(): void {
    const styleProfile = this.getTabMarkdown_(TAB_NAMES.STYLE_PROFILE);
    this.assertStyleProfileValid_(styleProfile);
    const existing = this.getTabMarkdown_(TAB_NAMES.GENERAL_PURPOSE_INSTRUCTIONS);

    const userPrompt = this.generateInstructionPrompt({
      styleProfile,
      existingInstructions: existing,
    });

    // Use plain-text Gemini call — no JSON schema — to avoid parse errors on
    // long markdown responses. The raw response IS the proposed_full_text.
    const rawText = this.callGemini_(
      this.SYSTEM_PROMPT,
      userPrompt,
      { tier: MODEL.FAST }
    ) as string;

    // Guard: strip JSON wrapper if the LLM ignores the "plain markdown" instruction.
    const proposedText = GeneralPurposeAgent.extractMarkdownFromJsonWrapper_(rawText);

    const update: RootUpdate = {
      workflow_type: 'instruction_update',
      review_tab: TAB_NAMES.GENERAL_PURPOSE_INSTRUCTIONS,
      proposed_full_text: proposedText,
    };

    CollaborationService.processUpdate(update);
  }
}
