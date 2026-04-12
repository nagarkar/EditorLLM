// ============================================================
// StringProcessor.ts — String utility helpers
// ============================================================

/**
 * Converts a comma-separated string into a cleaned, non-empty string array.
 */
function createStringArray(csvString: string): string[] {
  if (!csvString || typeof csvString !== 'string') return [];
  return csvString.split(',').map(item => item.trim()).filter(Boolean);
}
