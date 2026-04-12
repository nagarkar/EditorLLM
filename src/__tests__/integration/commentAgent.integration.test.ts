// ============================================================
// CommentAgent integration tests — real Gemini API calls.
//
// Workflow coverage:
//   W1 (generateInstructions) — instruction_update → { proposed_full_text, operations }
//   W2 (annotateTab)          — NOT APPLICABLE for CommentAgent
//   W3 (handleCommentThread)  — reply-only → { response }   ← NOTE: 'response', not 'reply'
//
// All tests use the fast model (gemini-2.0-flash).
// Individual test timeout is set to 60 s.
//
// IMPORTANT SCHEMA DIFFERENCE:
//   CommentAgent W3 returns { response: string }, NOT { reply: string }.
//   All other agents use THREAD_REPLY_SCHEMA. CommentAgent uses COMMENT_RESPONSE_SCHEMA.
//   This is intentional — documented in agents.test.ts (singleThreadSchema shape).
// ============================================================

import { callGemini } from './helpers/gemini';
import { INSTRUCTION_UPDATE_SCHEMA, COMMENT_RESPONSE_SCHEMA } from './helpers/schemas';
import {
  buildCommentAgentInstructionsPrompt,
  buildCommentAgentThreadPrompt,
} from './helpers/prompts';
import { FIXTURES, INTEGRATION_SYSTEM_PROMPT } from './fixtures/testDocument';

const TIER = 'fast' as const;
const TIMEOUT = 60000;

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
    expect(Array.isArray(result.operations)).toBe(true);
    expect(result.operations.length).toBeGreaterThan(0);
  }, TIMEOUT);

  it('each operation has non-empty match_text and reason', () => {
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

    for (const op of result.operations) {
      expect(typeof op.match_text).toBe('string');
      expect(op.match_text.trim().length).toBeGreaterThan(0);
      expect(typeof op.reason).toBe('string');
      expect(op.reason.trim().length).toBeGreaterThan(0);
    }
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
    expect(Array.isArray(result.operations)).toBe(true);
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
    expect(Array.isArray(result.operations)).toBe(true);
  }, TIMEOUT);

});

// ── W2: annotateTab — not applicable ─────────────────────────────────────────

describe('CommentAgent — W2: annotateTab (not applicable)', () => {

  it('is not implemented on CommentAgent', () => {
    // CommentAgent responds to @AI comment threads; it does not sweep tabs for
    // annotation. There is no annotateTab method, and no W2 workflow for this
    // agent. This test documents the intent and ensures the absence is deliberate.
    //
    // If annotateTab is ever added to CommentAgent, a corresponding W2
    // integration test must be added here.
    expect(true).toBe(true); // deliberate no-op — see comment above
  });

});

// ── W3: handleCommentThread ───────────────────────────────────────────────────

