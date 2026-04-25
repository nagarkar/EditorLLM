import {
  PUBLISHER_GEMINI_TAB_NAMES,
  PUBLISHER_ALL_OUTPUT_TAB_NAMES,
  determinePublisherTabsToGenerate,
  validatePublisherTabPayload,
  buildPublisherPackageFolderName,
  isBlankPublisherContent,
  publisherTabGenerationSchema,
} from '../PublisherHelpers';

describe('PublisherHelpers', () => {
  it('exposes the expected publisher tab sets', () => {
    expect(PUBLISHER_GEMINI_TAB_NAMES).toEqual([
      'Title',
      'Copyright',
      'About The Author',
      'Sales',
      'Hooks',
      'Cover',
    ]);
    expect(PUBLISHER_ALL_OUTPUT_TAB_NAMES).toContain('Table of Contents');
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
      Title: '# Existing Title',
      Copyright: '',
      'About The Author': '   ',
      Sales: '## Existing Sales',
      Hooks: '',
      Cover: '## Existing Cover',
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
        { tab_name: 'Title', markdown: '# Title' },
        { tab_name: 'Cover', markdown: '## Cover' },
        { tab_name: 'Unexpected', markdown: 'noop' },
        { tab_name: 'Title', markdown: '# Duplicate ignored' },
      ],
    }, ['Title', 'Sales', 'Cover']);

    expect(result.tabs).toEqual([
      { tab_name: 'Title', markdown: '# Title' },
      { tab_name: 'Cover', markdown: '## Cover' },
    ]);
    expect(result.missing).toEqual(['Sales']);
    expect(result.unexpected).toEqual(['Unexpected']);
  });

  it('builds stable package folder names from the document title and date', () => {
    expect(buildPublisherPackageFolderName('My: Book/Title?', '2026-04-22'))
      .toBe('My Book Title_2026-04-22_Package');
  });

  it('includes hhmmss in package folder names when provided', () => {
    expect(buildPublisherPackageFolderName('My: Book/Title?', '2026-04-22', '153045'))
      .toBe('My Book Title_2026-04-22_153045_Package');
  });

  it('builds a schema constrained to the requested tabs', () => {
    const schema: any = publisherTabGenerationSchema(['Title', 'Hooks']);
    expect(schema.required).toEqual(['tabs']);
    expect(schema.properties.tabs.items.properties.tab_name.enum).toEqual(['Title', 'Hooks']);
  });
});
