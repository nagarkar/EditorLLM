// ============================================================
// CommentProcessorHelpers.ts — Exported pure helpers for
// CommentProcessor.
//
// GAS build ("module": "none"): tsc emits these as plain
// function declarations in flat scope; the export statements
// compile to harmless Object.defineProperty calls.
//
// Tests: ts-jest uses config/jest/tsconfig.test.json which
// sets module:commonjs, so tests can import directly.
// ============================================================

/**
 * Strips trailing punctuation from a tag candidate so that "@AI:", "@AI,",
 * "@architect." etc. all resolve to the same registry key as "@AI".
 * Only trailing non-alphanumeric/non-tag characters are removed.
 */
export function normaliseTagWord_(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9@_-]+$/, '');
}
