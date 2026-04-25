# GAS Drive Services & OAuth Scopes

Guidelines for choosing between Drive service variants and declaring the minimum
required OAuth scopes in `appsscript.json` for any Google Apps Script project.

---

## 1. DriveApp vs Advanced Drive Service (`Drive`)

Prefer the **Advanced Drive Service** (`Drive`, v3) over `DriveApp` whenever
you also need Drive API features like comments, permissions, or file metadata
control, because mixing both clients adds complexity and redundant mocking.

| Dimension | `DriveApp` (built-in) | `Drive` v3 (Advanced Service) |
|---|---|---|
| **Performance** | ~200 ms GAS wrapper overhead per call | Direct REST — lower latency |
| **API surface** | Simplified subset; limited field control | Full Drive REST v3 surface |
| **Response shape** | GAS wrapper objects (`File`, `Folder`) | Plain JSON resources |
| **Capabilities** | Basic CRUD, simple sharing | Comments, permissions, revisions, shared drives, fine-grained field selection |
| **jest mocking** | Requires a separate `global.DriveApp` stub | One `global.Drive` stub covers all Drive operations |
| **File creation** | `DriveApp.createFile(blob)` | `Drive.Files.create(metadata, blob, { fields: 'id' })` |
| **Sharing** | `file.setSharing(Access.ANYONE_WITH_LINK, Permission.VIEW)` | `Drive.Permissions.create({ role: 'reader', type: 'anyone' }, fileId)` |
| **Download URL** | `file.getDownloadUrl()` (deprecated in newer SDK) | Construct manually: `` `https://drive.google.com/uc?id=${id}&export=download` `` |

**Guidance:** If you have already enabled the Advanced Drive Service, do not
also reach for `DriveApp` — use `Drive.Files.*` and `Drive.Permissions.*`
throughout. Mixing both requires two sets of mocks and two OAuth paths.

---

## 2. OAuth Scope Principles

### Minimum-privilege rule

Always declare the **narrowest scope** that satisfies every API call the script
makes. Overly broad scopes (`drive`, `cloud-platform`) widen the consent screen
prompt, alarm security-conscious users, and increase the blast radius of a
compromised token.

### Scope selection guide

| Scope | What it grants | Appropriate when |
|---|---|---|
| `drive.file` | Files the app created **or** the container document (container-bound scripts only) | Any Drive API operation that only touches app-created files or the bound document |
| `drive` | Full read/write access to all of the user's Drive | The script must access arbitrary Drive files it did not create and that are not the container document |
| `documents` | Full Docs API access to any document | The Advanced Docs API (`Docs.Documents.*`) is used, or the script operates on documents other than the container |
| `documents.currentonly` | `DocumentApp` built-in service on the container document only | No Advanced Docs API calls; script only uses `DocumentApp` on its own container |
| `cloud-platform` | Google Cloud ADC / service-account authentication | Authenticating to Cloud APIs (Cloud Storage, BigQuery, Vertex AI, etc.) via Application Default Credentials — **not** needed for `UrlFetchApp` + API key calls |
| `script.external_request` | All `UrlFetchApp.fetch()` calls | Any outbound HTTP request to an external API |
| `script.container.ui` | `DocumentApp.getUi()`, `SpreadsheetApp.getUi()`, etc. | Any script that renders menus, sidebars, or dialogs |
| `userinfo.email` | Read the authenticated user's email address | Identifying the current user |

### Common mistakes

- Adding `drive` when `drive.file` suffices (container-bound scripts commenting
  on their own document do **not** need full `drive`).
- Adding `cloud-platform` for outbound HTTP calls to AI or third-party APIs —
  `script.external_request` is all that is needed.
- Adding `documents` when only `DocumentApp` is used — prefer
  `documents.currentonly` in that case.

---

## 3. `drive.file` and Container-Bound Scripts

`drive.file` covers two categories:

1. Files **created by the script** via the Drive API.
2. The **container document** itself — for container-bound scripts (Add-ons,
   editor extensions), the document the script is bound to is implicitly within
   the app's working set.

**What this means in practice:**
- `Drive.Comments.create` and `Drive.Replies.create` on
  `DocumentApp.getActiveDocument()` work under `drive.file`. Full `drive` is
  not required.
