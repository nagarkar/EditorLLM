// ============================================================
// BaseAgent.ts — Abstract base class for all EditorLLM agents
// ============================================================

/** Provided by agentHelpers.ts (same GAS bundle, before BaseAgent in filePushOrder). */
declare function runInstructionQualityEval_(args: {
  gemini: (systemPrompt: string, userPrompt: string, opts: { schema: object; tier: ModelTier }) => unknown;
  logTag: string;
  rubricMarkdown: string;
  propKeys: { score: string; rationale: string; ts: string };
  markdown: string;
}): { score: number; rationale: string };

declare function instructionQualityDocumentPropKeysForAgentId_(agentId: string): {
  score: string;
  rationale: string;
  ts: string;
};

abstract class BaseAgent {
  // Every instance self-registers so callers can use getAllAgents() and
  // clearAllAgentCaches() without maintaining explicit agent lists elsewhere.
  private static registry_: BaseAgent[] = [];
  private static currentLlmService_: LlmServiceName = Constants.LLM_SERVICE.GEMINI;
  private static currentLlmClient_: LlmClient = (typeof GeminiService !== 'undefined'
    ? GeminiService
    : { generate: function() { throw new Error('No LLM service loaded.'); } }) as LlmClient;

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
    BaseAgent.refreshLlmSelectionIfChanged();
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

  /** Re-resolves the selected LLM provider once and keeps class-level dispatch current. */
  static reinitializeAllAgents(): void {
    BaseAgent.refreshLlmSelectionIfChanged(true);
  }

  // --- Shared Prompts & Formats ---

  protected static readonly SYSTEM_PREAMBLE = Constants.SYSTEM_PREAMBLE;

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

  // --- LLM call wrapper (logs context + timing) ---

  static refreshLlmSelectionIfChanged(force = false): void {
    if (typeof LLMFactory !== 'undefined' && LLMFactory.create) {
      const selectedService = LLMFactory.getSelectedService();
      if (force || selectedService !== BaseAgent.currentLlmService_) {
        BaseAgent.currentLlmService_ = selectedService;
        BaseAgent.currentLlmClient_ = LLMFactory.create(selectedService);
      }
      return;
    }
    BaseAgent.currentLlmService_ = Constants.LLM_SERVICE.GEMINI;
    BaseAgent.currentLlmClient_ = (typeof GeminiService !== 'undefined'
      ? GeminiService
      : { generate: function() { throw new Error('No LLM service loaded.'); } }) as LlmClient;
  }

  reinitialize(): void {
    BaseAgent.refreshLlmSelectionIfChanged(true);
  }

  /**
   * Unified LLM call with optional JSON-schema enforcement.
   *
   * - Pass `schema` → response is parsed as JSON and returned as `any`.
   * - Omit `schema`  → response is returned as a plain `string`
   *   (use for instruction-generation calls that return markdown).
   *
   * Both code paths share identical logging and timing so traces are
   * consistent regardless of the response mode.
   */
  protected callLlm_(
    systemPrompt: string,
    userPrompt: string,
    opts: { schema?: object; tier?: ModelTier } = {}
  ): any {
    const { schema, tier = Constants.MODEL.FAST } = opts;
    const name = this.constructor.name;
    const modelOverride = this.modelConfig_[tier as keyof ModelConfig];
    const mode = schema ? 'json' : 'text';
    BaseAgent.refreshLlmSelectionIfChanged();
    Tracer.info(
      `[${name}] LLM ${mode} call  service=${BaseAgent.currentLlmService_} tier=${tier}` +
      `${modelOverride ? ` model=${modelOverride}` : ''}`
    );
    Tracer.info(`[${name}]   user: "${userPrompt.slice(0, 200).replace(/\n/g, ' ')}…"`);
    const t0 = Date.now();
    try {
      const result = BaseAgent.currentLlmClient_.generate(systemPrompt, userPrompt, tier, { schema, modelOverride });
      const suffix = typeof result === 'string' ? ` (${result.length} chars)` : '';
      Tracer.info(`[${name}] LLM ${mode} done  ${Date.now() - t0}ms${suffix}`);
      return result;
    } catch (e: any) {
      Tracer.error(`[${name}] LLM ${mode} FAILED ${Date.now() - t0}ms — ${e.message}`);
      throw e;
    }
  }

