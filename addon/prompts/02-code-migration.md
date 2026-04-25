# Prompt: Apply Editor Add-on Code Migration

Paste this entire prompt to Claude (or run via `claude` CLI from the project root).
Claude will apply the specific, well-understood code changes required to make a
container-bound GAS TypeScript project work as a standalone Editor Add-on.
These changes are mechanical and deterministic — no architectural decisions
are needed.

Run `01-portability-audit.md` first and resolve any MUST-FIX P1 (module-level
GAS calls) findings manually before running this prompt.

---

## TASK

Apply the following changes to the Google Apps Script TypeScript project.
After all edits, run `npm run build:all` and report whether it exits 0.
If it fails, fix the errors before reporting done.

---

## CHANGE 1 — Add `e` parameter to `onOpen` and add `onInstall`

**File:** `src/Code.ts`

Find the `onOpen` function. Change its signature to accept the GAS add-on
event object, and add an `AuthMode.NONE` guard that shows only a minimal menu
before authorization. Then add `onInstall` immediately after `onOpen`.

**Before (approximate — match the actual signature in the file):**
```typescript
function onOpen() {
  const ui = DocumentApp.getUi();
  const menu = ui.createMenu(Constants.EXTENSION_NAME);
  // ... menu items ...
  menu.addToUi();
}
```

**After:**
```typescript
function onOpen(e?: GoogleAppsScript.Events.AddonOnOpen) {
  const ui = DocumentApp.getUi();

  // In add-on mode the script loads before the user grants authorization.
  // Attempting to build a real menu at AuthMode.NONE throws a permissions
  // error. Show a single "Authorize" item instead and return early.
  if (e?.authMode === ScriptApp.AuthMode.NONE) {
    ui.createAddonMenu()
      .addItem('Authorize EditorLLM', 'authorizeAddon_')
      .addToUi();
    return;
  }

  const menu = ui.createAddonMenu();
  // ... existing menu items unchanged — replace createMenu( with createAddonMenu( ...
  menu.addToUi();
}

function onInstall(e: GoogleAppsScript.Events.AddonOnInstall) {
  onOpen(e);
}

/** Called from the "Authorize EditorLLM" menu item when authMode is NONE. */
function authorizeAddon_() {
  // Showing any UI triggers the OAuth consent flow on the next onOpen.
  DocumentApp.getUi().alert(
    'EditorLLM',
    'Authorization complete. Please close and reopen this document to load the full menu.',
    DocumentApp.getUi().ButtonSet.OK
  );
}
```

**Additional requirement:** Replace every call to `.createMenu(` with
`.createAddonMenu(` throughout `src/Code.ts`. Remove the name argument —
`createAddonMenu()` takes no arguments.

---

## CHANGE 2 — Remove cross-user Script Properties API key fallback

**File:** whichever file contains `getScriptProperties` in the API key
resolution chain (likely `src/GeminiService.ts` or similar).

Find the function that resolves the Gemini API key. It currently checks
(1) environment variable, (2) User Properties, (3) Script Properties.

Remove step (3) and replace it with a clear error that directs the user to
set their own key. In a standalone add-on, Script Properties are isolated per
installation and cannot serve as a shared admin-set fallback.

**Before (approximate):**
```typescript
function resolveApiKey_(): string {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const userKey = PropertiesService.getUserProperties().getProperty('GEMINI_API_KEY');
  if (userKey) return userKey;
  const scriptKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (scriptKey) return scriptKey;
  throw new Error('No API key configured');
}
```

**After:**
```typescript
function resolveApiKey_(): string {
  // Layer 1: test environment variable (unit/integration tests only).
  if (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }
  // Layer 2: per-user key stored via the Settings dialog.
  const userKey = PropertiesService.getUserProperties().getProperty('GEMINI_API_KEY');
  if (userKey) return userKey;
  // Script Properties are NOT used as a fallback in add-on mode.
  // Each installation is isolated — there is no shared admin-set key.
  throw new Error(
    'No API key configured. Open Extensions > EditorLLM > Settings to add your Gemini API key.'
  );
}
```

If the file also has a `saveApiKey` or `setApiKey` function that writes to
Script Properties *in addition to* User Properties, remove the Script
Properties write (keep only the User Properties write).

---

## CHANGE 3 — Verify no module-level GAS calls remain

After making Changes 1 and 2, grep the `src/` directory (excluding
`src/__tests__/`) for any of the following patterns appearing *outside* a
function or class method body:

- `DocumentApp.getActiveDocument()`
- `DocumentApp.getUi()`
- `PropertiesService.`
- `ScriptApp.`
- `LockService.`

If any are found at module scope, move them inside the function that first
needs them. Report each one that required moving.

---

## VERIFICATION

After all changes:
1. Run `npm run build` — must exit 0 with no TypeScript errors.
2. Run `npm run lint` — must exit 0.
3. Run `npm test` — all tests must pass.
4. Confirm `onInstall` is present in `dist/Code.js`.
5. Confirm `createAddonMenu` appears in `dist/Code.js` and `createMenu(`
   does not (outside comments).

Report the result of each verification step.
