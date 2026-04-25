// ============================================================
// PlsParser.test.ts
//
// Pure unit tests for parsePlsRules() — no GAS mocks needed because the
// function only manipulates strings.  The test tsconfig sets module:commonjs
// so direct `import` from the source file works.
// ============================================================

import { parsePlsRules } from '../PlsParser';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** The exact PLS XML format ElevenLabs generates, with default namespace. */
const STANDARD_PLS = `<?xml version="1.0" encoding="UTF-8"?>
<lexicon version="1.0"
    xmlns="http://www.w3.org/2005/01/pronunciation-lexicon"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.w3.org/2005/01/pronunciation-lexicon
        http://www.w3.org/TR/2007/CR-pronunciation-lexicon-20071212/pls.xsd"
    alphabet="ipa" xml:lang="en-US">
<lexeme>
    <grapheme>tomato</grapheme>
    <phoneme>/tə'meɪtoʊ/</phoneme>
</lexeme>
<lexeme>
    <grapheme>Tomato</grapheme>
    <phoneme>/tə'meɪtoʊ/</phoneme>
</lexeme>
</lexicon>`;

// ── parsePlsRules — standard format ─────────────────────────────────────────

describe('parsePlsRules', () => {

  describe('standard PLS format (ElevenLabs default namespace)', () => {
    it('parses both lexeme entries from the standard PLS XML', () => {
      const rules = parsePlsRules(STANDARD_PLS);
      expect(rules).toHaveLength(2);
    });

    it('extracts grapheme from first entry', () => {
      const rules = parsePlsRules(STANDARD_PLS);
      expect(rules[0].grapheme).toBe('tomato');
    });

    it('extracts phoneme from first entry', () => {
      const rules = parsePlsRules(STANDARD_PLS);
      expect(rules[0].phoneme).toBe("/tə'meɪtoʊ/");
    });

    it('extracts grapheme from second entry (case-preserved)', () => {
      const rules = parsePlsRules(STANDARD_PLS);
      expect(rules[1].grapheme).toBe('Tomato');
    });

    it('extracts phoneme from second entry', () => {
      const rules = parsePlsRules(STANDARD_PLS);
      expect(rules[1].phoneme).toBe("/tə'meɪtoʊ/");
    });
  });

  // ── alias rule type ──────────────────────────────────────────────────────

  describe('<alias> rule type', () => {
    it('extracts <alias> when <phoneme> is absent', () => {
      const xml = `<lexicon xmlns="http://www.w3.org/2005/01/pronunciation-lexicon">
<lexeme><grapheme>GAS</grapheme><alias>Google Apps Script</alias></lexeme>
</lexicon>`;
      const rules = parsePlsRules(xml);
      expect(rules).toHaveLength(1);
      expect(rules[0].grapheme).toBe('GAS');
      expect(rules[0].phoneme).toBe('Google Apps Script');
    });

    it('prefers <phoneme> over <alias> when both are present', () => {
      const xml = `<lexicon xmlns="http://www.w3.org/2005/01/pronunciation-lexicon">
<lexeme>
  <grapheme>live</grapheme>
  <phoneme>/lɪv/</phoneme>
  <alias>livv</alias>
</lexeme>
</lexicon>`;
      const rules = parsePlsRules(xml);
      expect(rules[0].phoneme).toBe('/lɪv/');
    });
  });

  // ── edge cases ───────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns empty array for empty string', () => {
      expect(parsePlsRules('')).toEqual([]);
    });

    it('returns empty array for whitespace-only string', () => {
      expect(parsePlsRules('   \n  ')).toEqual([]);
    });

    it('returns empty array when no <lexeme> elements are present', () => {
      const xml = `<lexicon xmlns="http://www.w3.org/2005/01/pronunciation-lexicon"></lexicon>`;
      expect(parsePlsRules(xml)).toEqual([]);
    });

    it('skips <lexeme> entries that have no <grapheme>', () => {
      const xml = `<lexicon xmlns="http://www.w3.org/2005/01/pronunciation-lexicon">
<lexeme><phoneme>/foo/</phoneme></lexeme>
<lexeme><grapheme>valid</grapheme><phoneme>/valid/</phoneme></lexeme>
</lexicon>`;
      const rules = parsePlsRules(xml);
      expect(rules).toHaveLength(1);
      expect(rules[0].grapheme).toBe('valid');
    });

    it('skips <lexeme> entries with blank grapheme text', () => {
      const xml = `<lexicon xmlns="http://www.w3.org/2005/01/pronunciation-lexicon">
<lexeme><grapheme>   </grapheme><phoneme>/foo/</phoneme></lexeme>
<lexeme><grapheme>ok</grapheme><phoneme>/ok/</phoneme></lexeme>
</lexicon>`;
      const rules = parsePlsRules(xml);
      expect(rules).toHaveLength(1);
      expect(rules[0].grapheme).toBe('ok');
    });

    it('stores empty phoneme string when neither <phoneme> nor <alias> is present', () => {
      const xml = `<lexicon xmlns="http://www.w3.org/2005/01/pronunciation-lexicon">
<lexeme><grapheme>mystery</grapheme></lexeme>
</lexicon>`;
      const rules = parsePlsRules(xml);
      expect(rules).toHaveLength(1);
      expect(rules[0].grapheme).toBe('mystery');
      expect(rules[0].phoneme).toBe('');
    });

    it('handles inline (single-line) lexeme elements', () => {
      const xml = `<lexicon><lexeme><grapheme>foo</grapheme><phoneme>/fuː/</phoneme></lexeme></lexicon>`;
      const rules = parsePlsRules(xml);
      expect(rules).toHaveLength(1);
      expect(rules[0]).toEqual({ grapheme: 'foo', phoneme: '/fuː/' });
    });

    it('handles IPA characters with slashes and special Unicode', () => {
      const xml = `<lexicon xmlns="http://www.w3.org/2005/01/pronunciation-lexicon">
<lexeme>
    <grapheme>schedule</grapheme>
    <phoneme>/ˈʃɛdjuːl/</phoneme>
</lexeme>
</lexicon>`;
      const rules = parsePlsRules(xml);
      expect(rules[0].phoneme).toBe('/ˈʃɛdjuːl/');
    });

    it('trims surrounding whitespace from grapheme and phoneme', () => {
      const xml = `<lexicon>
<lexeme>
    <grapheme>  spaced  </grapheme>
    <phoneme>  /speɪst/  </phoneme>
</lexeme>
</lexicon>`;
      const rules = parsePlsRules(xml);
      expect(rules[0].grapheme).toBe('spaced');
      expect(rules[0].phoneme).toBe('/speɪst/');
    });

    it('parses many entries in order', () => {
      const words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
      const lexemes = words
        .map(w => `<lexeme><grapheme>${w}</grapheme><phoneme>/${w}/</phoneme></lexeme>`)
        .join('\n');
      const xml = `<lexicon xmlns="http://www.w3.org/2005/01/pronunciation-lexicon">${lexemes}</lexicon>`;
      const rules = parsePlsRules(xml);
      expect(rules).toHaveLength(5);
      expect(rules.map(r => r.grapheme)).toEqual(words);
    });
  });

});