  protected callGemini_(
    systemPrompt: string,
    userPrompt: string,
    opts: { schema?: object; tier?: ModelTier } = {}
  ): any {
    return this.callLlm_(systemPrompt, userPrompt, opts);
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
    return instructionUpdateSchema();
  }

  /**
   * JSON schema for the Gemini response for content_annotation calls.
   * Agents receive operations only; they set workflow_type and target_tab
   * themselves before calling CollaborationService.processUpdate.
   */
  protected annotationSchema_(): object {
    return annotationOperationsSchema();
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
    assertStyleProfileValid(content);
  }

  // ── §4.1 LLM-as-judge quality scorer (shared persistence in agentHelpers) ───

  /**
   * Fast-tier judge on freshly generated instruction markdown.
   * Callers normally use `evaluateInstructions()` instead of invoking this directly.
   */
  protected persistInstructionQualityScore_(
    proposedMarkdown: string,
    rubricMarkdown: string,
    propKeys: { score: string; rationale: string; ts: string }
  ): { score: number; rationale: string } {
    return runInstructionQualityEval_({
      gemini: (s, u, o) => this.callGemini_(s, u, o),
      logTag: `[${this.constructor.name}]`,
      rubricMarkdown,
      propKeys,
      markdown: proposedMarkdown,
    });
  }

  /**
   * Stable machine id for this agent (matches `AgentDefinition.id`). Used only
   * for persistence keys, not display.
   */
  protected abstract getAgentId(): string;

  /** Markdown rubric for the fast-tier instruction-quality judge after W1. */
  protected abstract getInstructionQualityRubric(): string;

  /** LLM-as-judge for this agent's instruction tab after W1 content is produced. */
  evaluateInstructions(proposedMarkdown: string): void {
    this.persistInstructionQualityScore_(
      proposedMarkdown,
      this.getInstructionQualityRubric(),
      instructionQualityDocumentPropKeysForAgentId_(this.getAgentId())
    );
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
    const filtered = validateOps(operations, passage) as Operation[];
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
        .join('\n');
      return (
        `### Thread: ${t.threadId}\n` +
        `**Selected Text:** ${t.selectedText}\n\n` +
        `**Conversation:**\n${conv}\n\n` +
        `**Request:** ${t.agentRequest}`
      );
    }).join('\n\n');
  }

  /**
   * Constructs a standard Markdown prompt formatted with matching dividers,
   * keeping output consistent structured for all workflows.
   */
  protected buildStandardPrompt(
    sections: Record<string, string | undefined | null>,
    instructions: string
  ): string {
    return buildStandardPrompt(sections, instructions);
  }

  /**
   * Reads the scratch tab written by processInstructionUpdate_ on the previous
   * W1 run. Returns the content, or a sentinel when the tab is empty or absent
   * (first run, no prior generation).
   *
   * Call this in generateInstructions() and pass the result to
   * generateInstructionPrompt() as `lastGenerated` so the LLM can compare the
   * current tab with the last-generated version and detect user edits.
   */
  protected readLastGeneratedInstructions_(instructionTabName: string): string {
    const scratchTab = `${instructionTabName} Scratch`;
    const content = this.getTabContent_(scratchTab);
    return content?.trim() ? content : '(none — first run)';
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
   * May also include Constants.COMMENT_ANCHOR_TAB sentinel.
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

  /** Model tier for comment thread replies (Constants.MODEL.FAST | MODEL.THINKING). */
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

  /**
   * W1 hook: subclasses continue after this. Instruction prompts should pass the
   * current instruction tab into the model and steer it to merge/refine author
   * edits — see `Constants.SYSTEM_PREAMBLE` and `.cursor/rules/experimental-dev.mdc`.
   */
  protected generateInstructions(): void {
    Tracer.info(`[${this.constructor.name}] generateInstructions: starting — ensureStandardTabs`);
    DocOps.ensureStandardTabs();
  }
}
