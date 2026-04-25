// ============================================================
// Constants.ts — Runtime constants, wrapped in an IIFE module.
//
// WHY THIS FILE EXISTS
// Flat-scope names like MODEL, TAB_NAMES, DEFAULT_MODELS pollute the
// shared GAS script namespace and risk shadowing conflicts. Wrapping all
// runtime constants in a single IIFE reduces the global footprint to ONE
// name: Constants.
//
// IMPORT IN EXPERIMENTAL / TEST CODE
// The `export` keyword makes this importable by ts-jest:
//   import { Constants } from '../Constants';
// With `module: none` (GAS build), tsc strips the export and emits the IIFE
// result as a bare `const Constants = ...` in the compiled flat-scope script,
// so fixgas handles the remaining CommonJS shim automatically.
//
// TYPES
// Type-only declarations (interfaces, type aliases) stay in Types.ts; they are
// compile-time constructs and cannot be encapsulated in an IIFE.
// ============================================================

const Constants = (() => {

  /** Display name used in UI and error messages. */
  const EXTENSION_NAME = 'EditorLLM';

  /**
   * Typed constants for model tier selection.
   * Use Constants.MODEL.FAST / .THINKING / .DEEPSEEK everywhere.
   */
  const MODEL = {
    FAST:     'fast'     as ModelTier,
    THINKING: 'thinking' as ModelTier,
    DEEPSEEK: 'deepseek' as ModelTier,
  } as const;

  const LLM_SERVICE = {
    GEMINI: 'gemini' as LlmServiceName,
    OPENAI: 'openai' as LlmServiceName,
  } as const;

  /** Fallback model names used when script properties are not set. */
  const DEFAULT_MODELS: Record<ModelTier, string> = {
    fast:     'gemini-3-flash-preview',
    thinking: 'gemini-3.1-pro-preview',
    deepseek: 'gemini-2.0-flash-thinking-exp-01-21',
  };

  /** Standard tab names used throughout the system. */
  const TAB_NAMES = {
    MANUSCRIPT:                    'Manuscript',
    AGENTIC_INSTRUCTIONS:          'Agentic Instructions',
    AGENTIC_SCRATCH:               'Agentic Scratch',
    PUBLISHER_ROOT:                'Publisher',
    STYLE_PROFILE:                 'StyleProfile',
    EAR_TUNE:                      'EarTune Instructions',
    TTS_INSTRUCTIONS:              'TTS Instructions',
    TECHNICAL_AUDIT:               'Audit Instructions',
    TETHER_INSTRUCTIONS:           'Tether Instructions',
    GENERAL_PURPOSE_INSTRUCTIONS:  'General Purpose Instructions',
    PUBLISHER_INSTRUCTIONS:        'Publisher Instructions',
    PUBLISHER_TITLE:               'Title',
    PUBLISHER_COPYRIGHT:           'Copyright',
    PUBLISHER_TOC:                 'Table of Contents',
    PUBLISHER_ABOUT_AUTHOR:        'About The Author',
    PUBLISHER_SALES:               'Sales',
    PUBLISHER_HOOKS:               'Hooks',
    PUBLISHER_COVER:               'Cover',
  } as const;

  /**
   * Root tab titles whose subtrees must not receive managed destructive passes
   * (orphan bookmark/named-range removal, directive-only clears, etc.).
   * Subtree membership is resolved at runtime via DocOps tab-tree walk.
   */
  const NEVER_PROCESSED_TABS = [
    TAB_NAMES.MANUSCRIPT,
    TAB_NAMES.AGENTIC_INSTRUCTIONS,
    TAB_NAMES.AGENTIC_SCRATCH,
  ] as const;

  /** Background color applied to annotated passages. */
  const HIGHLIGHT_COLOR = '#FFD966';

  /**
   * Prefix applied to every Drive reply posted by CommentProcessor on agent threads.
   */
  const AGENT_COMMENT_PREFIX = '[EditorLLM] ';

  /**
   * Sentinel value an agent puts in contextKeys to signal it needs
   * the content of the tab the comment is anchored in.
   */
  const COMMENT_ANCHOR_TAB = '__comment_anchor_tab__';

  return {
    EXTENSION_NAME,
    MODEL,
    LLM_SERVICE,
    DEFAULT_MODELS,
    TAB_NAMES,
    NEVER_PROCESSED_TABS,
    HIGHLIGHT_COLOR,
    AGENT_COMMENT_PREFIX,
    COMMENT_ANCHOR_TAB,
  };

})();

// Named export allows: import { Constants } from '../Constants'
// in experimental and test files (ts-jest, module: commonjs).
// With `module: none` (GAS build) this becomes `exports.Constants = Constants`
// after fixgas patches the file — the flat-scope `const Constants` above is
// what GAS source files reference at runtime.
// eslint-disable-next-line no-restricted-syntax
export { Constants };
