// ============================================================
// Types.ts — Shared TypeScript type declarations for EditorLLM.
//
// This file contains ONLY compile-time constructs (interfaces, type aliases,
// ambient function declarations). All runtime constants have moved to
// Constants.ts so they can be imported by experimental and test code.
//
// With `module: none` (GAS build), TypeScript compiles this file to an
// essentially empty script — type declarations are erased entirely — so there
// is no runtime footprint.
// ============================================================

/**
 * A single annotated passage within a RootUpdate payload.
 * match_text must be a unique 3–4-word string to locate the passage.
 */
interface Operation {
  match_text: string;
  reason: string;
}

/**
 * Root payload for instruction_update and content_annotation workflows.
 * Agents construct this after the Gemini call — never ask Gemini to produce
 * workflow_type, target_tab, or review_tab directly.
 */
interface RootUpdate {
  workflow_type: 'instruction_update' | 'content_annotation';
  agent_name?: string;
  /** Required for content_annotation: tab to highlight and comment. */
  target_tab?: string;
  /** Required for instruction_update: base name for the Scratch review tab. */
  review_tab?: string;
  /** Required for instruction_update: the full proposed text. */
  proposed_full_text?: string;
  operations?: Operation[];
}

/**
 * Selects which Gemini model tier to use for a call.
 * fast     — low-latency, high-throughput (prose, comments, styling)
 * thinking — extended reasoning budget (architecture, audit, deep analysis)
 * deepseek — configurable third slot for alternative model experiments
 */
type ModelTier = 'fast' | 'thinking' | 'deepseek';

/**
 * Per-agent model overrides.  Any tier left undefined falls through to the
 * GeminiService resolution chain (script properties → DEFAULT_MODELS).
 *
 * Pass to the BaseAgent constructor to use different models per agent instance:
 *   new ArchitectAgent({ thinking: 'gemini-2.5-flash' })
 *
 * Integration tests set GEMINI_FAST_MODEL / GEMINI_THINKING_MODEL /
 * GEMINI_DEEPSEEK_MODEL environment variables to use cheaper models without
 * touching any test source files.
 */
interface ModelConfig {
  fast?: string;
  thinking?: string;
  deepseek?: string;
}

/**
 * A single message in a Drive comment thread.
 * Shared by GeneralPurposeAgent and CommentProcessor.
 */
interface CommentMessage {
  role: 'User' | 'AI';
  content: string;
  authorName: string;
}

/** A parsed comment thread ready for agent dispatch. */
interface CommentThread {
  threadId: string;
  tag: string;           // normalised lowercase, e.g. '@eartune'
  agentRequest: string;           // text after the tag in the last message
  conversation: CommentMessage[]; // full thread history
  selectedText: string;           // the passage the comment is anchored to
  anchorTabName: string | null;    // resolved by CommentProcessor; null if not found
}

/** What an agent returns from handleCommentThread — posted as a Drive reply. */
interface ThreadReply {
  threadId: string;
  content: string;
}

// ── CollaborationHelpers ambient declarations ─────────────────────────────────
// These functions are defined (and exported for tests) in CollaborationHelpers.ts.
// The declarations here let the flat-scope tsc build resolve them in
// CollaborationService.ts without an import statement.
declare function findTextOrFallback_(
  body: GoogleAppsScript.Document.Body,
  matchText: string
): GoogleAppsScript.Document.RangeElement | null;

declare function matchesAgentPrefix_(
  content: string,
  agentPrefix: string | string[]
): boolean;

declare function highlightRangeElement_(
  rangeEl: GoogleAppsScript.Document.RangeElement,
  color: string
): void;

declare function highlightNamedRange_(
  namedRange: GoogleAppsScript.Document.NamedRange,
  color: string
): void;

declare function clearNamedRangeHighlights_(
  namedRange: GoogleAppsScript.Document.NamedRange
): number;

declare const MAX_COMMENT_CHARS: number;

declare function buildCommentContent_(
  agentPrefix: string,
  matchText: string,
  commentBody: string,
  bookmarkUrl: string
): { content: string; truncated: boolean };

declare function resolveWorkflowType_(
  update: RootUpdate
): 'instruction_update' | 'content_annotation';

// ── StringProcessor ambient declarations ──────────────────────────────────────
// Defined (and exported for tests) in StringProcessor.ts.
declare function createStringArray(csvString: string): string[];

// ── TabMergerHelpers ambient declarations ─────────────────────────────────────
// Defined (and exported for tests) in TabMergerHelpers.ts.
declare function sanitizePlatformError_(message: string): string;

// ── CommentProcessorHelpers ambient declarations ──────────────────────────────
// Defined (and exported for tests) in CommentProcessorHelpers.ts.
declare function normaliseTagWord_(w: string): string;

// ── Constants ambient declaration ─────────────────────────────────────────────
// The runtime value is defined and exported in Constants.ts (IIFE module).
// This ambient declaration exposes the same shape as a GAS-flat-scope global so
// that source files compiled with "module": "none" can reference Constants.*
// without import statements (which would break the GAS build).
declare const Constants: {
  readonly EXTENSION_NAME: string;
  readonly MODEL: {
    readonly FAST:     'fast';
    readonly THINKING: 'thinking';
    readonly DEEPSEEK: 'deepseek';
  };
  readonly DEFAULT_MODELS: Record<ModelTier, string>;
  readonly TAB_NAMES: {
    readonly MERGED_CONTENT:               'MergedContent';
    readonly AGENTIC_INSTRUCTIONS:         'Agentic Instructions';
    readonly AGENTIC_SCRATCH:              'Agentic Scratch';
    readonly STYLE_PROFILE:                'StyleProfile';
    readonly EAR_TUNE:                     'EarTune Instructions';
    readonly TECHNICAL_AUDIT:              'Audit Instructions';
    readonly TETHER_INSTRUCTIONS:          'TetherInstructions';
    readonly GENERAL_PURPOSE_INSTRUCTIONS: 'General Purpose Instructions';
  };
  readonly HIGHLIGHT_COLOR:      string;
  readonly AGENT_COMMENT_PREFIX: string;
  readonly COMMENT_ANCHOR_TAB:   string;
};
