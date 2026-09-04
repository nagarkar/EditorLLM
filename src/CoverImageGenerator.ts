// ============================================================
// CoverImageGenerator.ts — Walks the Publisher/Cover tab,
// generates a new cover image per concept via Nano Banana Pro,
// saves each to Drive (EditorLLM/images), and inserts the new
// image into the doc just after the prior baseline so that the
// generated image becomes the new baseline.
// ============================================================

interface CoverImageGenerationResult {
  conceptName: string | null;
  conceptNumber: number | null;
  status: 'generated' | 'skipped' | 'failed';
  fileName?: string;
  fileUrl?: string;
  archivedAs?: string;
  error?: string;
}

const CoverImageGenerator = (() => {

  /** Drive folder name used for cover-image uploads under EditorLLM/. */
  const COVER_IMAGES_FOLDER = 'images';

  // ── Concept extraction from the Cover tab ─────────────────────────────────

  interface ImageHandle {
    bodyChildIndex: number;       // index in body where the image's paragraph lives
    blob: GoogleAppsScript.Base.Blob;
  }

  /**
   * Walks the Cover tab body and produces:
   *   - items: the flat sequence consumed by parseCoverConcepts()
   *   - imageHandles: parallel array indexed by item.imageRef so the
   *     orchestrator can fetch the source blob and locate the inline image
   *     for downstream insertion.
   */
  function extractCoverItems_(
    body: GoogleAppsScript.Document.Body
  ): { items: CoverItem[]; imageHandles: ImageHandle[] } {
    const items: CoverItem[] = [];
    const imageHandles: ImageHandle[] = [];

    const numChildren = body.getNumChildren();
    for (let i = 0; i < numChildren; i++) {
      const child = body.getChild(i);
      if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;

      const para = child.asParagraph();
      const text = para.getText().trim();
      const marker = parseCoverConceptMarker(text);

      if (marker) {
        items.push({ bodyChildIndex: i, kind: 'marker', text, marker });
        continue;
      }

      if (text) {
        items.push({ bodyChildIndex: i, kind: 'text', text });
      }

      const numParts = para.getNumChildren();
      for (let j = 0; j < numParts; j++) {
        const part = para.getChild(j);
        if (part.getType() === DocumentApp.ElementType.INLINE_IMAGE) {
          const imageRef = imageHandles.length;
          imageHandles.push({
            bodyChildIndex: i,
            blob: part.asInlineImage().getBlob(),
          });
          items.push({ bodyChildIndex: i, kind: 'image', imageRef });
        }
      }
    }

    return { items, imageHandles };
  }

  // ── Drive helpers (scoped to EditorLLM/images) ────────────────────────────

  function getOrCreateCoverImagesFolderId_(): string {
    const rootId = getOrCreateDriveFolderByName_(Constants.DRIVE_FOLDERS.ROOT);
    return getOrCreateDriveFolderByName_(COVER_IMAGES_FOLDER, rootId);
  }

  function findFileIdByName_(folderId: string, name: string): string | null {
    const resp = Drive.Files.list({
      q: `'${folderId}' in parents and name="${name.replace(/"/g, '\\"')}" and trashed=false`,
      fields: 'files(id)',
      spaces: 'drive',
    } as any);
    const files: any[] = (resp as any).files || [];
    return files.length ? (files[0].id as string) : null;
  }

  function ddmmyyyyHhmmss_(): string {
    return Utilities.formatDate(new Date(), 'UTC', 'ddMMyyyyHHmmss');
  }

  /**
   * Uploads a generated cover image, archiving any pre-existing baseline file
   * with the same name (renamed with a `ddmmyyyyHHmmss` suffix) before write.
   */
  function uploadCoverImage_(
    folderId: string,
    blob: GoogleAppsScript.Base.Blob,
    baselineName: string
  ): { fileId: string; fileName: string; archivedAs: string | null } {
    let archivedAs: string | null = null;
    const existingId = findFileIdByName_(folderId, baselineName);
    if (existingId) {
      archivedAs = buildCoverArchiveFilename(baselineName, ddmmyyyyHhmmss_());
      Drive.Files.update({ name: archivedAs }, existingId);
    }
    blob.setName(baselineName);
    const created = Drive.Files.create(
      { name: baselineName, parents: [folderId], mimeType: blob.getContentType() || 'image/png' },
      blob,
      { fields: 'id' }
    ) as any;
    return { fileId: created.id as string, fileName: baselineName, archivedAs };
  }

  // ── Public entry ──────────────────────────────────────────────────────────

  /**
   * Reads the Publisher/Cover tab, parses its concepts, and generates one
   * Nano Banana Pro image per concept that has a prompt or a baseline image.
   * Throws when the Cover tab is missing or empty so the user is directed to
   * "Generate all publisher tabs first."
   */
  function generateCoverImages(): {
    folderName: string;
    folderUrl: string;
    results: CoverImageGenerationResult[];
  } {
    const coverTab = DocOps.getTabByName(Constants.TAB_NAMES.PUBLISHER_COVER);
    if (!coverTab) {
      throw new Error('Cover tab not found. Generate all publisher tabs first.');
    }
    const body = coverTab.getBody();
    if (!body.getText().trim()) {
      throw new Error('Cover tab is empty. Generate all publisher tabs first.');
    }

    const { items, imageHandles } = extractCoverItems_(body);
    const concepts = parseCoverConcepts(items);
    if (!concepts.length) {
      throw new Error(
        'No "Concept N" markers found in the Cover tab. Generate all publisher tabs first.'
      );
    }

    const folderId = getOrCreateCoverImagesFolderId_();
    assertInsideEditorLLMRoot_(folderId);
    const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;

    // Phase 1: call the API for each concept.  Collected separately so the
    // doc-mutation phase can run bottom-up without index-shift bugs.
    interface PendingInsert {
      blob: GoogleAppsScript.Base.Blob;
      bodyChildIndex: number;   // insert AFTER this child
      fileUrl: string;          // Drive view URL — applied as image hyperlink
    }
    const pending: PendingInsert[] = [];
    const results: CoverImageGenerationResult[] = [];

    for (const concept of concepts) {
      const conceptLabel = concept.name
        || (concept.number !== null ? `Concept ${concept.number}` : 'Concept');

      // Skip concepts that have neither a prompt nor a source image.
      if (!concept.text.trim() && concept.baselineImageRef === null) {
        results.push({
          conceptName: concept.name,
          conceptNumber: concept.number,
          status: 'skipped',
          error: 'No prompt or image to seed generation.',
        });
        continue;
      }

      const sourceBlob = concept.baselineImageRef !== null
        ? imageHandles[concept.baselineImageRef].blob
        : null;

      try {
        Tracer.info(`[CoverImageGenerator] generating image for "${conceptLabel}"`);
        const generated = GeminiService.generateImage(concept.text, sourceBlob);
        const baselineName = buildCoverBaselineFilename(concept.name, concept.number);
        const upload = uploadCoverImage_(folderId, generated, baselineName);
        const fileUrl = `https://drive.google.com/file/d/${upload.fileId}/view`;

        // Re-fetch the blob (Drive.Files.create may consume it) — the original
        // generated blob in memory is still valid for doc insertion.
        pending.push({
          blob: generated,
          bodyChildIndex: concept.insertAfterBodyChildIndex,
          fileUrl,
        });

        results.push({
          conceptName: concept.name,
          conceptNumber: concept.number,
          status: 'generated',
          fileName: upload.fileName,
          fileUrl,
          archivedAs: upload.archivedAs || undefined,
        });
      } catch (e: any) {
        Tracer.warn(`[CoverImageGenerator] "${conceptLabel}" failed: ${e.message}`);
        results.push({
          conceptName: concept.name,
          conceptNumber: concept.number,
          status: 'failed',
          error: e.message,
        });
      }
    }

    // Phase 2: insert images bottom-up so earlier insertion indices stay valid.
    pending.sort((a, b) => b.bodyChildIndex - a.bodyChildIndex);
    for (const ins of pending) {
      const newPara = body.insertParagraph(ins.bodyChildIndex + 1, '');
      const inserted = newPara.appendInlineImage(ins.blob);
      // Hyperlink the image to its Drive file so a click jumps to the asset.
      inserted.setLinkUrl(ins.fileUrl);
    }

    return { folderName: COVER_IMAGES_FOLDER, folderUrl, results };
  }

  return { generateCoverImages };
})();
