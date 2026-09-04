// ============================================================
// agentHelpers.ts — Pure helper functions shared across agents.
//
// GAS build ("module": "none"): compiled to flat-scope function
// declarations; export statements compile to harmless
// Object.defineProperty calls that fixgas.js strips.
//
// Experimental layer (src/experimental/): imported via ES module
// syntax since that directory is excluded from the GAS build and
// runs only under ts-jest with its own tsconfig.
// ============================================================

// ── StyleProfile validation ───────────────────────────────────────────────────

/**
 * Throws with a user-facing message if content is empty or < 200 chars.
 * Mirrors BaseAgent.assertStyleProfileValid_ for callers outside the class
 * hierarchy (AgentInterpreter, future standalone workflows).
 */
export function assertStyleProfileValid(content: string): void {
  if (!content.trim() || content.trim().length < 200) {
    throw new Error(
      '[EditorLLM] StyleProfile is empty or incomplete (< 200 chars). ' +
      'Run "Architect → Generate Instructions" before this workflow.'
    );
  }
}

// ── Markdown extraction guard ─────────────────────────────────────────────────

/**
 * Mirrors GeneralPurposeAgent.extractMarkdownFromJsonWrapper_.
 * Strips a JSON code-fence wrapper if Gemini ignores the "plain markdown"
 * instruction and wraps the response in ```json { ... } ```.
 */
export function extractMarkdownFromJsonWrapper(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('#') || !trimmed.startsWith('`')) return trimmed;

  const withoutFence = trimmed
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  try {
    const parsed = JSON.parse(withoutFence);
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object') {
      for (const val of Object.values(parsed)) {
        if (typeof val === 'string' && (val as string).trim().length > 0) return val as string;
      }
    }
  } catch { /* not JSON — fall through */ }

  return withoutFence;
}

// ── Prompt builder ────────────────────────────────────────────────────────────

/**
 * Mirrors BaseAgent.buildStandardPrompt exactly — same template-literal
 * escaping, same join separator, same trim().
 */
export function buildStandardPrompt(
  sections: Record<string, string | undefined | null>,
  instructions: string
): string {
  const formattedParts = Object.entries(sections)
    .map(([title, content]) => `## ${title}\n\n${content || '(not provided)'}\n`);
  return [...formattedParts, `\n## Instructions\n\n${instructions || '(not provided)'}`]
    .join('\n')
    .trim();
}

// ── Operation validation ──────────────────────────────────────────────────────

/**
 * Mirrors BaseAgent.validateAndFilterOperations_ without Tracer logging
 * (Tracer is a GAS side-effect not available in the test interpreter).
 */
export function validateOps(
  ops: Array<{ match_text: string; reason: string }>,
  passage: string
): Array<{ match_text: string; reason: string }> {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const normPassage = norm(passage);
  return ops.filter(op =>
    op.match_text?.trim() &&
    op.reason?.trim() &&
    normPassage.includes(norm(op.match_text))
  );
}

