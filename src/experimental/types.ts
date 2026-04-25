// ============================================================
// src/experimental/types.ts
//
// Declarative agent model — step 1 of the AgentDefinition migration.
//
// NOTE: This file lives under src/ and IS compiled by the main tsc
// build (tsconfig.json includes src/**/*.ts). Since it contains only
// TypeScript interfaces and type aliases, tsc emits an empty .js file
// (dist/experimental/types.js) which is harmless in GAS flat scope.
// To properly exclude it from the GAS build, add "src/experimental"
// to the exclude list in tsconfig.json.
// ============================================================

/** Model tier — mirrors Types.ts ModelTier */
export type ModelTier = 'fast' | 'thinking' | 'deepseek';

// ── Context sources ───────────────────────────────────────────────────────────

/** A single section in a workflow prompt — a (section title, content source) pair. */
export interface ContextSection {
  title:  string;
  source: ContextSource;
}

/**
 * Where the content for a prompt section comes from.
 *
 * Static sources (resolved by AgentInterpreter from services):
 *   style_profile    — StyleProfile tab, plain text or markdown
 *   self_instructions — the agent's own instruction tab, plain or markdown
 *   tab              — any named tab, plain or markdown, optional char limit
 *   manuscript   — Manuscript tab with optional char slice
 *
 * Runtime sources (passed in per-call via RuntimeCtx):
 *   passage    — the tab text being annotated (W2)
 *   threads    — formatted comment threads (W3)
 *   anchor_tab — content of the tab the comment is anchored to (W3)
 */
export type ContextSource =
  | { kind: 'literal';           text: string }
  | { kind: 'style_profile';     format: 'plain' | 'markdown' }
  | { kind: 'self_instructions'; format: 'plain' | 'markdown' }
  | { kind: 'tab';               tabName: string; format: 'plain' | 'markdown'; charLimit?: number; fallback?: string }
  | { kind: 'manuscript';    charLimit?: number }
  | { kind: 'passage' }
  | { kind: 'threads' }
  | { kind: 'anchor_tab' };

// ── Workflow definition ───────────────────────────────────────────────────────

/**
 * The response format the LLM should return for this workflow.
 * Determines the JSON schema passed to GeminiService and how the result is
 * mapped to a RootUpdate payload.
 */
export type ResponseFormat =
  | 'instruction_update'    // { proposed_full_text: string }
  | 'annotation_operations' // { operations: Operation[] }
  | 'thread_replies'        // { responses: { threadId, reply }[] }
  | 'bookmark_directives'   // { operations: CustomOperation[] }
  | 'plain_markdown';       // raw string, no JSON schema (GeneralPurposeAgent W1)

/**
 * Optional post-processing steps run after the main Gemini call.
 * Each step is identified by kind; the interpreter executes them in order.
 */
export type PostStep =
  | { kind: 'evaluate_instruction_quality' }
  | { kind: 'validate_operations' };   // drop hallucinated match_text values (W2)

/** Full configuration for one agent workflow (W1, W2, or W3). */
export interface WorkflowDef {
  /** Gemini model tier to use. */
  modelTier: ModelTier;

  /**
   * Number of threads per Gemini batch call.
   * Only meaningful for handleCommentThreads (W3). Defaults to 10.
   */
  chunkSize?: number;

  /**
   * When true, the interpreter throws a user-facing error if StyleProfile
   * is missing or shorter than 200 chars before making the Gemini call.
   * Defaults to true. Set false for ArchitectAgent (which generates the profile).
   */
  requiresStyleProfile?: boolean;

  responseFormat: ResponseFormat;

  /** Ordered list of context sections that make up the prompt body. */
  contextSections: ContextSection[];

  /**
   * Fixed instruction text appended as the final "## Instructions" section.
   * Should match exactly what the concrete agent's generateXxxPrompt() method
   * passes as the second arg to buildStandardPrompt().
   */
  instructions: string;

  /** Optional post-processing steps. */
  postSteps?: PostStep[];

  /** Optional: Schema provider for custom directives (used when responseFormat is bookmark_directives) */
  schemaProvider?: () => object;

  /** Optional: Builder to map an operation into a typed directive payload for bookmark directives */
  directiveBuilder?: (operation: any) => { type: string; payload: Record<string, unknown> };
}

// ── System prompt ─────────────────────────────────────────────────────────────

/**
 * How the agent's system prompt is resolved at call time.
 *
 *   static — fixed string baked into the definition (most agents)
 *   tab    — read from a named doc tab at runtime; falls back to `fallback`
 *            when the tab is empty (GeneralPurposeAgent pattern)
 */
export type SystemPromptDef =
  | { kind: 'static'; text: string }
  | { kind: 'tab';    tabName: string; fallback?: string };

// ── Agent definition ──────────────────────────────────────────────────────────

/**
 * Complete declarative description of an agent.
 *
 * An AgentInterpreter can execute any workflow declared here without
 * agent-specific subclass code.  Concrete agents can expose a static
 * toDefinition() method to emit this structure for validation / UI use.
 */
export interface AgentDefinition {
  /** Machine-readable stable identifier, e.g. "eartune". */
  id: string;

  /** Human-readable name shown in UI, e.g. "EarTune". */
  displayName: string;

  /** One-sentence purpose shown in the agent picker. */
  description: string;

  /**
   * Comment routing tags.  Lowercase, e.g. ['@eartune'].
   * Users write these in Drive comment threads to address the agent.
   */
  tags: string[];

  /**
   * Prefix applied to every Drive annotation comment this agent creates,
   * e.g. '[EarTune]'.  Used by clearAgentAnnotations to scope deletion.
   */
  commentPrefix: string;

  /**
   * Tab name where the agent's instructions live, e.g. 'EarTune Instructions'.
   * Scratch tab defaults to `${instructionTabName} Scratch`.
   */
  instructionTabName: string;

  /**
   * The agent's system prompt — either a fixed string or resolved from a tab.
   * Must be the full expanded string (SYSTEM_PREAMBLE already interpolated).
   */
  systemPrompt: SystemPromptDef;

  /**
   * Markdown rubric for the fast-tier LLM-as-judge after W1. Must match the
   * concrete agent's `INSTRUCTION_QUALITY_RUBRIC` (after `.trim()`).
   */
  instructionQualityRubric: string;

  /**
   * Declared workflows.  Only keys present here are offered in the UI and
   * executed by the interpreter.
   */
  workflows: {
    /** W1 — refresh the agent's instruction tab. */
    generateInstructions?: WorkflowDef;
    /** W2 — annotate a manuscript tab (highlight + Drive comment). */
    annotateTab?: WorkflowDef;
    /** W3 — reply to @tag comment threads. */
    handleCommentThreads?: WorkflowDef;
  };
}
