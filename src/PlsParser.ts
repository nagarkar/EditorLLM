// ============================================================
// PlsParser.ts — Pure PLS (Pronunciation Lexicon Specification) XML parser
//
// Uses regex instead of XmlService to avoid namespace-resolution issues:
// PLS documents declare a default namespace
//   xmlns="http://www.w3.org/2005/01/pronunciation-lexicon"
// which causes GAS XmlService.getChildren(name) / getChild(name) to return
// nothing silently — those methods look for elements with *no* namespace.
// getChildren() with no args returns all children, but even that approach
// fails in practice because getName() may include namespace context in some
// GAS runtime versions.
//
// Regex-based parsing bypasses namespace handling entirely and is immune to
// any quirks in the GAS XmlService JDOM wrapper.
//
// This module is deliberately kept free of GAS API dependencies so it can be
// unit-tested directly in Node.js / Jest with real XML strings (no mocking).
//
// GAS flat-scope: `export function` compiles to a plain function declaration
// that is available globally — fixgas.js strips the exports boilerplate.
// ============================================================

/**
 * Parses a W3C PLS (Pronunciation Lexicon Specification) XML string and returns
 * all lexeme rules as `{ grapheme, phoneme }` pairs.
 *
 * Supports both rule types accepted by ElevenLabs:
 *   `<phoneme>` — IPA phonetic string (e.g. `/tə'meɪtoʊ/`)
 *   `<alias>`   — word-substitution string (e.g. `tomayto`)
 *
 * When both are present inside a single `<lexeme>`, `<phoneme>` is preferred.
 * When neither is present, the `phoneme` field is stored as an empty string so
 * callers can still use the dictionary for text-matching even without a target.
 *
 * Returns an empty array when the XML contains no `<lexeme>` elements or when
 * the input string is empty or malformed — never throws.
 */
export function parsePlsRules(xml: string): Array<{ grapheme: string; phoneme: string }> {
  const rules: Array<{ grapheme: string; phoneme: string }> = [];
  if (!xml || !xml.trim()) return rules;

  // Match every <lexeme>…</lexeme> block, allowing multi-line whitespace.
  const lexRe = /<lexeme[^>]*>([\s\S]*?)<\/lexeme>/g;
  let lm: RegExpExecArray | null;

  while ((lm = lexRe.exec(xml)) !== null) {
    const block = lm[1];

    // Require <grapheme> — skip the entry if absent or blank.
    const gm = /<grapheme[^>]*>([\s\S]*?)<\/grapheme>/.exec(block);
    if (!gm) continue;
    const grapheme = gm[1].trim();
    if (!grapheme) continue;

    // Prefer <phoneme>; fall back to <alias>.
    const pm = /<phoneme[^>]*>([\s\S]*?)<\/phoneme>/.exec(block);
    const am = /<alias[^>]*>([\s\S]*?)<\/alias>/.exec(block);
    const phoneme = (pm ?? am)?.[1].trim() ?? '';

    rules.push({ grapheme, phoneme });
  }

  return rules;
}
