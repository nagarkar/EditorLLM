// ============================================================
// BaseAgent.ts — Abstract base class for all EditorLLM agents
// ============================================================

abstract class BaseAgent {
  // Every instance self-registers so callers can use getAllAgents() and
  // clearAllAgentCaches() without maintaining explicit agent lists elsewhere.
  private static registry_: BaseAgent[] = [];

  /**
   * Optional per-instance model overrides.
   *
   * Production (Code.ts) creates agents with no args → uses script properties
   * and DEFAULT_MODELS as usual.
   *
   * Tests (or custom UI flows) can inject cheaper/different models:
   *   new ArchitectAgent({ thinking: 'gemini-2.5-flash' })
   *
   * Any tier not specified here falls through to the normal GeminiService
   * resolution chain (script properties → DEFAULT_MODELS).
   */
  private modelConfig_: ModelConfig;

  constructor(modelConfig: ModelConfig = {}) {
    this.modelConfig_ = modelConfig;
    BaseAgent.registry_.push(this);
  }

  /** Returns a snapshot of every registered agent instance. */
  static getAllAgents(): BaseAgent[] {
    return BaseAgent.registry_.slice();
  }

  /** Clears the tab-content cache on every registered agent. */
  static clearAllAgentCaches(): void {
    for (const agent of BaseAgent.registry_) {
      agent.clearCache();
    }
  }

  // --- Shared Prompts & Formats ---

  protected static readonly SYSTEM_PREAMBLE = `
# EditorLLM Context

You are operating inside EditorLLM, an AI-augmented workspace for
high-fidelity book editing. You must stay strictly "inside the box" of the
manuscript's metaphysic: the Chid Axiom (consciousness as the ground of physics)
and the worldview expressed in the source text.

## Core Rules
- **Recursive Instruction Loop:** You are often refining existing instructions.
  Incorporate and improve upon any "Current Instructions" provided in the
  context. Do not "forget" established rules or voice constraints unless they
  explicitly contradict the newly provided manuscript context.
- **No External Metaphors:** Never introduce ideas, metaphors, or concepts that are not already present in the MergedContent source material.
- **Ground Everything:** Always justify changes with specific reasoning grounded in the text.
- **Strict Schema:** Your JSON output must exactly match the provided schema.

## Comment Length Constraint
Google Drive comments have a hard limit of approximately 4 096 characters per
entry. Each annotation comment is formatted as:
  [AgentName] "match_text": <your reason>: <bookmark URL>
The prefix, quoted match text, and bookmark URL together consume roughly
200 characters, leaving **at most ~3 900 characters** for your reason text.

- **Annotation reasons (W2):** Keep each \`reason\` field under **400 characters**.
  Be specific but concise — one crisp sentence identifying the issue and the
  suggested fix is ideal.
- **Comment-thread replies (W3):** Keep each \`reply\` field under **3 500 characters**.
  If a thorough answer needs more space, summarise the key point first and
  invite the author to ask follow-up questions.
`.trim();

  // --- Per-instance cache ---

  protected cache_: { [tabName: string]: string } = {};

  protected getTabContent_(tabName: string): string {
    if (this.cache_[tabName] !== undefined) return this.cache_[tabName];
    const content = DocOps.getTabContent(tabName);
    if (!content.trim()) {
      Tracer.warn(`[${this.constructor.name}] getTabContent_: tab "${tabName}" is empty or missing`);
    }
    this.cache_[tabName] = content;
    return content;
  }

  /**
   * Reads a tab as Markdown (for W1 generateInstructions context).
   * Converts the tab's formatted Google Docs content back to a markdown string
   * so the model receives a clean, structured representation of instruction tabs.
   * Use this only for instruction tabs (StyleProfile, EarTune, etc.) — NOT for
   * manuscript tabs (W2/W3 must use getTabContent_ for plain text).
   */
  protected getTabMarkdown_(tabName: string): string {
    const cacheKey = `__md__${tabName}`;
    if (this.cache_[cacheKey] !== undefined) return this.cache_[cacheKey];
    const content = MarkdownService.tabToMarkdown(tabName);
    if (!content.trim()) {
      Tracer.warn(`[${this.constructor.name}] getTabMarkdown_: tab "${tabName}" is empty or missing`);
    }
    this.cache_[cacheKey] = content;
    return content;
  }

