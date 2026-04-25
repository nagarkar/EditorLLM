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
 * Root payload dispatched to CollaborationService.processUpdate after a Gemini call.
 * Covers all four workflow types: instruction_update, content_annotation,
 * bookmark_directives, and tab_generation.
 * Agents construct this — never ask Gemini to produce workflow_type, target_tab, or review_tab.
 */
interface RootUpdate {
  workflow_type: 'instruction_update' | 'content_annotation' | 'bookmark_directives' | 'tab_generation';
  agent_name?: string;
  /** Required for content_annotation and bookmark_directives: tab to highlight and comment. */
  target_tab?: string;
  /** Required for instruction_update: base name for the Scratch review tab. */
  review_tab?: string;
  /** Required for instruction_update: the full proposed text. */
  proposed_full_text?: string;
  operations?: Operation[];
  directives?: DirectiveCreate[];
  generated_tabs?: GeneratedTab[];
}

interface GeneratedTab {
  tab_name: string;
  markdown: string;
}

interface DirectiveCreate {
  match_text: string;
  type: string;
  payload: Record<string, unknown>;
}

interface StoredDirectiveRecord {
  v: number;
  type: string;
  payload: Record<string, unknown>;
}

interface TtsOperation {
  match_text: string;
  tts_model: string;
  voice_id: string;
  stability: number;
  similarity_boost: number;
}

/**
 * Selects which Gemini model tier to use for a call.
 * fast     — low-latency, high-throughput (prose, comments, styling)
 * thinking — extended reasoning budget (architecture, audit, deep analysis)
 * deepseek — configurable third slot for alternative model experiments
 */
type ModelTier = 'fast' | 'thinking' | 'deepseek';
// Keep this explicit union even though Constants.LLM_SERVICE exists at runtime.
// Types.ts is compile-time only, while Constants.ts is a runtime IIFE global in
// the GAS bundle. Using a standalone type here preserves narrow type-checking
// without coupling the ambient type layer to runtime value access.
type LlmServiceName = 'gemini' | 'openai';

/**
 * Allowlist for managed destructive tab passes (see DocOps.getUserAllowedManagedTabs / DocOps.isManagedTab).
 * null = every non–never-processed tab is eligible; otherwise only listed names.
 */
type ManagedTabsList = string[] | null;

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

interface LlmGenerateOptions {
  schema?: object;
  modelOverride?: string;
}

