// Mock all Google Apps Script globals for Jest (Node.js) environment

const fs = require('fs');
const path = require('path');

// The PromptBuilders requirement has been deprecated.

const mockBody = {
  getText: jest.fn().mockReturnValue(''),
  clear: jest.fn(),
  appendParagraph: jest.fn(),
  findText: jest.fn().mockReturnValue(null),
};

const mockDocumentTab = {
  getBody: jest.fn().mockReturnValue(mockBody),
  getId: jest.fn().mockReturnValue('mock-tab-id'),
};

const mockTab = {
  getTitle: jest.fn().mockReturnValue('MockTab'),
  getId: jest.fn().mockReturnValue('mock-tab-id'),
  getChildTabs: jest.fn().mockReturnValue([]),
  asDocumentTab: jest.fn().mockReturnValue(mockDocumentTab),
};

const mockDocument = {
  getTabs: jest.fn().mockReturnValue([mockTab]),
  addTab: jest.fn().mockReturnValue(mockTab),
  getId: jest.fn().mockReturnValue('mock-doc-id'),
  getName: jest.fn().mockReturnValue('Mock Document'),
};

global.DocumentApp = {
  getActiveDocument: jest.fn().mockReturnValue(mockDocument),
  ElementType: {
    TEXT: 'TEXT',
    PARAGRAPH: 'PARAGRAPH',
    TABLE: 'TABLE',
    TABLE_ROW: 'TABLE_ROW',
    LIST_ITEM: 'LIST_ITEM',
    INLINE_IMAGE: 'INLINE_IMAGE',
    HORIZONTAL_RULE: 'HORIZONTAL_RULE',
    PAGE_BREAK: 'PAGE_BREAK',
    FOOTNOTE: 'FOOTNOTE',
    TABLE_OF_CONTENTS: 'TABLE_OF_CONTENTS',
  },
  ParagraphHeading: {
    NORMAL: 'NORMAL',
    HEADING1: 'HEADING1',
    HEADING2: 'HEADING2',
    HEADING3: 'HEADING3',
    HEADING4: 'HEADING4',
    HEADING5: 'HEADING5',
    HEADING6: 'HEADING6',
  },
  GlyphType: {
    BULLET: 'BULLET',
    HOLLOW_BULLET: 'HOLLOW_BULLET',
    SQUARE_BULLET: 'SQUARE_BULLET',
    NUMBER: 'NUMBER',
  },
  openById: jest.fn().mockReturnValue(mockDocument),
};

global.PropertiesService = {
  getUserProperties: jest.fn().mockReturnValue({
    getProperty: jest.fn().mockReturnValue(null),
    setProperty: jest.fn(),
    deleteProperty: jest.fn(),
  }),
  getScriptProperties: jest.fn().mockReturnValue({
    getProperty: jest.fn().mockReturnValue(null),
    setProperty: jest.fn(),
  }),
};

global.UrlFetchApp = {
  fetch: jest.fn().mockReturnValue({
    getContentText: jest.fn().mockReturnValue('{}'),
    getResponseCode: jest.fn().mockReturnValue(200),
  }),
};

global.ScriptApp = {
  getOAuthToken: jest.fn().mockReturnValue('mock-token'),
};

global.HtmlService = {
  createHtmlOutputFromFile: jest.fn().mockReturnValue({
    setWidth: jest.fn().mockReturnThis(),
    setHeight: jest.fn().mockReturnThis(),
    setSandboxMode: jest.fn().mockReturnThis(),
  }),
  SandboxMode: { IFRAME: 'IFRAME' },
};

global.SpreadsheetApp = {
  getActiveSpreadsheet: jest.fn().mockReturnValue({}),
};

global.Drive = {
  Comments: {
    create: jest.fn().mockReturnValue({ id: 'mock-comment-id' }),
    list: jest.fn().mockReturnValue({ comments: [], items: [] }),
    remove: jest.fn(),
  },
  Replies: {
    create: jest.fn().mockReturnValue({ id: 'mock-reply-id' }),
  },
};

global.PropertiesService.getDocumentProperties = jest.fn().mockReturnValue({
  getProperty: jest.fn().mockReturnValue(null),
  setProperty: jest.fn(),
  deleteProperty: jest.fn(),
});

global.Docs = {
  Documents: {
    batchUpdate: jest.fn().mockReturnValue({}),
    get: jest.fn().mockReturnValue({}),
  },
};

global.Logger = {
  log: jest.fn(),
};

// ── CacheService mock (in-memory Map with TTL) ────────────────────────────
// Used by the real Tracer module in tracer.test.ts.
function createMockCache() {
  const store = new Map();  // key → { value, expiresAt }
  return {
    _store: store,  // exposed for test assertions
    put(key, value, ttl) {
      const expiresAt = ttl ? Date.now() + ttl * 1000 : Infinity;
      store.set(key, { value: String(value), expiresAt });
    },
    get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    getAll(keys) {
      const result = {};
      keys.forEach(function(k) {
        const v = this.get(k);
        if (v !== null) result[k] = v;
      }, this);
      return result;
    },
    remove(key) { store.delete(key); },
    removeAll(keys) { keys.forEach(function(k) { store.delete(k); }); },
  };
}

