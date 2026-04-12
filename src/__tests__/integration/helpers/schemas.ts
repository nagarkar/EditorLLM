// ============================================================
// JSON schema shapes for integration tests.
// These mirror the schemas in BaseAgent.instructionUpdateSchema_(),
// BaseAgent.annotationSchema_(), and the per-agent inline schemas.
// If the production schemas change, update these to match.
// ============================================================

/** Schema for Gemini responses for W1 (generateInstructions). */
export const INSTRUCTION_UPDATE_SCHEMA = {
  type: 'object',
  properties: {
    proposed_full_text: { type: 'string' },
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
  required: ['proposed_full_text', 'operations'],
} as const;

/** Schema for Gemini responses for W2 (annotateTab). */
export const ANNOTATION_SCHEMA = {
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
} as const;

/**
 * Schema for W3 (handleCommentThread) on Architect, Stylist, and Audit agents.
 * Returns { reply: string }.
 */
export const THREAD_REPLY_SCHEMA = {
  type: 'object',
  properties: { reply: { type: 'string' } },
  required: ['reply'],
} as const;

/**
 * Schema for W3 (handleCommentThread) on CommentAgent only.
 * Returns { response: string } — note the different field name.
 * This intentional difference is documented in agents.test.ts (singleThreadSchema shape).
 */
export const COMMENT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: { response: { type: 'string' } },
  required: ['response'],
} as const;
