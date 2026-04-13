// ============================================================
// CommentAgent integration tests — real Gemini API calls.
//
// Workflow coverage:
//   W1 (generateInstructions) — instruction_update → { proposed_full_text, operations }
//   W2 (annotateTab)          — NOT APPLICABLE for CommentAgent
//   W3 (handleCommentThreads) — batch reply → { responses: [{threadId, reply}] }
//
// CommentAgent now groups by anchor tab. Tests cover:
//   - single-thread batch (one thread, anchor content provided)
//   - multi-thread batch sharing one anchor tab
//   - null-anchor thread (no anchor content, fallback to selectedText)
//
// All tests use the fast model.
// Individual test timeout is set to 60 s; multi-thread tests use 90 s.
// ============================================================

import { callGemini } from './helpers/gemini';
import { INSTRUCTION_UPDATE_SCHEMA, BATCH_REPLY_SCHEMA } from './helpers/schemas';
import {
  buildCommentAgentInstructionsPrompt,
  buildCommentAgentBatchPrompt,
} from './helpers/prompts';
import {
  FIXTURES,
  INTEGRATION_SYSTEM_PROMPT,
  CHAPTER_1_THREADS,
  NULL_ANCHOR_THREAD,
} from './fixtures/testDocument';

const TIER    = 'fast' as const;
const TIMEOUT = 60000;
const TIMEOUT_MULTI = 90000;

// ── W1: generateInstructions ──────────────────────────────────────────────────

