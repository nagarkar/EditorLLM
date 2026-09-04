// ============================================================
// PublisherHelpers.ts — Pure helpers for Publisher workflows.
// ============================================================

export const PUBLISHER_GEMINI_TAB_NAMES = [
  'Copyright',
  'About The Author',
  'Sales',
  'Hooks',
  'Cover',
  'Opening Audio Credits',
  'Closing Audio Credits',
] as const;

export const PUBLISHER_ALL_OUTPUT_TAB_NAMES = [...PUBLISHER_GEMINI_TAB_NAMES] as const;

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

/** @deprecated Use buildVersionFolderName for new version-based folder structure. */
export function buildPublisherPackageFolderName(docName: string, isoDate: string, hhmmss?: string): string {
  const safeDoc = String(docName || 'Document')
    .replace(/[\\/:*?"<>|#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Document';
  const stamp = hhmmss ? `${isoDate}_${hhmmss}` : isoDate;
  return `${safeDoc}_${stamp}_Package`;
}

/**
 * Returns the Drive folder name for a version: `{docId}_V{label}`.
 * docId is the native Google Doc ID (stable, rename-proof).
 */
export function buildVersionFolderName(docId: string, label: string): string {
  return `${docId}_V${label}`;
}

/**
 * Validates and trims a version label.
 * Throws if the label is empty or contains path-unsafe characters.
 */
export function validateVersionLabel(label: string): string {
  const clean = String(label || '').trim();
  if (!clean) throw new Error('Version label is required.');
  if (/[\\/:*?"<>|]/.test(clean)) {
    throw new Error('Version label contains invalid characters: \\ / : * ? " < > |');
  }
  return clean;
}

/**
 * Extracts raw CSS from a markdown string that wraps it in a ```css code fence.
 * Falls back to returning the full trimmed string if no fence is found.
 */
export function extractCssFromTab(markdown: string): string {
  const match = String(markdown || '').match(/```(?:css)?\s*\n([\s\S]*?)\n```/);
  return match ? match[1].trim() : String(markdown || '').trim();
}

// ── Cover concept parsing (pure) ──────────────────────────────────────────────

export interface CoverItem {
  /** Body child index of the originating paragraph in the Cover tab. */
  bodyChildIndex: number;
  kind: 'text' | 'image' | 'marker';
  /** Text payload for kind='text' or 'marker' (the marker line as written). */
  text?: string;
  /** Parsed marker fields when kind='marker'. */
  marker?: { number: number | null; name: string | null };
  /**
   * Serial reference for kind='image'. Indexes into the caller's parallel
   * array of inline-image handles so the orchestrator can fetch the blob and
   * locate the element in the doc body for downstream insertion.
   */
  imageRef?: number;
}

export interface ParsedCoverConcept {
  /** Concept number from "Concept N" marker (or null if missing). */
  number: number | null;
  /** Optional concept name from "Concept N: name". */
  name: string | null;
  /** Concatenated text of this concept's text items (excluding the marker). */
  text: string;
  /** imageRef of the last image item in this concept (the baseline), or null. */
  baselineImageRef: number | null;
  /** All image refs in this concept, in document order. */
  imageRefs: number[];
  /**
   * Body child index AFTER which the newly generated image should be inserted.
   * Equals the bodyChildIndex of the baseline image's paragraph when an image
   * is present; otherwise the last non-marker item; otherwise the marker.
   */
  insertAfterBodyChildIndex: number;
}

/**
 * Parses a single line as a "Concept N[: Name]" marker.
 * Tolerates leading markdown decoration (`#`, `*`, `**`, `***`) and trailing
 * `**` / `*`.  Accepts `:`, `-`, `–`, `—` as the name separator.
 * Returns null when the line is not a concept marker.
 */
export function parseCoverConceptMarker(
  line: string
): { number: number | null; name: string | null } | null {
  const raw = String(line || '').trim();
  if (!raw) return null;
  // Strip leading markdown header / list markers.
  const stripped = raw
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\*{1,3}/, '')
    .replace(/\*{1,3}$/, '')
    .trim();
  const m = stripped.match(/^Concept(?:\s+(\d+))?(?:\s*[:\-–—]\s*(.+))?$/i);
  if (!m) return null;
  const number = m[1] ? parseInt(m[1], 10) : null;
  const nameRaw = m[2] ? m[2].trim().replace(/\*{1,3}$/, '').trim() : '';
  return { number, name: nameRaw || null };
}

/**
 * Splits a flat sequence of cover items (text / image / marker) into one
 * concept per marker.  Items appearing before the first marker are dropped:
 * the Cover tab always opens with a "Concept 1" line, so leading prose is
 * treated as preamble that the user did not associate with any concept.
 *
 * For each concept:
 *   - text         = concatenated `text` items joined with single newlines
 *   - baseline ref = the LAST image item's ref (or null when none)
 *   - imageRefs    = every image ref in document order
 *   - insertAfter  = bodyChildIndex of the baseline image's paragraph, or of
 *                    the last non-marker item, or of the marker itself when
 *                    the concept is empty.
 */
export function parseCoverConcepts(items: CoverItem[]): ParsedCoverConcept[] {
  const concepts: ParsedCoverConcept[] = [];
  let current: ParsedCoverConcept | null = null;
  let currentTextParts: string[] = [];
  let lastNonMarkerIndex = -1;

  function finalize() {
    if (!current) return;
    current.text = currentTextParts.join('\n').trim();
    if (current.baselineImageRef !== null) {
      // insertAfterBodyChildIndex is the bodyChildIndex tied to the baseline
      // image — already set when we recorded the baseline.
    } else if (lastNonMarkerIndex !== -1) {
      current.insertAfterBodyChildIndex = lastNonMarkerIndex;
    }
    concepts.push(current);
  }

  for (const item of items) {
    if (item.kind === 'marker') {
      finalize();
      current = {
        number: item.marker?.number ?? null,
        name: item.marker?.name ?? null,
        text: '',
        baselineImageRef: null,
        imageRefs: [],
        insertAfterBodyChildIndex: item.bodyChildIndex,
      };
      currentTextParts = [];
      lastNonMarkerIndex = item.bodyChildIndex;
      continue;
    }
    if (!current) continue;  // skip preamble before first marker
    if (item.kind === 'text' && item.text) {
      currentTextParts.push(item.text);
      lastNonMarkerIndex = item.bodyChildIndex;
    } else if (item.kind === 'image' && typeof item.imageRef === 'number') {
      current.imageRefs.push(item.imageRef);
      current.baselineImageRef = item.imageRef;
      current.insertAfterBodyChildIndex = item.bodyChildIndex;
      lastNonMarkerIndex = item.bodyChildIndex;
    }
  }
  finalize();
  return concepts;
}

/**
 * Sanitizes a string for use as a filename component.
 * Replaces filesystem-unsafe characters with `_` and collapses whitespace.
 */
export function sanitizeCoverImageFilename(raw: string): string {
  const cleaned = String(raw || '')
    .replace(/[\\/:*?"<>|#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'concept';
}

/**
 * Builds the canonical baseline filename for a generated cover image.
 * Format: `{conceptName} - baseline.png`. When `name` is empty, falls back
 * to `Concept {number} - baseline.png`; when both are missing, uses
 * `concept - baseline.png`.
 */
export function buildCoverBaselineFilename(
  name: string | null,
  number: number | null
): string {
  let stem: string;
  if (name && name.trim()) {
    stem = sanitizeCoverImageFilename(name);
  } else if (typeof number === 'number') {
    stem = `Concept ${number}`;
  } else {
    stem = 'concept';
  }
  return `${stem} - baseline.png`;
}

/**
 * Builds the archive filename used when an existing baseline file must be
 * renamed before a new one is written.  Suffix is `ddmmyyyyHHmmss`.
 */
export function buildCoverArchiveFilename(baselineFilename: string, stamp: string): string {
  const dotIdx = baselineFilename.lastIndexOf('.');
  const stem = dotIdx > 0 ? baselineFilename.slice(0, dotIdx) : baselineFilename;
  const ext = dotIdx > 0 ? baselineFilename.slice(dotIdx) : '';
  return `${stem}${stamp}${ext}`;
}
