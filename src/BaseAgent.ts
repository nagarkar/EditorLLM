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

  protected callGemini_(
    systemPrompt: string,
    userPrompt: string,
    schema: object,
    tier: ModelTier = MODEL.FAST
  ): any {
    const name = this.constructor.name;
    const modelOverride = this.modelConfig_[tier as keyof ModelConfig];
    const sysPrev = systemPrompt.slice(0, 100).replace(/\n/g, ' ');
    const usrPrev = userPrompt.slice(0, 200).replace(/\n/g, ' ');
    Tracer.info(`[${name}] Gemini call  tier=${tier}${modelOverride ? ` model=${modelOverride}` : ''}`);
    Tracer.info(`[${name}]   system: "${sysPrev}"`);
    Tracer.info(`[${name}]   user:   "${usrPrev}…"`);
    const t0 = Date.now();
    try {
      const result = GeminiService.generateJson(systemPrompt, userPrompt, schema, tier, modelOverride);
      Tracer.info(`[${name}] Gemini done  ${Date.now() - t0}ms`);
      return result;
    } catch (e: any) {
      Tracer.error(`[${name}] Gemini FAILED ${Date.now() - t0}ms — ${e.message}`);
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
      .filter(([_, content]) => !!content) // drop empty context sections
      .map(([title, content]) => `## ${title}\\n\\n${content}\\n`);

    return [...formattedParts, `\\n## Instructions\\n\\n${instructions}`].join('\\n').trim();
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
   * Process a batch of comment threads routed to this agent.
   * Agents own chunk sizing, subgrouping strategy, and prompt structure.
   * Failed chunks must be caught internally and return [] rather than throw.
   * Returns one ThreadReply per thread that received a valid response.
   * Not every input thread needs a reply — missing coverage is tolerated.
   */
  abstract handleCommentThreads(threads: CommentThread[]): ThreadReply[];

  /**
   * Triggers an instruction_update to refresh the agent's canonical system prompt tab.
   * Routes the result through CollaborationService → Scratch tab.
   */
  protected generateInstructions(): void {
    Tracer.info(`[${this.constructor.name}] generateInstructions: starting — ensureStandardTabs`);
    DocOps.ensureStandardTabs();
  }

  /**
   * Populates the relevant tabs with high-quality reference/example content.
   * Used by the "Generate Example" button in the Configure dialog.
   */
  protected generateExample(): void {
    Tracer.info(`[${this.constructor.name}] generateExample: starting — ensureStandardTabs`);
    DocOps.ensureStandardTabs();
  }
}
