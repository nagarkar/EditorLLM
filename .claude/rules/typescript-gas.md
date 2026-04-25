---
paths:
  - "**/*.ts"
  - "**/tsconfig.json"
  - "**/appsscript.json"
  - "**/.clasp.json"
  - "**/package.json"
  - "**/jest.config.cjs"
  - "**/jest.setup.js"
  - "**/jest.setup.ts"
  - "**/*.sh"
---

<!--
  CANONICAL SOURCE OF TRUTH
  ─────────────────────────
  This file is the single source of truth for TypeScript/GAS workspace rules.
  Cursor mirrors it via:  .cursor/rules/typescript-gas.mdc  (@-reference)
  To update rules, edit THIS file only — Cursor will reflect the change automatically.
-->

# TypeScript + Google Apps Script — Workspace Rules

These rules apply to every TypeScript/Google Apps Script project in this
workspace. They are inferred from the shared build artefacts across projects
and must be maintained as the canonical standard.

---

## 1. Build Gate — Never Leave a Broken Build

After **any** code edit (TypeScript, HTML, JSON config), run the full build
pipeline and resolve **all** errors before stopping:

```
npm run build   # must exit 0 — tsc compile + asset copy
npm run lint    # must exit 0 — ESLint with TypeScript rules
npm test        # must exit 0 — all tests green
```

Or run all three in sequence with:
```
npm run build:all   # build → lint → test
```

- Never mark a task done while `tsc` emits type errors.
- Never mark a task done while ESLint reports any `error`-level violation.
- Never mark a task done while any Jest test is failing or in an error state.
- Fix errors in the order: type errors → lint errors → test failures → lint warnings.
- If a fix introduces a new error elsewhere, fix that too before stopping.

---

## 2. TypeScript Compiler Options (tsconfig.json)

Maintain these exact settings in every project's `tsconfig.json`. Do not
change them without an explicit user instruction.

| Option | Required value | Reason |
|--------|---------------|--------|
| `target` | `"ES2019"` | Google Apps Script V8 runtime supports ES2019 |
| `module` | `"none"` | GAS uses a flat global scope — no module system |
| `rootDir` | `"src"` | All source TypeScript lives under `src/` |
| `outDir` | `"dist"` | Compiled JS is written to `dist/` |
| `noEmitOnError` | `true` | Never write broken JS to `dist/` |
| `skipLibCheck` | `true` | Avoids noise from `@types/google-apps-script` internals |
| `esModuleInterop` | `true` | Required by ts-jest |
| `lib` | includes `"es2019"` and `"dom"` | Provides standard library types |
| `types` | `["google-apps-script", "jest", "node"]` | Three type namespaces always needed |
| `strict` | `false` | GAS globals are loosely typed; strict mode causes too many false positives |

**Excluded from compilation** (always in `exclude` array):
- `node_modules`
- `dist`
- `src/__tests__/**/*`
- `jest.setup.ts`

---

## 3. Folder Structure — Maintain the Canonical Layout

Every project must preserve this exact structure. Do not create source files
outside `src/`, do not write compiled output inside `src/`.

```
<project-root>/
├── src/
│   ├── *.ts                 # Feature modules — IIFE or class pattern (see §5)
│   └── __tests__/
│       └── *.test.ts        # Unit tests — one file per feature module minimum
├── dist/                    # Compiled output — NEVER edit manually
├── *.html                   # Sidebar and dialog HTML — lives at project root
├── appsscript.json          # GAS manifest — copied to dist/ during build
├── .clasp.json              # clasp config — rootDir must always be "dist"
├── package.json             # npm scripts (see §4)
├── tsconfig.json            # Compiler config (see §2)
├── jest.config.cjs          # Jest config (CommonJS)
├── jest.setup.js            # GAS global mocks for Jest
└── jest.setup.ts            # TypeScript version of GAS mocks
```

**Rules:**
- `dist/` is generated. Never commit it. Confirm it is in `.gitignore`.
- `node_modules/` must be in `.gitignore`.
- HTML files (sidebars, dialogs) live at the **project root**, not inside `src/`.
- `appsscript.json` lives at the **project root** and is copied to `dist/` by the build script.

