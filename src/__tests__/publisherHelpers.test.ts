import {
  PUBLISHER_GEMINI_TAB_NAMES,
  PUBLISHER_ALL_OUTPUT_TAB_NAMES,
  determinePublisherTabsToGenerate,
  validatePublisherTabPayload,
  buildPublisherPackageFolderName,
  buildVersionFolderName,
  validateVersionLabel,
  extractCssFromTab,
  isBlankPublisherContent,
  publisherTabGenerationSchema,
  parseCoverConceptMarker,
  parseCoverConcepts,
  buildCoverBaselineFilename,
  buildCoverArchiveFilename,
  sanitizeCoverImageFilename,
} from '../PublisherHelpers';
import type { CoverItem } from '../PublisherHelpers';

describe('PublisherHelpers', () => {
  it('exposes the expected publisher tab sets', () => {
    expect(PUBLISHER_GEMINI_TAB_NAMES).toEqual([
      'Copyright',
      'About The Author',
      'Sales',
      'Hooks',
      'Cover',
      'Opening Audio Credits',
      'Closing Audio Credits',
    ]);
    expect(PUBLISHER_ALL_OUTPUT_TAB_NAMES).toEqual([...PUBLISHER_GEMINI_TAB_NAMES]);
    expect(PUBLISHER_ALL_OUTPUT_TAB_NAMES).toContain('Opening Audio Credits');
    expect(PUBLISHER_ALL_OUTPUT_TAB_NAMES).toContain('Closing Audio Credits');
  });

  it('detects blank publisher content', () => {
    expect(isBlankPublisherContent('')).toBe(true);
    expect(isBlankPublisherContent('   ')).toBe(true);
    expect(isBlankPublisherContent(null)).toBe(true);
    expect(isBlankPublisherContent('Hello')).toBe(false);
  });

  it('returns all gemini tabs for mode=all', () => {
    const existing: Record<string, string> = {};
    expect(determinePublisherTabsToGenerate('all', existing)).toEqual([...PUBLISHER_GEMINI_TAB_NAMES]);
  });

  it('returns only missing or empty tabs for mode=missing', () => {
    const existing = {
      Copyright: '',
      'About The Author': '   ',
      Sales: '## Existing Sales',
      Hooks: '',
      Cover: '## Existing Cover',
      'Opening Audio Credits': 'This is My Book…',
      'Closing Audio Credits': 'You have been listening…',
    };

    expect(determinePublisherTabsToGenerate('missing', existing)).toEqual([
      'Copyright',
      'About The Author',
      'Hooks',
    ]);
  });

  it('validates publisher payloads and reports missing/unexpected tabs', () => {
    const result = validatePublisherTabPayload({
      tabs: [
        { tab_name: 'Copyright', markdown: '# Copyright' },
        { tab_name: 'Cover', markdown: '## Cover' },
        { tab_name: 'Unexpected', markdown: 'noop' },
        { tab_name: 'Copyright', markdown: '# Duplicate ignored' },
      ],
    }, ['Copyright', 'Sales', 'Cover']);

    expect(result.tabs).toEqual([
      { tab_name: 'Copyright', markdown: '# Copyright' },
      { tab_name: 'Cover', markdown: '## Cover' },
    ]);
    expect(result.missing).toEqual(['Sales']);
    expect(result.unexpected).toEqual(['Unexpected']);
  });

  it('builds stable package folder names from the document title and date (deprecated path)', () => {
    expect(buildPublisherPackageFolderName('My: Book/Title?', '2026-04-22'))
      .toBe('My Book Title_2026-04-22_Package');
  });

  it('includes hhmmss in package folder names when provided (deprecated path)', () => {
    expect(buildPublisherPackageFolderName('My: Book/Title?', '2026-04-22', '153045'))
      .toBe('My Book Title_2026-04-22_153045_Package');
  });

  it('builds a schema constrained to the requested tabs', () => {
    const schema: any = publisherTabGenerationSchema(['Copyright', 'Hooks']);
    expect(schema.required).toEqual(['tabs']);
    expect(schema.properties.tabs.items.properties.tab_name.enum).toEqual(['Copyright', 'Hooks']);
  });

  describe('buildVersionFolderName', () => {
    it('combines docId and label with _V separator', () => {
      expect(buildVersionFolderName('abc123', '1')).toBe('abc123_V1');
      expect(buildVersionFolderName('abc123', 'final-draft')).toBe('abc123_Vfinal-draft');
    });

    it('uses the full native doc ID as-is', () => {
      const longId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms';
      expect(buildVersionFolderName(longId, '2')).toBe(`${longId}_V2`);
    });
  });

  describe('validateVersionLabel', () => {
    it('trims whitespace and returns the clean label', () => {
      expect(validateVersionLabel('  final  ')).toBe('final');
      expect(validateVersionLabel('1')).toBe('1');
    });

    it('throws for empty labels', () => {
      expect(() => validateVersionLabel('')).toThrow('Version label is required.');
      expect(() => validateVersionLabel('   ')).toThrow('Version label is required.');
    });

    it('throws for labels containing path-unsafe characters', () => {
      expect(() => validateVersionLabel('my/label')).toThrow('invalid characters');
      expect(() => validateVersionLabel('my:label')).toThrow('invalid characters');
      expect(() => validateVersionLabel('my*label')).toThrow('invalid characters');
      expect(() => validateVersionLabel('my?label')).toThrow('invalid characters');
    });

    it('accepts hyphens and dots', () => {
      expect(validateVersionLabel('v1.0-beta')).toBe('v1.0-beta');
    });
  });

  describe('parseCoverConceptMarker', () => {
    it('parses "Concept N: Name"', () => {
      expect(parseCoverConceptMarker('Concept 1: Beach Sunset')).toEqual({ number: 1, name: 'Beach Sunset' });
    });

    it('parses "Concept N" without a name', () => {
      expect(parseCoverConceptMarker('Concept 4')).toEqual({ number: 4, name: null });
    });

    it('strips leading markdown decoration', () => {
      expect(parseCoverConceptMarker('## Concept 2: Mountain')).toEqual({ number: 2, name: 'Mountain' });
      expect(parseCoverConceptMarker('**Concept 3: City**')).toEqual({ number: 3, name: 'City' });
      expect(parseCoverConceptMarker('- Concept 5')).toEqual({ number: 5, name: null });
    });

    it('accepts em-dash and hyphen as the name separator', () => {
      expect(parseCoverConceptMarker('Concept 1 — Sunrise')).toEqual({ number: 1, name: 'Sunrise' });
      expect(parseCoverConceptMarker('Concept 2 - Forest')).toEqual({ number: 2, name: 'Forest' });
    });

    it('returns null for non-marker lines', () => {
      expect(parseCoverConceptMarker('Just some prose.')).toBeNull();
      expect(parseCoverConceptMarker('')).toBeNull();
      expect(parseCoverConceptMarker('   ')).toBeNull();
    });
  });

  describe('parseCoverConcepts', () => {
    it('produces the structure described by the user example', () => {
      // Layout:
      //   Concept 1: One   (text only)
      //   Concept 2: Two   (text + image)
      //   Concept 3       (image, image — baseline = image[2])
      //   Concept 4       (text only)
      //   Concept 5       (image only)
      const items: CoverItem[] = [
        { bodyChildIndex: 0, kind: 'marker', text: 'Concept 1: One', marker: { number: 1, name: 'One' } },
        { bodyChildIndex: 1, kind: 'text', text: 'text for concept 1' },
        { bodyChildIndex: 2, kind: 'marker', text: 'Concept 2: Two', marker: { number: 2, name: 'Two' } },
        { bodyChildIndex: 3, kind: 'text', text: 'text for concept 2' },
        { bodyChildIndex: 4, kind: 'image', imageRef: 0 },
        { bodyChildIndex: 5, kind: 'marker', text: 'Concept 3', marker: { number: 3, name: null } },
        { bodyChildIndex: 6, kind: 'image', imageRef: 1 },
        { bodyChildIndex: 7, kind: 'image', imageRef: 2 },
        { bodyChildIndex: 8, kind: 'marker', text: 'Concept 4', marker: { number: 4, name: null } },
        { bodyChildIndex: 9, kind: 'text', text: 'text for concept 4' },
        { bodyChildIndex: 10, kind: 'marker', text: 'Concept 5', marker: { number: 5, name: null } },
        { bodyChildIndex: 11, kind: 'image', imageRef: 3 },
      ];

      const concepts = parseCoverConcepts(items);
      expect(concepts).toHaveLength(5);

      expect(concepts[0]).toEqual({
        number: 1, name: 'One',
        text: 'text for concept 1',
        baselineImageRef: null,
        imageRefs: [],
        insertAfterBodyChildIndex: 1,
      });

      expect(concepts[1]).toEqual({
        number: 2, name: 'Two',
        text: 'text for concept 2',
        baselineImageRef: 0,
        imageRefs: [0],
        insertAfterBodyChildIndex: 4,
      });

      expect(concepts[2]).toEqual({
        number: 3, name: null,
        text: '',
        baselineImageRef: 2,
        imageRefs: [1, 2],
        insertAfterBodyChildIndex: 7,
      });

      expect(concepts[3]).toEqual({
        number: 4, name: null,
        text: 'text for concept 4',
        baselineImageRef: null,
        imageRefs: [],
        insertAfterBodyChildIndex: 9,
      });

      expect(concepts[4]).toEqual({
        number: 5, name: null,
        text: '',
        baselineImageRef: 3,
        imageRefs: [3],
        insertAfterBodyChildIndex: 11,
      });
    });

    it('drops items that appear before the first marker', () => {
      const items: CoverItem[] = [
        { bodyChildIndex: 0, kind: 'text', text: 'preamble — should be discarded' },
        { bodyChildIndex: 1, kind: 'marker', text: 'Concept 1: A', marker: { number: 1, name: 'A' } },
        { bodyChildIndex: 2, kind: 'text', text: 'kept' },
      ];
      const concepts = parseCoverConcepts(items);
      expect(concepts).toHaveLength(1);
      expect(concepts[0].text).toBe('kept');
    });

    it('joins multiple text items with newlines', () => {
      const items: CoverItem[] = [
        { bodyChildIndex: 0, kind: 'marker', text: 'Concept 1', marker: { number: 1, name: null } },
        { bodyChildIndex: 1, kind: 'text', text: 'line one' },
        { bodyChildIndex: 2, kind: 'text', text: 'line two' },
      ];
      const concepts = parseCoverConcepts(items);
      expect(concepts[0].text).toBe('line one\nline two');
    });

    it('returns an empty array when no markers exist', () => {
      const items: CoverItem[] = [
        { bodyChildIndex: 0, kind: 'text', text: 'just prose' },
      ];
      expect(parseCoverConcepts(items)).toEqual([]);
    });
  });

  describe('cover image filename helpers', () => {
    it('builds a baseline filename from the concept name', () => {
      expect(buildCoverBaselineFilename('Beach Sunset', 1)).toBe('Beach Sunset - baseline.png');
    });

    it('falls back to "Concept N - baseline.png" when no name is set', () => {
      expect(buildCoverBaselineFilename(null, 4)).toBe('Concept 4 - baseline.png');
    });

    it('falls back to "concept - baseline.png" when both name and number are missing', () => {
      expect(buildCoverBaselineFilename(null, null)).toBe('concept - baseline.png');
    });

    it('strips filesystem-unsafe characters from sanitized names', () => {
      expect(sanitizeCoverImageFilename('My/Concept:Name?')).toBe('My Concept Name');
      expect(sanitizeCoverImageFilename('   ')).toBe('concept');
    });

    it('archives a baseline file by inserting a stamp before the extension', () => {
      expect(buildCoverArchiveFilename('Beach Sunset - baseline.png', '01012026120000'))
        .toBe('Beach Sunset - baseline01012026120000.png');
    });

    it('appends the stamp at the end when there is no extension', () => {
      expect(buildCoverArchiveFilename('noext', '01012026120000'))
        .toBe('noext01012026120000');
    });
  });

  describe('extractCssFromTab', () => {
    it('extracts CSS from a markdown code fence', () => {
      const markdown = '```css\n.main-title { font-weight: bold; }\n.author { color: #333; }\n```\nSome prose.';
      expect(extractCssFromTab(markdown)).toBe('.main-title { font-weight: bold; }\n.author { color: #333; }');
    });

    it('extracts from a plain ``` fence without language tag', () => {
      const markdown = '```\n.chapter-title { font-style: italic; }\n```';
      expect(extractCssFromTab(markdown)).toBe('.chapter-title { font-style: italic; }');
    });

    it('falls back to returning the full trimmed string when no fence is present', () => {
      const raw = '  .main-title { font-size: 2em; }  ';
      expect(extractCssFromTab(raw)).toBe('.main-title { font-size: 2em; }');
    });

    it('handles empty and null-like input gracefully', () => {
      expect(extractCssFromTab('')).toBe('');
      expect(extractCssFromTab('   ')).toBe('');
    });
  });
});