- Generating a file (e.g. saving audio, exporting a PDF) and sharing it works
  under `drive.file` — the script created the file.

**When `drive.file` is not enough:**
- The script must read or write a Drive file it did not create *and* that is not
  the container document (e.g. reading an arbitrary user-owned spreadsheet by
  ID without using the Picker).
- In that case, escalate to `drive` and leave a code comment explaining why
  `drive.file` is insufficient — it is a deliberate exception, not a default.

---

## 4. `cloud-platform` — When Not to Use It

`cloud-platform` grants access to Google Cloud APIs via **Application Default
Credentials (ADC)** or a **service account**. It is appropriate for:
- Cloud Storage, BigQuery, Pub/Sub, Vertex AI called with ADC.
- Service-account-authenticated workflows.

It is **not** required for — and should not be added for:
- `UrlFetchApp.fetch()` calls authenticated with an API key or OAuth token in a
  request header. Use `script.external_request` instead.
- Google Workspace API calls (Drive, Docs, Sheets, Gmail) made through the
  built-in or Advanced Services. Use the corresponding Workspace scope instead.

Adding `cloud-platform` unnecessarily presents users with a consent prompt that
implies far broader Google Cloud access than the script actually uses.

---

## 5. `documents` vs `documents.currentonly`

| Scope | Required when |
|---|---|
| `documents.currentonly` | Script uses only the `DocumentApp` built-in service on its container document |
| `documents` | Script uses the Advanced Docs API (`Docs.Documents.batchUpdate`, `Docs.Documents.get`), or operates on documents other than the container |

Note: `documents.currentonly` is an Apps Script–only scope not accepted by the
Advanced Docs API or direct REST calls. If you call `Docs.Documents.*` anywhere,
you must use `documents`.

---

## 6. Reading the OAuth Consent Screen

The consent screen wording can be misleading. Know what each phrase maps to:

| Consent screen text | Scope | Notes |
|---|---|---|
| "See, edit, create, and delete **all of your Google Drive files**" | `drive` | The broad scope — avoid unless necessary |
| "See, edit, create, and delete **only the specific Google Drive files** you use with this app" | `drive.file` | The narrow scope — prefer this |
| "See, edit, create, and delete **all your Google Docs documents**" | `documents` | Docs-only, not all of Drive — expected when Advanced Docs API is used |
| "View and manage the document this application has been installed in" | `documents.currentonly` | Built-in DocumentApp only |
| "Connect to an external service" | `script.external_request` | All UrlFetchApp calls |

**`documents` ≠ "all Drive files".** `documents` only covers Google Docs files,
not Sheets, Slides, PDFs, or other Drive content. Do not confuse the two.

---

## 7. Cached Authorization — Scope Changes Don't Auto-Prompt

Changing `appsscript.json` and redeploying does **not** automatically present
users (or the developer) with a new consent screen. GAS reuses the previously
granted OAuth token until it is explicitly revoked.

**To force re-authorization after narrowing or changing scopes:**

1. Go to [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
2. Find the app by name and click **Remove Access**.
3. Re-open the document (or re-run the script from the editor) — the updated
   consent screen will appear.

Alternatively, from the Apps Script editor: **Run → Review permissions** after revoking.

Until the old token is revoked, the app continues to hold whatever scopes were
granted previously — even if `appsscript.json` no longer declares them.

---

## 8. Scope Change Checklist

When adding or changing a scope in `appsscript.json`:

- [ ] Is there a narrower scope that still satisfies every affected API call?
- [ ] For Drive operations: is `drive.file` sufficient, or is full `drive` genuinely needed?
- [ ] If escalating to `drive`, add a code comment explaining why `drive.file` does not cover the use case.
- [ ] For outbound HTTP: is `script.external_request` sufficient instead of `cloud-platform`?
- [ ] For document access: is `documents.currentonly` sufficient, or is the Advanced Docs API in use?
- [ ] Rebuild so the updated manifest is copied to `dist/` before pushing.
- [ ] After narrowing scopes, revoke the existing token (myaccount.google.com/permissions) and re-authorize to verify the new consent screen matches expectations.