function normalizeEarTuneReasonText_(s: string): string {
  return s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, '\'')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function extractEarTuneSuggestedRewrite_(reason: string): string | null {
  const mainReason = reason.split(/\n##\s+Phonetic Lexicon Suggestions\b/i)[0];
  const m = mainReason.match(/Suggested rewrite:\s*(?:"([^"]+)"|“([^”]+)”)/i);
  const rewrite = (m?.[1] ?? m?.[2] ?? '').trim();
  return rewrite || null;
}

export function validateEarTuneOps(
  ops: Array<{ match_text: string; reason: string }>,
  passage: string
): Array<{ match_text: string; reason: string }> {
  const grounded = validateOps(ops, passage);
  const normalizedPassage = normalizeEarTuneReasonText_(passage);

  return grounded.filter(op => {
    const rewrite = extractEarTuneSuggestedRewrite_(op.reason);
    if (!rewrite) return false;
    return !normalizedPassage.includes(normalizeEarTuneReasonText_(rewrite));
  });
}

/**
 * Sorts `ops` by the position of their `match_text` in `passage` (document
 * order), then removes consecutive operations whose TTS parameters are
 * identical to the immediately preceding one.
 *
 * Pure function — no GAS globals, no Tracer calls.  Used by TtsAgent.annotateTab
 * and testable in Node.js.
 *
 * Precondition: every op in `ops` has a `match_text` that exists in `passage`
 * (i.e. validateOps has already been applied).
 */
/**
 * Builds synthetic break directives that pause 1 s at every ellipsis in the
 * tab.  Always emits BOTH a literal `"..."` (three ASCII periods) and the
 * Unicode `"…"` (U+2026 HORIZONTAL ELLIPSIS) directive — Google Docs
 * auto-substitutes the latter for the former under common autocorrect
 * settings, so we cover both unconditionally.  No passage scan; if the marker
 * is absent CollaborationService.createBookmarkDirectives_ logs a benign warn
 * and skips it.  Cheaper and simpler than scanning here.
 *
 * Each directive uses `apply_to: 'every_occurrence'` so CollaborationService
 * fans it out to all matches via findAllTextOccurrences_.
 *
 * Wire format: payload key is `timeMs` (what Code.ts audio renderer reads),
 * not `duration_ms` (the prompt-facing field on TtsBreakOperation).
 *
 * Pure function — no GAS globals.
 */
export function buildEllipsisBreakDirectives(): DirectiveCreate[] {
  return [
    { match_text: '...', type: 'break', payload: { timeMs: 1000 }, apply_to: 'every_occurrence' },
    { match_text: '…',   type: 'break', payload: { timeMs: 1000 }, apply_to: 'every_occurrence' },
  ];
}

/**
 * Reduces a (possibly multi-line) `match_text` to its first non-empty line,
 * trimmed.  Required because `Body.findText()` in GAS does NOT span paragraph
 * boundaries — a regex containing literal `\n` cannot match because each
 * paragraph is a separate text element with no `\n` in its content.
 *
 * The LLM, under strict-schema pressure with no length cap on `match_text`,
 * sometimes emits a multi-paragraph chunk to mark the start of a transition
 * (e.g. for the very first directive in a tab, it may dump the first three
 * paragraphs into match_text).  We normalise here so the find succeeds on
 * the first paragraph — which is exactly the position the model intended.
 *
 * Returns the input unchanged when it's already single-line.
 *
 * Pure function — no GAS globals.
 */
export function firstLineForMatchText(matchText: string): string {
  if (!matchText) return matchText;
  // Split on any line break (LF, CR, or VT) and take the first non-empty.
  const lines = matchText.split(/[\r\n\v]+/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return matchText.trim();
}

/**
 * Heading-break duration constants, in milliseconds.  Used by the auto-break
 * pass that emits silence before and after every heading paragraph.
 *
 * Picked at the low-to-mid range of pro audiobook conventions
 * (Audible/ACX: H1 2-5s, H2 1-3s, H3+ 0.5-1s).
 */
export const H1_BREAK_MS = 3250;
export const H2_BREAK_MS = 2250;
export const H3_PLUS_BREAK_MS = 1250;

/**
 * Maps a heading level (1-6) to the auto-break duration in ms.
 * Level outside 1-6 returns 0 (caller should not emit a break).
 *
 * Pure function — no GAS globals.
 */
export function getHeadingDurationMsForLevel(level: number): number {
  if (level === 1) return H1_BREAK_MS;
  if (level === 2) return H2_BREAK_MS;
  if (level >= 3 && level <= 6) return H3_PLUS_BREAK_MS;
  return 0;
}

/**
 * Given a list of heading levels per paragraph (1-6 for H1-H6, null for
 * non-heading paragraphs), returns one entry per heading-adjacent paragraph
 * boundary describing where to anchor a break and what duration to use.
 *
 * Per-boundary algorithm (Approach B):
 *   - boundary i sits before paragraph index i (i.e. between ¶i-1 and ¶i)
 *   - if neither side is a heading: skip
 *   - if both sides are headings: duration = min(left, right) — adjacent
 *     headings collapse to one tighter break
 *   - else: duration = the one heading's level duration
 *
 * The returned `atParagraphIndex` is the index of the paragraph the break
 * anchors to (i.e. the break fires BEFORE that paragraph's text).  A boundary
 * "after the last paragraph" is intentionally not emitted — there is nothing
 * to anchor to and the trailing-break rule would discard it anyway.
 *
 * Pure function — no GAS globals.
 */
export function computeHeadingBreakBoundaries(
  paragraphLevels: Array<number | null>
): Array<{ atParagraphIndex: number; durationMs: number }> {
  const out: Array<{ atParagraphIndex: number; durationMs: number }> = [];
  for (let i = 0; i < paragraphLevels.length; i++) {
    const left  = i > 0 ? paragraphLevels[i - 1] : null;
    const right = paragraphLevels[i];
    const leftIsHeading  = left  !== null && left  !== undefined;
    const rightIsHeading = right !== null && right !== undefined;
    if (!leftIsHeading && !rightIsHeading) continue;

    let dur: number;
    if (leftIsHeading && rightIsHeading) {
      dur = Math.min(getHeadingDurationMsForLevel(left as number), getHeadingDurationMsForLevel(right as number));
    } else if (rightIsHeading) {
      dur = getHeadingDurationMsForLevel(right as number);
    } else {
      dur = getHeadingDurationMsForLevel(left as number);
    }
    if (dur > 0) out.push({ atParagraphIndex: i, durationMs: dur });
  }
  return out;
}

/**
 * Maximum number of characters used as `match_text` for a heading-break
 * directive.  Long enough that body-paragraph prefixes are normally unique
 * within a tab; short enough not to bloat directive metadata.  Always paired
 * with `firstLineForMatchText` first to avoid soft-line-break failures inside
 * a paragraph (Body.findText does not span line breaks).
 */
export const HEADING_MATCH_TEXT_MAX_CHARS = 80;

/**
 * Project-wide TTS parameter defaults.  Mirrors ElevenLabsService default
 * voice_settings — used when LLM emits 0 / null / undefined under strict-schema
 * pressure (see TtsAgent.annotateTab post-process).
 */
export const TTS_DEFAULT_STABILITY = 0.5;
export const TTS_DEFAULT_SIMILARITY_BOOST = 0.75;

/**
 * Replaces 0 / null / undefined / NaN values for `stability` and
 * `similarity_boost` with project defaults.  Returns a NEW op when any field
 * was substituted (so the original LLM output remains untouched), otherwise
 * the input op by reference.
 *
 * Why 0 is treated as a substitution sentinel: under OpenAI strict-schema
 * mode the field is required, but the W2 prompt instructs the model not to
 * guess when the Cast Role Policy lacks a concrete value.  The model resolves
 * the conflict by emitting 0.  In practice no operator legitimately wants 0
 * for these parameters; treat 0 as "model gave up" and apply defaults.
 *
 * Pure function — no GAS globals.
 */
export function applyTtsOperationDefaults(op: TtsOperation): { op: TtsOperation; appliedStability: boolean; appliedSimilarityBoost: boolean } {
  const stabBad = !Number.isFinite(op.stability) || op.stability <= 0;
  const simBad  = !Number.isFinite(op.similarity_boost) || op.similarity_boost <= 0;
  if (!stabBad && !simBad) {
    return { op, appliedStability: false, appliedSimilarityBoost: false };
  }
  return {
    op: {
      ...op,
      stability:        stabBad ? TTS_DEFAULT_STABILITY        : op.stability,
      similarity_boost: simBad  ? TTS_DEFAULT_SIMILARITY_BOOST : op.similarity_boost,
    },
    appliedStability: stabBad,
    appliedSimilarityBoost: simBad,
  };
}

export function deduplicateTtsOps(passage: string, ops: TtsOperation[]): TtsOperation[] {
  const normPassage = passage.replace(/\s+/g, ' ').toLowerCase();

  // Sort by first occurrence of the normalised match_text in the passage.
  const pos = (op: TtsOperation) =>
    normPassage.indexOf(op.match_text.replace(/\s+/g, ' ').toLowerCase());

  const sorted = ops.slice().sort((a, b) => pos(a) - pos(b));

  // Remove consecutive ops whose TTS params are identical.
  const result: TtsOperation[] = [];
  let last: TtsOperation | null = null;
  for (const op of sorted) {
    if (
      !last ||
      op.tts_model        !== last.tts_model ||
      op.voice_id         !== last.voice_id ||
      op.stability        !== last.stability ||
      op.similarity_boost !== last.similarity_boost
    ) {
      result.push(op);
      last = op;
    }
  }
  return result;
}

/**
 * Returns the previous request IDs to pass to ElevenLabs for a given voice,
 * given the accumulated per-voice history map.
 *
 * Stitching is voice-scoped: passing request IDs from a different voice has no
 * meaningful effect on prosody and may degrade quality.  This helper keeps that
 * rule in one testable place.
 *
 * @param voiceId       The voice being used for the current segment.
 * @param historyByVoice  Running map of voiceId → list of prior request IDs.
 * @param useStitching  When false the function always returns [].
 */
export function stitchingIdsForVoice(
  voiceId: string,
  historyByVoice: Record<string, string[]>,
  useStitching: boolean
): string[] {
  if (!useStitching) return [];
  return (historyByVoice[voiceId] ?? []).slice();
}

/**
 * Records a completed request ID into the per-voice history map (mutates in place).
 * Returns the map for convenience.
 */
export function recordRequestId(
  voiceId: string,
  requestId: string,
  historyByVoice: Record<string, string[]>
): Record<string, string[]> {
  if (!requestId) return historyByVoice;
  if (!historyByVoice[voiceId]) historyByVoice[voiceId] = [];
  historyByVoice[voiceId].push(requestId);
  return historyByVoice;
}

// ── Gemini JSON schemas ───────────────────────────────────────────────────────
// Mirrors BaseAgent.instructionUpdateSchema_(), annotationSchema_(), batchReplySchema_().

export function instructionUpdateSchema(): object {
  return {
    type: 'object',
    properties: {
      proposed_full_text: { type: 'string' },
    },
    required: ['proposed_full_text'],
  };
}

export function annotationOperationsSchema(): object {
  return {
    type: 'object',
    properties: {
      operations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            match_text: { type: 'string' },
            reason:     { type: 'string' },
          },
          required: ['match_text', 'reason'],
        },
      },
    },
    required: ['operations'],
  };
}

