// ============================================================
// PublisherHelpers.ts — Pure helpers for Publisher workflows.
// ============================================================

export const PUBLISHER_GEMINI_TAB_NAMES = [
  'Title',
  'Copyright',
  'About The Author',
  'Sales',
  'Hooks',
  'Cover',
] as const;

export const PUBLISHER_ALL_OUTPUT_TAB_NAMES = [
  ...PUBLISHER_GEMINI_TAB_NAMES,
  'Table of Contents',
] as const;

export function isBlankPublisherContent(text: string | null | undefined): boolean {
  return !text || !text.trim();
}

export function determinePublisherTabsToGenerate(
  mode: 'all' | 'missing',
  existingContent: Record<string, string>
): string[] {
  if (mode === 'all') return [...PUBLISHER_GEMINI_TAB_NAMES];
  return PUBLISHER_GEMINI_TAB_NAMES.filter(name => isBlankPublisherContent(existingContent[name]));
}

export function publisherTabGenerationSchema(requestedTabs: string[]): object {
  return {
    type: 'object',
    properties: {
      tabs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tab_name: {
              type: 'string',
              enum: requestedTabs,
            },
            markdown: { type: 'string' },
          },
          required: ['tab_name', 'markdown'],
        },
      },
    },
    required: ['tabs'],
  };
}

export function validatePublisherTabPayload(
  raw: any,
  requestedTabs: string[]
): { tabs: GeneratedTab[]; missing: string[]; unexpected: string[] } {
  const requested = new Set(requestedTabs);
  const seen = new Set<string>();
  const unexpected: string[] = [];
  const tabs: GeneratedTab[] = [];

  const items = Array.isArray(raw?.tabs) ? raw.tabs : [];
  for (const item of items) {
    const tabName = String(item?.tab_name || '').trim();
    const markdown = String(item?.markdown || '');
    if (!tabName || seen.has(tabName)) continue;
    if (!requested.has(tabName)) {
      unexpected.push(tabName);
      continue;
    }
    seen.add(tabName);
    tabs.push({ tab_name: tabName, markdown });
  }

  const missing = requestedTabs.filter(name => !seen.has(name));
  return { tabs, missing, unexpected };
}

export function buildPublisherPackageFolderName(docName: string, isoDate: string, hhmmss?: string): string {
  const safeDoc = String(docName || 'Document')
    .replace(/[\\/:*?"<>|#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Document';
  const stamp = hhmmss ? `${isoDate}_${hhmmss}` : isoDate;
  return `${safeDoc}_${stamp}_Package`;
}
