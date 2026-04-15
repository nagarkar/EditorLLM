// ============================================================
// TabMergerHelpers.ts — Exported pure helpers for TabMerger.
//
// GAS build ("module": "none"): tsc emits these as plain
// function declarations in flat scope; the export statements
// compile to harmless Object.defineProperty calls.
//
// Tests: ts-jest uses config/jest/tsconfig.test.json which
// sets module:commonjs, so tests can import directly.
// ============================================================

/**
 * Strips GAS-internal document IDs from error messages so they are safe
 * to surface in the add-on UI without leaking sensitive document identifiers.
 *
 * Handles two patterns:
 *   "Service Documents failed while accessing document with id <id>."
 *   "… document with id <id> …"  (any generic phrasing)
 */
export function sanitizePlatformError_(message: string): string {
  return String(message || '')
    .replace(
      /Service Documents failed while accessing document with id [^.\n]+\.?/gi,
      'Document access error.'
    )
    .replace(/document with id [A-Za-z0-9_-]{20,}\.?/gi, 'document.')
    .trim();
}