export function ttsDirectivesSchema(): object {
  return {
    type: 'object',
    properties: {
      operations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            match_text: { type: 'string' },
            tts_model:  { type: 'string' },
            voice_id:   { type: 'string' },
            stability:  { type: 'number' },
            similarity_boost: { type: 'number' },
          },
          required: ['match_text', 'tts_model', 'voice_id', 'stability', 'similarity_boost'],
        },
      },
    },
    required: ['operations'],
  };
}

// ── Directive codecs + storage keys ─────────────────────────────────────────

/** Prefix for named ranges that represent non-annotation directives. */
export const DIRECTIVE_RANGE_PREFIX = 'directive_';

/** Prefix for DocumentProperties entries that store directive payloads. */
export const DIRECTIVE_PROP_PREFIX = 'directive:';

/** Same sanitizer as CollaborationService / Code.ts for the agent prefix only. */
export function sanitizeDirectiveNamePart_(s: string): string {
  return String(s).replace(/[^a-zA-Z0-9_]/g, '');
}

function sanitizeDirectiveAgent_(s: string): string {
  return sanitizeDirectiveNamePart_(s).replace(/_/g, '');
}

function sanitizeDirectiveId_(s: string): string {
  return String(s).replace(/[^a-zA-Z0-9]/g, '');
}

