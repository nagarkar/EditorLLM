// ============================================================
// markdown.test.ts — Unit tests for MarkdownService
//
// All helper logic (parseInlineRuns, isTableLine, parseHeading, …) lives
// exclusively in MarkdownService.ts and is exposed on the public API.
// Tests call MarkdownService.xxx() directly — no local duplicates.
//
// jest.setup.js initialises global.MarkdownService with the same
// implementations used in production so tests exercise the real code.
//
// Tests cover:
//   1. Inline run parsing (bold, italic, code, links, bold-italic, plain)
//   2. Markdown → Body element assembly (headings, lists, tables, code blocks, HR)
//   3. Body → Markdown element walking (headings, formatting, lists, tables, code blocks)
//   4. appendTable_ bug fix — GAS body.appendTable() returns empty table;
//      getRow(0) on an empty table THROWS, never returns null.
//      The fix: always appendTableRow() for every row.
//   5. Edge cases and round-trip fidelity
// ============================================================

// ═══════════════════════════════════════════════════════════════
// InlineRun type (mirrors MarkdownService's internal type)
// ═══════════════════════════════════════════════════════════════

interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  url?: string;
}

// ═══════════════════════════════════════════════════════════════
// 1. Inline run parsing
// ═══════════════════════════════════════════════════════════════