---

## 4. npm Scripts — Maintain the Standard Pipeline

Every project's `package.json` must include these exact script names:

| Script | Command pattern | Purpose |
|--------|----------------|---------|
| `build` | `tsc && cp appsscript.json dist/ && cp *.html dist/ 2>/dev/null \|\| true` | Compile + copy assets |
| `lint` | `eslint src/**/*.ts` | ESLint with TypeScript rules |
| `test` | `jest` | Run all tests |
| `build:all` | `npm run build && npm run lint && npm run test` | Full gate (build + lint + test) |
| `deploy:staging` | `npm run build:all && clasp push` | Push to @HEAD |
| `deploy:prod` | `npm run build:all && clasp deploy --deploymentId <ID>` | Versioned release |

**Rules:**
- `build` must copy `appsscript.json` **and** all `*.html` files to `dist/`.
  The `2>/dev/null || true` guard is required so the build does not fail if no
  HTML files exist yet.
- `deploy:staging` and `deploy:prod` must always run `build:all` (not just
  `build`) so tests are always gated before a push.
- `"type": "commonjs"` must be present in `package.json` (required by ts-jest).

---

## 5. Google Apps Script Code Patterns

### No import / export statements
GAS flattens all `.js` files from `dist/` into a single global scope.
**Never** use `import` or `export` in any `.ts` source file. Shared symbols
are available globally across all compiled files.

### Module pattern: IIFE closures
Services and utilities must use the IIFE (Immediately Invoked Function
Expression) module pattern to encapsulate private state:

```typescript
const MyService = (() => {
  // private
  function helper_(): void { ... }

  // public
  function doSomething(): void { helper_(); }

  return { doSomething };
})();
```

- Private functions use a trailing underscore suffix (`helper_`).
- The returned object is the only public API.

### Class pattern
Classes extending a shared base are an acceptable alternative to IIFEs for
stateful plugin or agent objects. They must not use `import`/`export`.

### Entry point file
- An `onOpen()` function must register the UI menu.
- All functions called from HTML via `google.script.run` must be declared at
  the **top level** of the entry point file (not inside a class or IIFE) —
  GAS can only invoke top-level functions.

---

## 6. .clasp.json Integrity

`.clasp.json` must always satisfy:

```json
{
  "scriptId": "<real script ID — never a placeholder>",
  "rootDir": "dist",
  "scriptExtensions": [".js", ".gs"],
  "htmlExtensions": [".html"],
  "jsonExtensions": [".json"],
  "filePushOrder": [
    "dist/Types.js",
    "dist/Prompts.js",
    "dist/<utilities>.js",
    "dist/<services>.js",
    "dist/BaseAgent.js",
    "dist/<agent subclasses>.js",
    "dist/Code.js"
  ],
  "skipSubdirectories": false
}
```

- `rootDir` must be `"dist"` — clasp reads compiled output, not source.
- Never change `scriptId` to a placeholder string; if the ID is unknown,
  leave the existing value and flag it to the user.
- `skipSubdirectories` must be `false` so all files in `dist/` are pushed.
- **`filePushOrder` is mandatory.** GAS executes files in alphabetical order
  by default. Class declarations are not hoisted — if a subclass file sorts
  before its base class alphabetically, every `onOpen()` call will throw
  `"BaseAgent is not defined"` (or similar). Always specify the explicit
  load order: shared constants and types first, services next, base classes
  before subclasses, entry point (`Code.js`) last.
- **Every new `.ts` source file must be added to `filePushOrder` immediately.**
  Forgetting this silently omits the compiled module from GAS even though
  `dist/` contains the `.js` file — the symptom is an undefined global at
  runtime with no build error.

---

## 7. appsscript.json Integrity

Every `appsscript.json` must include:

```json
{
  "runtimeVersion": "V8",
  "exceptionLogging": "STACKDRIVER",
  "oauthScopes": ["https://www.googleapis.com/auth/documents.currentonly", ...]
}
```

- `runtimeVersion` must be `"V8"` — never `"DEPRECATED_ES5"`.
- When adding a new GAS service (e.g., Drive, Sheets), add its OAuth scope
  to `oauthScopes` **and** its advanced service entry under `dependencies`.