/** Fields encoded into the middle wire segment for TTS bookmark directives. */
export interface TtsDirectivePayloadFields {
  tts_model: string;
  voice_id: string;
  stability: number;
  similarity_boost: number;
}

/** Body of bookmark wire segment (after the separating `_` before bookmark). */
const BOOKMARK_WIRE_BODY_RE = /^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)?$/;

/** TTS-only: tail of encoded payload …_<stab1000>_<sim1000> (RTL-safe). */
const TTS_MIDDLE_TAIL_RE = /_(\d{1,4})_(\d{1,4})$/;

function toThousandths_(x: number): number {
  return Math.max(0, Math.min(1000, Math.round(Number(x) * 1000)));
}

function fromThousandths_(n: number): number {
  return Math.round(n) / 1000;
}

function assertVoiceIdNoUnderscore_(voiceId: string): void {
  if (voiceId.includes('_')) {
    throw new Error(`TTS voice_id must not contain '_': "${voiceId}"`);
  }
}

/** At most one '.'; no '_' in raw (reserved for the single dot encoding). */
export function assertBookmarkIdWireable_(bookmarkId: string): void {
  const dots = (bookmarkId.match(/\./g) || []).length;
  if (dots > 1) {
    throw new Error(`TTS directive bookmark id must contain at most one '.', got "${bookmarkId}"`);
  }
  if (bookmarkId.includes('_')) {
    throw new Error(`TTS directive bookmark id must not contain '_': "${bookmarkId}"`);
  }
}

export function bookmarkIdToWire_(bookmarkId: string): string {
  assertBookmarkIdWireable_(bookmarkId);
  return bookmarkId.replace('.', '_');
}

export function wireToBookmarkId_(wire: string): string {
  const us = (wire.match(/_/g) || []).length;
  if (us > 1) {
    throw new Error(`Invalid TTS directive bookmark wire "${wire}": at most one '_'`);
  }
  return us === 0 ? wire : wire.replace('_', '.');
}

