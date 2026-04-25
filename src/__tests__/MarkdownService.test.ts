import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

describe('MarkdownService', () => {
  let ms: any;
  let bodyMock: any;
  let elements: any[];

  beforeEach(() => {
    elements = [];

    const createTextMock = (text = '') => ({
      getText: jest.fn().mockReturnValue(text),
      setBold: jest.fn(),
      setItalic: jest.fn(),
      setFontFamily: jest.fn(),
      setLinkUrl: jest.fn(),
      setForegroundColor: jest.fn(),
    });

    const createParagraphMock = (text = '') => {
      const textMock = createTextMock(text);
      const p = {
        getType: () => 'PARAGRAPH',
        getText: () => text,
        clear: jest.fn(),
        setText: jest.fn((t) => { p.text = t; }),
        editAsText: jest.fn().mockReturnValue(textMock),
        setHeading: jest.fn(),
        setIndentStart: jest.fn(),
        setIndentFirstLine: jest.fn(),
        text,
      };
      return p;
    };

    const createListItemMock = (text = '') => {
      const textMock = createTextMock(text);
      const li = {
        getType: () => 'LIST_ITEM',
        clear: jest.fn(),
        setText: jest.fn((t) => { li.text = t; }),
        editAsText: jest.fn().mockReturnValue(textMock),
        setNestingLevel: jest.fn(),
        setGlyphType: jest.fn(),
        text,
      };
      return li;
    };

    bodyMock = {
      clear: jest.fn(),
      getNumChildren: () => elements.length,
      getChild: (i: number) => elements[i],
      appendParagraph: jest.fn((text) => {
        const p = createParagraphMock(text);
        elements.push(p);
        return p;
      }),
      appendListItem: jest.fn((text) => {
        const li = createListItemMock(text);
        elements.push(li);
        return li;
      }),
      appendHorizontalRule: jest.fn(() => {
        elements.push({ getType: () => 'HORIZONTAL_RULE' });
      }),
      appendTable: jest.fn(() => {
        const table = {
          getType: () => 'TABLE',
          appendTableRow: jest.fn(() => {
            const row = {
              appendTableCell: jest.fn(() => {
                // mock cell
              })
            };
            return row;
          })
        };
        elements.push(table);
        return table;
      }),
      getAttributes: jest.fn().mockReturnValue({}),
    };

    const ctx = vm.createContext({
      DocumentApp: {
        ElementType: { PARAGRAPH: 'PARAGRAPH', LIST_ITEM: 'LIST_ITEM', TABLE: 'TABLE', TEXT: 'TEXT', HORIZONTAL_RULE: 'HORIZONTAL_RULE' },
        ParagraphHeading: { HEADING1: 1, HEADING2: 2, HEADING3: 3 },
        GlyphType: { BULLET: 'BULLET', NUMBER: 'NUMBER' },
        Attribute: { BACKGROUND_COLOR: 'BACKGROUND_COLOR' }
      },
      DocOps: {
        clearBodySafely: jest.fn((b) => b.clear())
      },
      Tracer: {
        warn: jest.fn(),
        info: jest.fn()
      }
    });

    const code = fs.readFileSync(path.join(__dirname, '../../dist/MarkdownService.js'), 'utf8');
    vm.runInContext(code + '\n; this.MarkdownService = MarkdownService;', ctx);
    ms = (ctx as any).MarkdownService;
  });

  it('compiles', () => {
    expect(ms).toBeDefined();
  });

  it('parses unordered list with continuations', () => {
    const md = `- Item 1\n  Continuation 1\n- Item 2\n  - Subitem`;
    ms.writeMarkdownToBody(md, bodyMock);
    
    expect(elements).toHaveLength(3);
    expect(elements[0].getType()).toBe('LIST_ITEM');
    expect(elements[0].text).toBe('Item 1\nContinuation 1');
    expect(elements[0].setNestingLevel).toHaveBeenCalledWith(0);
    
    expect(elements[1].getType()).toBe('LIST_ITEM');
    expect(elements[1].text).toBe('Item 2');
    expect(elements[1].setNestingLevel).toHaveBeenCalledWith(0);
    
    expect(elements[2].getType()).toBe('LIST_ITEM');
    expect(elements[2].text).toBe('Subitem');
    expect(elements[2].setNestingLevel).toHaveBeenCalledWith(1);
  });

  it('parses ordered list with continuations', () => {
    const md = `1. First\n   Still first\n2. Second`;
    ms.writeMarkdownToBody(md, bodyMock);
    
    expect(elements).toHaveLength(2);
    expect(elements[0].getType()).toBe('LIST_ITEM');
    expect(elements[0].text).toBe('First\nStill first');
    expect(elements[0].setGlyphType).toHaveBeenCalledWith('NUMBER');
    
    expect(elements[1].getType()).toBe('LIST_ITEM');
    expect(elements[1].text).toBe('Second');
    expect(elements[1].setGlyphType).toHaveBeenCalledWith('NUMBER');
  });

  it('parses blockquotes', () => {
    const md = `> Quote line 1\n> Quote line 2\n\nNormal paragraph`;
    ms.writeMarkdownToBody(md, bodyMock);
    
    expect(elements).toHaveLength(3);
    expect(elements[0].getType()).toBe('PARAGRAPH');
    expect(elements[0].text).toBe('Quote line 1');
    expect(elements[0].setIndentStart).toHaveBeenCalledWith(36);
    
    expect(elements[1].getType()).toBe('PARAGRAPH');
    expect(elements[1].text).toBe('Quote line 2');
    expect(elements[1].setIndentStart).toHaveBeenCalledWith(36);

    expect(elements[2].getType()).toBe('PARAGRAPH');
    expect(elements[2].text).toBe('Normal paragraph');
  });

  describe('parseInlineRuns', () => {
    it('parses inline bold and italic', () => {
      const runs = ms.parseInlineRuns('This is **bold** and *italic* and ***both***!');
      expect(runs).toEqual([
        { text: 'This is ' },
        { text: 'bold', bold: true },
        { text: ' and ' },
        { text: 'italic', italic: true },
        { text: ' and ' },
        { text: 'both', bold: true, italic: true },
        { text: '!' },
      ]);
    });

    it('parses inline code', () => {
      const runs = ms.parseInlineRuns('Run `npm install` to begin.');
      expect(runs).toEqual([
        { text: 'Run ' },
        { text: 'npm install', code: true },
        { text: ' to begin.' },
      ]);
    });

    it('parses links', () => {
      const runs = ms.parseInlineRuns('Click [here](https://google.com).');
      expect(runs).toEqual([
        { text: 'Click ' },
        { text: 'here', url: 'https://google.com' },
        { text: '.' },
      ]);
    });
  });

});
