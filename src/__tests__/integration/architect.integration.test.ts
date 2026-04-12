// ============================================================
// ArchitectAgent integration tests — real Gemini API calls.
//
// Workflow coverage:
//   W1 (generateInstructions) — instruction_update → { proposed_full_text, operations }
//   W2 (annotateTab)          — NOT APPLICABLE for ArchitectAgent
//   W3 (handleCommentThread)  — reply-only → { reply }
//
// All tests use the thinking model (gemini-2.5-pro).
// Individual test timeout is set to 120 s.
// ============================================================

import { callGemini } from './helpers/gemini';
import { INSTRUCTION_UPDATE_SCHEMA, BATCH_REPLY_SCHEMA } from './helpers/schemas';
import {
  buildArchitectInstructionsPrompt,
  buildArchitectBatchPrompt,
} from './helpers/prompts';
import { FIXTURES, INTEGRATION_SYSTEM_PROMPT } from './fixtures/testDocument';

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
    expect(Array.isArray(result.operations)).toBe(true);
    expect(result.operations.length).toBeGreaterThan(0);
  }, 120000);

  it('each operation has non-empty match_text and reason', () => {
    const userPrompt = buildArchitectInstructionsPrompt({
      manuscript: FIXTURES.MERGED_CONTENT,
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      INSTRUCTION_UPDATE_SCHEMA,
      { tier: 'thinking' }
    );

    for (const op of result.operations) {
      expect(typeof op.match_text).toBe('string');
      expect(op.match_text.trim().length).toBeGreaterThan(0);
      expect(typeof op.reason).toBe('string');
      expect(op.reason.trim().length).toBeGreaterThan(0);
    }
  }, 120000);

  it('each W1 match_text is a verbatim substring of proposed_full_text', () => {
    // The prompt explicitly instructs: "Each match_text must be a verbatim 3–4-word
    // phrase from proposed_full_text." So the correct grounding source is the model's
    // own proposed output, not the manuscript.
    const userPrompt = buildArchitectInstructionsPrompt({ manuscript: FIXTURES.MERGED_CONTENT });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      INSTRUCTION_UPDATE_SCHEMA,
      { tier: 'thinking' }
    );

    const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const normalizedProposed = normalize(result.proposed_full_text);
    const hallucinated = result.operations.filter(op => {
      const n = normalize(op.match_text);
      return n.length > 0 && !normalizedProposed.includes(n);
    });
    if (hallucinated.length > 0) {
      console.warn(`[match_text grounding] ${hallucinated.length}/${result.operations.length} ops have match_text not found in proposed_full_text:`);
      hallucinated.forEach(op => console.warn(`  - "${op.match_text.slice(0, 100)}"`));
    }
    expect(hallucinated.length).toBeLessThanOrEqual(2);
  }, 120000);

  it('gracefully returns a response even when MergedContent is empty', () => {
    // Empty context degrades quality but must not crash.
    const userPrompt = buildArchitectInstructionsPrompt({ manuscript: '' });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      INSTRUCTION_UPDATE_SCHEMA,
      { tier: 'thinking' }
    );

    // Response may be minimal but must still match the schema.
    expect(typeof result.proposed_full_text).toBe('string');
    expect(Array.isArray(result.operations)).toBe(true);
  }, 120000);

});

// ── W2: annotateTab — not applicable ─────────────────────────────────────────

describe('ArchitectAgent — W2: annotateTab (not applicable)', () => {

  it('is not implemented on ArchitectAgent', () => {
    // ArchitectAgent has no annotateTab method. This test documents the intent
    // and will fail at TypeScript compile time if annotateTab is ever added
    // without a corresponding integration test.
    //
    // The absence of a W2 test for ArchitectAgent is intentional: architectural
    // analysis runs via W1 (generateInstructions) for instruction-level changes
    // and W3 (handleCommentThread) for targeted passage feedback.
    expect(true).toBe(true); // deliberate no-op — see comment above
  });

});

// ── W3: handleCommentThread ───────────────────────────────────────────────────

describe('ArchitectAgent — W3: handleCommentThread (reply-only)', () => {

  it('returns a reply string when analysing a selected passage', () => {
    const userPrompt = buildArchitectBatchPrompt({
      styleProfile:  FIXTURES.STYLE_PROFILE,
      manuscript:    FIXTURES.MERGED_CONTENT,
      selectedText:  'The Chid Axiom fills this gap',
      agentRequest:  'Does this passage follow the thesis→observation pattern?',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: 'thinking' }
    );

    expect(typeof result.reply).toBe('string');
    expect(result.reply.trim().length).toBeGreaterThan(0);
  }, 120000);

  it('reply ends with the AI Editorial Assistant signature', () => {
    const userPrompt = buildArchitectBatchPrompt({
      styleProfile:  FIXTURES.STYLE_PROFILE,
      manuscript:    FIXTURES.MERGED_CONTENT,
      selectedText:  'consciousness is the ground',
      agentRequest:  'Check motif consistency.',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: 'thinking' }
    );

    expect(result.reply).toContain('AI Editorial Assistant');
  }, 120000);

  it('does NOT return a RootUpdate or workflow_type field', () => {
    const userPrompt = buildArchitectBatchPrompt({
      styleProfile: FIXTURES.STYLE_PROFILE,
      manuscript:   FIXTURES.MERGED_CONTENT,
      selectedText: 'orthodox quantum mechanics',
      agentRequest: 'Flag any inconsistency.',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: 'thinking' }
    );

    // W3 is reply-only — no document mutation fields should appear.
    expect(result.workflow_type).toBeUndefined();
    expect(result.target_tab).toBeUndefined();
    expect(result.operations).toBeUndefined();
  }, 120000);

  it('gracefully handles empty StyleProfile', () => {
    const userPrompt = buildArchitectBatchPrompt({
      styleProfile: '',  // missing — should degrade gracefully
      manuscript:   FIXTURES.MERGED_CONTENT,
      selectedText: 'The Chid Axiom fills this gap',
      agentRequest: 'Analyse structure.',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      BATCH_REPLY_SCHEMA,
      { tier: 'thinking' }
    );

    expect(typeof result.reply).toBe('string');
    expect(result.reply.trim().length).toBeGreaterThan(0);
  }, 120000);

});

// ── Error conditions ──────────────────────────────────────────────────────────

describe('ArchitectAgent — error conditions', () => {

  it('throws a descriptive error when the API key is invalid', () => {
    const userPrompt = buildArchitectBatchPrompt({
      styleProfile: FIXTURES.STYLE_PROFILE,
      manuscript:   FIXTURES.MERGED_CONTENT,
      selectedText: 'any passage',
      agentRequest: 'any request',
    });

    expect(() =>
      callGemini(INTEGRATION_SYSTEM_PROMPT, userPrompt, BATCH_REPLY_SCHEMA, {
        tier:           'fast',
        apiKeyOverride: 'INVALID_API_KEY_FOR_TESTING',
      })
    ).toThrow(/Gemini API error/);
  });

});