/**
 * Middle segment only: `<tts_model>_<voice_id>_<stab1000>_<sim1000>`.
 * Used as `encoded_payload` on RootUpdate and by the experimental TTS directiveEncoder.
 */
export function encodeTtsDirectiveMiddleWire(op: TtsDirectivePayloadFields): string {
  assertVoiceIdNoUnderscore_(op.voice_id);
  const s1 = toThousandths_(op.stability);
  const s2 = toThousandths_(op.similarity_boost);
  return `${op.tts_model}_${op.voice_id}_${s1}_${s2}`;
}

export function makeDirectivePropertyKey_(directiveId: string): string {
  const safeId = sanitizeDirectiveId_(directiveId);
  if (!safeId) {
    throw new Error(`Directive ID must contain at least one alphanumeric character, got "${directiveId}"`);
  }
  return `${DIRECTIVE_PROP_PREFIX}${safeId}`;
}

/**
 * Full named range name for a generic directive:
 *   directive_<agent>_<directiveId>_<bookmarkWire>
 */
export function encodeDirectiveNamedRangeName(
  agentPrefixRaw: string,
  directiveIdRaw: string,
  bookmarkIdRaw: string
): string {
  const safeAgent = sanitizeDirectiveAgent_(agentPrefixRaw);
  if (!/^[A-Za-z0-9]+$/.test(safeAgent)) {
    throw new Error(
      `Directive agent prefix must be alphanumeric after sanitization, got "${safeAgent}"`
    );
  }
  const safeId = sanitizeDirectiveId_(directiveIdRaw);
  if (!safeId) {
    throw new Error(`Directive ID must contain at least one alphanumeric character, got "${directiveIdRaw}"`);
  }
  const bmWire = bookmarkIdToWire_(bookmarkIdRaw);
  return `${DIRECTIVE_RANGE_PREFIX}${safeAgent}_${safeId}_${bmWire}`;
}

function bookmarkWireCandidateValid_(bookmarkWire: string): boolean {
  if (!BOOKMARK_WIRE_BODY_RE.test(bookmarkWire)) return false;
  try {
    wireToBookmarkId_(bookmarkWire);
    return true;
  } catch {
    return false;
  }
}

type DirectiveNameParts_ = {
  agent: string;
  directiveId: string;
  bookmarkWire: string;
  bookmarkRaw: string;
};

/**
 * Splits a directive named range into agent, directive id, and bookmark wire.
 * Format:
 *   directive_<agent>_<directiveId>_<bookmarkWire>
 */
export function splitDirectiveNamedRangeName(name: string): {
  agent: string;
  directiveId: string;
  bookmarkWire: string;
  bookmarkRaw: string;
} | null {
  if (!name.startsWith(DIRECTIVE_RANGE_PREFIX)) return null;
  const rest = name.slice(DIRECTIVE_RANGE_PREFIX.length);
  const parts = rest.split('_');
  if (parts.length < 3) return null;

  const agent = parts[0];
  const directiveId = parts[1];
  const bookmarkWire = parts.slice(2).join('_');

  if (!/^[A-Za-z0-9]+$/.test(agent)) return null;
  if (!/^[A-Za-z0-9]+$/.test(directiveId)) return null;
  if (!bookmarkWireCandidateValid_(bookmarkWire)) return null;

  return {
    agent,
    directiveId,
    bookmarkWire,
    bookmarkRaw: wireToBookmarkId_(bookmarkWire),
  };
}

export type DecodeDirectiveNamedRangeNameResult =
  | {
      ok: true;
      agent: string;
      directiveId: string;
      /** Wire suffix as stored in the named range (after dot→underscore rules). */
      bookmarkId: string;
      /** Decoded GAS bookmark id (inverse of bookmarkIdToWire_). */
      bookmarkRaw: string;
      parseError: null;
    }
  | { ok: false; reason: string };

export type DecodeTtsDirectiveMiddleResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * Parses the TTS-specific middle wire (`<tts_model>_<voice_id>_<stab1000>_<sim1000>`).
 * Uses {@link TTS_MIDDLE_TAIL_RE} on the payload only (RTL numeric tail, then
 * `lastIndexOf('_')` for model vs voice).
 */
