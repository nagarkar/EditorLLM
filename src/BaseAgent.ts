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

  // --- Per-instance cache ---

  protected cache_: { [tabName: string]: string } = {};

  protected getTabContent_(tabName: string): string {
    if (this.cache_[tabName] !== undefined) return this.cache_[tabName];
    const content = DocOps.getTabContent(tabName);
    if (!content.trim()) {
      Logger.log(`[${this.constructor.name}] getTabContent_: tab "${tabName}" is empty or missing`);
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
      Logger.log(`[${this.constructor.name}] getTabMarkdown_: tab "${tabName}" is empty or missing`);
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
    Logger.log(`[${name}] Gemini call  tier=${tier}${modelOverride ? ` model=${modelOverride}` : ''}`);
    Logger.log(`[${name}]   system: "${sysPrev}"`);
    Logger.log(`[${name}]   user:   "${usrPrev}…"`);
    const t0 = Date.now();
    try {
      const result = GeminiService.generateJson(systemPrompt, userPrompt, schema, tier, modelOverride);
      Logger.log(`[${name}] Gemini done  ${Date.now() - t0}ms`);
      return result;
    } catch (e: any) {
      Logger.log(`[${name}] Gemini FAILED ${Date.now() - t0}ms — ${e.message}`);
      throw e;
    }
  }

  // --- Comment thread logging helper ---

  protected logCommentThread_(thread: CommentThread, method: string): void {
    const name = this.constructor.name;
    const sel = thread.selectedText.slice(0, 80).replace(/\n/g, ' ');
    const req = thread.agentRequest.slice(0, 120).replace(/\n/g, ' ');
    Logger.log(`[${name}] ${method}: thread=${thread.threadId} tag=${thread.tag}`);
    Logger.log(`[${name}]   anchor=${thread.anchorTabName ?? '(none)'}`);
    Logger.log(`[${name}]   selected="${sel}"`);
    Logger.log(`[${name}]   request="${req}"`);
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
      required: ['proposed_full_text', 'operations'],
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

  // --- Abstract interface ---

  /** Lowercase tag strings users write in comments, e.g. ['@eartune', '@stylist'] */
  abstract readonly tags: string[];

  /**
   * Tab names (TAB_NAMES values) this agent reads during comment processing.
   * May also include COMMENT_ANCHOR_TAB sentinel.
   * Used by CommentProcessor for pre-flight validation only — agents still
   * fetch tab content themselves via getTabContent_().
   */
  abstract readonly contextKeys: string[];

  /**
   * Process a single comment thread routed to this agent.
   * Apply any document changes via CollaborationService.processUpdate().
   * Return the text to post as a Drive reply on that thread.
   */
  abstract handleCommentThread(thread: CommentThread): ThreadReply;

  /**
   * Triggers an instruction_update to refresh the agent's canonical system prompt tab.
   * Routes the result through CollaborationService → Scratch tab.
   */
  abstract generateInstructions(): void;

  /**
   * Populates the relevant tabs with high-quality reference/example content.
   * Used by the "Generate Example" button in the Configure dialog.
   */
  abstract generateExample(): void;
}
