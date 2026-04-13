// ============================================================
// JSON schema shapes for integration tests.
// These mirror the schemas in BaseAgent.instructionUpdateSchema_(),
// BaseAgent.annotationSchema_(), and BaseAgent.batchReplySchema_().
// If the production schemas change, update these to match.
// ============================================================

/** Schema for Gemini responses for W1 (generateInstructions). */
export const INSTRUCTION_UPDATE_SCHEMA = {
  type: 'object',
  properties: {
    proposed_full_text: { type: 'string' },
  },
  required: ['proposed_full_text'],
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
 * Standard schema for W3 (handleCommentThreads) on all agents.
 * Returns { responses: [{threadId, reply}, ...] }.
 * Pairs with BaseAgent.normaliseBatchReplies_() for post-processing.
 */
export const BATCH_REPLY_SCHEMA = {
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
} as const;