export function decodeTtsDirectiveMiddleWire(encodedPayload: string): DecodeTtsDirectiveMiddleResult {
  const mTail = encodedPayload.match(TTS_MIDDLE_TAIL_RE);
  if (!mTail) return { ok: false, reason: 'bad_tts_tail' };
  const stabT = parseInt(mTail[1], 10);
  const simT = parseInt(mTail[2], 10);
  if (!Number.isFinite(stabT) || !Number.isFinite(simT)) {
    return { ok: false, reason: 'bad_tts_numeric_tail' };
  }
  const prefix = encodedPayload.slice(0, encodedPayload.length - mTail[0].length);
  const li = prefix.lastIndexOf('_');
  if (li <= 0) return { ok: false, reason: 'no_voice_split' };
  const tts_model = prefix.slice(0, li);
  const voice_id = prefix.slice(li + 1);
  if (!tts_model || !voice_id) return { ok: false, reason: 'empty_model_or_voice' };
  if (voice_id.includes('_')) return { ok: false, reason: 'voice_has_underscore' };
  return {
    ok: true,
    payload: {
      tts_model:        tts_model,
      voice_id:         voice_id,
      stability:        fromThousandths_(stabT),
      similarity_boost: fromThousandths_(simT),
    },
  };
}

/**
 * Parses any directive named range:
 *   directive_<agent>_<directiveId>_<bookmarkWire>
 */
export function decodeDirectiveNamedRangeName(name: string): DecodeDirectiveNamedRangeNameResult {
  const parts = splitDirectiveNamedRangeName(name);
  if (!parts) return { ok: false, reason: 'not_directive_name' };
  return {
    ok:         true,
    agent:      parts.agent,
    directiveId: parts.directiveId,
    bookmarkId: parts.bookmarkWire,
    bookmarkRaw: parts.bookmarkRaw,
    parseError: null,
  };
}

export function threadRepliesSchema(): object {
  return {
    type: 'object',
    properties: {
      responses: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            threadId: { type: 'string' },
            reply:    { type: 'string' },
          },
          required: ['threadId', 'reply'],
        },
      },
    },
    required: ['responses'],
  };
}

/**
 * DocumentProperties keys for W1 instruction-quality scores.
 * Pattern: `${agentId}_score`, `${agentId}_rationale`, `${agentId}_eval_ts`.
 * `agentId` must match `BaseAgent.getAgentId()` and `AgentDefinition.id`.
 */
export function instructionQualityDocumentPropKeysForAgentId_(agentId: string): {
  score: string;
  rationale: string;
  ts: string;
} {
  return {
    score:     `${agentId}_score`,
    rationale: `${agentId}_rationale`,
    ts:        `${agentId}_eval_ts`,
  };
}

// ── Instruction quality (LLM-as-judge 0–5) ───────────────────────────────────

function instructionEvalScoreJsonSchema_(): object {
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
 * Fast-tier JSON judge. Persists score/rationale/ts to DocumentProperties.
 * Rubric comes from the agent; property keys use `instructionQualityDocumentPropKeysForAgentId_(agentId)`.
 * Never throws — returns score 0 with error rationale on failure.
 */
export function runInstructionQualityEval_(args: {
  gemini: (systemPrompt: string, userPrompt: string, opts: { schema: object; tier: string }) => unknown;
  logTag: string;
  rubricMarkdown: string;
  propKeys: { score: string; rationale: string; ts: string };
  markdown: string;
}): { score: number; rationale: string } {
  const EVAL_SYSTEM = 'You are an editorial-instruction quality evaluator. Respond ONLY with the JSON schema provided.';
  const EVAL_USER = `Rate the following document on a scale of 0–5.

${args.rubricMarkdown.trim()}
Return {"score": <integer 0-5>, "rationale": "<one sentence>"}

Instructions to evaluate:
---
${args.markdown}
---`;

  try {
    const result = args.gemini(EVAL_SYSTEM, EVAL_USER, {
      schema: instructionEvalScoreJsonSchema_(),
      tier:   Constants.MODEL.FAST,
    }) as { score: number; rationale: string };

    const score     = Math.max(0, Math.min(5, Math.round(result.score ?? 0)));
    const rationale = (result.rationale ?? '').slice(0, 300);
    Tracer.info(`${args.logTag} Instruction quality score=${score} — ${rationale}`);
    const pk = args.propKeys;
    DocPropsCache.writeMany({
      [pk.score]:     String(score),
      [pk.rationale]: rationale,
      [pk.ts]:        new Date().toISOString(),
    });
    return { score, rationale };
  } catch (e: any) {
    Tracer.warn(`${args.logTag} Instruction quality eval failed — ${e.message}`);
    return { score: 0, rationale: 'Evaluation failed: ' + e.message };
  }
}