- External API URLs must be added to `urlFetchWhitelist` before calling them
  with `UrlFetchApp.fetch`.

---

## 8. Jest & Test Conventions

### jest.config.cjs
```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: ['/node_modules/'],
};
```
Do not add unknown or misspelled options (e.g., `setupFilesAfterFramework`).

### jest.setup.js
Must mock **every** GAS global that any source file touches:
`DocumentApp`, `SpreadsheetApp`, `PropertiesService`, `UrlFetchApp`,
`ScriptApp`, `HtmlService`, `Drive`, `Logger`, `Utilities`.

Mocks must return safe stubs (not `undefined`) to prevent cascading errors
in tests that don't exercise those paths.

**vm-context hygiene:** vm-based tests (e.g. `loadCollaborationService()`)
seed a vm context from `global`. Any new **public method** added to a GAS
service IIFE (e.g. `DocOps.walkTabs`) must also be added as a `jest.fn()` stub
on the corresponding `global.<Service>` object in `jest.setup.js`. Omitting
this causes `<method> is not a function` at vm-test runtime even though unit
tests pass — the two test layers share the global mock object.

### Test file requirements
- Every project must have at least one sanity test that:
  - Verifies the primary data interfaces (types) are shaped correctly.
  - Requires zero GAS runtime — runs purely in Node.js.
- Tests must not rely on a live GAS runtime, network, or file system outside
  the project root.
- Tests must not import directly from compiled `dist/` files unless the test
  explicitly documents that `npm run build` must be run first.

---

## 9. DevDependencies — Keep in Sync

All projects must always install these packages (version ranges may differ):

```
@types/google-apps-script
@types/jest
@types/node
@typescript-eslint/eslint-plugin
@typescript-eslint/parser
eslint
jest
ts-jest
typescript
```

Do not add runtime `dependencies` — GAS projects have no runtime package
manager; all logic must compile into `dist/`.

---

## 10. Git & Repository Hygiene

`.gitignore` must always contain at minimum:

```
node_modules/
dist/
*.js.map
.env
```

- Never commit `dist/` — it is a build artefact.
- Never commit `node_modules/`.
- Never commit `.env` or any file containing API keys or OAuth tokens.
- `appsscript.json`, `*.html`, `.clasp.json`, and all `src/` files must be
  committed.
- Deployment shell scripts must be committed with executable permissions
  (`chmod +x`).

---

## 11. Shell Scripts — initclasp.sh, deploy.sh, deploy_prod.sh

Every TypeScript/GAS project **must** include these three shell scripts at the
project root. All three must be committed with executable permissions
(`git add --chmod=+x` or `chmod +x` before committing).

### initclasp.sh — First-time GAS project setup

Required behaviour:
1. Verify `clasp` is installed (`command -v clasp`); exit with instructions if not.
2. Run `clasp login` to authenticate.
3. Run `clasp create --title "<Project Title>" --type docs --rootDir dist` to
   create the Apps Script project.
4. If clasp writes `.clasp.json` into `dist/` instead of the project root,
   move it: `mv dist/.clasp.json .clasp.json`.
5. If `dist/` does not yet exist, run `npm run build` first so clasp has a
   directory to push.
6. Support a `--reuse` flag that skips `clasp create` (for projects that
   already have a script ID) and only runs login + build.

### deploy.sh — Staging deploy

Required behaviour:
1. **Pre-flight checks** (fail fast before touching clasp):
   - `.clasp.json` must exist — exit with a clear error if not.
   - `scriptId` in `.clasp.json` must not be a placeholder string — exit with
     a message directing the user to run `initclasp.sh`.
   - `clasp` binary must be on `PATH` — exit with install instructions if not.
2. Run `npm run build:all` (build + lint + test) — **not** `npm run build &&
   npm test` separately. Lint must always run before a staging push.
3. Run `clasp push --force` to overwrite the @HEAD deployment.
4. Print the Apps Script editor URL on success.
5. Support a `--skip-tests` flag that substitutes `npm run build` for
   `npm run build:all` (for emergency hotfixes only — document the risk in
   the script).