interface LlmClient {
  generate(
    systemPrompt: string,
    userPrompt: string,
    tier?: ModelTier,
    opts?: LlmGenerateOptions
  ): any;
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

// ── StringProcessor ambient declarations ──────────────────────────────────────
// Defined (and exported for tests) in StringProcessor.ts.
declare function createStringArray(csvString: string): string[];

// ── TabMergerHelpers ambient declarations ─────────────────────────────────────
// Defined (and exported for tests) in TabMergerHelpers.ts.
declare function sanitizePlatformError_(message: string): string;

// ── CommentProcessorHelpers ambient declarations ──────────────────────────────
// Defined (and exported for tests) in CommentProcessorHelpers.ts.
declare function normaliseTagWord_(w: string): string;

// ── agentHelpers ambient declarations ────────────────────────────────────────
// Defined (and exported for tests) in PlsParser.ts.
// Called from ElevenLabsService in the GAS flat scope.
declare function parsePlsRules(xml: string): Array<{ grapheme: string; phoneme: string }>;

// Defined (and exported for tests) in agentHelpers.ts.
// Called directly from BaseAgent subclasses in the GAS flat scope.
declare function assertStyleProfileValid(content: string): void;
declare function buildStandardPrompt(
  sections: Record<string, string | undefined | null>,
  instructions: string
): string;
declare function validateOps(
  ops: Array<{ match_text: string; reason: string }>,
  passage: string
): Array<{ match_text: string; reason: string }>;
declare function extractMarkdownFromJsonWrapper(raw: string): string;
declare function instructionUpdateSchema(): object;
declare function annotationOperationsSchema(): object;
declare function ttsDirectivesSchema(): object;
declare function publisherTabGenerationSchema(requestedTabs: string[]): object;
declare function determinePublisherTabsToGenerate(
  mode: 'all' | 'missing',
  existingContent: Record<string, string>
): string[];
declare function validatePublisherTabPayload(
  raw: any,
  requestedTabs: string[]
): { tabs: GeneratedTab[]; missing: string[]; unexpected: string[] };
declare function buildPublisherPackageFolderName(docName: string, isoDate: string, hhmmss?: string): string;
declare function isBlankPublisherContent(text: string | null | undefined): boolean;
declare function deduplicateTtsOps(passage: string, ops: TtsOperation[]): TtsOperation[];
declare function stitchingIdsForVoice(voiceId: string, historyByVoice: Record<string, string[]>, useStitching: boolean): string[];
declare function recordRequestId(voiceId: string, requestId: string, historyByVoice: Record<string, string[]>): Record<string, string[]>;
declare function makeDirectivePropertyKey_(directiveId: string): string;
declare function encodeDirectiveNamedRangeName(
  agentPrefixRaw: string,
  directiveIdRaw: string,
  bookmarkIdRaw: string
): string;
declare function bookmarkIdToWire_(bookmarkId: string): string;
declare function wireToBookmarkId_(wire: string): string;

// ── agentPrompts ambient declarations ────────────────────────────────────────
// AUTO-GENERATED from src/prompts/*.md and src/prompts/agents/*.md
// (see scripts/generate_prompt_constants.js).
// Accessible as flat-scope globals in GAS; imported normally in experimental/test code.

// Shared prompt elements
declare const SYSTEM_PREAMBLE: string;
declare const W1_FORMAT_GUIDELINES: string;
declare const W2_PASSAGE_SECTION_TITLE: string;

// EarTune Agent
declare const EARTUNE_SYSTEM_PROMPT_BODY: string;
declare const EARTUNE_MANUAL_INNOVATION_PRESERVATION: string;
declare const EARTUNE_W1_INSTRUCTIONS: string;
declare const EARTUNE_W2_INSTRUCTIONS: string;
declare const EARTUNE_W3_INSTRUCTIONS: string;
declare const EARTUNE_INSTRUCTION_QUALITY_RUBRIC: string;

// Audit Agent
declare const AUDIT_SYSTEM_PROMPT_BODY: string;
declare const AUDIT_W1_INSTRUCTIONS: string;
declare const AUDIT_W2_INSTRUCTIONS: string;
declare const AUDIT_W3_INSTRUCTIONS: string;
declare const AUDIT_INSTRUCTION_QUALITY_RUBRIC: string;

// Tether Agent
declare const TETHER_SYSTEM_PROMPT_BODY: string;
declare const TETHER_W1_INSTRUCTIONS: string;
declare const TETHER_W2_INSTRUCTIONS: string;
declare const TETHER_W3_INSTRUCTIONS: string;
declare const TETHER_INSTRUCTION_QUALITY_RUBRIC: string;

// TTS Agent
declare const TTS_SYSTEM_PROMPT_BODY: string;
declare const TTS_CAST_ROLE_POLICY_SCHEMA: string;
declare const TTS_W1_INSTRUCTIONS: string;
declare const TTS_W2_INSTRUCTIONS: string;
declare const TTS_INSTRUCTION_QUALITY_RUBRIC: string;

// Publisher Agent
declare const PUBLISHER_GEMINI_TAB_NAMES: readonly string[];
declare const PUBLISHER_ALL_OUTPUT_TAB_NAMES: readonly string[];
declare const PUBLISHER_SYSTEM_PROMPT_BODY: string;
declare const PUBLISHER_W1_INSTRUCTIONS: string;
declare const PUBLISHER_W2_INSTRUCTIONS: string;
declare const PUBLISHER_INSTRUCTION_QUALITY_RUBRIC: string;

// Architect Agent
declare const ARCHITECT_SYSTEM_PROMPT_BODY: string;
declare const ARCHITECT_STYLEPROFILE_SCHEMA: string;
declare const ARCHITECT_W1_INSTRUCTIONS: string;
declare const ARCHITECT_W3_INSTRUCTIONS: string;
declare const ARCHITECT_INSTRUCTION_QUALITY_RUBRIC: string;

// GeneralPurpose Agent
declare const GENERALPURPOSE_SYSTEM_PROMPT_BODY: string;
declare const GENERALPURPOSE_W1_INSTRUCTIONS: string;
declare const GENERALPURPOSE_W3_INSTRUCTIONS: string;
declare const GENERALPURPOSE_INSTRUCTION_QUALITY_RUBRIC: string;

// ── ElevenLabs types ──────────────────────────────────────────────────────────

/**
 * A single voice entry returned by ElevenLabsService.listVoices().
 * Normalised from the raw API shape — callers never need to inspect
 * the raw `labels` map directly (though it is available for edge cases).
 */
interface ElevenLabsVoice {
  voice_id: string;
  name:     string;
  /** ElevenLabs category: "premade" | "cloned" | "generated" | "professional" */
  category: string;
  /** Value of labels['use case'] — e.g. "narration" | "conversational" | "characters" */
  use_case: string;
  /** Raw labels object from the API (may contain accent, gender, age, etc.) */
  labels:   Record<string, string>;
}

/**
 * A single TTS-capable model returned by ElevenLabsService.listModels().
 */
interface ElevenLabsModel {
  model_id:    string;
  name:        string;
  description: string;
}

/**
 * A single rule in a pronunciation dictionary.
 *
 * | alphabet | interpretation |
 * |----------|---------------|
 * | `"ipa"`  | `replace_with` is an IPA phoneme string (ElevenLabs `phoneme` rule) |
 * | `""`     | `replace_with` is a plain word/phrase alias (ElevenLabs `alias` rule) |
 */
interface ElevenLabsPronunciationRule {
  /** The word or phrase to be replaced in source text. */
  string_to_replace: string;
  /** Replacement: IPA string when alphabet="ipa", plain alias when alphabet="". */
  replace_with: string;
  /** "ipa" for phoneme rules; "" for alias rules. */
  alphabet: string;
}

/**
 * A pronunciation dictionary cached by ElevenLabsService after prefetching.
 * Stores the data needed to (a) match source text, (b) build the TTS locator,
 * and (c) display the human-readable rules table in the TTS panel.
 */
interface ElevenLabsPronunciationDictionary {
  id:         string;
  version_id: string;
  name:       string;
  rules: ElevenLabsPronunciationRule[];
}

/**
 * One entry in the `pronunciation_dictionary_locators` array sent to the
 * ElevenLabs TTS endpoint.  At most 3 locators are allowed per request.
 */
interface ElevenLabsPronunciationDictionaryLocator {
  pronunciation_dictionary_id: string;
  version_id:                  string;
}

/**
 * Metadata persisted to UserProperties after each successful TTS generation.
 * Allows the dialog to display (and reload) the last audio when reopened.
 */
interface ElevenLabsLastGenMeta {
  /** Drive file ID of the saved MP3 — used to re-fetch audio bytes. */
  fileId:    string;
  /** Public Drive download URL shown as a link in the dialog. */
  driveUrl:  string;
  /** Display name of the voice used (label from the dropdown). */
  voiceName: string;
  /** Display name of the model used (label from the dropdown). */
  modelName: string;
  /** Number of characters synthesised (= credits consumed). */
  charCount: number;
  /** Unix timestamp (ms) when the generation completed. */
  timestamp: number;
}

// ── Constants ambient declaration ─────────────────────────────────────────────
// The runtime value is defined and exported in Constants.ts (IIFE module).
// This ambient declaration exposes the same shape as a GAS-flat-scope global so
// that source files compiled with "module": "none" can reference Constants.*
// without import statements (which would break the GAS build).
declare const Constants: {
  readonly EXTENSION_NAME: string;
  readonly SYSTEM_PREAMBLE: string;
  readonly W2_PASSAGE_SECTION_TITLE: string;
  readonly MODEL: {
    readonly FAST:     'fast';
    readonly THINKING: 'thinking';
    readonly DEEPSEEK: 'deepseek';
  };
  readonly LLM_SERVICE: {
    readonly GEMINI: 'gemini';
    readonly OPENAI: 'openai';
  };
  readonly DEFAULT_MODELS: Record<ModelTier, string>;
  readonly TAB_NAMES: {
    readonly MANUSCRIPT:                   'Manuscript';
    readonly AGENTIC_INSTRUCTIONS:         'Agentic Instructions';
    readonly AGENTIC_SCRATCH:              'Agentic Scratch';
    readonly PUBLISHER_ROOT:               'Publisher';
    readonly STYLE_PROFILE:                'StyleProfile';
    readonly EAR_TUNE:                     'EarTune Instructions';
    readonly TTS_INSTRUCTIONS:             'TTS Instructions';
    readonly TECHNICAL_AUDIT:              'Audit Instructions';
    readonly TETHER_INSTRUCTIONS:          'Tether Instructions';
    readonly GENERAL_PURPOSE_INSTRUCTIONS: 'General Purpose Instructions';
    readonly PUBLISHER_INSTRUCTIONS:       'Publisher Instructions';
    readonly PUBLISHER_TITLE:              'Title';
    readonly PUBLISHER_COPYRIGHT:          'Copyright';
    readonly PUBLISHER_TOC:                'Table of Contents';
    readonly PUBLISHER_ABOUT_AUTHOR:       'About The Author';
    readonly PUBLISHER_SALES:              'Sales';
    readonly PUBLISHER_HOOKS:              'Hooks';
    readonly PUBLISHER_COVER:              'Cover';
  };
  readonly NEVER_PROCESSED_TABS: readonly string[];
  readonly HIGHLIGHT_COLOR:      string;
  readonly AGENT_COMMENT_PREFIX: string;
  readonly COMMENT_ANCHOR_TAB:   string;
};