  clearCache(): void {
    this.cache_ = {};
  }

  // --- Gemini call wrapper (logs context + timing) ---

  /**
   * Unified Gemini call with optional JSON-schema enforcement.
   *
   * - Pass `schema` → response is parsed as JSON and returned as `any`.
   * - Omit `schema`  → response is returned as a plain `string`
   *   (use for instruction-generation calls that return markdown).
   *
   * Both code paths share identical logging and timing so traces are
   * consistent regardless of the response mode.
   */
  protected callGemini_(
    systemPrompt: string,
    userPrompt: string,
    opts: { schema?: object; tier?: ModelTier } = {}
  ): any {
    const { schema, tier = MODEL.FAST } = opts;
    const name = this.constructor.name;
    const modelOverride = this.modelConfig_[tier as keyof ModelConfig];
    const mode = schema ? 'json' : 'text';
    Tracer.info(`[${name}] Gemini ${mode} call  tier=${tier}${modelOverride ? ` model=${modelOverride}` : ''}`);
    Tracer.info(`[${name}]   user: "${userPrompt.slice(0, 200).replace(/\n/g, ' ')}…"`);
    const t0 = Date.now();
    try {
      const result = GeminiService.generate(systemPrompt, userPrompt, tier, { schema, modelOverride });
      const suffix = typeof result === 'string' ? ` (${result.length} chars)` : '';
      Tracer.info(`[${name}] Gemini ${mode} done  ${Date.now() - t0}ms${suffix}`);
      return result;
    } catch (e: any) {
      Tracer.error(`[${name}] Gemini ${mode} FAILED ${Date.now() - t0}ms — ${e.message}`);
      throw e;
    }
  }

  // --- Comment thread logging helper ---

  protected logCommentThread_(thread: CommentThread, method: string): void {
    const name = this.constructor.name;
    const sel = thread.selectedText.slice(0, 80).replace(/\n/g, ' ');
    const req = thread.agentRequest.slice(0, 120).replace(/\n/g, ' ');
    Tracer.info(`[${name}] ${method}: thread=${thread.threadId} tag=${thread.tag}`);
    Tracer.info(`[${name}]   anchor=${thread.anchorTabName ?? '(none)'}`);
    Tracer.info(`[${name}]   selected="${sel}"`);
    Tracer.info(`[${name}]   request="${req}"`);
  }

  // --- JSON schemas for Gemini calls ---

  /**
   * JSON schema for the Gemini response for instruction_update calls.
   * Agents receive proposed_full_text + operations; they set workflow_type
   * and review_tab themselves before calling CollaborationService.processUpdate.
   */
  protected instructionUpdateSchema_(): object {
    return {
      type: 'object',
      properties: {
        proposed_full_text: { type: 'string' },
      },
      required: ['proposed_full_text'],
    };
  }