### deploy_prod.sh — Versioned production deploy

Required behaviour:
1. Same pre-flight checks as `deploy.sh`.
2. Resolve `DEPLOYMENT_ID`:
   - Check `DEPLOYMENT_ID` environment variable first.
   - Fall back to parsing `deploy:prod` script in `package.json` via regex.
   - If neither yields a real ID (still `YOUR_DEPLOYMENT_ID_HERE`), abort
     with instructions.
3. Run `npm run build:all` (never separate build + test).
4. Run `clasp push --force`.
5. Run `clasp deploy --deploymentId "$DEPLOYMENT_ID" --description "..."`.
   - Version description should include a git commit SHA if available
     (`git rev-parse --short HEAD 2>/dev/null`).
6. After the first successful prod deploy, **auto-patch** `package.json` so
   the `deploy:prod` script contains the real deployment ID (using `sed` or
   a json replacement), then commit the change.
7. Support `--skip-tests` and `--dry-run` flags. `--dry-run` prints all
   commands without executing clasp push or deploy.

### Sync contract between scripts and package.json

| Action | Shell script | package.json script |
|--------|-------------|---------------------|
| Staging deploy | `./deploy.sh` | `npm run deploy:staging` |
| Prod deploy | `./deploy_prod.sh` | `npm run deploy:prod` |
| Build gate | `npm run build:all` | `build:all` = build → lint → test |

Both shell scripts and npm scripts must invoke the **same** `build:all`
pipeline so that lint is never skipped on any deploy path.

---

## 12. Error Resolution Protocol

When a build or test failure occurs during an edit session:

1. **Read the full error message** — do not guess the fix from the first line.
2. **Fix the root cause**, not just the symptom (e.g., if a type is wrong,
   fix the type — do not cast to `any` unless the GAS typings genuinely do
   not expose the API).
3. **Re-run `npm run build`** after every fix — never batch-declare victory
   without re-running.
4. **Re-run `npm test`** after the build is clean.
5. If three consecutive fix attempts fail, **stop and explain** the root cause
   to the user rather than continuing to guess.

Acceptable use of `as any`:
- Newer GAS APIs not yet reflected in `@types/google-apps-script`.
- Must always include a comment: `// GAS API not in @types — cast required`.

---

## 13. ESLint Configuration (eslint.config.mjs)

Every project must have an `eslint.config.mjs` using flat config format with:
- `@typescript-eslint/parser` for TypeScript parsing
- `sourceType: 'script'` for GAS source files (no ES modules)
- `no-restricted-syntax` rules blocking `ImportDeclaration` and `ExportNamedDeclaration`
- GAS globals declared (`DocumentApp`, `Drive`, `Logger`, etc.) to prevent false `no-undef` errors
- Separate, relaxed config block for `src/__tests__/**/*.ts`

---

## 14. PropertiesService Resolution Order & E2E API Key Hygiene

`GeminiService.resolveApiKey_()` checks stores in this order:
1. Environment variable (`process.env.GEMINI_API_KEY`)
2. `PropertiesService.getUserProperties()`
3. `PropertiesService.getScriptProperties()`

**The `setScriptProperty` doPost handler must mirror writes to UserProperties**
for `GEMINI_API_KEY`. If it only writes to ScriptProperties, the
sidebar-flow `saveApiKey()` (which stores in UserProperties) leaves a
stale key that makes E2E "no-key" tests pass when they should fail.

```typescript
if (propKey === 'GEMINI_API_KEY') {
  PropertiesService.getUserProperties().setProperty(propKey, propValue ?? '');
}
```

This makes clear and restore symmetric — clearing via `setScriptProperty`
actually clears all checked stores, not just one.

---

## 15. Experimental Layer — Isolation Rules

`src/experimental/` is excluded from the main `tsconfig.json` and must never
appear in `dist/`. It exists only for local development and Jest testing.

- Never put shared utilities in `src/experimental/` — they won't reach GAS.
- Code shared between experimental tests and GAS agents must live in `src/`
  (e.g. `src/agentHelpers.ts`).
- The experimental tsconfig must extend the root tsconfig and add
  `src/experimental/**/*` back into `include`.
