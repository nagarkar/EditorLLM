// ============================================================
// CollaborationHelpers.ts — Exported pure helper functions for
// CollaborationService. Keeping them here lets tests import
// them directly instead of inlining/duplicating the logic.
//
// GAS build ("module": "none"): tsc emits these as plain
// function declarations; the export statements compile to
// harmless Object.defineProperty calls that clasp ignores.
// All functions remain in flat scope and are callable from
// CollaborationService.ts without any import statement.
//
// Tests: ts-jest uses its own CommonJS transform so tests
// import from this file with `import { ... } from '...'`.
// ============================================================

// ── Text matching ─────────────────────────────────────────────────────────────

/**
 * Tries to find matchText in the body.
 * Falls back to the very first non-whitespace word if not found.
 */
export function findTextOrFallback_(
  body: GoogleAppsScript.Document.Body,
  matchText: string
): GoogleAppsScript.Document.RangeElement | null {
  const escapedMatch = matchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exact = body.findText(escapedMatch);
  if (exact) return exact;

  Tracer.warn(
    `CollaborationService: match_text "${matchText}" not found — falling back to first word.`
  );
  return body.findText('\\S+');
}

// ── Prefix matching ───────────────────────────────────────────────────────────

/**
 * Returns true if the comment content starts with any of the agent prefixes.
 *
 * Drive API v3 may strip the leading '[' character from comment content when
 * the comment is fetched via Comments.list(). To handle this, we also check
 * each prefix without its leading '[' as a fallback.
 *
 * Example: '[EarTune] "thick with"…' may come back as 'EarTune] "thick with"…'
 * so we match both '[EarTune]' and 'EarTune]' (i.e. prefix.slice(1)).
 */
export function matchesAgentPrefix_(content: string, agentPrefix: string | string[]): boolean {
  const list = Array.isArray(agentPrefix) ? agentPrefix : [agentPrefix];
  return list.some(p => {
    if (content.startsWith(p)) return true;
    // Fallback: Drive API may strip the leading '[' — check without it
    if (p.startsWith('[') && content.startsWith(p.slice(1))) return true;
    return false;
  });
}

// ── Highlighting ──────────────────────────────────────────────────────────────

/**
 * Applies highlight color and bold to a RangeElement (TEXT elements only).
 * Kept for backward compatibility. New annotations use highlightNamedRange_
 * so the exact text range is stored and can be precisely reversed at clear time.
 */
export function highlightRangeElement_(
  rangeEl: GoogleAppsScript.Document.RangeElement,
  color: string
): void {
  const el = rangeEl.getElement();
  if (el.getType() !== DocumentApp.ElementType.TEXT) return;

  const textEl = el.asText();
  const start = rangeEl.getStartOffset();
  const end = rangeEl.getEndOffsetInclusive();
  textEl.setBackgroundColor(start, end, color);
  textEl.setBold(start, end, true);
}

/**
 * Applies highlight color and bold to every TEXT element in a NamedRange.
 * Used by the new annotation creation path so the precise span is captured
 * in the named range and can be cleared exactly by clearNamedRangeHighlights_.
 */
export function highlightNamedRange_(
  namedRange: GoogleAppsScript.Document.NamedRange,
  color: string
): void {
  for (const el of namedRange.getRange().getRangeElements()) {
    if (el.getElement().getType() !== DocumentApp.ElementType.TEXT) continue;
    const text  = el.getElement().asText();
    const start = el.getStartOffset();
    const end   = el.getEndOffsetInclusive();
    text.setBackgroundColor(start, end, color);
    text.setBold(start, end, true);
  }
}

/**
 * Removes highlight (sets background to null) and bold from every TEXT element
 * in a NamedRange. Sets null rather than a specific color so it clears any
 * color present, not just the current HIGHLIGHT_COLOR constant.
 *
 * Returns the number of TEXT element runs whose formatting was cleared.
 * The caller accumulates this for the per-clear-pass summary trace.
 *
 * NOTE: This clears bold as well as background color. If the text was bold
 * before annotation, that bold will be lost — the same accepted limitation as
 * the old color-sweep approach.
 */
export function clearNamedRangeHighlights_(
  namedRange: GoogleAppsScript.Document.NamedRange
): number {
  let cleared = 0;
  for (const el of namedRange.getRange().getRangeElements()) {
    if (el.getElement().getType() !== DocumentApp.ElementType.TEXT) continue;
    const text  = el.getElement().asText();
    const start = el.getStartOffset();
    const end   = el.getEndOffsetInclusive();
    // null removes all background color regardless of what was applied.
    text.setBackgroundColor(start, end, null as unknown as string);
    text.setBold(start, end, false);
    cleared++;
  }
  return cleared;
}

// ── Comment content builder ───────────────────────────────────────────────────

/** Drive API practical character limit per comment/reply. */
export const MAX_COMMENT_CHARS = 3900;

/**
 * Builds the final comment string (prefix + match_text + reason + bookmark),
 * truncating to MAX_COMMENT_CHARS if necessary.
 * Returns { content, truncated }.
 */
export function buildCommentContent_(
  agentPrefix: string,
  matchText: string,
  commentBody: string,
  bookmarkUrl: string
): { content: string; truncated: boolean } {
  const full = bookmarkUrl
    ? `${agentPrefix} "${matchText}": ${commentBody}: ${bookmarkUrl}`
    : `${agentPrefix} "${matchText}": ${commentBody}`;

  if (full.length <= MAX_COMMENT_CHARS) {
    return { content: full, truncated: false };
  }

  const suffix = bookmarkUrl ? `… [truncated]: ${bookmarkUrl}` : '… [truncated]';
  const content = full.slice(0, MAX_COMMENT_CHARS - suffix.length) + suffix;
  return { content, truncated: true };
}

// ── Workflow routing ──────────────────────────────────────────────────────────

/**
 * Returns the workflow handler key for a given update.
 * Pure — no side effects, no GAS API calls.
 */
export function resolveWorkflowType_(update: RootUpdate): 'instruction_update' | 'content_annotation' {
  return update.workflow_type === 'instruction_update'
    ? 'instruction_update'
    : 'content_annotation';
}
