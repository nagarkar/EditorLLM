# EditorLLM — OAuth Scope Justifications

This document is provided to Google Workspace Marketplace reviewers to justify
each OAuth scope declared in `appsscript.json`. One section per scope.

---

## `https://www.googleapis.com/auth/documents`

**Grants:** Read and write access to the user's Google Docs documents.

**Used by:**
- `Docs.Documents.get()` called from `DocOps.fetchTabRegistry_()` to fetch the
  document's tab tree (title → tabId map) via the Advanced Docs REST API.
- `Docs.Documents.batchUpdate()` called from `DocOps.createTabViaApi_()` and
  `DocOps.ensureStandardTabs()` to create named instruction tabs (e.g.
  "StyleProfile", "EarTune Instructions") and apply structured edits to the
  document body.

**Why `documents.currentonly` is insufficient:** `documents.currentonly` is
an Apps Script–only scope that covers only the `DocumentApp` built-in service
on the container document. This add-on uses the Advanced Docs REST API
(`Docs.Documents.get` and `Docs.Documents.batchUpdate`) to read and manipulate
tab structure. The Advanced Docs API does not accept `documents.currentonly`;
the full `documents` scope is required.

---

## `https://www.googleapis.com/auth/drive.file`

**Grants:** Read and write access to files created by this app and to the
document the add-on is installed in (the container document).

**Used by:**
- `Drive.Files.create()` in `elevenLabsTextToSpeech()` and
  `elevenLabsTextToSpeechFromDirectives()` to save generated MP3 audio files
  to an `EditorLLM/audio` folder in the user's Drive.
- `Drive.Files.list()` in `getOrCreateEditorLLMAudioFolder_()` to locate or
  create the `EditorLLM` and `EditorLLM/audio` folders (both created by this
  script, therefore within the `drive.file` scope).
- `Drive.Permissions.create()` to set reader access on exported audio files so
  the user can share a download link.
- `Drive.Comments.create()` and `Drive.Replies.create()` in
  `CollaborationService` to post AI agent annotations as Drive comments on the
  active (container) document.

**Why full `drive` is not required:** Every Drive operation targets either a
file created by this script (audio exports, `EditorLLM/audio` folder) or the
container document itself. Both categories are covered by `drive.file`. The
add-on never reads or writes arbitrary Drive files that it did not create.

---

## `https://www.googleapis.com/auth/script.container.ui`

**Grants:** Permission to call `DocumentApp.getUi()` and render UI elements
(menus, sidebars, dialogs) in the host Google Docs editor.

**Used by:**
- `DocumentApp.getUi().createAddonMenu()` in `onOpen()` to register the
  Extensions menu with all agent actions.
- `DocumentApp.getUi().showSidebar()` in `showSidebar()` to render the main
  EditorLLM sidebar (320 px).
- `DocumentApp.getUi().showModelessDialog()` in `openAsDialog()` to open the
  main UI as a floating dialog.
- `DocumentApp.getUi().showModalDialog()` in `showTtsDialog()` and
  `copyAllLogsMenu()` to display focused modal panels.

**Why this scope is required:** Any Apps Script that calls `DocumentApp.getUi()`
requires `script.container.ui`. Without it, all UI rendering calls throw an
authorization error at runtime.

---

## `https://www.googleapis.com/auth/script.external_request`

**Grants:** Permission for `UrlFetchApp.fetch()` to make outbound HTTPS
requests to external services.

**Used by:**
- `GeminiService.ts`: `UrlFetchApp.fetch()` to
  `https://generativelanguage.googleapis.com/v1beta/models/*:generateContent`
  for all AI text generation (instruction generation, annotation, comment
  replies) and to the ListModels endpoint for model discovery.
- `ElevenLabsService.ts`: `UrlFetchApp.fetch()` to
  `https://api.elevenlabs.io/v1/voices`, `/v1/models`, and
  `/v1/text-to-speech/*` for voice listing, model listing, and audio
  synthesis.
- `Code.ts` (`elevenLabsLoadLastAudio`): `UrlFetchApp.fetch()` to
  `https://www.googleapis.com/drive/v3/files/*?alt=media` to retrieve a
  previously generated audio file for in-dialog playback.

**Why this scope is required:** Every `UrlFetchApp.fetch()` call, regardless
of destination, requires `script.external_request`. There is no narrower scope
for outbound HTTP.

---

## `https://www.googleapis.com/auth/userinfo.email`

**Grants:** Read access to the authenticated user's email address.

**Used by:** The OAuth 2.0 authorization flow to identify the installing user
during add-on installation and to associate per-user preferences stored in
`PropertiesService.getUserProperties()` with the correct Google account.

**Why this scope is required:** Google Workspace Add-ons require
`userinfo.email` to establish user identity during installation and for the
Marketplace consent flow. The add-on does not read or display the email
address in its own UI.