- `filePushOrder` must never list any `dist/experimental/` path.

---

## 16. export function Helper Pattern

For helper files that must be both:
- Importable by Jest / experimental code as an ES module, **and**
- Available as flat-scope globals in GAS

Use `export function` declarations. The build chain (`fixgas.js`) strips the
`Object.defineProperty(exports,…)` calls from the compiled output, leaving
plain function declarations in the flat scope.

**Required pairing:** Every `export function foo(...)` in a shared helper file
must have a corresponding `declare function foo(...)` ambient declaration in
`src/Types.ts`. Without this, GAS flat-scope callers will see TypeScript
errors (`Cannot find name 'foo'`).

---

## 17. Service Ownership — Tab Traversal

`DocOps.walkTabs(callback)` is the **single** implementation of recursive
`DocumentApp.getTabs()` traversal. Do not duplicate tab-walking loops in
`CollaborationService`, `CommentProcessor`, or any other module.

```typescript
// CORRECT — delegate to DocOps
DocOps.walkTabs(tab => directory.set(tab.getId(), tab.getTitle()));

// WRONG — local re-implementation of the same traversal
function walk_(tabs) { for (const t of tabs) { ...; walk_(t.getChildTabs()); } }
walk_(DocumentApp.getActiveDocument().getTabs());
```

---

## 18. Dead Code Hygiene

Regularly audit for these categories of dead code:

| Category | How to detect |
|----------|--------------|
| `protected readonly EXAMPLE_CONTENT` on agent classes | Grep for `EXAMPLE_CONTENT` — if never read outside the declaring class, delete |
| Identity-wrapper functions (`resolveX_` that just returns its argument) | Grep callers — if every call could inline the value, delete the wrapper |
| Legacy highlight helpers | Grep for the symbol in production paths (not just tests) — if only called from isolated tests, delete both |
| Duplicate `buildStandardPrompt` / schema implementations | Grep for the function name in `src/experimental/` and `src/BaseAgent` — one canonical copy must win |

When deleting a dead symbol: remove it from `src/Types.ts` (ambient
declaration), from any `import` statement in test files, and from any test
`describe` block that only tests that symbol.

---

## 19. Code Review Checklist (before marking any edit complete)

- [ ] `npm run build` exits 0 with no TypeScript errors or warnings
- [ ] `npm run lint` exits 0 with no ESLint errors (warnings are allowed)
- [ ] `npm test` exits 0 with all tests green
- [ ] New interfaces/types have corresponding shape tests in `src/__tests__/`
- [ ] New pure utility functions have unit tests (inline logic if no GAS deps)
- [ ] No `import` / `export` statements in any `.ts` source file
- [ ] All top-level `google.script.run`-callable functions are in the entry point file
- [ ] `dist/` not manually edited
- [ ] `appsscript.json` updated if new OAuth scopes or services were added
- [ ] `.clasp.json` has `"rootDir": "dist"` and a real (non-placeholder) `scriptId`
- [ ] `.clasp.json` `filePushOrder` lists all `.js` files with types/constants first, base classes before subclasses, `Code.js` last
- [ ] New GAS globals mocked in `jest.setup.js` if used by new code
- [ ] `.gitignore` still excludes `node_modules/`, `dist/`, `.env`
- [ ] `initclasp.sh`, `deploy.sh`, and `deploy_prod.sh` are present at the project root
- [ ] All three shell scripts are committed with executable permissions (`chmod +x`)
- [ ] `deploy.sh` and `deploy_prod.sh` both call `npm run build:all` (not `npm run build` + `npm test` separately) so lint is always included on every deploy path
- [ ] Every new `.ts` file in `src/` has been added to `filePushOrder` in `.clasp.json`
- [ ] Every new `export function` in a shared helper file has a `declare function` ambient in `src/Types.ts`
- [ ] No file under `src/experimental/` has been added to `filePushOrder`
- [ ] Any new public method on a GAS service IIFE has a `jest.fn()` stub in `jest.setup.js` (for vm-context tests)
- [ ] `GEMINI_API_KEY` writes in `doPost` mirror to both UserProperties and ScriptProperties
