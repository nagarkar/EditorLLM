// ============================================================
// Types.ts — Shared interfaces for the EditorLLM system
// ============================================================

/** Display name used throughout the UI and error messages. */
const EXTENSION_NAME = 'EditorLLM';

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
  /** Required for content_annotation: tab to highlight and comment. */
  target_tab?: string;
  /** Required for instruction_update: base name for the Scratch review tab. */
  review_tab?: string;
  /** Required for instruction_update: the full proposed text. */
  proposed_full_text?: string;
  operations: Operation[];
}

/**
 * Selects which Gemini model tier to use for a call.
 * fast     — low-latency, high-throughput (prose, comments, styling)
 * thinking — extended reasoning budget (architecture, audit, deep analysis)
 * deepseek — configurable third slot for alternative model experiments
 */
type ModelTier = 'fast' | 'thinking' | 'deepseek';

/**
 * Typed constants for model tier selection.
 * Use MODEL.FAST / MODEL.THINKING / MODEL.DEEPSEEK everywhere instead of
 * bare string literals — eliminates typos and makes grep easy.
 */
const MODEL = {
  FAST:     'fast'     as ModelTier,
  THINKING: 'thinking' as ModelTier,
  DEEPSEEK: 'deepseek' as ModelTier,
} as const;

/** Script property keys that hold the configured model names. */
const MODEL_PROP_KEYS = {
  FAST:     'GEMINI_FAST_MODEL',
  THINKING: 'GEMINI_THINKING_MODEL',
  DEEPSEEK: 'GEMINI_DEEPSEEK_MODEL',
} as const;

/** Fallback model names used when script properties are not set. */
const DEFAULT_MODELS: Record<ModelTier, string> = {
  fast:     'gemini-3-flash-preview',
  thinking: 'gemini-3.1-pro-preview',
  deepseek: 'gemini-2.0-flash-thinking-exp-01-21',
};

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
  fast?:     string;
  thinking?: string;
  deepseek?: string;
}

/** Standard tab names used throughout the system. */
const TAB_NAMES = {
  MERGED_CONTENT: 'MergedContent',
  AGENTIC_INSTRUCTIONS: 'Agentic Instructions',
  STYLE_PROFILE: 'StyleProfile',
  EAR_TUNE: 'EarTune',
  TECHNICAL_AUDIT: 'TechnicalAudit',
  COMMENT_INSTRUCTIONS: 'Comment Instructions',
} as const;

/** Background color applied to annotated passages. */
const HIGHLIGHT_COLOR = '#FFD966';

/**
 * Prefix applied to every Drive comment created by an agent.
 * Used by clearAgentAnnotations_ to distinguish agent comments from user comments.
 */
const AGENT_COMMENT_PREFIX = '[EditorLLM] ';

// ── Comment routing types ────────────────────────────────────────────────────

/**
 * A single message in a Drive comment thread.
 * Shared by CommentAgent and CommentProcessor.
 */
interface CommentMessage {
  role: 'User' | 'AI';
  content: string;
  authorName: string;
}

/**
 * Sentinel value an agent puts in contextKeys to signal it needs
 * the content of the tab the comment is anchored in.
 */
const COMMENT_ANCHOR_TAB = '__comment_anchor_tab__';

/** A parsed comment thread ready for agent dispatch. */
interface CommentThread {
  threadId:      string;
  tag:           string;           // normalised lowercase, e.g. '@eartune'
  agentRequest:  string;           // text after the tag in the last message
  conversation:  CommentMessage[]; // full thread history
  selectedText:  string;           // the passage the comment is anchored to
  anchorTabName: string | null;    // resolved by CommentProcessor; null if not found
}

/** What an agent returns from handleCommentThread — posted as a Drive reply. */
interface ThreadReply {
  threadId: string;
  content:  string;
}
