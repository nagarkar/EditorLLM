# Prompt: Container-Bound → Editor Add-on Portability Audit

Paste this entire prompt to Claude (or run via `claude` CLI from the project root).
Claude will scan `src/` and report every pattern that must be fixed before the
script can be deployed as a Google Workspace Editor Add-on.

---

## TASK

You are auditing a Google Apps Script TypeScript project for portability issues
that would break when the script is deployed as a standalone Editor Add-on
rather than a container-bound script.

Read every `.ts` file under `src/` (excluding `src/__tests__/` and
`src/experimental/`). For each file, check for the anti-patterns listed below.
Report your findings as a structured list grouped by file, including the line
number and a one-line fix description for each finding.

At the end, print a **summary table**: one row per file, with columns for the
file name and the count of MUST-FIX vs SHOULD-REVIEW findings.

---

## ANTI-PATTERNS TO CHECK

### MUST-FIX — Will cause runtime errors in add-on mode

**P1 — Module-level GAS API calls**
Any call to a GAS service that appears *outside* a function body (at module
scope, in a top-level variable initialiser, or in the body of an IIFE that runs
at load time). GAS executes top-level code when the script loads; in add-on
mode this happens before the user has granted authorization, causing an
`Exception: You do not have permission` error.

Specific instances to flag:
- `DocumentApp.getActiveDocument()` at module scope
- `DocumentApp.getUi()` at module scope
- `SpreadsheetApp.getActive()` at module scope
- `LockService.getDocumentLock()` at module scope
- Any `PropertiesService.*` call at module scope
- Any `ScriptApp.*` call at module scope

Pattern hint: look for these identifiers on lines that are NOT inside a
`function`, arrow function, or class method body. IIFE patterns like
`const X = (() => { ... })()` — scan the *body* of the IIFE for the above.

**P2 — Missing `onInstall` function**
The file that defines `onOpen` must also define `onInstall`. Add-ons fire
`onInstall` at install time; without it, the menu never appears for new users.
Flag if `onInstall` is absent from the codebase entirely.

**P3 — `onOpen` missing `e` parameter**
`onOpen` must accept an event object `e` so that `e.authMode` can be read.
Without it, the function signature is valid but `authMode` is always undefined,
making auth guards impossible.
Flag: `function onOpen(` with no parameters, or with only a comment.

**P4 — No `AuthMode.NONE` guard in `onOpen`**
In add-on mode, `onOpen` is called with `AuthMode.NONE` when the document is
opened by a user who has not yet authorized the add-on. If the function calls
any API that requires auth (including `DocumentApp.getUi().createAddonMenu()`
with real menu items), it will throw. A guard is required:
```typescript
if (e?.authMode === ScriptApp.AuthMode.NONE) { /* minimal/empty menu */ return; }
```
Flag if `onOpen` contains no reference to `AuthMode` or `authMode`.

**P5 — `createMenu(` instead of `createAddonMenu(`**
Container-bound scripts use `DocumentApp.getUi().createMenu(name)`.
Editor add-ons must use `createAddonMenu()` so the menu appears under
**Extensions** (not as a top-level menu). Flag every call to `.createMenu(`.

---

### SHOULD-REVIEW — Likely to behave unexpectedly in add-on mode

**R1 — `getScriptProperties()` used as a cross-user shared store**
In a container-bound script, Script Properties are set once by a developer and
read by all users of that document. In a standalone add-on each user's
installation has its own isolated Script Properties store — there is no
shared admin-set fallback. Flag every `getScriptProperties()` call and note
whether it reads a value that the developer might expect to be shared (e.g.,
API keys, configuration presets).

**R2 — `document.getId()` or `ScriptApp.getScriptId()` used in identity checks**
These return different values between the container-bound script and the
standalone add-on script. Flag any comparisons or logging that reference them,
in case the code makes assumptions about stable IDs.

**R3 — Hard-coded deployment IDs or script IDs in source code**
Flag any string literals that look like GAS deployment IDs
(`AKfycb...`) or script IDs embedded in source `.ts` files (they belong in
`.clasp.json` and `package.json` only).

**R4 — `LockService.getDocumentLock()`**
Document locks are scoped to the container document. In a multi-user add-on,
each user operates on a different document; document locks still work correctly,
but any assumption that a lock acquired in one user's session blocks another
user's session on a *different* document is wrong. Flag usages so the developer
can confirm the intent.

---

## OUTPUT FORMAT

For each finding, output one entry in this format:

```
[MUST-FIX P2] src/Code.ts:12
  onInstall() is missing. Add: function onInstall(e) { onOpen(e); }
```

After all findings, output the summary table:

```
File                    | MUST-FIX | SHOULD-REVIEW
------------------------|----------|---------------
src/Code.ts             |    3     |      1
src/GeminiService.ts    |    0     |      1
```

If a file has no findings, omit it from the table.
If no findings exist at all, print: ✅ No portability issues found.
