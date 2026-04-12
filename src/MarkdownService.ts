// ============================================================
// MarkdownService.ts — Bidirectional Markdown ↔ Google Docs
// conversion for individual document tabs.
//
// tabToMarkdown: walks a tab's Body element tree and emits
//   GitHub-Flavoured Markdown (headings, bold, italic, links,
//   inline code, ordered/unordered lists, tables, images,
//   horizontal rules, footnotes).
//
// markdownToTab: parses a markdown string and writes it as
//   natively-formatted Google Docs content (headings, bold,
//   italic, links, inline code, lists, code blocks, tables,
//   horizontal rules).
//
// Core conversion logic adapted from trepidacious/gdocs2md
// (Apache 2.0, Copyright 2013 Google Inc.).
// ============================================================

const MarkdownService = (() => {

  // ════════════════════════════════════════════════════════════
  // Tab → Markdown
  // ════════════════════════════════════════════════════════════

  /**
   * Converts a named tab's body content to a Markdown string.
   * Returns '' if the tab doesn't exist.
   */
  function tabToMarkdown(tabName: string): string {
    const docTab = DocOps.getTabByName(tabName);
    if (!docTab) {
      Logger.log(`[MarkdownService] tabToMarkdown: tab "${tabName}" not found`);
      return '';
    }
    return bodyToMarkdown_(docTab.getBody());
  }

  function bodyToMarkdown_(body: GoogleAppsScript.Document.Body): string {
    const numChildren = body.getNumChildren();
    let text = '';
    let inCodeBlock = false;
    const listCounters: Record<string, number> = {};

    for (let i = 0; i < numChildren; i++) {
      const child = body.getChild(i);
      const result = processElement_(i, child, listCounters, inCodeBlock);
      if (result === null) continue;

      if (inCodeBlock && !result.codeBlockLine) {
        text += '```\n\n';
        inCodeBlock = false;
      }

      if (result.codeBlockLine) {
        if (!inCodeBlock) {
          text += '\n```\n';
          inCodeBlock = true;
        }
        text += result.text + '\n';
      } else if (result.text !== undefined && result.text.length > 0) {
        text += result.text + '\n\n';
      }
    }

    if (inCodeBlock) {
      text += '```\n';
    }

    return text.trim() + '\n';
  }

  interface ElementResult {
    text: string;
    codeBlockLine?: boolean;
  }

  function processElement_(
    _index: number,
    element: GoogleAppsScript.Document.Element,
    listCounters: Record<string, number>,
    inCodeBlock: boolean
  ): ElementResult | null {
    const el = element as any;
    if (!el.getNumChildren || el.getNumChildren() === 0) {
      if (inCodeBlock) return { text: '', codeBlockLine: true };
      return null;
    }

    const type = element.getType();

    if (type === DocumentApp.ElementType.TABLE_OF_CONTENTS) {
      return { text: '[[TOC]]' };
    }

    // --- Table ---
    if (type === DocumentApp.ElementType.TABLE) {
      return processTable_(element);
    }

    // --- List item ---
    if (type === DocumentApp.ElementType.LIST_ITEM) {
      return processListItem_(element, listCounters);
    }

    // --- Paragraph (headings, normal text, HR) ---
    const textParts: string[] = [];
    let plainOut = '';

    for (let i = 0; i < el.getNumChildren(); i++) {
      const child = el.getChild(i);
      const t = child.getType();

      if (t === DocumentApp.ElementType.TEXT) {
        const txt = child.asText();
        plainOut += txt.getText();
        textParts.push(processTextElement_(txt));
      } else if (t === DocumentApp.ElementType.INLINE_IMAGE) {
        textParts.push('![image](image)');
      } else if (t === DocumentApp.ElementType.HORIZONTAL_RULE) {
        textParts.push('---');
      } else if (t === DocumentApp.ElementType.FOOTNOTE) {
        const note = (child as any).getFootnoteContents?.();
        if (note) textParts.push(` (NOTE: ${note.getText()})`);
      } else if (t === DocumentApp.ElementType.PAGE_BREAK) {
        // ignore
      }
    }

    if (textParts.length === 0) return null;

    // Detect code block (Courier New with leading tab)
    if (isCodeBlockCandidate_(element, plainOut)) {
      const line = plainOut.charAt(0) === '\t' ? plainOut.slice(1) : plainOut;
      return { text: line, codeBlockLine: true };
    }

    // Blank line following a code block
    if (inCodeBlock && plainOut.trim().length === 0) {
      return { text: '', codeBlockLine: true };
    }

    const prefix = headingPrefix_(element);
    return { text: prefix + textParts.join('') };
  }

  function processTable_(element: GoogleAppsScript.Document.Element): ElementResult {
    const table = element as unknown as GoogleAppsScript.Document.Table;
    const nRows = table.getNumRows();
    if (nRows === 0) return { text: '' };

    const nCols = table.getRow(0).getNumCells();
    const lines: string[] = [];

    for (let r = 0; r < nRows; r++) {
      const row = table.getRow(r);
      const cells: string[] = [];
      for (let c = 0; c < nCols; c++) {
        const cell = row.getCell(c);
        let cellText = '';
        const cellAny = cell as any;
        if (cellAny.getNumChildren && cellAny.getNumChildren() > 0) {
          const para = cellAny.getChild(0);
          if (para.getType() === DocumentApp.ElementType.PARAGRAPH) {
            const paraAny = para as any;
            for (let k = 0; k < (paraAny.getNumChildren?.() || 0); k++) {
              const childEl = paraAny.getChild(k);
              if (childEl.getType() === DocumentApp.ElementType.TEXT) {
                cellText += processTextElement_(childEl.asText());
              }
            }
          } else {
            cellText = cell.getText();
          }
        }
        cells.push(cellText.trim());
      }
      lines.push('| ' + cells.join(' | ') + ' |');

      // Header separator after first row
      if (r === 0) {
        const sep = cells.map(() => '---').join(' | ');
        lines.push('| ' + sep + ' |');
      }
    }
    return { text: lines.join('\n') };
  }

  function processListItem_(
    element: GoogleAppsScript.Document.Element,
    listCounters: Record<string, number>
  ): ElementResult {
    const listItem = element as unknown as GoogleAppsScript.Document.ListItem;
    const nesting = listItem.getNestingLevel();
    const indent = '  '.repeat(nesting);

    let prefix: string;
    const gt = listItem.getGlyphType();
    if (
      gt === DocumentApp.GlyphType.BULLET ||
      gt === DocumentApp.GlyphType.HOLLOW_BULLET ||
      gt === DocumentApp.GlyphType.SQUARE_BULLET
    ) {
      prefix = '- ';
    } else {
      const key = listItem.getListId() + '.' + nesting;
      const counter = (listCounters[key] || 0) + 1;
      listCounters[key] = counter;
      prefix = counter + '. ';
    }

    // Build inline text from child elements
    let text = '';
    const elAny = element as any;
    for (let i = 0; i < (elAny.getNumChildren?.() || 0); i++) {
      const child = elAny.getChild(i);
      if (child.getType() === DocumentApp.ElementType.TEXT) {
        text += processTextElement_(child.asText());
      }
    }

    return { text: indent + prefix + text };
  }

  function processTextElement_(txt: GoogleAppsScript.Document.Text): string {
    let pOut = txt.getText();
    if (!txt.getTextAttributeIndices) return pOut;

    const attrs = txt.getTextAttributeIndices();
    let lastOff = pOut.length;

    for (let i = attrs.length - 1; i >= 0; i--) {
      let off = attrs[i];
      const url = txt.getLinkUrl(off);

      if (url) {
        // Merge adjacent link pieces
        while (i >= 1 && attrs[i - 1] === off - 1 && txt.getLinkUrl(attrs[i - 1]) === url) {
          i--;
          off = attrs[i];
        }
        const inside = pOut.substring(off, lastOff);
        pOut = pOut.substring(0, off) + '[' + inside + '](' + url + ')' + pOut.substring(lastOff);
      } else {
        const font = txt.getFontFamily(off);
        if (font && String(font).toUpperCase().indexOf('COURIER') >= 0) {
          while (i >= 1 && isCourier_(txt, attrs[i - 1])) {
            i--;
            off = attrs[i];
          }
          const inside = compressWhitespace_(pOut.substring(off, lastOff));
          if (inside.length > 0) {
            pOut = pOut.substring(0, off) + '`' + inside + '`' + pOut.substring(lastOff);
          }
        } else {
          const bold = txt.isBold(off);
          const italic = txt.isItalic(off);
          if (bold || italic) {
            while (i >= 1 && txt.isBold(attrs[i - 1]) === bold && txt.isItalic(attrs[i - 1]) === italic) {
              i--;
              off = attrs[i];
            }
            const inside = compressWhitespace_(pOut.substring(off, lastOff));
            if (inside.length > 0) {
              let d1: string, d2: string;
              if (bold && italic) { d1 = '***'; d2 = '***'; }
              else if (bold)      { d1 = '**'; d2 = '**'; }
              else                { d1 = '*'; d2 = '*'; }
              pOut = pOut.substring(0, off) + d1 + inside + d2 + pOut.substring(lastOff);
            }
          }
        }
      }
      lastOff = off;
    }
    return pOut;
  }

  function isCourier_(txt: GoogleAppsScript.Document.Text, off: number): boolean {
    const f = txt.getFontFamily(off);
    return !!f && String(f).toUpperCase().indexOf('COURIER') >= 0;
  }

  function compressWhitespace_(s: string): string {
    return s.replace(/^\s+/, '').replace(/\s+$/, '');
  }

  function headingPrefix_(element: GoogleAppsScript.Document.Element): string {
    if (element.getType() !== DocumentApp.ElementType.PARAGRAPH) return '';
    const para = element as unknown as GoogleAppsScript.Document.Paragraph;
    const heading = para.getHeading();
    switch (heading) {
      case DocumentApp.ParagraphHeading.HEADING1: return '# ';
      case DocumentApp.ParagraphHeading.HEADING2: return '## ';
      case DocumentApp.ParagraphHeading.HEADING3: return '### ';
      case DocumentApp.ParagraphHeading.HEADING4: return '#### ';
      case DocumentApp.ParagraphHeading.HEADING5: return '##### ';
      case DocumentApp.ParagraphHeading.HEADING6: return '###### ';
      default: return '';
    }
  }

  function isCodeBlockCandidate_(
    element: GoogleAppsScript.Document.Element,
    plainText: string
  ): boolean {
    if (element.getType() !== DocumentApp.ElementType.PARAGRAPH) return false;
    if (plainText.length < 2 || plainText.charAt(0) !== '\t') return false;
    const elAny = element as any;
    for (let i = 0; i < (elAny.getNumChildren?.() || 0); i++) {
      const child = elAny.getChild(i);
      if (child.getType() === DocumentApp.ElementType.TEXT) {
        const txt = child.asText();
        for (let c = 0; c < txt.getText().length; c++) {
          if (isCourier_(txt, c)) return true;
        }
      }
    }
    return false;
  }

  // ════════════════════════════════════════════════════════════
  // Markdown → Tab
  // ════════════════════════════════════════════════════════════

  /**
   * Parses a markdown string and writes it as formatted Google Docs
   * content into the named tab (created if it doesn't exist).
   * The tab body is cleared before writing.
   */
  function markdownToTab(markdown: string, tabName: string, parentTabName?: string): void {
    const docTab = DocOps.getOrCreateTab(tabName, parentTabName);
    const body = docTab.getBody();
    body.clear();
    writeMarkdownToBody_(markdown, body);
  }

  function writeMarkdownToBody_(markdown: string, body: GoogleAppsScript.Document.Body): void {
    const lines = markdown.split('\n');
    let i = 0;
    let firstElement = true;

    while (i < lines.length) {
      const line = lines[i];

      // --- Fenced code block ---
      if (line.trimStart().startsWith('```')) {
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        i++; // skip closing ```
        for (const cl of codeLines) {
          const para = appendOrReplace_(body, cl, firstElement);
          firstElement = false;
          setFontFamily_(para, 'Courier New');
        }
        continue;
      }

      // --- Table ---
      if (isTableLine_(line) && i + 1 < lines.length && isTableSeparator_(lines[i + 1])) {
        const tableLines: string[] = [];
        while (i < lines.length && isTableLine_(lines[i])) {
          if (!isTableSeparator_(lines[i])) {
            tableLines.push(lines[i]);
          }
          i++;
        }
        if (tableLines.length > 0) {
          appendTable_(body, tableLines, firstElement);
          firstElement = false;
        }
        continue;
      }

      // --- Horizontal rule ---
      if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
        appendOrReplace_(body, '', firstElement);
        firstElement = false;
        body.appendHorizontalRule();
        i++;
        continue;
      }

      // --- Empty line ---
      if (line.trim() === '') {
        i++;
        continue;
      }

      // --- Heading ---
      const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const content = headingMatch[2];
        const para = appendOrReplace_(body, '', firstElement);
        firstElement = false;
        applyInlineFormatting_(para, content);
        setHeadingLevel_(para, level);
        i++;
        continue;
      }

      // --- Unordered list ---
      if (/^\s*[-*+]\s+/.test(line)) {
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          const itemMatch = lines[i].match(/^(\s*)[-*+]\s+(.*)/);
          if (itemMatch) {
            const nesting = Math.floor(itemMatch[1].length / 2);
            const content = itemMatch[2];
            const item = body.appendListItem('');
            applyInlineFormatting_(item, content);
            item.setNestingLevel(nesting);
            item.setGlyphType(DocumentApp.GlyphType.BULLET);
            firstElement = false;
          }
          i++;
        }
        continue;
      }

      // --- Ordered list ---
      if (/^\s*\d+\.\s+/.test(line)) {
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          const itemMatch = lines[i].match(/^(\s*)\d+\.\s+(.*)/);
          if (itemMatch) {
            const nesting = Math.floor(itemMatch[1].length / 2);
            const content = itemMatch[2];
            const item = body.appendListItem('');
            applyInlineFormatting_(item, content);
            item.setNestingLevel(nesting);
            item.setGlyphType(DocumentApp.GlyphType.NUMBER);
            firstElement = false;
          }
          i++;
        }
        continue;
      }

      // --- Normal paragraph ---
      const para = appendOrReplace_(body, '', firstElement);
      firstElement = false;
      applyInlineFormatting_(para, line);
      i++;
    }
  }

  /**
   * For the very first element we replace the default empty paragraph
   * that body.clear() leaves behind, rather than appending.
   */
  function appendOrReplace_(
    body: GoogleAppsScript.Document.Body,
    text: string,
    isFirst: boolean
  ): GoogleAppsScript.Document.Paragraph {
    if (isFirst && body.getNumChildren() > 0) {
      const first = body.getChild(0);
      if (first.getType() === DocumentApp.ElementType.PARAGRAPH) {
        (first as GoogleAppsScript.Document.Paragraph).setText(text);
        return first as GoogleAppsScript.Document.Paragraph;
      }
    }
    return body.appendParagraph(text);
  }

  function isTableLine_(line: string): boolean {
    return line.trim().startsWith('|') && line.trim().endsWith('|');
  }

  function isTableSeparator_(line: string): boolean {
    return /^\|[\s\-:|]+\|$/.test(line.trim());
  }

  function appendTable_(
    body: GoogleAppsScript.Document.Body,
    dataLines: string[],
    _isFirst: boolean
  ): void {
    const rows = dataLines.map(line =>
      line.split('|').slice(1, -1).map(cell => cell.trim())
    );
    if (rows.length === 0) return;

    const nCols = rows[0].length;
    const nRows = rows.length;

    const table = body.appendTable();
    for (let r = 0; r < nRows; r++) {
      // GAS body.appendTable() returns an empty table (no rows).
      // table.getRow(0) throws on an empty table — it does NOT return null.
      // Always appendTableRow() so we never call getRow() on an empty table.
      const tr = table.appendTableRow();
      for (let c = 0; c < nCols; c++) {
        const cellText = (rows[r] && rows[r][c]) || '';
        tr.appendTableCell(cellText);
      }
    }
  }

  /**
   * Applies inline markdown formatting (bold, italic, inline code, links)
   * to a Paragraph or ListItem element.
   */
  function applyInlineFormatting_(
    element: GoogleAppsScript.Document.Paragraph | GoogleAppsScript.Document.ListItem,
    text: string
  ): void {
    // Parse inline tokens and build a flat list of styled runs
    const runs = parseInlineRuns_(text);
    if (runs.length === 0) return;

    // Set plain text first
    const plainText = runs.map(r => r.text).join('');
    element.setText(plainText);

    // Apply formatting to each run
    let offset = 0;
    for (const run of runs) {
      const end = offset + run.text.length - 1;
      if (run.text.length > 0) {
        const textEl = element.editAsText();
        if (run.bold) textEl.setBold(offset, end, true);
        if (run.italic) textEl.setItalic(offset, end, true);
        if (run.code) textEl.setFontFamily(offset, end, 'Courier New');
        if (run.url) textEl.setLinkUrl(offset, end, run.url);
      }
      offset += run.text.length;
    }
  }

  interface InlineRun {
    text: string;
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
    url?: string;
  }

  /**
   * Parses a markdown line into an ordered list of styled runs.
   * Handles: `code`, **bold**, *italic*, ***bold italic***, [link](url).
   * Does not nest arbitrarily — handles the common markdown subset.
   */
  function parseInlineRuns_(input: string): InlineRun[] {
    const runs: InlineRun[] = [];
    // Regex matches inline code, bold-italic, bold, italic, links, and plain text
    const pattern = /(`[^`]+`)|(\*{3}[^*]+\*{3})|(\*{2}[^*]+\*{2})|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))|([^`*\[]+)/g;
    let m: RegExpExecArray | null;

    while ((m = pattern.exec(input)) !== null) {
      const [match] = m;
      if (m[1]) {
        // Inline code: `text`
        runs.push({ text: match.slice(1, -1), code: true });
      } else if (m[2]) {
        // Bold italic: ***text***
        runs.push({ text: match.slice(3, -3), bold: true, italic: true });
      } else if (m[3]) {
        // Bold: **text**
        runs.push({ text: match.slice(2, -2), bold: true });
      } else if (m[4]) {
        // Italic: *text*
        runs.push({ text: match.slice(1, -1), italic: true });
      } else if (m[5]) {
        // Link: [text](url)
        const linkMatch = match.match(/\[([^\]]+)\]\(([^)]+)\)/);
        if (linkMatch) {
          runs.push({ text: linkMatch[1], url: linkMatch[2] });
        }
      } else if (m[6]) {
        // Plain text
        runs.push({ text: match });
      }
    }
    return runs;
  }

  function setHeadingLevel_(
    para: GoogleAppsScript.Document.Paragraph,
    level: number
  ): void {
    switch (level) {
      case 1: para.setHeading(DocumentApp.ParagraphHeading.HEADING1); break;
      case 2: para.setHeading(DocumentApp.ParagraphHeading.HEADING2); break;
      case 3: para.setHeading(DocumentApp.ParagraphHeading.HEADING3); break;
      case 4: para.setHeading(DocumentApp.ParagraphHeading.HEADING4); break;
      case 5: para.setHeading(DocumentApp.ParagraphHeading.HEADING5); break;
      case 6: para.setHeading(DocumentApp.ParagraphHeading.HEADING6); break;
      default: break;
    }
  }

  function setFontFamily_(
    para: GoogleAppsScript.Document.Paragraph,
    fontFamily: string
  ): void {
    const textEl = para.editAsText();
    const len = textEl.getText().length;
    if (len > 0) {
      textEl.setFontFamily(0, len - 1, fontFamily);
    }
  }

  // ════════════════════════════════════════════════════════════
  // Standalone markdown → string and string → markdown for
  // non-tab use cases (e.g. passing to Gemini or tests).
  // ════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════
  // Pure helper accessors — exposed so tests call the real code
  // instead of maintaining local duplicates.
  // ════════════════════════════════════════════════════════════

  /** Exposed for testing: parses inline runs from a markdown line. */
  function parseInlineRuns(input: string): InlineRun[] {
    return parseInlineRuns_(input);
  }

  /** Returns true when a line looks like a GFM table row (starts and ends with |). */
  function isTableLine(line: string): boolean {
    return isTableLine_(line);
  }

  /** Returns true when a line is a GFM table separator (e.g. | --- | :--- | ---: |). */
  function isTableSeparator(line: string): boolean {
    return isTableSeparator_(line);
  }

  /** Returns true when a line is a markdown horizontal rule (---, ***, ___). */
  function isHorizontalRule(line: string): boolean {
    return /^\s*(---+|\*\*\*+|___+)\s*$/.test(line);
  }

  /** Returns true when a line opens or closes a fenced code block (```). */
  function isCodeFence(line: string): boolean {
    return line.trimStart().startsWith('```');
  }

  /**
   * Parses a heading line (e.g. "## Title") and returns { level, content },
   * or null if the line is not a heading.
   */
  function parseHeading(line: string): { level: number; content: string } | null {
    const m = line.match(/^(#{1,6})\s+(.*)/);
    if (!m) return null;
    return { level: m[1].length, content: m[2] };
  }

  /**
   * Parses an unordered list item (-, *, +) and returns { nesting, content },
   * or null if the line is not an unordered list item.
   */
  function parseUnorderedListItem(line: string): { nesting: number; content: string } | null {
    const m = line.match(/^(\s*)[-*+]\s+(.*)/);
    if (!m) return null;
    return { nesting: Math.floor(m[1].length / 2), content: m[2] };
  }

  /**
   * Parses an ordered list item (1., 2., …) and returns { nesting, content },
   * or null if the line is not an ordered list item.
   */
  function parseOrderedListItem(line: string): { nesting: number; content: string } | null {
    const m = line.match(/^(\s*)\d+\.\s+(.*)/);
    if (!m) return null;
    return { nesting: Math.floor(m[1].length / 2), content: m[2] };
  }

  /**
   * Writes markdown directly to an existing Body element.
   * Exposed for testing so tests can pass a mock Body without needing DocOps/tabs.
   */
  function writeMarkdownToBody(markdown: string, body: GoogleAppsScript.Document.Body): void {
    body.clear();
    writeMarkdownToBody_(markdown, body);
  }

  return {
    tabToMarkdown,
    markdownToTab,
    parseInlineRuns,
    isTableLine,
    isTableSeparator,
    isHorizontalRule,
    isCodeFence,
    parseHeading,
    parseUnorderedListItem,
    parseOrderedListItem,
    writeMarkdownToBody,
  };
})();
