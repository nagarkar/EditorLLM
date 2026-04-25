// ============================================================
// DirectivePersistence.ts — Shared directive persistence helpers
// for bookmark + named-range based directives.
// ============================================================

const DirectivePersistence = (() => {

  function getDocumentProperties_(): GoogleAppsScript.Properties.Properties {
    return PropertiesService.getDocumentProperties();
  }

  function getStoredDirectiveRecord_(directiveId: string): StoredDirectiveRecord | null {
    const raw = getDocumentProperties_().getProperty(makeDirectivePropertyKey_(directiveId));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as StoredDirectiveRecord;
      if (!parsed || typeof parsed !== 'object' || !parsed.type || !parsed.payload) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function saveStoredDirectiveRecord_(directiveId: string, record: StoredDirectiveRecord): void {
    getDocumentProperties_().setProperty(
      makeDirectivePropertyKey_(directiveId),
      JSON.stringify(record)
    );
  }

  function deleteStoredDirectiveRecord_(directiveId: string): void {
    getDocumentProperties_().deleteProperty(makeDirectivePropertyKey_(directiveId));
  }

  function readDirectiveMatchText_(nr: GoogleAppsScript.Document.NamedRange): string {
    try {
      const range = nr.getRange();
      if (!range) return 'unknown';
      const parts = range.getRangeElements().map((el: GoogleAppsScript.Document.RangeElement) => {
        const text = el.getElement().asText().getText();
        return text.substring(el.getStartOffset(), el.getEndOffsetInclusive() + 1);
      });
      return parts.join('');
    } catch (e) {
      Tracer.warn(`readDirectiveMatchText_: could not read match_text — ${e}`);
      return 'unknown';
    }
  }

  function buildDirectiveBookmarkUrl_(
    docId: string,
    tabId: string,
    bookmarkWire: string
  ): string {
    try {
      const rawId = wireToBookmarkId_(bookmarkWire);
      return `https://docs.google.com/document/d/${docId}/edit` +
        (tabId ? `?tab=${tabId}` : '') +
        `#bookmark=${rawId}`;
    } catch (_) {
      return '';
    }
  }

  function collectTextElementsInOrder_(
    el: any,
    out: GoogleAppsScript.Document.Text[]
  ): void {
    if (el.getType() === DocumentApp.ElementType.TEXT) {
      out.push(el.asText());
      return;
    }
    const anyEl = el as any;
    const childCount = typeof anyEl.getNumChildren === 'function' ? anyEl.getNumChildren() : 0;
    for (let i = 0; i < childCount; i++) {
      collectTextElementsInOrder_(anyEl.getChild(i), out);
    }
  }

  function getElementPathKey_(el: any): string | null {
    if (!el) return null;
    const parts: string[] = [];
    let current = el;
    let parent = typeof current.getParent === 'function' ? current.getParent() : null;

    while (parent && typeof parent.getChildIndex === 'function') {
      parts.unshift(String(parent.getChildIndex(current)));
      current = parent;
      parent = typeof current.getParent === 'function' ? current.getParent() : null;
    }

    return parts.length ? parts.join('/') : null;
  }

  function buildBodyTextIndex_(
    body: GoogleAppsScript.Document.Body
  ): Map<string, number> {
    const offsets = new Map<string, number>();
    let cursor = 0;
    const childCount = body.getNumChildren();
    for (let i = 0; i < childCount; i++) {
      const child = body.getChild(i);
      const texts: GoogleAppsScript.Document.Text[] = [];
      collectTextElementsInOrder_(child, texts);
      for (const textEl of texts) {
        const key = getElementPathKey_(textEl as any);
        if (key) offsets.set(key, cursor);
        cursor += textEl.getText().length;
      }
      if (i + 1 < childCount) cursor += 1;
    }
    return offsets;
  }

  function getAbsoluteOffsetForPosition_(
    pos: GoogleAppsScript.Document.Position,
    textOffsets: Map<string, number>
  ): number {
    const textEl = pos.getSurroundingText();
    if (!textEl) return -1;
    const key = getElementPathKey_(textEl as any);
    if (!key) return -1;
    const base = textOffsets.get(key);
    if (base == null) return -1;
    return base + pos.getSurroundingTextOffset();
  }

  function getAbsoluteOffsetsForNamedRange_(
    nr: GoogleAppsScript.Document.NamedRange,
    textOffsets: Map<string, number>
  ): { start: number; endExclusive: number } | null {
    const range = nr.getRange();
    if (!range) return null;
    const els = range.getRangeElements();
    if (!els.length) return null;
    const first = els[0];
    const last = els[els.length - 1];
    const firstText = first.getElement().asText();
    const lastText = last.getElement().asText();
    const firstKey = getElementPathKey_(firstText as any);
    const lastKey = getElementPathKey_(lastText as any);
    if (!firstKey || !lastKey) return null;
    const startBase = textOffsets.get(firstKey);
    const endBase = textOffsets.get(lastKey);
    if (startBase == null || endBase == null) return null;
    return {
      start: startBase + first.getStartOffset(),
      endExclusive: endBase + last.getEndOffsetInclusive() + 1,
    };
  }

  function createDirectiveAtRange(
    docTab: GoogleAppsScript.Document.DocumentTab,
    agentPrefix: string,
    type: string,
    payload: Record<string, unknown>,
    range: GoogleAppsScript.Document.Range
  ): { directiveId: string; name: string } {
    const rangeEls = range.getRangeElements();
    if (!rangeEls.length) {
      throw new Error('Directive range must contain at least one range element.');
    }

    const first = rangeEls[0];
    const firstText = first.getElement().asText();
    const bookmarkPos = docTab.newPosition(firstText, first.getStartOffset());

    const directiveId = Utilities.getUuid().replace(/-/g, '');
    const bookmark = docTab.addBookmark(bookmarkPos);
    try {
      saveStoredDirectiveRecord_(directiveId, {
        v: 2,
        type,
        payload,
      });

      const name = encodeDirectiveNamedRangeName(agentPrefix, directiveId, bookmark.getId());
      docTab.addNamedRange(name, range);
      return { directiveId, name };
    } catch (e) {
      deleteStoredDirectiveRecord_(directiveId);
      try { bookmark.remove(); } catch (_) { /* best effort */ }
      throw e;
    }
  }

  function updateDirectivePayload(
    tabName: string,
    namedRangeName: string,
    newType: string,
    newPayload: Record<string, unknown>
  ): boolean {
    const tab = DocOps.getTabByName(tabName);
    if (!tab) return false;

    const nr = tab.getNamedRanges().find(r => r.getName() === namedRangeName);
    if (!nr) return false;

    const dec = decodeDirectiveNamedRangeName(namedRangeName);
    if (!dec.ok) return false;

    saveStoredDirectiveRecord_(dec.directiveId, {
      v: 2,
      type: newType,
      payload: newPayload,
    });
    return true;
  }

  function deleteDirective(
    tabName: string,
    namedRangeName: string
  ): boolean {
    const tab = DocOps.getTabByName(tabName);
    if (!tab) return false;

    const dec = decodeDirectiveNamedRangeName(namedRangeName);
    if (!dec.ok) return false;

    const nr = tab.getNamedRanges().find(r => r.getName() === namedRangeName);
    if (!nr) return false;

    const bm = tab.getBookmarks().find(b => {
      try {
        return bookmarkIdToWire_(b.getId()) === dec.bookmarkId;
      } catch {
        return false;
      }
    });

    if (bm) bm.remove();
    deleteStoredDirectiveRecord_(dec.directiveId);
    nr.remove();
    return true;
  }

  function listDirectivesOnTab(tabName: string, agentFilter?: string): any[] {
    const tab = DocOps.getTabByName(tabName);
    if (!tab) return [];

    const body = tab.getBody();
    const textOffsets = buildBodyTextIndex_(body);
    const doc = DocumentApp.getActiveDocument();
    const docId = doc.getId();
    const tabId = (tab as any).getId ? (tab as any).getId() as string : '';
    const directives: any[] = [];
    const bookmarkMap = new Map<string, GoogleAppsScript.Document.Bookmark>();
    for (const bm of tab.getBookmarks()) {
      try {
        bookmarkMap.set(bookmarkIdToWire_(bm.getId()), bm);
      } catch (_) { /* skip invalid */ }
    }

    for (const nr of tab.getNamedRanges()) {
      const dec = decodeDirectiveNamedRangeName(nr.getName());
      if (!dec.ok) continue;
      if (agentFilter && dec.agent !== agentFilter) continue;

      const stored = getStoredDirectiveRecord_(dec.directiveId);
      if (!stored) {
        Tracer.warn(`listDirectivesOnTab: no stored payload for directive ${dec.directiveId}`);
        continue;
      }

      const rangeOffsets = getAbsoluteOffsetsForNamedRange_(nr, textOffsets);
      const bookmark = bookmarkMap.get(dec.bookmarkId) || null;
      let insertPos = rangeOffsets ? rangeOffsets.start : -1;
      if (bookmark) {
        try {
          const bookmarkOffset = getAbsoluteOffsetForPosition_(bookmark.getPosition(), textOffsets);
          if (bookmarkOffset >= 0) insertPos = bookmarkOffset;
        } catch (_) { /* non-fatal */ }
      }

      const directive: any = {
        name: nr.getName(),
        agent: dec.agent,
        directiveId: dec.directiveId,
        bookmarkId: dec.bookmarkId,
        bookmarkUrl: buildDirectiveBookmarkUrl_(docId, tabId, dec.bookmarkId),
        matchText: readDirectiveMatchText_(nr),
        type: stored.type,
        payload: stored.payload,
        _rangeStart: rangeOffsets ? rangeOffsets.start : -1,
        _rangeEndExclusive: rangeOffsets ? rangeOffsets.endExclusive : -1,
        _insertPos: insertPos,
        _matchPos: rangeOffsets ? rangeOffsets.start : insertPos,
      };
      if (stored.type === 'tts') {
        directive.tts_model = stored.payload.tts_model;
        directive.voice_id = stored.payload.voice_id;
        directive.stability = stored.payload.stability;
        directive.similarity_boost = stored.payload.similarity_boost;
      }
      directives.push(directive);
    }

    return directives.sort((a, b) => a._insertPos - b._insertPos);
  }

  function clearDirectivesOnTab(tabName: string, agentFilter?: string): number {
    const docTab = DocOps.getTabByName(tabName);
    if (!docTab) return 0;

    let removed = 0;
    for (const nr of docTab.getNamedRanges().slice()) {
      const dec = decodeDirectiveNamedRangeName(nr.getName());
      if (!dec.ok) continue;
      if (agentFilter && dec.agent !== agentFilter) continue;
      if (deleteDirective(tabName, nr.getName())) removed++;
    }
    return removed;
  }

  return {
    createDirectiveAtRange,
    updateDirectivePayload,
    deleteDirective,
    listDirectivesOnTab,
    clearDirectivesOnTab,
    getStoredDirectiveRecord_,
  };
})();