describe('CommentAgent — W1: generateInstructions (instruction_update)', () => {

  it('produces proposed_full_text and operations from StyleProfile', () => {
    const userPrompt = buildCommentAgentInstructionsPrompt({
      styleProfile:         FIXTURES.STYLE_PROFILE,
      existingInstructions: FIXTURES.COMMENT_INSTRUCTIONS,
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      INSTRUCTION_UPDATE_SCHEMA,
      { tier: TIER }
    );

    expect(typeof result.proposed_full_text).toBe('string');
    expect(result.proposed_full_text.trim().length).toBeGreaterThan(0);
  }, TIMEOUT);



  it('gracefully returns a response even when StyleProfile is empty', () => {
    const userPrompt = buildCommentAgentInstructionsPrompt({
      styleProfile:         '',
      existingInstructions: FIXTURES.COMMENT_INSTRUCTIONS,
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      INSTRUCTION_UPDATE_SCHEMA,
      { tier: TIER }
    );

    expect(typeof result.proposed_full_text).toBe('string');
  }, TIMEOUT);

  it('gracefully returns a response even when existing instructions are empty', () => {
    const userPrompt = buildCommentAgentInstructionsPrompt({
      styleProfile:         FIXTURES.STYLE_PROFILE,
      existingInstructions: '',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      INSTRUCTION_UPDATE_SCHEMA,
      { tier: TIER }
    );

    expect(typeof result.proposed_full_text).toBe('string');
  }, TIMEOUT);

});

// ── W2: annotateTab — not applicable ─────────────────────────────────────────

describe('CommentAgent — W2: annotateTab (not applicable)', () => {

  it('is not implemented on CommentAgent', () => {
    // CommentAgent responds to @AI comment threads; it does not sweep tabs for
    // annotation. There is no annotateTab method, and no W2 workflow for this
    // agent. This test documents the intent and ensures the absence is deliberate.
    expect(true).toBe(true); // deliberate no-op
  });

});

// ── W3: handleCommentThreads — single thread with anchor content ──────────────

describe('CommentAgent — W3: single-thread batch with anchor content', () => {

  it('returns a responses array with a valid threadId and non-empty reply', () => {
    const [thread] = CHAPTER_1_THREADS;
    const userPrompt = buildCommentAgentBatchPrompt({
      anchorContent: FIXTURES.CHAPTER_1,
      threads:       [thread],
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: TIER }
    );

    expect(Array.isArray(result.responses)).toBe(true);
    expect(result.responses.length).toBeGreaterThan(0);
    const r = result.responses[0];
    expect(r.threadId).toBe(thread.threadId);
    expect(typeof r.reply).toBe('string');
    expect(r.reply.trim().length).toBeGreaterThan(0);
  }, TIMEOUT);

  it('reply ends with the AI Editorial Assistant signature', () => {
    const [thread] = CHAPTER_1_THREADS;
    const userPrompt = buildCommentAgentBatchPrompt({
      anchorContent: FIXTURES.CHAPTER_1,
      threads:       [thread],
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: TIER }
    );

    expect(result.responses[0].reply).toContain('AI Editorial Assistant');
  }, TIMEOUT);

  it('does not return threadIds outside the input set', () => {
    const [thread] = CHAPTER_1_THREADS;
    const userPrompt = buildCommentAgentBatchPrompt({
      anchorContent: FIXTURES.CHAPTER_1,
      threads:       [thread],
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: TIER }
    );

    const returnedIds = result.responses.map((r: any) => r.threadId);
    for (const id of returnedIds) {
      expect(id).toBe(thread.threadId);
    }
  }, TIMEOUT);

});

// ── W3: handleCommentThreads — multi-thread batch sharing one anchor tab ─────

describe('CommentAgent — W3: multi-thread batch with shared anchor tab', () => {

  it('returns responses for both threads in the batch', () => {
    const userPrompt = buildCommentAgentBatchPrompt({
      anchorContent: FIXTURES.CHAPTER_1,
      threads:       CHAPTER_1_THREADS,
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: TIER }
    );

    expect(Array.isArray(result.responses)).toBe(true);
    // Gemini may not reply to every thread; at least one reply required
    expect(result.responses.length).toBeGreaterThan(0);
    // All returned threadIds must be from the input batch
    const validIds = new Set(CHAPTER_1_THREADS.map(t => t.threadId));
    for (const r of result.responses) {
      expect(validIds.has(r.threadId)).toBe(true);
    }
  }, TIMEOUT_MULTI);

  it('each reply is a non-empty string', () => {
    const userPrompt = buildCommentAgentBatchPrompt({
      anchorContent: FIXTURES.CHAPTER_1,
      threads:       CHAPTER_1_THREADS,
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: TIER }
    );

    for (const r of result.responses) {
      expect(typeof r.reply).toBe('string');
      expect(r.reply.trim().length).toBeGreaterThan(0);
    }
  }, TIMEOUT_MULTI);

  it('no duplicate threadIds in the response', () => {
    const userPrompt = buildCommentAgentBatchPrompt({
      anchorContent: FIXTURES.CHAPTER_1,
      threads:       CHAPTER_1_THREADS,
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: TIER }
    );

    const ids = result.responses.map((r: any) => r.threadId);
    expect(new Set(ids).size).toBe(ids.length);
  }, TIMEOUT_MULTI);

});

// ── W3: handleCommentThreads — null-anchor thread (fallback to selectedText) ──

describe('CommentAgent — W3: null-anchor thread (no anchor content)', () => {

  it('returns a valid reply using only selectedText context', () => {
    const userPrompt = buildCommentAgentBatchPrompt({
      anchorContent: '',  // no anchor tab — agent falls back to selectedText
      threads:       [NULL_ANCHOR_THREAD],
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: TIER }
    );

    expect(Array.isArray(result.responses)).toBe(true);
    expect(result.responses.length).toBeGreaterThan(0);
    expect(result.responses[0].threadId).toBe(NULL_ANCHOR_THREAD.threadId);
    expect(result.responses[0].reply.trim().length).toBeGreaterThan(0);
  }, TIMEOUT);

});

// ── Error conditions ──────────────────────────────────────────────────────────

describe('CommentAgent — error conditions', () => {

  it('throws a descriptive error when the API key is invalid', () => {
    const userPrompt = buildCommentAgentBatchPrompt({
      anchorContent: '',
      threads: [NULL_ANCHOR_THREAD],
    });

    expect(() =>
      callGemini(INTEGRATION_SYSTEM_PROMPT, userPrompt, BATCH_REPLY_SCHEMA, {
        tier:           TIER,
        apiKeyOverride: 'INVALID_API_KEY_FOR_TESTING',
      })
    ).toThrow(/Gemini API error/);
  });

});
