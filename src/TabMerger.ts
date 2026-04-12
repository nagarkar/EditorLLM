// ============================================================
// TabMerger.ts — Merges named tabs into MergedContent.
// Not an agent — a standalone utility class (IIFE module).
// Ported and adapted from the Youtube project's TabProcessor.
// ============================================================

const TabMerger = (() => {
  const TABS_PROPERTY_KEY = 'mergeTabNames';

  // --- Private helpers ---

  function sanitizePlatformError_(message: string): string {
    return String(message || '')
      .replace(
        /Service Documents failed while accessing document with id [^.\n]+\.?/gi,
        'Document access error.'
      )
      .replace(/document with id [A-Za-z0-9_-]{20,}\.?/gi, 'document.')
      .trim();
  }

  function getElementPreview_(element: GoogleAppsScript.Document.Element): string {
    try {
      const type = element.getType();
      if (type === DocumentApp.ElementType.PARAGRAPH) {
        return (element as GoogleAppsScript.Document.Paragraph).getText().trim().slice(0, 120);
      }
      if (type === DocumentApp.ElementType.LIST_ITEM) {
        return (element as GoogleAppsScript.Document.ListItem).getText().trim().slice(0, 120);
      }
      if (type === DocumentApp.ElementType.TABLE) {
        const table = element as GoogleAppsScript.Document.Table;
        if (table.getNumRows() > 0 && table.getRow(0).getNumCells() > 0) {
          return table.getRow(0).getCell(0).getText().trim().slice(0, 120);
        }
      }
    } catch (_) {}
    return '';
  }

  /**
   * Copies all child elements from sourceBody into destinationBody,
   * then appends a page break as a separator.
   */
  function appendTabContent_(
    sourceBody: GoogleAppsScript.Document.Body,
    destinationBody: GoogleAppsScript.Document.Body
  ): void {
    const numChildren = sourceBody.getNumChildren();
    for (let i = 0; i < numChildren; i++) {
      const sourceChild = sourceBody.getChild(i);
      const sourceType = sourceChild.getType();
      try {
        const element = sourceChild.copy();
        const type = element.getType();
        if (type === DocumentApp.ElementType.PARAGRAPH) {
          destinationBody.appendParagraph(
            (element as GoogleAppsScript.Document.Paragraph)
          );
        } else if (type === DocumentApp.ElementType.TABLE) {
          destinationBody.appendTable(
            (element as GoogleAppsScript.Document.Table)
          );
        } else if (type === DocumentApp.ElementType.LIST_ITEM) {
          destinationBody.appendListItem(
            (element as GoogleAppsScript.Document.ListItem)
          );
        }
      } catch (e: any) {
        const preview = getElementPreview_(sourceChild);
        const details =
          `Copy failed at child index ${i} (type: ${sourceType}). ` +
          (preview ? `Content preview: "${preview}". ` : '') +
          `Reason: ${sanitizePlatformError_(e.message || String(e))}`;
        throw new Error(details);
      }
    }
    destinationBody.appendPageBreak();
  }

  // --- Public API ---

  /**
   * Merges a single named source tab into the MergedContent destination tab.
   * Called once per tab by the sidebar's sequential merge loop.
   */
  function mergeOneTab(tabName: string): { ok: boolean; name: string; message?: string } {
    if (!tabName || typeof tabName !== 'string') {
      return { ok: false, name: String(tabName), message: 'Invalid tab name.' };
    }
    try {
      const destDocTab = DocOps.getTabByName(TAB_NAMES.MERGED_CONTENT);
      if (!destDocTab) {
        return { ok: false, name: tabName, message: `"${TAB_NAMES.MERGED_CONTENT}" tab not found.` };
      }
      const srcDocTab = DocOps.getTabByName(tabName);
      if (!srcDocTab) {
        return { ok: false, name: tabName, message: `Source tab "${tabName}" not found.` };
      }
      appendTabContent_(srcDocTab.getBody(), destDocTab.getBody());
      return { ok: true, name: tabName };
    } catch (e: any) {
      return { ok: false, name: tabName, message: sanitizePlatformError_(e.message || String(e)) };
    }
  }

  /**
   * Clears the MergedContent tab before starting a fresh merge run.
   */
  function clearDestination(): { ok: boolean; message?: string } {
    const destDocTab = DocOps.getTabByName(TAB_NAMES.MERGED_CONTENT);
    if (!destDocTab) {
      return { ok: false, message: `"${TAB_NAMES.MERGED_CONTENT}" tab not found.` };
    }
    destDocTab.getBody().clear();
    return { ok: true };
  }

  /**
   * Returns the saved list of tab names to merge (document-scoped property).
   * The user-properties fallback is a migration shim: older versions of this
   * add-on stored the tab list in user properties, while saveTabNames() now
   * always writes to document properties (shared across all editors of the doc).
   * The fallback can be removed once all documents have been migrated.
   */
  function getSavedTabNames(): string[] {
    const raw =
      PropertiesService.getDocumentProperties().getProperty(TABS_PROPERTY_KEY) ||
      PropertiesService.getUserProperties().getProperty(TABS_PROPERTY_KEY) ||
      '';
    return createStringArray(raw);
  }

  /**
   * Persists a comma-separated list of tab names to document properties.
   */
  function saveTabNames(csv: string): { ok: boolean } {
    PropertiesService.getDocumentProperties().setProperty(
      TABS_PROPERTY_KEY,
      (csv || '').trim()
    );
    return { ok: true };
  }

  return { mergeOneTab, clearDestination, getSavedTabNames, saveTabNames };
})();