const mockUserCache = createMockCache();
global.CacheService = {
  getUserCache: jest.fn().mockReturnValue(mockUserCache),
  getScriptCache: jest.fn().mockReturnValue(createMockCache()),
  _mockUserCache: mockUserCache,  // exposed for test reset
  _createMockCache: createMockCache,
};

global.Tracer = {
  info:       jest.fn(),
  warn:       jest.fn(),
  error:      jest.fn(),
  startJob:   jest.fn(),
  finishJob:  jest.fn(),
  failJob:    jest.fn(),
  getLogs:    jest.fn().mockReturnValue([]),
  getJobStatus: jest.fn().mockReturnValue({ label: 'Agent', done: false, error: null }),
  getJobList:   jest.fn().mockReturnValue([]),
  clearAll:     jest.fn(),
};

global.Utilities = {
  sleep: jest.fn(),
};

// ── MarkdownService pure-function stubs ────────────────────────────────────
// These implement the same logic as the private helpers in MarkdownService.ts.
// Keeping them here (rather than duplicating in every test file) means tests
// call a single source-of-truth implementation via the MarkdownService global.
// tabToMarkdown / markdownToTab require GAS runtime; they are left as stubs.

global.MarkdownService = {
  // ── inline parsing ──────────────────────────────────────────────────────
  parseInlineRuns: function(input) {
    const runs = [];
    const pattern = /(`[^`]+`)|(\*{3}[^*]+\*{3})|(\*{2}[^*]+\*{2})|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))|([^`*\[]+)/g;
    let m;
    while ((m = pattern.exec(input)) !== null) {
      const match = m[0];
      if (m[1]) runs.push({ text: match.slice(1, -1), code: true });
      else if (m[2]) runs.push({ text: match.slice(3, -3), bold: true, italic: true });
      else if (m[3]) runs.push({ text: match.slice(2, -2), bold: true });
      else if (m[4]) runs.push({ text: match.slice(1, -1), italic: true });
      else if (m[5]) {
        const lm = match.match(/\[([^\]]+)\]\(([^)]+)\)/);
        if (lm) runs.push({ text: lm[1], url: lm[2] });
      } else if (m[6]) runs.push({ text: match });
    }
    return runs;
  },

  // ── line classifiers ────────────────────────────────────────────────────
  isTableLine: function(line) {
    return line.trim().startsWith('|') && line.trim().endsWith('|');
  },
  isTableSeparator: function(line) {
    return /^\|[\s\-:|]+\|$/.test(line.trim());
  },
  isHorizontalRule: function(line) {
    return /^\s*(---+|\*\*\*+|___+)\s*$/.test(line);
  },
  isCodeFence: function(line) {
    return line.trimStart().startsWith('```');
  },

  // ── structural parsers ──────────────────────────────────────────────────
  parseHeading: function(line) {
    const m = line.match(/^(#{1,6})\s+(.*)/);
    if (!m) return null;
    return { level: m[1].length, content: m[2] };
  },
  parseUnorderedListItem: function(line) {
    const m = line.match(/^(\s*)[-*+]\s+(.*)/);
    if (!m) return null;
    return { nesting: Math.floor(m[1].length / 2), content: m[2] };
  },
  parseOrderedListItem: function(line) {
    const m = line.match(/^(\s*)\d+\.\s+(.*)/);
    if (!m) return null;
    return { nesting: Math.floor(m[1].length / 2), content: m[2] };
  },

  // ── body writer (for testing appendTable_ and other internal paths) ──────
  writeMarkdownToBody: function(markdown, body) {
    // Minimal re-implementation of writeMarkdownToBody_ for test use.
    // Mirrors the real logic closely enough to exercise appendTable_.
    const isTableLine = (l) => l.trim().startsWith('|') && l.trim().endsWith('|');
    const isTableSeparator = (l) => /^\|[\s\-:|]+\|$/.test(l.trim());
    const isCodeFence = (l) => l.trimStart().startsWith('```');

    const lines = markdown.split('\n');
    let i = 0;
    body.clear();

    while (i < lines.length) {
      const line = lines[i];

      // Fenced code block
      if (isCodeFence(line)) {
        i++;
        while (i < lines.length && !isCodeFence(lines[i])) {
          body.appendParagraph(lines[i]);
          i++;
        }
        i++;
        continue;
      }

      // Table
      if (isTableLine(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        const tableLines = [];
        while (i < lines.length && isTableLine(lines[i])) {
          if (!isTableSeparator(lines[i])) tableLines.push(lines[i]);
          i++;
        }
        if (tableLines.length > 0) {
          const rows = tableLines.map(l => l.split('|').slice(1, -1).map(c => c.trim()));
          const table = body.appendTable();
          for (let r = 0; r < rows.length; r++) {
            const tr = table.appendTableRow();
            for (let c = 0; c < rows[r].length; c++) {
              tr.appendTableCell(rows[r][c] || '');
            }
          }
        }
        continue;
      }

      if (line.trim() === '') { i++; continue; }

      body.appendParagraph(line);
      i++;
    }
  },

  // ── stubs for GAS-dependent methods ─────────────────────────────────────
  tabToMarkdown: jest.fn().mockReturnValue(''),
  markdownToTab: jest.fn(),
};
