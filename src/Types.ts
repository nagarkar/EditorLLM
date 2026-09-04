// ============================================================
// Types.ts — Server-side TypeScript type declarations for EditorLLM.
//
// Contains ONLY compile-time constructs (interfaces, type aliases,
// ambient function declarations). All runtime constants have moved to
// Constants.ts so they can be imported by experimental and test code.
//
// Types shared with the browser client live in client/server-types.d.ts,
// which is included by both tsconfig.json and tsconfig.client.json.
// Do not duplicate those interfaces here.
//
// With `module: none` (GAS build), TypeScript compiles this file to an
// essentially empty script — type declarations are erased entirely — so
// there is no runtime footprint.
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
  /**
   * Selects how many directives are created from this entry.
   * 'first_occurrence' (default) — single directive at the first match of match_text.
   * 'every_occurrence'           — directive at every match (e.g. structural markers,
   *   ellipsis breaks).  Resolved by CollaborationService.createBookmarkDirectives_.
   */
  apply_to?: 'first_occurrence' | 'every_occurrence';
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

/** A break directive operation from the TTS agent — inserts a timed silence at the given location. */
interface TtsBreakOperation {
  match_text: string;
  duration_ms: number;
  /**
   * Controls how many directives are created from this operation.
   * 'first_occurrence' (default) — one directive at the first match of match_text.
   * 'every_occurrence'           — one directive at every match in the tab (used
   *   for structural markers such as '---' and '* * *' that appear repeatedly).
   */
  apply_to?: 'first_occurrence' | 'every_occurrence';
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
  hasApiKey(): boolean;
  listAvailableModels(force?: boolean): string[];
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

declare function findAllTextOccurrences_(
  body: GoogleAppsScript.Document.Body,
  matchText: string
): GoogleAppsScript.Document.RangeElement[];

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
declare function validateEarTuneOps(
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
declare function buildVersionFolderName(docId: string, label: string): string;
declare function validateVersionLabel(label: string): string;
declare function extractCssFromTab(markdown: string): string;
declare function isBlankPublisherContent(text: string | null | undefined): boolean;

interface CoverItem {
  bodyChildIndex: number;
  kind: 'text' | 'image' | 'marker';
  text?: string;
  marker?: { number: number | null; name: string | null };
  imageRef?: number;
}
interface ParsedCoverConcept {
  number: number | null;
  name: string | null;
  text: string;
  baselineImageRef: number | null;
  imageRefs: number[];
  insertAfterBodyChildIndex: number;
}
declare function parseCoverConceptMarker(line: string): { number: number | null; name: string | null } | null;
declare function parseCoverConcepts(items: CoverItem[]): ParsedCoverConcept[];
declare function sanitizeCoverImageFilename(raw: string): string;
declare function buildCoverBaselineFilename(name: string | null, number: number | null): string;
declare function buildCoverArchiveFilename(baselineFilename: string, stamp: string): string;

// Drive helpers defined at flat scope in Code.ts; declared here so other
// source files (CoverImageGenerator, etc.) type-check in the GAS bundle.
declare function getOrCreateDriveFolderByName_(folderName: string, parentId?: string): string;
declare function assertInsideEditorLLMRoot_(folderId: string): void;
declare function deduplicateTtsOps(passage: string, ops: TtsOperation[]): TtsOperation[];
declare function httpFetchWithRetry(
  url: string,
  fetchOpts: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions,
  cfg: {
    maxRetries: number;
    baseMs: number;
    label: string;
    shouldRetry: (response: GoogleAppsScript.URL_Fetch.HTTPResponse, attempt: number) => boolean;
  }
): GoogleAppsScript.URL_Fetch.HTTPResponse;
declare function httpComputeBaseMs(inputBytes: number, opts?: { minMs?: number; maxMs?: number; bytesPerMs?: number }): number;
declare function httpParseRetryAfterMs(headers: Record<string, string | undefined>, nowMs: number): number | null;
declare function buildEllipsisBreakDirectives(): DirectiveCreate[];
declare function firstLineForMatchText(matchText: string): string;
declare const TTS_DEFAULT_STABILITY: number;
declare const TTS_DEFAULT_SIMILARITY_BOOST: number;
declare function applyTtsOperationDefaults(op: TtsOperation): { op: TtsOperation; appliedStability: boolean; appliedSimilarityBoost: boolean };
declare const H1_BREAK_MS: number;
declare const H2_BREAK_MS: number;
declare const H3_PLUS_BREAK_MS: number;
declare const HEADING_MATCH_TEXT_MAX_CHARS: number;
declare function getHeadingDurationMsForLevel(level: number): number;
declare function computeHeadingBreakBoundaries(paragraphLevels: Array<number | null>): Array<{ atParagraphIndex: number; durationMs: number }>;
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

// ── Audio Manifest types ──────────────────────────────────────────────────────
// PartialManifestKind and PartialManifest are defined in client/server-types.d.ts
// (included by both tsconfigs). Only the ambient function declaration lives here.

declare function buildSpecialManifest_(tabName: string, allowMultiple: boolean): AudioManifest | null;
declare function exportPartialManifest(tabName: string): PartialManifest | null;

// ── ElevenLabs types ──────────────────────────────────────────────────────────
// ElevenLabsVoice, ElevenLabsModel, ElevenLabsPronunciationRule,
// ElevenLabsPronunciationDictionary, and ElevenLabsLastGenMeta are defined in
// client/server-types.d.ts (included by both tsconfigs).

/**
 * One entry in the `pronunciation_dictionary_locators` array sent to the
 * ElevenLabs TTS endpoint.  At most 3 locators are allowed per request.
 * Server-only — never returned to the client as JSON.
 */
interface ElevenLabsPronunciationDictionaryLocator {
  pronunciation_dictionary_id: string;
  version_id:                  string;
}

// ── Agent export / import types ───────────────────────────────────────────────

/**
 * A single agent entry in an export payload.
 * Tab content fields are included so the agent can be fully reconstructed
 * in another document without needing access to the source document.
 */
interface AgentExportEntry {
  displayName:          string;
  tag:                  string;
  systemPrompt:         string;
  workflows:            { w2: boolean; w3: boolean; w6: boolean };
  instructionTabName?:  string;
  instructionTabContent?: string;
  contextTabName?:      string;
  contextTabContent?:   string;
}

/**
 * Top-level envelope for a portable agent export JSON blob.
 */
interface AgentExportPayload {
  version:    1;
  exportedAt: string;
  agents:     AgentExportEntry[];
}

// ── Agentic Team types ────────────────────────────────────────────────────────

/**
 * A named, ordered list of custom agent IDs that run together
 * on a source tab for an Agentic Team Analysis.
 */
interface AgentTeamDefinition {
  /** Stable UUID (no dashes). */
  id:        string;
  /** Human-readable team name. */
  name:      string;
  /** Ordered list of custom agent IDs. */
  agentIds:  string[];
  /** Where this team definition is stored. */
  storedIn:  'user' | 'document';
  /** Unix timestamp (ms) of creation. */
  createdAt: number;
  /** Owner email — set when storedIn === 'document'. */
  ownerEmail?: string;
}

/**
 * Export envelope for agent teams — same structure as AgentExportPayload
 * but for teams.
 */
interface AgentTeamExportPayload {
  version:    1;
  exportedAt: string;
  teams:      AgentTeamDefinition[];
}

/**
 * Progress checkpoint stored in Document Properties while an analysis is running.
 * Key: `team_analysis_progress::<sourceTabName>::<dateStr>` (e.g. "09/05/2026")
 */
interface TeamAnalysisProgress {
  /** Index of the last fully processed paragraph (0-based). */
  lastProcessedIndex: number;
  /** Total paragraph count extracted from source tab at start of run. */
  totalParagraphs:    number;
  /** Name of the output tab (e.g. "Agentic Analysis 09/05/2026"). */
  outputTabName:      string;
}

/**
 * Return value from startOrContinueTeamAnalysis().
 */
interface TeamAnalysisResult {
  status:         'complete' | 'continuing' | 'error';
  processedCount: number;
  totalCount:     number;
  outputTabName:  string;
  error?:         string;
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
    readonly PUBLISHER_COPYRIGHT:          'Copyright';
    readonly PUBLISHER_ABOUT_AUTHOR:       'About The Author';
    readonly PUBLISHER_SALES:              'Sales';
    readonly PUBLISHER_HOOKS:              'Hooks';
    readonly PUBLISHER_COVER:              'Cover';
    readonly PUBLISHER_VISUAL_STYLES:        'Visual Styles';
    readonly PUBLISHER_OPENING_CREDITS:      'Opening Audio Credits';
    readonly PUBLISHER_CLOSING_CREDITS:      'Closing Audio Credits';
  };
  readonly DRIVE_FOLDERS: {
    readonly ROOT:  'EditorLLM';
    readonly BOOKS: 'Books';
    readonly EPUB:  'EPUB';
    readonly AUDIO: 'Audio';
  };
  readonly NEVER_PROCESSED_TABS: readonly string[];
  readonly HIGHLIGHT_COLOR:      string;
  readonly AGENT_COMMENT_PREFIX: string;
  readonly COMMENT_ANCHOR_TAB:   string;
};
