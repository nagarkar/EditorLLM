# Prompt: Generate Workspace Marketplace Listing Assets

Fill in every field in the **CONTEXT** section below, then paste this entire
document to Claude. Claude will generate all required listing assets and write
them to `addon/listing/`. It will also update `addon/listing/listing.json` with
the structured metadata.

Run this prompt once. Re-run it (with the same context) to regenerate any
individual file by deleting that file first.

---

## CONTEXT — Fill in before sending

```
APP_NAME:           EditorLLM
TAGLINE:            AI-augmented editing assistant for Google Docs
WHAT_IT_DOES: |
  EditorLLM is a Google Docs editor add-on that augments long-form writing
  and editing workflows with AI agents. It provides an in-document sidebar
  with agents for structural editing (Architect), prose rhythm (EarTune),
  technical accuracy (Audit), thematic coherence (Tether), text-to-speech
  preview (TTS), and a general-purpose writing assistant.
  Users interact with agents via a sidebar and document menu. Each agent
  reads the document, applies suggestions as tracked comments or direct
  edits, and writes structured instructions to named document tabs.
  Users supply their own Gemini API key via the Settings panel.

TARGET_USERS:       Authors, editors, and writing professionals
DEVELOPER_NAME:     <your name or company>
DEVELOPER_EMAIL:    <support email>
GITHUB_REPO_URL:    <https://github.com/owner/repo>
SUPPORT_URL:        <https://github.com/owner/repo/issues>
EFFECTIVE_DATE:     <YYYY-MM-DD>

SCOPES_IN_USE:
  - documents          (Advanced Docs API for reading/writing document structure)
  - drive.file         (Creating and sharing audio export files; accessing the active document)
  - script.container.ui (Rendering sidebar and dialog UI via DocumentApp.getUi())
  - script.external_request (Outbound HTTPS calls to Gemini API and ElevenLabs TTS API)
  - userinfo.email     (Identifying the current user for agent context)
```

---

## TASK

Using the context above, generate every file listed below and write each one
to `addon/listing/<filename>`. Create the directory if it does not exist.

After writing all files, update `addon/listing/listing.json` with the
structured metadata (name, shortDescription, developerName, developerEmail,
supportUrl, category — leave privacyUrl and tosUrl empty, they are populated
by deploy_privacy.sh).

---

### File 1 — `addon/listing/short-description.txt`

A single line of plain text, **maximum 150 characters**. This is the subtitle
shown on the Marketplace card. It must be benefit-focused (what the user gains),
not feature-focused. No trailing punctuation.

---

### File 2 — `addon/listing/long-description.txt`

Plain text, **maximum 1500 characters**. Structure:

1. Opening sentence — the core value proposition.
2. Paragraph listing 4–6 key capabilities (written as user benefits, not
   feature names). Use natural language; avoid bullet points (not rendered in
   the Marketplace).
3. One sentence on setup (users provide their own Gemini API key in Settings).
4. One sentence on privacy (no data stored outside the user's document and
   their own API account).

---

### File 3 — `addon/listing/scope-justifications.md`

A Markdown document with one H2 section per OAuth scope. Each section must
contain:
- The full scope URI
- A one-sentence plain English explanation of what it grants
- A concrete description of exactly which function call(s) in the add-on
  require this scope
- A statement of why no narrower scope is sufficient (where applicable)

Google reviewers read this document during the verification process.
Write it in a factual, audit-friendly tone.

Example structure:
```markdown
## `https://www.googleapis.com/auth/documents`

**Grants:** Read and write access to all of the user's Google Docs documents.

**Used by:** `Docs.Documents.get()` and `Docs.Documents.batchUpdate()` called
from `DocOps.ts` to read document structure and apply agent suggestions as
inline edits and named ranges.

**Why narrower scope is insufficient:** `documents.currentonly` covers only the
`DocumentApp` built-in service. This add-on uses the Advanced Docs REST API
(`Docs.Documents.*`) which requires the full `documents` scope.
```

Write one section for each of the five scopes listed in SCOPES_IN_USE above.

---

### File 4 — `addon/listing/privacy.html`

A complete, self-contained HTML page (no external CSS or JS dependencies).
It must be hostable as a static file on GitHub Pages.

Required sections:
1. **Introduction** — what the policy covers and the effective date.
2. **Data we collect** — be precise: the add-on reads document content only
   while an agent is actively running; it does not store document content
   outside the user's own Google account.
3. **How we use your data** — document content is passed to the Gemini API
   (Google) via the user's own API key; audio content is passed to ElevenLabs
   via the user's own API key; no data is retained by the developer.
4. **Third-party services** — Gemini API (Google LLC), ElevenLabs; link to
   their respective privacy policies.
5. **User controls** — how to revoke access (Google account permissions page).
6. **Contact** — the developer email from CONTEXT.

Style: clean, readable, mobile-friendly. Use a system font stack and a
max-width container. No cookies, no tracking pixels.

---

### File 5 — `addon/listing/tos.html`

A complete, self-contained HTML page.

Required sections:
1. **Acceptance** — by installing the add-on the user agrees to these terms.
2. **Permitted use** — personal and professional writing assistance; no
   automated bulk processing or resale of outputs.
3. **User responsibilities** — the user is responsible for the content of
   their documents and for complying with the Gemini and ElevenLabs terms of
   service for their own API keys.
4. **Disclaimer of warranties** — the add-on is provided as-is; no guarantee
   of accuracy of AI-generated suggestions.
5. **Limitation of liability** — developer is not liable for document changes
   made by agent suggestions that the user accepts.
6. **Changes to terms** — developer may update terms; continued use after
   30-day notice constitutes acceptance.
7. **Contact** — the developer email from CONTEXT.

Same style as privacy.html (consistent visual design).

---

### File 6 — `addon/listing/screenshot-guide.md`

A short Markdown checklist (not generated screenshots — this is a guide for
the developer to capture them manually). Include:

- Required dimensions: 1280×800 pixels (or 2560×1600 for HiDPI). PNG format.
- Naming convention: `screenshot01.png`, `screenshot02.png`, etc.
- File destination: `addon/listing/`
- List of 5 recommended screens to capture (specific views that showcase the
  add-on's value — e.g., the sidebar open with an agent result visible, the
  settings dialog, a before/after of a document edit).
- Instructions for hiding personal data before capturing.

---

### File 7 — `addon/listing/logo-specs.md`

A short Markdown guide for producing the two required logo files:

- `addon/listing/logo128.png` — 128×128 px, PNG with transparent background.
- `addon/listing/logo512.png` — 512×512 px, PNG with transparent background.

Include: recommended design constraints (legible at 128px, works on both light
and dark backgrounds, no text), and a one-liner for resizing with ImageMagick
if the developer already has an SVG source.

---

## OUTPUT INSTRUCTIONS

- Write each file using the Write tool, do not print the contents inline.
- After writing all files, print a summary table: filename | status (created /
  already existed, skipped).
- If any CONTEXT field above still contains a `<placeholder>`, note it in
  the summary and leave the corresponding placeholder in the generated file
  (wrapped in `<!-- TODO: ... -->` comments) rather than inventing a value.
