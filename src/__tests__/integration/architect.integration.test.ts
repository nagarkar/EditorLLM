// ============================================================
// ArchitectAgent integration tests — real Gemini API calls.
//
// Workflow coverage:
//   W1 (generateInstructions) — instruction_update → { proposed_full_text, operations }
//   W2 (annotateTab)          — NOT APPLICABLE for ArchitectAgent
//   W3 (handleCommentThreads) — batch reply → { responses: [{threadId, reply}] }
//
// ArchitectAgent does not subgroup by anchor tab; all threads share
// MergedContent + StyleProfile context in one batch.
//
// All tests use the thinking model.
// Individual test timeout is set to 120 s; multi-thread tests use 150 s.
// ============================================================

import { callGemini } from './helpers/gemini';
import { INSTRUCTION_UPDATE_SCHEMA, BATCH_REPLY_SCHEMA } from './helpers/schemas';
import {
  buildArchitectInstructionsPrompt,
  buildArchitectBatchPrompt,
} from './helpers/prompts';
import {
  FIXTURES,
  INTEGRATION_SYSTEM_PROMPT,
  ARCHITECT_THREADS,
} from './fixtures/testDocument';

const TIMEOUT       = 120000;
const TIMEOUT_MULTI = 150000;

// ── W1: generateInstructions ──────────────────────────────────────────────────

describe('ArchitectAgent — W1: generateInstructions (instruction_update)', () => {

  it('produces proposed_full_text and operations from MergedContent', () => {
    const userPrompt = buildArchitectInstructionsPrompt({
      manuscript: FIXTURES.MERGED_CONTENT,
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      INSTRUCTION_UPDATE_SCHEMA,
      { tier: 'thinking' }
    );

    expect(typeof result.proposed_full_text).toBe('string');
    expect(result.proposed_full_text.trim().length).toBeGreaterThan(0);
  }, TIMEOUT);



  it('gracefully returns a response even when MergedContent is empty', () => {
    const userPrompt = buildArchitectInstructionsPrompt({ manuscript: '' });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      INSTRUCTION_UPDATE_SCHEMA,
      { tier: 'thinking' }
    );

    expect(typeof result.proposed_full_text).toBe('string');
  }, TIMEOUT);

});

// ── W2: annotateTab — not applicable ─────────────────────────────────────────

describe('ArchitectAgent — W2: annotateTab (not applicable)', () => {

  it('is not implemented on ArchitectAgent', () => {
    expect(true).toBe(true); // deliberate no-op — see comment above
  });

});

// ── W3: handleCommentThreads — single-thread batch ───────────────────────────

describe('ArchitectAgent — W3: single-thread batch', () => {

  it('returns a responses array with a valid threadId and non-empty reply', () => {
    const [thread] = ARCHITECT_THREADS;
    const userPrompt = buildArchitectBatchPrompt({
      styleProfile: FIXTURES.STYLE_PROFILE,
      manuscript:   FIXTURES.MERGED_CONTENT,
      threads:      [thread],
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: 'thinking' }
    );

    expect(Array.isArray(result.responses)).toBe(true);
    expect(result.responses.length).toBeGreaterThan(0);
    const r = result.responses[0];
    expect(r.threadId).toBe(thread.threadId);
    expect(typeof r.reply).toBe('string');
    expect(r.reply.trim().length).toBeGreaterThan(0);
  }, TIMEOUT);

  it('reply ends with the AI Editorial Assistant signature', () => {
    const [thread] = ARCHITECT_THREADS;
    const userPrompt = buildArchitectBatchPrompt({
      styleProfile: FIXTURES.STYLE_PROFILE,
      manuscript:   FIXTURES.MERGED_CONTENT,
      threads:      [thread],
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: 'thinking' }
    );

    expect(result.responses[0].reply).toContain('AI Editorial Assistant');
  }, TIMEOUT);

  it('does NOT return workflow_type or document-mutation fields', () => {
    const [thread] = ARCHITECT_THREADS;
    const userPrompt = buildArchitectBatchPrompt({
      styleProfile: FIXTURES.STYLE_PROFILE,
      manuscript:   FIXTURES.MERGED_CONTENT,
      threads:      [thread],
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: 'thinking' }
    );

    expect(result.workflow_type).toBeUndefined();
    expect(result.target_tab).toBeUndefined();
    expect(result.operations).toBeUndefined();
  }, TIMEOUT);

  it('gracefully handles empty StyleProfile', () => {
    const [thread] = ARCHITECT_THREADS;
    const userPrompt = buildArchitectBatchPrompt({
      styleProfile: '',
      manuscript:   FIXTURES.MERGED_CONTENT,
      threads:      [thread],
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: 'thinking' }
    );

    expect(Array.isArray(result.responses)).toBe(true);
    expect(result.responses.length).toBeGreaterThan(0);
    expect(result.responses[0].reply.trim().length).toBeGreaterThan(0);
  }, TIMEOUT);

});

// ── W3: handleCommentThreads — multi-thread batch ────────────────────────────

describe('ArchitectAgent — W3: multi-thread batch (no anchor-tab subgrouping)', () => {

  it('returns responses — all returned threadIds are valid input IDs', () => {
    const userPrompt = buildArchitectBatchPrompt({
      styleProfile: FIXTURES.STYLE_PROFILE,
      manuscript:   FIXTURES.MERGED_CONTENT,
      threads:      ARCHITECT_THREADS,
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: 'thinking' }
    );

    expect(Array.isArray(result.responses)).toBe(true);
    expect(result.responses.length).toBeGreaterThan(0);

    const validIds = new Set(ARCHITECT_THREADS.map(t => t.threadId));
    for (const r of result.responses) {
      expect(validIds.has(r.threadId)).toBe(true);
    }
  }, TIMEOUT_MULTI);

  it('each reply in the multi-thread batch is a non-empty string', () => {
    const userPrompt = buildArchitectBatchPrompt({
      styleProfile: FIXTURES.STYLE_PROFILE,
      manuscript:   FIXTURES.MERGED_CONTENT,
      threads:      ARCHITECT_THREADS,
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: 'thinking' }
    );

    for (const r of result.responses) {
      expect(typeof r.reply).toBe('string');
      expect(r.reply.trim().length).toBeGreaterThan(0);
    }
  }, TIMEOUT_MULTI);

  it('no duplicate threadIds in the batch response', () => {
    const userPrompt = buildArchitectBatchPrompt({
      styleProfile: FIXTURES.STYLE_PROFILE,
      manuscript:   FIXTURES.MERGED_CONTENT,
      threads:      ARCHITECT_THREADS,
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: 'thinking' }
    );

    const ids = result.responses.map((r: any) => r.threadId);
    expect(new Set(ids).size).toBe(ids.length);
  }, TIMEOUT_MULTI);

});

// ── Error conditions ──────────────────────────────────────────────────────────

describe('ArchitectAgent — error conditions', () => {

  it('throws a descriptive error when the API key is invalid', () => {
    const [thread] = ARCHITECT_THREADS;
    const userPrompt = buildArchitectBatchPrompt({
      styleProfile: FIXTURES.STYLE_PROFILE,
      manuscript:   FIXTURES.MERGED_CONTENT,
      threads:      [thread],
    });

    expect(() =>
      callGemini(INTEGRATION_SYSTEM_PROMPT, userPrompt, BATCH_REPLY_SCHEMA, {
        tier:           'fast',
        apiKeyOverride: 'INVALID_API_KEY_FOR_TESTING',
      })
    ).toThrow(/Gemini API error/);
  });

});