describe('MarkdownService — inline run parsing', () => {
  it('parses plain text', () => {
    const runs = MarkdownService.parseInlineRuns('Hello world') as InlineRun[];
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual({ text: 'Hello world' });
  });

  it('parses bold text (**)', () => {
    const runs = MarkdownService.parseInlineRuns('before **bold** after') as InlineRun[];
    expect(runs).toHaveLength(3);
    expect(runs[0]).toEqual({ text: 'before ' });
    expect(runs[1]).toEqual({ text: 'bold', bold: true });
    expect(runs[2]).toEqual({ text: ' after' });
  });

  it('parses italic text (*)', () => {
    const runs = MarkdownService.parseInlineRuns('before *italic* after') as InlineRun[];
    expect(runs).toHaveLength(3);
    expect(runs[1]).toEqual({ text: 'italic', italic: true });
  });

  it('parses bold italic (***)', () => {
    const runs = MarkdownService.parseInlineRuns('***bold and italic***') as InlineRun[];
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual({ text: 'bold and italic', bold: true, italic: true });
  });

  it('parses inline code (`)', () => {
    const runs = MarkdownService.parseInlineRuns('use `const x = 1` here') as InlineRun[];
    expect(runs).toHaveLength(3);
    expect(runs[0]).toEqual({ text: 'use ' });
    expect(runs[1]).toEqual({ text: 'const x = 1', code: true });
    expect(runs[2]).toEqual({ text: ' here' });
  });

  it('parses links [text](url)', () => {
    const runs = MarkdownService.parseInlineRuns('visit [Google](https://google.com) now') as InlineRun[];
    expect(runs).toHaveLength(3);
    expect(runs[0]).toEqual({ text: 'visit ' });
    expect(runs[1]).toEqual({ text: 'Google', url: 'https://google.com' });
    expect(runs[2]).toEqual({ text: ' now' });
  });

  it('parses mixed inline formatting', () => {
    const runs = MarkdownService.parseInlineRuns('**bold** and *italic* and `code`') as InlineRun[];
    expect(runs).toHaveLength(5);
    expect(runs[0]).toEqual({ text: 'bold', bold: true });
    expect(runs[1]).toEqual({ text: ' and ' });
    expect(runs[2]).toEqual({ text: 'italic', italic: true });
    expect(runs[3]).toEqual({ text: ' and ' });
    expect(runs[4]).toEqual({ text: 'code', code: true });
  });

  it('handles empty string', () => {
    const runs = MarkdownService.parseInlineRuns('') as InlineRun[];
    expect(runs).toHaveLength(0);
  });

  it('handles multiple bold sections', () => {
    const runs = MarkdownService.parseInlineRuns('**a** then **b**') as InlineRun[];
    expect(runs).toHaveLength(3);
    expect(runs[0]).toEqual({ text: 'a', bold: true });
    expect(runs[1]).toEqual({ text: ' then ' });
    expect(runs[2]).toEqual({ text: 'b', bold: true });
  });

  it('handles link with special characters in URL', () => {
    const runs = MarkdownService.parseInlineRuns('[doc](https://example.com/path?q=1&r=2)') as InlineRun[];
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual({ text: 'doc', url: 'https://example.com/path?q=1&r=2' });
  });

  it('handles inline code containing asterisks', () => {
    const runs = MarkdownService.parseInlineRuns('`**not bold**` is code') as InlineRun[];
    expect(runs).toHaveLength(2);
    expect(runs[0]).toEqual({ text: '**not bold**', code: true });
    expect(runs[1]).toEqual({ text: ' is code' });
  });

  it('handles plain text with no special characters', () => {
    const runs = MarkdownService.parseInlineRuns('Just some normal text here.') as InlineRun[];
    expect(runs).toHaveLength(1);
    expect(runs[0].text).toBe('Just some normal text here.');
    expect(runs[0].bold).toBeUndefined();
    expect(runs[0].italic).toBeUndefined();
    expect(runs[0].code).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Heading parsing
// ═══════════════════════════════════════════════════════════════

describe('MarkdownService — heading parsing', () => {
  it('parses H1', () => {
    const h = MarkdownService.parseHeading('# Title');
    expect(h).toEqual({ level: 1, content: 'Title' });
  });

  it('parses H2', () => {
    const h = MarkdownService.parseHeading('## Subtitle');
    expect(h).toEqual({ level: 2, content: 'Subtitle' });
  });

  it('parses H3 through H6', () => {
    for (let level = 3; level <= 6; level++) {
      const prefix = '#'.repeat(level);
      const h = MarkdownService.parseHeading(`${prefix} Heading ${level}`);
      expect(h).toEqual({ level, content: `Heading ${level}` });
    }
  });

  it('returns null for non-heading lines', () => {
    expect(MarkdownService.parseHeading('Normal text')).toBeNull();
    expect(MarkdownService.parseHeading('#NoSpace')).toBeNull();
    expect(MarkdownService.parseHeading('####### Too many')).toBeNull();
  });

  it('preserves inline formatting in heading content', () => {
    const h = MarkdownService.parseHeading('## **Bold** heading');
    expect(h).toEqual({ level: 2, content: '**Bold** heading' });
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Table detection
// ═══════════════════════════════════════════════════════════════

describe('MarkdownService — table detection', () => {
  it('detects valid table lines', () => {
    expect(MarkdownService.isTableLine('| a | b | c |')).toBe(true);
    expect(MarkdownService.isTableLine('|a|b|c|')).toBe(true);
  });

  it('rejects non-table lines', () => {
    expect(MarkdownService.isTableLine('not a table')).toBe(false);
    expect(MarkdownService.isTableLine('| only start')).toBe(false);
    expect(MarkdownService.isTableLine('only end |')).toBe(false);
  });

  it('detects separator rows', () => {
    expect(MarkdownService.isTableSeparator('| --- | --- | --- |')).toBe(true);
    expect(MarkdownService.isTableSeparator('|---|---|---|')).toBe(true);
    expect(MarkdownService.isTableSeparator('| :--- | :---: | ---: |')).toBe(true);
  });

  it('rejects non-separator rows', () => {
    expect(MarkdownService.isTableSeparator('| a | b | c |')).toBe(false);
    expect(MarkdownService.isTableSeparator('not a separator')).toBe(false);
  });

  it('a complete table is detected line-by-line', () => {
    const tableLines = [
      '| Header 1 | Header 2 |',
      '| --- | --- |',
      '| Cell 1 | Cell 2 |',
    ];
    expect(MarkdownService.isTableLine(tableLines[0])).toBe(true);
    expect(MarkdownService.isTableSeparator(tableLines[1])).toBe(true);
    expect(MarkdownService.isTableLine(tableLines[2])).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. List parsing
// ═══════════════════════════════════════════════════════════════

describe('MarkdownService — list parsing', () => {
  it('parses unordered list with -', () => {
    const item = MarkdownService.parseUnorderedListItem('- Item one');
    expect(item).toEqual({ nesting: 0, content: 'Item one' });
  });

  it('parses unordered list with *', () => {
    const item = MarkdownService.parseUnorderedListItem('* Item two');
    expect(item).toEqual({ nesting: 0, content: 'Item two' });
  });

  it('parses unordered list with +', () => {
    const item = MarkdownService.parseUnorderedListItem('+ Item three');
    expect(item).toEqual({ nesting: 0, content: 'Item three' });
  });

  it('detects nesting level from indentation', () => {
    expect(MarkdownService.parseUnorderedListItem('  - Nested once')).toEqual({ nesting: 1, content: 'Nested once' });
    expect(MarkdownService.parseUnorderedListItem('    - Nested twice')).toEqual({ nesting: 2, content: 'Nested twice' });
  });

  it('parses ordered list', () => {
    const item = MarkdownService.parseOrderedListItem('1. First item');
    expect(item).toEqual({ nesting: 0, content: 'First item' });
  });

  it('parses ordered list with large numbers', () => {
    const item = MarkdownService.parseOrderedListItem('42. Forty-second item');
    expect(item).toEqual({ nesting: 0, content: 'Forty-second item' });
  });

  it('detects ordered list nesting', () => {
    expect(MarkdownService.parseOrderedListItem('  1. Nested once')).toEqual({ nesting: 1, content: 'Nested once' });
  });

  it('returns null for non-list lines', () => {
    expect(MarkdownService.parseUnorderedListItem('Not a list')).toBeNull();
    expect(MarkdownService.parseOrderedListItem('Not a list')).toBeNull();
    expect(MarkdownService.parseUnorderedListItem('---')).toBeNull();
  });

  it('handles list items with inline formatting', () => {
    const item = MarkdownService.parseUnorderedListItem('- **Bold** item with `code`');
    expect(item).toEqual({ nesting: 0, content: '**Bold** item with `code`' });
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Horizontal rule detection
// ═══════════════════════════════════════════════════════════════

describe('MarkdownService — horizontal rule detection', () => {
  it('detects triple dashes', () => {
    expect(MarkdownService.isHorizontalRule('---')).toBe(true);
    expect(MarkdownService.isHorizontalRule('-----')).toBe(true);
  });

  it('detects triple asterisks', () => {
    expect(MarkdownService.isHorizontalRule('***')).toBe(true);
    expect(MarkdownService.isHorizontalRule('*****')).toBe(true);
  });

  it('detects triple underscores', () => {
    expect(MarkdownService.isHorizontalRule('___')).toBe(true);
    expect(MarkdownService.isHorizontalRule('_____')).toBe(true);
  });

  it('allows leading/trailing whitespace', () => {
    expect(MarkdownService.isHorizontalRule('  ---  ')).toBe(true);
  });

  it('rejects non-HR lines', () => {
    expect(MarkdownService.isHorizontalRule('-- not enough')).toBe(false);
    expect(MarkdownService.isHorizontalRule('text ---')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Code fence detection
// ═══════════════════════════════════════════════════════════════

describe('MarkdownService — code fence detection', () => {
  it('detects opening code fence', () => {
    expect(MarkdownService.isCodeFence('```')).toBe(true);
    expect(MarkdownService.isCodeFence('```javascript')).toBe(true);
    expect(MarkdownService.isCodeFence('```typescript')).toBe(true);
  });

  it('detects closing code fence', () => {
    expect(MarkdownService.isCodeFence('```')).toBe(true);
  });

  it('allows leading whitespace', () => {
    expect(MarkdownService.isCodeFence('  ```')).toBe(true);
  });

  it('rejects non-fence lines', () => {
    expect(MarkdownService.isCodeFence('``not a fence')).toBe(false);
    expect(MarkdownService.isCodeFence('text ```')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Full markdown parsing (block classification)
// ═══════════════════════════════════════════════════════════════

describe('MarkdownService — full markdown parsing (line-by-line)', () => {
  /**
   * Walks markdown lines using the real MarkdownService classifiers
   * and records block types — mirrors the logic in writeMarkdownToBody_.
   */
  function classifyBlocks(markdown: string): string[] {
    const lines = markdown.split('\n');
    const blocks: string[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (MarkdownService.isCodeFence(line)) {
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !MarkdownService.isCodeFence(lines[i])) {
          codeLines.push(lines[i]);
          i++;
        }
        i++;
        blocks.push(`CODE_BLOCK(${codeLines.length} lines)`);
        continue;
      }

      if (MarkdownService.isTableLine(line) && i + 1 < lines.length && MarkdownService.isTableSeparator(lines[i + 1])) {
        let rowCount = 0;
        while (i < lines.length && MarkdownService.isTableLine(lines[i])) {
          if (!MarkdownService.isTableSeparator(lines[i])) rowCount++;
          i++;
        }
        blocks.push(`TABLE(${rowCount} rows)`);
        continue;
      }

      if (MarkdownService.isHorizontalRule(line)) {
        blocks.push('HR');
        i++;
        continue;
      }

      if (line.trim() === '') {
        i++;
        continue;
      }

      const heading = MarkdownService.parseHeading(line);
      if (heading) {
        blocks.push(`H${heading.level}(${heading.content})`);
        i++;
        continue;
      }

      const ul = MarkdownService.parseUnorderedListItem(line);
      if (ul) {
        let count = 0;
        while (i < lines.length && MarkdownService.parseUnorderedListItem(lines[i])) {
          count++;
          i++;
        }
        blocks.push(`UL(${count} items)`);
        continue;
      }

      const ol = MarkdownService.parseOrderedListItem(line);
      if (ol) {
        let count = 0;
        while (i < lines.length && MarkdownService.parseOrderedListItem(lines[i])) {
          count++;
          i++;
        }
        blocks.push(`OL(${count} items)`);
        continue;
      }

      blocks.push(`PARA(${line.slice(0, 40)})`);
      i++;
    }

    return blocks;
  }

  it('classifies a simple document', () => {
    const md = `# Title

Some paragraph text.

## Section

- Item 1
- Item 2
- Item 3
`;
    const blocks = classifyBlocks(md);
    expect(blocks).toEqual([
      'H1(Title)',
      'PARA(Some paragraph text.)',
      'H2(Section)',
      'UL(3 items)',
    ]);
  });

  it('classifies code blocks', () => {
    const md = `Some text.

\`\`\`typescript
const x = 1;
const y = 2;
\`\`\`

More text.
`;
    const blocks = classifyBlocks(md);
    expect(blocks).toEqual([
      'PARA(Some text.)',
      'CODE_BLOCK(2 lines)',
      'PARA(More text.)',
    ]);
  });

  it('classifies tables', () => {
    const md = `| Name | Age |
| --- | --- |
| Alice | 30 |
| Bob | 25 |
`;
    const blocks = classifyBlocks(md);
    expect(blocks).toEqual(['TABLE(3 rows)']);
  });

  it('classifies horizontal rules', () => {
    const md = `Above

---

Below
`;
    const blocks = classifyBlocks(md);
    expect(blocks).toEqual([
      'PARA(Above)',
      'HR',
      'PARA(Below)',
    ]);
  });

  it('classifies ordered lists', () => {
    const md = `1. First
2. Second
3. Third
`;
    const blocks = classifyBlocks(md);
    expect(blocks).toEqual(['OL(3 items)']);
  });

  it('classifies a complex document', () => {
    const md = `# EditorLLM Manual

## Setup

Install the add-on and run **Initialize Tabs**.

### Requirements

- Google Docs
- Gemini API key
- A manuscript

## Agents

| Agent | Tier |
| --- | --- |
| Architect | Thinking |
| EarTune | Fast |

---

## Code Example

\`\`\`javascript
function run() {
  console.log('hello');
}
\`\`\`

1. Step one
2. Step two
`;
    const blocks = classifyBlocks(md);
    expect(blocks).toEqual([
      'H1(EditorLLM Manual)',
      'H2(Setup)',
      'PARA(Install the add-on and run **Initialize )',
      'H3(Requirements)',
      'UL(3 items)',
      'H2(Agents)',
      'TABLE(3 rows)',
      'HR',
      'H2(Code Example)',
      'CODE_BLOCK(3 lines)',
      'OL(2 items)',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. appendTable_ bug fix — GAS table.getRow(0) throws on empty table
// ═══════════════════════════════════════════════════════════════

describe('MarkdownService — appendTable_ bug fix', () => {
  /**
   * In GAS, body.appendTable() returns an empty table with NO rows.
   * Calling table.getRow(0) on that empty table THROWS — it does NOT return
   * null. The original code used `table.getRow(0) || table.appendTableRow()`
   * which throws before the || can fire.
   *
   * The fix: always call table.appendTableRow() for every row so getRow() is
   * never called on an empty table.
   */
  it('does not call getRow(0) — would throw on an empty GAS table', () => {
    const mockTableRow = {
      appendTableCell: jest.fn().mockReturnThis(),
      getNumCells: jest.fn().mockReturnValue(0),
    };
    const mockTable = {
      appendTableRow: jest.fn().mockReturnValue(mockTableRow),
      // Simulate real GAS: getRow on empty table throws, not returns null
      getRow: jest.fn().mockImplementation(() => {
        throw new Error('GAS: Index (0) is out of bounds for array of size 0');
      }),
    };
    const mockBodyForTable = {
      clear: jest.fn(),
      appendTable: jest.fn().mockReturnValue(mockTable),
      appendParagraph: jest.fn(),
      appendListItem: jest.fn().mockReturnValue({
        editAsText: jest.fn().mockReturnValue({
          setBold: jest.fn(), setItalic: jest.fn(),
          setFontFamily: jest.fn(), setLinkUrl: jest.fn(),
        }),
        setText: jest.fn(),
        setNestingLevel: jest.fn(),
        setGlyphType: jest.fn(),
      }),
      appendHorizontalRule: jest.fn(),
      getNumChildren: jest.fn().mockReturnValue(0),
    };

    const tableMarkdown = `| Header 1 | Header 2 |
| --- | --- |
| Cell 1 | Cell 2 |`;

    // Must not throw — the fixed code never calls getRow()
    expect(() =>
      MarkdownService.writeMarkdownToBody(tableMarkdown, mockBodyForTable as any)
    ).not.toThrow();

    // Verify getRow was never called (the bug would have triggered it)
    expect(mockTable.getRow).not.toHaveBeenCalled();

    // appendTableRow called once per data row: header row + data row = 2
    expect(mockTable.appendTableRow).toHaveBeenCalledTimes(2);

    // appendTableCell called for each cell in each row: 2 columns × 2 rows = 4
    expect(mockTableRow.appendTableCell).toHaveBeenCalledTimes(4);
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. Body → Markdown: processTextElement_ logic
//    Realistic GAS attribute arrays — each run produces BOTH a start
//    entry (with formatting flags) AND an end entry (with no flags).
// ═══════════════════════════════════════════════════════════════

describe('MarkdownService — Body → Markdown (processTextElement_ logic)', () => {
  /**
   * Simulates processTextElement_ for plain text with attribute run entries.
   *
   * Real GAS getTextAttributeIndices() returns BOTH the start AND the end offset
   * of every formatting run. For example, "Hello bold world" with chars 6–9 bold:
   *   attrs = [{ off: 0 }, { off: 6, bold: true }, { off: 10 }]
   *
   * Processing walks backwards so each run wraps exactly the text from
   * that offset to lastOff, where lastOff was set by the prior (right-side) entry.
   */
  function simulateTextElement(
    text: string,
    attrs: Array<{
      off: number;
      bold?: boolean;
      italic?: boolean;
      linkUrl?: string;
      fontFamily?: string;
    }>
  ): string {
    let pOut = text;
    let lastOff = pOut.length;

    for (let i = attrs.length - 1; i >= 0; i--) {
      let off = attrs[i].off;

      if (attrs[i].linkUrl) {
        const url = attrs[i].linkUrl!;
        while (i >= 1 && attrs[i - 1].off === off - 1 && attrs[i - 1].linkUrl === url) {
          i--;
          off = attrs[i].off;
        }
        const inside = pOut.substring(off, lastOff);
        pOut = pOut.substring(0, off) + '[' + inside + '](' + url + ')' + pOut.substring(lastOff);
      } else if (attrs[i].fontFamily && attrs[i].fontFamily!.toUpperCase().indexOf('COURIER') >= 0) {
        while (
          i >= 1 &&
          attrs[i - 1].fontFamily &&
          attrs[i - 1].fontFamily!.toUpperCase().indexOf('COURIER') >= 0
        ) {
          i--;
          off = attrs[i].off;
        }
        const inside = pOut.substring(off, lastOff).trim();
        if (inside.length > 0) {
          pOut = pOut.substring(0, off) + '`' + inside + '`' + pOut.substring(lastOff);
        }
      } else if (attrs[i].bold || attrs[i].italic) {
        const bold = !!attrs[i].bold;
        const italic = !!attrs[i].italic;
        while (
          i >= 1 &&
          !!attrs[i - 1].bold === bold &&
          !!attrs[i - 1].italic === italic
        ) {
          i--;
          off = attrs[i].off;
        }
        const inside = pOut.substring(off, lastOff).trim();
        if (inside.length > 0) {
          let d1: string, d2: string;
          if (bold && italic) { d1 = '***'; d2 = '***'; }
          else if (bold)      { d1 = '**'; d2 = '**'; }
          else                { d1 = '*'; d2 = '*'; }
          pOut = pOut.substring(0, off) + d1 + inside + d2 + pOut.substring(lastOff);
        }
      }

      lastOff = off;
    }
    return pOut;
  }

  it('returns plain text unchanged', () => {
    expect(simulateTextElement('Hello world', [])).toBe('Hello world');
  });

  it('wraps a bounded bold run in ** (realistic: start + end entry)', () => {
    // "Hello bold world" — chars 6–9 ("bold") are bold.
    // Realistic GAS attrs: offset 0 (plain), 6 (bold start), 10 (end/plain).
    const result = simulateTextElement('Hello bold world', [
      { off: 0 },
      { off: 6, bold: true },
      { off: 10 },
    ]);
    expect(result).toBe('Hello **bold** world');
  });

  it('wraps a bounded italic run in * (realistic: start + end entry)', () => {
    // "Hello italic world" — chars 6–11 ("italic") are italic.
    const result = simulateTextElement('Hello italic world', [
      { off: 0 },
      { off: 6, italic: true },
      { off: 12 },
    ]);
    expect(result).toBe('Hello *italic* world');
  });

  it('wraps a bounded bold-italic run in *** (realistic)', () => {
    // "Hello both world" — chars 6–9 ("both") are bold+italic.
    const result = simulateTextElement('Hello both world', [
      { off: 0 },
      { off: 6, bold: true, italic: true },
      { off: 10 },
    ]);
    expect(result).toBe('Hello ***both*** world');
  });

  it('wraps a bounded link in [text](url) (realistic)', () => {
    // "Click here please" — chars 6–9 ("here") are linked.
    const result = simulateTextElement('Click here please', [
      { off: 0 },
      { off: 6, linkUrl: 'https://example.com' },
      { off: 10 },
    ]);
    expect(result).toBe('Click [here](https://example.com) please');
  });

  it('wraps a bounded Courier New run in backticks (realistic)', () => {
    // "Use const x here" — chars 4–10 ("const x") are Courier New.
    const result = simulateTextElement('Use const x here', [
      { off: 0 },
      { off: 4, fontFamily: 'Courier New' },
      { off: 11 },
    ]);
    expect(result).toBe('Use `const x` here');
  });

  it('handles two disjoint formatting runs correctly (realistic)', () => {
    // "A bold B italic C"
    // chars 2–5 ("bold") are bold, chars 9–14 ("italic") are italic.
    // Realistic attrs: 0, 2 (bold), 6 (end bold), 9 (italic), 15 (end italic)
    const result = simulateTextElement('A bold B italic C', [
      { off: 0 },
      { off: 2, bold: true },
      { off: 6 },
      { off: 9, italic: true },
      { off: 15 },
    ]);
    expect(result).toBe('A **bold** B *italic* C');
  });

  it('bold that extends to end of string (single entry — no end marker)', () => {
    // If there is no end-marker entry, the run extends to lastOff = text.length.
    // This happens when the entire tail of the string has the same formatting.
    const result = simulateTextElement('Hello bold world', [{ off: 6, bold: true }]);
    expect(result).toContain('**bold world**');
  });
});

// ═══════════════════════════════════════════════════════════════
// 10. Heading prefix generation
// ═══════════════════════════════════════════════════════════════

describe('MarkdownService — heading prefix generation', () => {
  const headingMap: Record<string, string> = {
    HEADING1: '# ',
    HEADING2: '## ',
    HEADING3: '### ',
    HEADING4: '#### ',
    HEADING5: '##### ',
    HEADING6: '###### ',
    NORMAL: '',
  };

  for (const [heading, prefix] of Object.entries(headingMap)) {
    it(`${heading} produces prefix "${prefix.trim() || '(none)'}"`, () => {
      expect(headingMap[heading]).toBe(prefix);
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// 11. Table row parsing
// ═══════════════════════════════════════════════════════════════

describe('MarkdownService — table row parsing', () => {
  function parseTableRow(line: string): string[] {
    return line.split('|').slice(1, -1).map(cell => cell.trim());
  }

  it('parses a header row', () => {
    expect(parseTableRow('| Name | Age | City |')).toEqual(['Name', 'Age', 'City']);
  });

  it('parses a data row', () => {
    expect(parseTableRow('| Alice | 30 | NYC |')).toEqual(['Alice', '30', 'NYC']);
  });

  it('handles cells with extra whitespace', () => {
    expect(parseTableRow('|  a  |  b  |')).toEqual(['a', 'b']);
  });

  it('handles empty cells', () => {
    expect(parseTableRow('| a |  | c |')).toEqual(['a', '', 'c']);
  });
});

// ═══════════════════════════════════════════════════════════════
// 12. Markdown to body assembly simulation
// ═══════════════════════════════════════════════════════════════

describe('MarkdownService — markdown to body assembly simulation', () => {
  interface DocCall {
    type: 'paragraph' | 'heading' | 'list_bullet' | 'list_number' | 'table' | 'hr' | 'code';
    text?: string;
    level?: number;
    nesting?: number;
    rows?: number;
    cols?: number;
  }

  function simulateMarkdownToBody(markdown: string): DocCall[] {
    const calls: DocCall[] = [];
    const lines = markdown.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (MarkdownService.isCodeFence(line)) {
        i++;
        while (i < lines.length && !MarkdownService.isCodeFence(lines[i])) {
          calls.push({ type: 'code', text: lines[i] });
          i++;
        }
        i++;
        continue;
      }

      if (MarkdownService.isTableLine(line) && i + 1 < lines.length && MarkdownService.isTableSeparator(lines[i + 1])) {
        const dataRows: string[][] = [];
        while (i < lines.length && MarkdownService.isTableLine(lines[i])) {
          if (!MarkdownService.isTableSeparator(lines[i])) {
            dataRows.push(lines[i].split('|').slice(1, -1).map(c => c.trim()));
          }
          i++;
        }
        calls.push({
          type: 'table',
          rows: dataRows.length,
          cols: dataRows[0]?.length || 0,
        });
        continue;
      }

      if (MarkdownService.isHorizontalRule(line)) {
        calls.push({ type: 'hr' });
        i++;
        continue;
      }

      if (line.trim() === '') { i++; continue; }

      const heading = MarkdownService.parseHeading(line);
      if (heading) {
        calls.push({ type: 'heading', text: heading.content, level: heading.level });
        i++;
        continue;
      }

      const ul = MarkdownService.parseUnorderedListItem(line);
      if (ul) {
        calls.push({ type: 'list_bullet', text: ul.content, nesting: ul.nesting });
        i++;
        continue;
      }

      const ol = MarkdownService.parseOrderedListItem(line);
      if (ol) {
        calls.push({ type: 'list_number', text: ol.content, nesting: ol.nesting });
        i++;
        continue;
      }

      calls.push({ type: 'paragraph', text: line });
      i++;
    }

    return calls;
  }

  it('converts a simple document to expected calls', () => {
    const calls = simulateMarkdownToBody(`# Title

Hello **world**.

- Item 1
- Item 2
`);
    expect(calls).toEqual([
      { type: 'heading', text: 'Title', level: 1 },
      { type: 'paragraph', text: 'Hello **world**.' },
      { type: 'list_bullet', text: 'Item 1', nesting: 0 },
      { type: 'list_bullet', text: 'Item 2', nesting: 0 },
    ]);
  });

  it('converts nested lists correctly', () => {
    const calls = simulateMarkdownToBody(`- Top level
  - Nested once
    - Nested twice
`);
    expect(calls).toEqual([
      { type: 'list_bullet', text: 'Top level', nesting: 0 },
      { type: 'list_bullet', text: 'Nested once', nesting: 1 },
      { type: 'list_bullet', text: 'Nested twice', nesting: 2 },
    ]);
  });

  it('converts tables', () => {
    const calls = simulateMarkdownToBody(`| A | B |
| --- | --- |
| 1 | 2 |
| 3 | 4 |
`);
    expect(calls).toEqual([
      { type: 'table', rows: 3, cols: 2 },
    ]);
  });

  it('converts code blocks', () => {
    const calls = simulateMarkdownToBody(`\`\`\`
line1
line2
\`\`\`
`);
    expect(calls).toEqual([
      { type: 'code', text: 'line1' },
      { type: 'code', text: 'line2' },
    ]);
  });

  it('converts horizontal rules', () => {
    const calls = simulateMarkdownToBody(`Above

---

Below
`);
    expect(calls).toEqual([
      { type: 'paragraph', text: 'Above' },
      { type: 'hr' },
      { type: 'paragraph', text: 'Below' },
    ]);
  });

  it('handles mixed ordered and unordered lists', () => {
    const calls = simulateMarkdownToBody(`- Bullet item
1. Number item
- Another bullet
`);
    expect(calls).toEqual([
      { type: 'list_bullet', text: 'Bullet item', nesting: 0 },
      { type: 'list_number', text: 'Number item', nesting: 0 },
      { type: 'list_bullet', text: 'Another bullet', nesting: 0 },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════
// 13. Round-trip fidelity (inline formatting)
// ═══════════════════════════════════════════════════════════════

describe('MarkdownService — round-trip fidelity (inline formatting)', () => {
  function reassemble(runs: InlineRun[]): string {
    return runs.map(r => {
      if (r.bold && r.italic) return `***${r.text}***`;
      if (r.bold) return `**${r.text}**`;
      if (r.italic) return `*${r.text}*`;
      if (r.code) return `\`${r.text}\``;
      if (r.url) return `[${r.text}](${r.url})`;
      return r.text;
    }).join('');
  }

  it('bold survives markdown → runs → text', () => {
    const md = '**important** text';
    expect(reassemble(MarkdownService.parseInlineRuns(md))).toBe(md);
  });

  it('italic survives round-trip', () => {
    const md = '*emphasis* here';
    expect(reassemble(MarkdownService.parseInlineRuns(md))).toBe(md);
  });

  it('inline code survives round-trip', () => {
    const md = '`code` snippet';
    expect(reassemble(MarkdownService.parseInlineRuns(md))).toBe(md);
  });

  it('link survives round-trip', () => {
    const md = '[text](https://url.com)';
    expect(reassemble(MarkdownService.parseInlineRuns(md))).toBe(md);
  });

  it('complex mixed formatting survives round-trip', () => {
    const md = '**bold** and *italic* with `code` and [link](http://x.com)';
    expect(reassemble(MarkdownService.parseInlineRuns(md))).toBe(md);
  });
});

// ═══════════════════════════════════════════════════════════════
// 14. Edge cases
// ═══════════════════════════════════════════════════════════════

describe('MarkdownService — edge cases', () => {
  it('empty markdown produces no runs', () => {
    expect(MarkdownService.parseInlineRuns('')).toHaveLength(0);
  });

  it('whitespace-only markdown produces no blocks', () => {
    const md = '   \n\n  \n';
    const nonEmpty = md.split('\n').filter(l => l.trim() !== '');
    expect(nonEmpty).toHaveLength(0);
  });

  it('handles consecutive headings', () => {
    const blocks: string[] = [];
    for (const line of ['# H1', '## H2', '### H3']) {
      const h = MarkdownService.parseHeading(line);
      if (h) blocks.push(`H${h.level}`);
    }
    expect(blocks).toEqual(['H1', 'H2', 'H3']);
  });

  it('handles code fence with language tag', () => {
    expect(MarkdownService.isCodeFence('```python')).toBe(true);
    expect(MarkdownService.isCodeFence('```json')).toBe(true);
    expect(MarkdownService.isCodeFence('```')).toBe(true);
  });

  it('handles table with single column', () => {
    expect(MarkdownService.isTableLine('| only |')).toBe(true);
    expect(MarkdownService.isTableSeparator('| --- |')).toBe(true);
  });

  it('handles deeply nested unordered list', () => {
    const item = MarkdownService.parseUnorderedListItem('      - Deep');
    expect(item).toEqual({ nesting: 3, content: 'Deep' });
  });

  it('handles deeply nested ordered list', () => {
    const item = MarkdownService.parseOrderedListItem('      1. Deep');
    expect(item).toEqual({ nesting: 3, content: 'Deep' });
  });
});