  /**
   * JSON schema for the Gemini response for content_annotation calls.
   * Agents receive operations only; they set workflow_type and target_tab
   * themselves before calling CollaborationService.processUpdate.
   */
  protected annotationSchema_(): object {
    return {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              match_text: { type: 'string' },
              reason: { type: 'string' },
            },
            required: ['match_text', 'reason'],
          },
        },
      },
      required: ['operations'],
    };
  }

  /**
   * Standard JSON schema for batch comment-thread replies.
   * All agents use this for handleCommentThreads() Gemini calls.
   * Pairs with normaliseBatchReplies_() for post-processing.
   */
  protected batchReplySchema_(): object {
    return {
      type: 'object',
      properties: {
        responses: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              threadId: { type: 'string' },
              reply: { type: 'string' },
            },
            required: ['threadId', 'reply'],
          },
        },
      },
      required: ['responses'],
    };
  }

  /**
   * Validates and normalises raw Gemini batch output into ThreadReply[].
   *
   * Validation rules (all violations are logged and dropped, never thrown):
   *   - drop items with missing or empty threadId / reply
   *   - drop threadIds not present in the input chunk (hallucinations)
   *   - drop duplicate threadIds (keep first occurrence)
   *
   * Missing coverage (Gemini did not reply to every input thread) is tolerated.
   */
  protected normaliseBatchReplies_(
    threads: CommentThread[],
    raw: any,
    agentName: string
  ): ThreadReply[] {
    const validIds = new Set(threads.map(t => t.threadId));
    const seen = new Set<string>();
    const replies: ThreadReply[] = [];

    const items: Array<{ threadId: string; reply: string }> =
      Array.isArray(raw?.responses) ? raw.responses : [];

    for (const item of items) {
      if (!item.threadId || !item.reply?.trim()) {
        Tracer.warn(
          `[${agentName}] normaliseBatchReplies_: dropping item with missing or empty threadId/reply`
        );
        continue;
      }
      if (!validIds.has(item.threadId)) {
        Tracer.warn(
          `[${agentName}] normaliseBatchReplies_: dropping hallucinated threadId=${item.threadId}`
        );
        continue;
      }
      if (seen.has(item.threadId)) {
        Tracer.warn(
          `[${agentName}] normaliseBatchReplies_: dropping duplicate threadId=${item.threadId}`
        );
        continue;
      }
      seen.add(item.threadId);
      replies.push({ threadId: item.threadId, content: item.reply });
    }

    Tracer.info(
      `[${agentName}] normaliseBatchReplies_: ` +
      `${replies.length} valid / ${threads.length} input threads`
    );
    return replies;
  }

  /**
   * Guards every workflow that *consumes* StyleProfile.
   * Throws with a user-facing message if the StyleProfile tab is missing,
   * empty, or too short to have been generated by ArchitectAgent.
   *
   * Call this immediately after reading StyleProfile in W1 / W2. W3 paths
   * already degrade gracefully per-chunk, so the guard is optional there.
   *
   * Threshold: 200 chars. A real StyleProfile (multiple ## sections with
   * bullet points) always exceeds this; an un-generated or accidentally
   * cleared tab never does.
   */
  protected assertStyleProfileValid_(content: string): void {
    if (!content.trim() || content.trim().length < 200) {
      throw new Error(
        '[EditorLLM] StyleProfile is empty or incomplete (< 200 chars). ' +
        'Run "Architect → Generate Instructions" before this workflow.'
      );
    }
  }

  // ── §4.1 LLM-as-judge quality scorer ───────────────────────────────────────

  /**
   * JSON schema for the fast-tier StyleProfile quality evaluation call.
   * score: 0–5 integer. rationale: one sentence explaining the score.
   */
  private evalScoreSchema_(): object {
    return {
      type: 'object',
      properties: {
        score:     { type: 'integer' },
        rationale: { type: 'string' },
      },
      required: ['score', 'rationale'],
    };
  }

  /**
   * LLM-as-judge quality evaluation for ArchitectAgent output.
   *
   * Calls a fast-tier Gemini instance with a 0–5 rubric after the StyleProfile
   * is written. The result is persisted to DocumentProperties so the sidebar
   * can surface the score without an extra Gemini call.
   *
   * Score bands:
   *   5 — all 5 canonical sections present, ≥ 2 bullets each, 500+ chars
   *   4 — 5 sections, some thin (< 2 bullets)
   *   3 — 4 sections, usable — downstream agents can run
   *   2 — 3 sections, incomplete
   *   1 — 1–2 sections, barely structured
   *   0 — empty, error, or unable to evaluate
   *
   * Never throws — a failed eval logs a warning and returns score 0 so the
   * caller can still decide whether to proceed.
   */
  protected evaluateStyleProfile_(styleProfile: string): { score: number; rationale: string } {
    const EVAL_SYSTEM = `You are a style-guide quality evaluator. Respond ONLY with the JSON schema provided.`;
    const EVAL_USER = `Rate the following StyleProfile on a scale of 0–5.

Rubric:
  5 = All 5 required sections (Voice, Sentence Rhythm, Vocabulary Register,
      Structural Patterns, Thematic Motifs) present with ≥ 2 detailed bullets each.
  4 = All 5 sections present, some have fewer than 2 bullets.
  3 = At least 4 sections present; downstream agents can use it productively.
  2 = 3 sections present; noticeably incomplete.
  1 = 1–2 sections; barely structured.
  0 = Empty, incoherent, or clearly not a StyleProfile.

Required sections: Voice, Sentence Rhythm, Vocabulary Register, Structural Patterns, Thematic Motifs.
Return {"score": <integer 0-5>, "rationale": "<one sentence>"}

StyleProfile to evaluate:
---
${styleProfile.slice(0, 4000)}
---`;

    try {
      const result = this.callGemini_(EVAL_SYSTEM, EVAL_USER, { schema: this.evalScoreSchema_(), tier: MODEL.FAST }) as {
        score: number;
        rationale: string;
      };
      const score     = Math.max(0, Math.min(5, Math.round(result.score ?? 0)));
      const rationale = (result.rationale ?? '').slice(0, 300);
      Tracer.info(`[${this.constructor.name}] StyleProfile eval score=${score} — ${rationale}`);
      PropertiesService.getDocumentProperties().setProperties({
        STYLE_PROFILE_SCORE:     String(score),
        STYLE_PROFILE_RATIONALE: rationale,
        STYLE_PROFILE_EVAL_TS:   new Date().toISOString(),
      });
      return { score, rationale };
    } catch (e: any) {
      Tracer.warn(`[${this.constructor.name}] StyleProfile eval failed — ${e.message}`);
      return { score: 0, rationale: 'Evaluation failed: ' + e.message };
    }
  }

  /**
   * Post-processes raw W2 annotation operations before they reach
   * CollaborationService.processUpdate. Silently drops (and logs) any op
   * that would cause a placement failure at the Drive/Docs layer:
   *
   *   - empty match_text or reason
   *   - match_text not found verbatim in the annotated passage
   *     (hallucination guard — mirrors the integration-test grounding check)
   *
   * Never throws; a fully invalid batch returns []. Callers should log a
   * warning themselves if the filtered slice is unexpectedly empty.
   */
  protected validateAndFilterOperations_(
    operations: Operation[],
    passage: string,
    agentName: string
  ): Operation[] {
    const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const normalizedPassage = normalize(passage);
    const filtered: Operation[] = [];

    for (const op of operations) {
      if (!op.match_text?.trim()) {
        Tracer.warn(`[${agentName}] validateAndFilterOperations_: dropping op — empty match_text`);
        continue;
      }
      if (!op.reason?.trim()) {
        Tracer.warn(`[${agentName}] validateAndFilterOperations_: dropping op — empty reason (match="${op.match_text.slice(0, 60)}")`);
        continue;
      }
      if (!normalizedPassage.includes(normalize(op.match_text))) {
        Tracer.warn(
          `[${agentName}] validateAndFilterOperations_: dropping op — match_text not in passage: ` +
          `"${op.match_text.slice(0, 60)}"`
        );
        continue;
      }
      filtered.push(op);
    }

    Tracer.info(
      `[${agentName}] validateAndFilterOperations_: ` +
      `${filtered.length} valid / ${operations.length} total`
    );
    return filtered;
  }

  /**
   * Formats an array of CommentThreads into the per-thread section of a batch
   * prompt. Each thread is labelled with its threadId so Gemini can map replies.
   */
  protected formatThreadsForBatch_(threads: CommentThread[]): string {
    return threads.map(t => {
      const conv = t.conversation
        .map(m => `**[${m.role}] ${m.authorName}:** ${m.content}`)
        .join('\\n');
      return (
        `### Thread: ${t.threadId}\\n` +
        `**Selected Text:** ${t.selectedText}\\n\\n` +
        `**Conversation:**\\n${conv}\\n\\n` +
        `**Request:** ${t.agentRequest}`
      );
    }).join('\\n\\n');
  }

  /**
   * Constructs a standard Markdown prompt formatted with matching dividers,
   * keeping output consistent structured for all workflows.
   */
  protected buildStandardPrompt(
    sections: Record<string, string | undefined | null>,
    instructions: string
  ): string {
    const formattedParts = Object.entries(sections)
      .map(([title, content]) => `## ${title}\\n\\n${content || '(not provided)'}\\n`);

    return [...formattedParts, `\\n## Instructions\\n\\n${instructions || '(not provided)'}`].join('\\n').trim();
  }

  // --- Prompt Builder Overrides ---

  generateInstructionPrompt(opts: any): string {
    throw new Error(`[${this.constructor.name}] generateInstructionPrompt not implemented.`);
  }

  generateTabAnnotationPrompt(opts: any): string {
    throw new Error(`[${this.constructor.name}] generateTabAnnotationPrompt not implemented.`);
  }

  generateCommentResponsesPrompt(opts: any): string {
    throw new Error(`[${this.constructor.name}] generateCommentResponsesPrompt not implemented.`);
  }

  // --- Abstract interface ---

  /** Lowercase tag strings users write in comments, e.g. ['@eartune', '@eartune'] */
  abstract readonly tags: string[];

  /**
   * Tab names (TAB_NAMES values) this agent reads during comment processing.
   * May also include COMMENT_ANCHOR_TAB sentinel.
   * Used by CommentProcessor for pre-flight validation only — agents still
   * fetch tab content themselves via getTabContent_().
   */
  abstract readonly contextKeys: string[];

  /**
   * Template Method — concrete in the base, NOT overridden by subclasses.
   * Delegates to the shared loop via the three abstract hooks below.
   */
  handleCommentThreads(threads: CommentThread[]): ThreadReply[] {
    return this.handleCommentThreadsLoop_(threads, {
      chunkSize:    this.commentChunkSize_(),
      tier:         this.commentModelTier_(),
      systemPrompt: this.commentSystemPrompt_(),
      buildPrompt:  (chunk, ctx) => this.buildCommentPrompt_(chunk, ctx),
    });
  }

  // ── Abstract hooks ─────────────────────────────────────────────────────────

  /** Number of threads per Gemini call. */
  protected abstract commentChunkSize_(): number;

  /** Model tier for comment thread replies (MODEL.FAST | MODEL.THINKING). */
  protected abstract commentModelTier_(): ModelTier;

  /**
   * Builds the user-turn prompt for a chunk of threads.
   * passageContext is the plain-text body of the anchor tab, or '' if none.
   */
  protected abstract buildCommentPrompt_(
    chunk: CommentThread[],
    passageContext: string
  ): string;

  /**
   * System prompt for comment thread replies.
   * Default: this.SYSTEM_PROMPT (set by each concrete agent).
   * Override only when the system prompt is dynamic (e.g. GeneralPurposeAgent reads
   * a tab at runtime).
   */
  protected commentSystemPrompt_(): string {
    return (this as any).SYSTEM_PROMPT as string ?? '';
  }

  // ── Shared loop (private — subclasses use hooks, not this method) ──────────

  private handleCommentThreadsLoop_(
    threads: CommentThread[],
    opts: {
      chunkSize: number;
      tier: ModelTier;
      buildPrompt: (chunk: CommentThread[], passageContext: string) => string;
      systemPrompt?: string;
    }
  ): ThreadReply[] {
    const agentName = this.constructor.name;
    Tracer.info(`[${agentName}] handleCommentThreads: received ${threads.length} thread(s)`);

    const systemPrompt = opts.systemPrompt ?? '';

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
      const passageContext = anchorTabName ? this.getTabContent_(anchorTabName) : '';

      for (let i = 0; i < subThreads.length; i += opts.chunkSize) {
        const chunk = subThreads.slice(i, i + opts.chunkSize);
        const chunkNum = Math.floor(i / opts.chunkSize) + 1;
        Tracer.info(
          `[${agentName}] handleCommentThreads: anchor=${anchorTabName ?? '(none)'} ` +
          `chunk ${chunkNum} size=${chunk.length}`
        );

        try {
          const userPrompt = opts.buildPrompt(chunk, passageContext);
          const raw = this.callGemini_(systemPrompt, userPrompt, { schema: this.batchReplySchema_(), tier: opts.tier });
          const replies = this.normaliseBatchReplies_(chunk, raw, agentName);
          allReplies.push(...replies);
        } catch (e: any) {
          Tracer.error(
            `[${agentName}] handleCommentThreads: anchor=${anchorTabName ?? '(none)'} ` +
            `chunk ${chunkNum} failed — ${e.message}`
          );
        }
      }
    }

    Tracer.info(`[${agentName}] handleCommentThreads: returning ${allReplies.length} reply/replies`);
    return allReplies;
  }

  protected generateInstructions(): void {
    Tracer.info(`[${this.constructor.name}] generateInstructions: starting — ensureStandardTabs`);
    DocOps.ensureStandardTabs();
  }
}
