// ============================================================
// DocOps.ts — Document and Tab management via DocumentApp
// ============================================================

const DocOps = (() => {

  // ── Execution-scoped registry cache ─────────────────────────────────────────
  // Avoids re-fetching the entire tab tree from the REST API on every call.
  // Invalidated only when we know the tree has changed (tab creation).
  let cachedRegistry_: Map<string, string> | null = null;

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
   *
   * Uses the Docs REST API (fetchTabRegistry_) rather than DocumentApp.getTabs()
   * because DocumentApp's start-of-execution snapshot can return stale IDs —
   * particularly for tabs created in a prior API call during the same session,
   * where tab.getId() may return the wrong value ("t.0") even when the tab is
   * found by title. The REST API always reflects the true, current tab IDs.
   */
  function getTabIdByName(name: string): string | null {
    const registry = fetchTabRegistry_();
    return registry.get(name) ?? null;
  }

  // ── REST API helpers (always fresh, bypasses DocumentApp cache) ────────────

  /**
   * Fetches the tab tree via the Docs REST API and returns a flat title → tabId map.
   * Uses a fields mask so only tabProperties/childTabs metadata is returned — no body
   * content — keeping the request fast regardless of document size.
   *
   * Results are cached for the duration of the script execution. Call
   * invalidateRegistryCache_() before re-fetching after tab mutations.
   *
   * includeTabsContent=true is still required for the `tabs` array to be populated at
   * all; the fields mask then prunes everything except the structural metadata.
   */
  function fetchTabRegistry_(): Map<string, string> {
    if (cachedRegistry_) return cachedRegistry_;

    const docId = getDoc_().getId();
    const t0 = Date.now();
    Tracer.info(`[DocOps] fetchTabRegistry_: fetching tab metadata for doc ${docId}`);

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
        }
        index_(t.childTabs ?? [], depth + 1);
      }
    }
    index_(doc.tabs ?? [], 0);

    cachedRegistry_ = registry;
    Tracer.info(`[DocOps] fetchTabRegistry_: found ${registry.size} tab(s) in ${Date.now() - t0}ms`);
    return registry;
  }

  /** Invalidates the execution-scoped registry cache so the next fetch is fresh. */
  function invalidateRegistryCache_(): void {
    cachedRegistry_ = null;
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
    Tracer.info(`[DocOps] createTabViaApi_: creating "${title}"${parentTabId ? ` under parent ${parentTabId}` : ' (root)'}`);
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
      // Fallback: invalidate cache and re-fetch to find the newly created tab
      Tracer.warn(`[DocOps] createTabViaApi_: reply missing tabId — re-fetching registry for "${title}"`);
      invalidateRegistryCache_();
      const fresh = fetchTabRegistry_();
      newTabId = fresh.get(title);
    } else {
      // Fast path succeeded — add to the cached registry without re-fetching
      if (cachedRegistry_) cachedRegistry_.set(title, newTabId);
    }

    Tracer.info(`[DocOps] createTabViaApi_: "${title}" → id=${newTabId ?? 'MISSING'} (${Date.now() - t0}ms)`);

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
   *
   * Two-phase approach for performance:
   *   1. Fetch the full tab registry once.
   *   2. Collect all missing tabs, grouped by parent.
   *   3. Create root-level missing tabs first (sequentially, since children
   *      need the parent ID to exist).
   *   4. Batch all children of each parent into a single batchUpdate call.
   *   5. Do one final re-fetch to resolve any missing IDs.
   *
   * This reduces the number of REST API round-trips from O(n) to O(parents+1).
   */
  function ensureStandardTabs(): void {
    const t0 = Date.now();
    Tracer.info('[DocOps] ensureStandardTabs: start');

    // Seed registry from REST API (authoritative, never stale)
    const registry = fetchTabRegistry_();
    Tracer.info(`[DocOps] ensureStandardTabs: registry seeded with ${registry.size} tab(s)`);

    // Desired tabs: [title, parentTitle | undefined]
    const desired: [string, string | undefined][] = [
      [Constants.TAB_NAMES.MERGED_CONTENT, undefined],
      [Constants.TAB_NAMES.AGENTIC_INSTRUCTIONS, undefined],
      [Constants.TAB_NAMES.AGENTIC_SCRATCH, undefined],
      [Constants.TAB_NAMES.STYLE_PROFILE, Constants.TAB_NAMES.AGENTIC_INSTRUCTIONS],
      [Constants.TAB_NAMES.EAR_TUNE, Constants.TAB_NAMES.AGENTIC_INSTRUCTIONS],
      [Constants.TAB_NAMES.TECHNICAL_AUDIT, Constants.TAB_NAMES.AGENTIC_INSTRUCTIONS],
      [Constants.TAB_NAMES.TETHER_INSTRUCTIONS, Constants.TAB_NAMES.AGENTIC_INSTRUCTIONS],
      [Constants.TAB_NAMES.GENERAL_PURPOSE_INSTRUCTIONS, Constants.TAB_NAMES.AGENTIC_INSTRUCTIONS],
      [`${Constants.TAB_NAMES.STYLE_PROFILE} Scratch`, Constants.TAB_NAMES.AGENTIC_SCRATCH],
      [`${Constants.TAB_NAMES.EAR_TUNE} Scratch`, Constants.TAB_NAMES.AGENTIC_SCRATCH],
      [`${Constants.TAB_NAMES.TECHNICAL_AUDIT} Scratch`, Constants.TAB_NAMES.AGENTIC_SCRATCH],
      [`${Constants.TAB_NAMES.TETHER_INSTRUCTIONS} Scratch`, Constants.TAB_NAMES.AGENTIC_SCRATCH],
      [`${Constants.TAB_NAMES.GENERAL_PURPOSE_INSTRUCTIONS} Scratch`, Constants.TAB_NAMES.AGENTIC_SCRATCH],
    ];

    // Filter to only missing tabs
    const missing = desired.filter(([title]) => !registry.has(title));
    if (missing.length === 0) {
      Tracer.info(`[DocOps] ensureStandardTabs: all tabs present — done in ${Date.now() - t0}ms`);
      return;
    }

    Tracer.info(`[DocOps] ensureStandardTabs: ${missing.length} tab(s) to create`);

    // Separate into root and child tabs
    const rootMissing = missing.filter(([, parent]) => !parent);
    const childMissing = missing.filter(([, parent]) => !!parent);

    // Phase 1: create root tabs (one at a time since each may be a parent for Phase 2)
    for (const [title] of rootMissing) {
      const newId = createTabViaApi_(title);
      registry.set(title, newId);
    }

    // Phase 2: batch children by parent
    const byParent = new Map<string, string[]>();
    for (const [title, parent] of childMissing) {
      if (!byParent.has(parent!)) byParent.set(parent!, []);
      byParent.get(parent!)!.push(title);
    }

    const docId = getDoc_().getId();
    for (const [parentTitle, titles] of byParent) {
      const parentTabId = registry.get(parentTitle);
      if (!parentTabId) {
        throw new Error(`Cannot batch-create children: parent "${parentTitle}" has no ID`);
      }

      Tracer.info(`[DocOps] ensureStandardTabs: batch-creating ${titles.length} tab(s) under "${parentTitle}"`);

      const requests = titles.map(title => ({
        addDocumentTab: {
          tabProperties: { title, parentTabId },
        },
      })) as unknown as GoogleAppsScript.Docs.Schema.Request[];

      const response = Docs.Documents!.batchUpdate({ requests }, docId) as any;

      // Try to extract IDs from replies
      const replies = response?.replies ?? [];
      let needRefetch = false;
      for (let i = 0; i < titles.length; i++) {
        const tabId = replies[i]?.addDocumentTab?.tab?.tabProperties?.tabId;
        if (tabId) {
          registry.set(titles[i], tabId);
          if (cachedRegistry_) cachedRegistry_.set(titles[i], tabId);
        } else {
          needRefetch = true;
        }
      }

      // If any replies were missing IDs, do one re-fetch for this batch
      if (needRefetch) {
        Tracer.warn(`[DocOps] ensureStandardTabs: some batch replies missing tabId — re-fetching registry`);
        invalidateRegistryCache_();
        const fresh = fetchTabRegistry_();
        for (const title of titles) {
          if (!registry.has(title) && fresh.has(title)) {
            registry.set(title, fresh.get(title)!);
          }
        }
      }
    }

    Tracer.info(`[DocOps] ensureStandardTabs: done in ${Date.now() - t0}ms`);
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
    // Fast path: DocumentApp cache (frozen at script start)
    const existing = getTabByName(name);
    if (existing) {
      Tracer.info(`[DocOps] getOrCreateTab: "${name}" found in DocumentApp cache`);
      return existing;
    }

    // Medium path: REST registry catches tabs created via ensureStandardTabs()
    // in the same execution (DocumentApp cache is stale for these).
    const registry = fetchTabRegistry_();
    const existingTabId = registry.get(name);
    if (existingTabId) {
      Tracer.info(`[DocOps] getOrCreateTab: "${name}" found in REST registry (id=${existingTabId}) — skipping create`);
      let tab = getDoc_().getTab(existingTabId);
      if (tab) return tab.asDocumentTab();
      // Retry with fresh Document handle. Child tabs created by ensureStandardTabs()
      // in the same GAS execution may take several seconds to propagate to the
      // DocumentApp service even when visible in the REST API immediately.
      Tracer.warn(`[DocOps] getOrCreateTab: getTab(${existingTabId}) returned null — retrying with fresh handle`);
      let retries = 6;
      while (!tab && retries-- > 0) {
        Utilities.sleep(3000);
        const freshDoc = DocumentApp.openById(getDoc_().getId());
        tab = freshDoc.getTab(existingTabId);
      }
      if (tab) return tab.asDocumentTab();

      // Retries exhausted — the tab exists in the REST API but DocumentApp cannot
      // see it within this execution. Do NOT attempt to delete and recreate: the
      // tab is real, and a duplicate-name create would fail immediately.
      // Instruct the caller to retry the operation in a fresh execution.
      throw new Error(
        `Tab "${name}" (id=${existingTabId}) exists in the document but could not be ` +
        `accessed via DocumentApp after multiple retries. ` +
        `This typically happens on first-run setup when many tabs are created at once. ` +
        `Please wait a few seconds and try the operation again.`
      );
    }

    // Slow path: create the tab
    Tracer.info(`[DocOps] getOrCreateTab: "${name}" not found — creating`);
    let parentTabId: string | undefined;
    if (parentTabName) {
      parentTabId = registry.get(parentTabName);
      if (!parentTabId) {
        // Final fallback: check DocumentApp cache for parent
        const parentRaw = findTabByTitle_(getDoc_().getTabs(), parentTabName);
        if (parentRaw) {
          parentTabId = parentRaw.getId();
        } else {
          throw new Error(
            `Cannot create tab "${name}": parent tab "${parentTabName}" does not exist.`
          );
        }
      }
    }

    const newTabId = createTabViaApi_(name, parentTabId);

    // Document.getTab(id) targets a specific ID and may succeed even when
    // getTabs() (which uses the start-of-execution snapshot) would not.
    let newTab = getDoc_().getTab(newTabId);
    if (!newTab) {
      Tracer.warn(`[DocOps] getOrCreateTab: could not find new tab ${newTabId} in active document session, falling back to full refresh.`);
      // The REST API mutation can take several seconds to propagate to the DocumentApp internal cache.
      let retries = 5;
      while (!newTab && retries-- > 0) {
        Utilities.sleep(2000);
        const freshDoc = DocumentApp.openById(getDoc_().getId());
        newTab = freshDoc.getTab(newTabId);
      }
    }
    
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
    const tab = getOrCreateTab(scratchName, Constants.TAB_NAMES.AGENTIC_SCRATCH);
    clearBodySafely(tab.getBody());
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
    clearBodySafely(body);
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
      Tracer.warn(`[DocOps] getTabContent: tab "${tabName}" not found — returning ""`);
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

  /**
   * Safely clears a document body, avoiding the "Can't remove the last paragraph" GAS bug.
   */
  function clearBodySafely(body: GoogleAppsScript.Document.Body): void {
    body.appendParagraph('');
    while (body.getNumChildren() > 1) {
      body.getChild(0).removeFromParent();
    }
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
    clearBodySafely,
  };
})();