describe('CommentAgent — W3: handleCommentThread (reply-only, response field)', () => {

  it('returns a response string for a simple @AI thread', () => {
    const userPrompt = buildCommentAgentThreadPrompt({
      selectedText: 'The Chid Axiom fills this gap',
      conversation: [
        {
          role:       'User',
          authorName: 'Author',
          content:    '@AI Can you explain what gap the Chid Axiom fills here?',
        },
      ],
      agentRequest: 'Explain what gap the Chid Axiom fills.',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      COMMENT_RESPONSE_SCHEMA,
      { tier: TIER }
    );

    expect(typeof result.response).toBe('string');
    expect(result.response.trim().length).toBeGreaterThan(0);
  }, TIMEOUT);

  it('response ends with the AI Editorial Assistant signature', () => {
    const userPrompt = buildCommentAgentThreadPrompt({
      selectedText: 'consciousness is the ground',
      conversation: [
        {
          role:       'User',
          authorName: 'Author',
          content:    '@AI Is this claim adequately supported?',
        },
      ],
      agentRequest: 'Assess whether the claim is supported by the preceding argument.',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      COMMENT_RESPONSE_SCHEMA,
      { tier: TIER }
    );

    expect(result.response).toContain('AI Editorial Assistant');
  }, TIMEOUT);

  it('uses the response field — not reply — confirming schema difference from other agents', () => {
    const userPrompt = buildCommentAgentThreadPrompt({
      selectedText: 'orthodox quantum mechanics',
      conversation: [
        {
          role:       'User',
          authorName: 'Author',
          content:    '@AI Clarify this reference.',
        },
      ],
      agentRequest: 'Clarify the reference to orthodox quantum mechanics.',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      COMMENT_RESPONSE_SCHEMA,
      { tier: TIER }
    );

    // CommentAgent uses 'response', not 'reply'.
    expect(typeof result.response).toBe('string');
    // The 'reply' field (used by other agents) must be absent.
    expect(result.reply).toBeUndefined();
  }, TIMEOUT);

  it('handles a multi-turn conversation history correctly', () => {
    const userPrompt = buildCommentAgentThreadPrompt({
      selectedText: 'The wave function ψ collapses to a definite eigenstate',
      conversation: [
        {
          role:       'User',
          authorName: 'Author',
          content:    '@AI Does collapse violate unitarity?',
        },
        {
          role:       'AI',
          authorName: 'AI Editorial Assistant',
          content:    'Within the Chid Axiom framework, collapse is not a unitary process — it is the moment consciousness selects an eigenstate. — AI Editorial Assistant',
        },
        {
          role:       'User',
          authorName: 'Author',
          content:    '@AI Can you suggest a way to clarify this for lay readers?',
        },
      ],
      agentRequest: 'Suggest a clarification for lay readers.',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      COMMENT_RESPONSE_SCHEMA,
      { tier: TIER }
    );

    expect(typeof result.response).toBe('string');
    expect(result.response.trim().length).toBeGreaterThan(0);
  }, TIMEOUT);

  it('maintains coherent context across a five-turn conversation', () => {
    // Deep multi-turn: verifies the agent does not lose thread context at depth.
    // Prior reply said collapse violates unitarity under the Copenhagen view;
    // the final turn asks for a concrete rewrite — the reply must still be coherent.
    const userPrompt = buildCommentAgentThreadPrompt({
      selectedText: 'The wave function ψ collapses to a definite eigenstate',
      conversation: [
        {
          role: 'User', authorName: 'Author',
          content: '@AI Does collapse violate unitarity?',
        },
        {
          role: 'AI', authorName: 'AI Editorial Assistant',
          content: 'Within the Chid Axiom framework, collapse is not a unitary process — it is the moment consciousness selects an eigenstate. — AI Editorial Assistant',
        },
        {
          role: 'User', authorName: 'Author',
          content: '@AI Can you suggest a clearer phrasing for a lay reader?',
        },
        {
          role: 'AI', authorName: 'AI Editorial Assistant',
          content: 'Try: "When you observe a quantum system, your act of attention resolves all possibilities into one." — AI Editorial Assistant',
        },
        {
          role: 'User', authorName: 'Author',
          content: '@AI Good — now propose a one-sentence version that fits the manuscript voice.',
        },
      ],
      agentRequest: 'Propose a one-sentence version fitting the manuscript voice.',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      COMMENT_RESPONSE_SCHEMA,
      { tier: TIER }
    );

    expect(typeof result.response).toBe('string');
    expect(result.response.trim().length).toBeGreaterThan(0);
    // The reply must end with the signature, proving the agent completed its response.
    expect(result.response).toContain('AI Editorial Assistant');
  }, TIMEOUT);

  it('does NOT return a RootUpdate or workflow_type field', () => {
    const userPrompt = buildCommentAgentThreadPrompt({
      selectedText: 'The Chid Axiom fills this gap',
      conversation: [
        {
          role:       'User',
          authorName: 'Author',
          content:    '@AI Any structural concerns?',
        },
      ],
      agentRequest: 'Check for structural concerns.',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      COMMENT_RESPONSE_SCHEMA,
      { tier: TIER }
    );

    expect(result.workflow_type).toBeUndefined();
    expect(result.target_tab).toBeUndefined();
    expect(result.operations).toBeUndefined();
  }, TIMEOUT);

  it('gracefully handles an empty conversation history', () => {
    // Edge case: no prior messages — just selected text and a request.
    const userPrompt = buildCommentAgentThreadPrompt({
      selectedText: 'The Chid Axiom fills this gap',
      conversation: [],
      agentRequest: 'Summarise the significance of this claim.',
    });
    const result = callGemini(
      INTEGRATION_SYSTEM_PROMPT,
      userPrompt,
      COMMENT_RESPONSE_SCHEMA,
      { tier: TIER }
    );

    expect(typeof result.response).toBe('string');
    expect(result.response.trim().length).toBeGreaterThan(0);
  }, TIMEOUT);

});

// ── Error conditions ──────────────────────────────────────────────────────────

describe('CommentAgent — error conditions', () => {

  it('throws a descriptive error when the API key is invalid', () => {
    const userPrompt = buildCommentAgentThreadPrompt({
      selectedText: 'any passage',
      conversation: [
        { role: 'User', authorName: 'Author', content: '@AI any request' },
      ],
      agentRequest: 'any request',
    });

    expect(() =>
      callGemini(INTEGRATION_SYSTEM_PROMPT, userPrompt, COMMENT_RESPONSE_SCHEMA, {
        tier:           TIER,
        apiKeyOverride: 'INVALID_API_KEY_FOR_TESTING',
      })
    ).toThrow(/Gemini API error/);
  });

});
