// ============================================================
// DocOps.ts — Document and Tab management via DocumentApp
// ============================================================

const DocOps = (() => {

  function getDoc_(): GoogleAppsScript.Document.Document {
    return DocumentApp.getActiveDocument();
  }

  // ── DocumentApp tab search (reads from start-of-execution cache) ───────────

  function findTabByTitle_(
    tabs: GoogleAppsScript.Document.Tab[],
    title: string
  ): GoogleAppsScript.Document.Tab | null {
    for (const tab of tabs) {
      if (tab.getTitle() === title) return tab;
      const found = findTabByTitle_(tab.getChildTabs(), title);
      if (found) return found;
    }
    return null;
  }

  /**
   * Returns the DocumentTab for the given tab name from the DocumentApp cache,
   * or null if not found. Fast but only sees tabs that existed at script start.
   */
  function getTabByName(name: string): GoogleAppsScript.Document.DocumentTab | null {
    const tab = findTabByTitle_(getDoc_().getTabs(), name);
    return tab ? tab.asDocumentTab() : null;
  }

  /**
   * Returns the opaque tab ID (e.g. "t.abc123") for a tab by title.
   * `DocumentTab` (returned by asDocumentTab) does NOT have getId(); only the
   * parent `Tab` object does, so this helper is the canonical way to look up
   * a tab's ID by name.
   */
  function getTabIdByName(name: string): string | null {
    const tab = findTabByTitle_(getDoc_().getTabs(), name);
    return tab ? tab.getId() : null;
  }

  // ── REST API helpers (always fresh, bypasses DocumentApp cache) ────────────

  /**
   * Fetches the tab tree via the Docs REST API and returns a flat title → tabId map.
   * Uses a fields mask so only tabProperties/childTabs metadata is returned — no body
   * content — keeping the request fast regardless of document size.
   *
   * includeTabsContent=true is still required for the `tabs` array to be populated at
   * all; the fields mask then prunes everything except the structural metadata.
   */
  function fetchTabRegistry_(): Map<string, string> {
    const docId = getDoc_().getId();
    const t0 = Date.now();
    Logger.log(`[DocOps] fetchTabRegistry_: fetching tab metadata for doc ${docId}`);

    // Fetch up to 4 nesting levels; real documents rarely exceed 2.
    // includeTabsContent — newer than our @types; cast required.
    const doc = (Docs.Documents as any).get(docId, {
      includeTabsContent: true,
      fields: 'tabs(tabProperties,childTabs(tabProperties,childTabs(tabProperties,childTabs(tabProperties))))',
    }) as any;

    const registry = new Map<string, string>();
    function index_(tabs: any[], depth: number): void {
      for (const t of tabs ?? []) {
        const props = t.tabProperties;
        if (props?.title && props?.tabId) {
          registry.set(props.title, props.tabId);
          Logger.log(`[DocOps] fetchTabRegistry_:  depth=${depth} title="${props.title}" id=${props.tabId}`);
        }
        index_(t.childTabs ?? [], depth + 1);
      }
    }
    index_(doc.tabs ?? [], 0);

    Logger.log(`[DocOps] fetchTabRegistry_: found ${registry.size} tab(s) in ${Date.now() - t0}ms`);
    return registry;
  }

  /**
   * Creates a tab via the Docs REST API (DocumentApp has no addTab).
   * Returns the new tab's ID.
   *
   * The Apps Script Advanced Service does not reliably populate the
   * addDocumentTab reply in the batchUpdate response, so we treat that as a
   * fast path only and fall back to a fresh fetchTabRegistry_() when the reply
   * is absent. The tab is always created successfully by the time we fall back.
   */
  function createTabViaApi_(title: string, parentTabId?: string): string {
    const docId = getDoc_().getId();
    Logger.log(`[DocOps] createTabViaApi_: creating "${title}"${parentTabId ? ` under parent ${parentTabId}` : ' (root)'}`);
    const t0 = Date.now();

    const tabProperties: { title: string; parentTabId?: string } = { title };
    if (parentTabId) tabProperties.parentTabId = parentTabId;

    const request = {
      addDocumentTab: { tabProperties },
    } as unknown as GoogleAppsScript.Docs.Schema.Request;

    const response = Docs.Documents!.batchUpdate({ requests: [request] }, docId) as any;

    // Fast path: tabId in the batchUpdate reply (not always populated by the Advanced Service)
    let newTabId = response?.replies?.[0]?.addDocumentTab?.tab?.tabProperties?.tabId as string | undefined;

    if (!newTabId) {
      // Fallback: re-fetch the registry to find the newly created tab by title
      Logger.log(`[DocOps] createTabViaApi_: reply missing tabId — re-fetching registry for "${title}"`);
      const fresh = fetchTabRegistry_();
      newTabId = fresh.get(title);
    }

    Logger.log(`[DocOps] createTabViaApi_: "${title}" → id=${newTabId ?? 'MISSING'} (${Date.now() - t0}ms)`);

    if (!newTabId) {
      throw new Error(
        `Failed to create tab "${title}": tab not found after creation. ` +
        `Ensure the Docs advanced service is enabled in the Apps Script project.`
      );
    }
    return newTabId;
  }

  // ── Public: ensureStandardTabs ─────────────────────────────────────────────

  /**
   * Ensures the canonical standard tabs exist in the document.
   * Uses a pure REST API approach with an in-memory registry so that tabs
   * created earlier in the same execution are immediately available as parents
   * for subsequent subtab creation — no DocumentApp cache involvement.
   */
  function ensureStandardTabs(): void {
    const t0 = Date.now();
    Logger.log('[DocOps] ensureStandardTabs: start');

    // Seed registry from REST API (authoritative, never stale)
    const registry = fetchTabRegistry_();
    Logger.log(`[DocOps] ensureStandardTabs: registry seeded with ${registry.size} tab(s): [${[...registry.keys()].join(', ')}]`);

    function ensureTab_(title: string, parentTitle?: string): void {
      if (registry.has(title)) {
        Logger.log(`[DocOps] ensureTab_: "${title}" already exists — skip`);
        return;
      }
      const parentTabId = parentTitle ? registry.get(parentTitle) : undefined;
      if (parentTitle && !parentTabId) {
        throw new Error(
          `Cannot create tab "${title}": parent tab "${parentTitle}" was not found.`
        );
      }
      const newTabId = createTabViaApi_(title, parentTabId);
      // Track immediately so subsequent calls in this run can use it as a parent
      registry.set(title, newTabId);
    }

    ensureTab_(TAB_NAMES.MERGED_CONTENT);
    ensureTab_(TAB_NAMES.AGENTIC_INSTRUCTIONS);
    ensureTab_(TAB_NAMES.STYLE_PROFILE, TAB_NAMES.AGENTIC_INSTRUCTIONS);
    ensureTab_(TAB_NAMES.EAR_TUNE, TAB_NAMES.AGENTIC_INSTRUCTIONS);
    ensureTab_(TAB_NAMES.TECHNICAL_AUDIT, TAB_NAMES.AGENTIC_INSTRUCTIONS);
    ensureTab_(TAB_NAMES.COMMENT_INSTRUCTIONS, TAB_NAMES.AGENTIC_INSTRUCTIONS);

    Logger.log(`[DocOps] ensureStandardTabs: done in ${Date.now() - t0}ms`);
  }

  // ── Public: getOrCreateTab ─────────────────────────────────────────────────

  /**
   * Returns an existing DocumentTab by name, or creates a new one.
   * Checks DocumentApp cache first (fast path for pre-existing tabs).
   * Falls back to REST API for parent resolution and post-creation lookup
   * to handle tabs created earlier in the same execution context.
   */
  function getOrCreateTab(
    name: string,
    parentTabName?: string
  ): GoogleAppsScript.Document.DocumentTab {
    const existing = getTabByName(name);
    if (existing) return existing;

    // Resolve parent tab ID. DocumentApp first; REST fallback for same-run parents.
    let parentTabId: string | undefined;
    if (parentTabName) {
      const parentRaw = findTabByTitle_(getDoc_().getTabs(), parentTabName);
      if (parentRaw) {
        parentTabId = parentRaw.getId();
      } else {
        const registry = fetchTabRegistry_();
        parentTabId = registry.get(parentTabName);
        if (!parentTabId) {
          throw new Error(
            `Cannot create tab "${name}": parent tab "${parentTabName}" does not exist.`
          );
        }
      }
    }

    const newTabId = createTabViaApi_(name, parentTabId);

    // Document.getTab(id) targets a specific ID and may succeed even when
    // getTabs() (which uses the start-of-execution snapshot) would not.
    const newTab = getDoc_().getTab(newTabId);
    if (newTab) return newTab.asDocumentTab();

    throw new Error(
      `Tab "${name}" was created (id: ${newTabId}) but could not be accessed via DocumentApp. ` +
      `Ensure the Docs advanced service is enabled and re-authorize the add-on if prompted.`
    );
  }

  // ── Public: createScratchTab ───────────────────────────────────────────────

  /**
   * Creates (or reuses) a "[baseName] Scratch" review tab.
   * Clears existing content so each instruction_update starts fresh.
   */
  function createScratchTab(baseName: string): GoogleAppsScript.Document.DocumentTab {
    const scratchName = `${baseName} Scratch`;
    const tab = getOrCreateTab(scratchName);
    tab.getBody().clear();
    return tab;
  }

  // ── Public: content helpers ────────────────────────────────────────────────

  /**
   * Replaces all body content of a DocumentTab with the given text.
   */
  function overwriteTabContent(
    docTab: GoogleAppsScript.Document.DocumentTab,
    text: string
  ): void {
    const body = docTab.getBody();
    body.clear();
    if (text.trim()) {
      const lines = text.split('\n');
      for (const line of lines) {
        body.appendParagraph(line);
      }
    }
  }

  /**
   * Returns the full plain-text content of a named tab, or '' if the tab
   * does not exist. Logs a warning when the tab is missing so callers can
   * distinguish "tab exists but is empty" from "tab not found".
   */
  function getTabContent(tabName: string): string {
    const tab = getTabByName(tabName);
    if (!tab) {
      Logger.log(`[DocOps] getTabContent: tab "${tabName}" not found — returning ""`);
      return '';
    }
    return tab.getBody().getText();
  }

  /**
   * Returns true if a tab with the given name exists in the document
   * (uses DocumentApp start-of-execution snapshot — fast but may miss
   * tabs created in the same run).
   */
  function tabExists(tabName: string): boolean {
    return findTabByTitle_(getDoc_().getTabs(), tabName) !== null;
  }

  return {
    getTabByName,
    getTabIdByName,
    getOrCreateTab,
    createScratchTab,
    overwriteTabContent,
    getTabContent,
    ensureStandardTabs,
    tabExists,
  };
})();
