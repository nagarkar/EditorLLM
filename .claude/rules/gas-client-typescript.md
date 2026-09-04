# GAS Client-Side TypeScript Build

Rules for projects that compile browser-side TypeScript alongside a GAS
server-side TypeScript build. Applies whenever a `client/` directory and
`tsconfig.client.json` exist.

---

## 1. Two Compilation Contexts — Never Mix Them

| | Server | Client |
|---|---|---|
| Source root | `src/` | `client/` |
| tsconfig | `tsconfig.json` | `tsconfig.client.json` |
| Output | `dist/` (GAS JS) | `dist_client/` (concatenated into `sidebar_js.html`) |
| Runtime | GAS V8 | Browser |
| Module system | `"module": "none"` | `"module": "none"` |
| Target | `"ES2019"` | `"ES2020"` |

**Never import between the two.** GAS uses a flat global scope; the browser
build is concatenated, not bundled. Neither context has an `import`/`export`
runtime. Cross-context sharing is handled by `.d.ts` files included in both
tsconfigs (see §2).

---

## 2. Three Type Files — One Job Each

### `client/server-types.d.ts` — the shared contract
Interfaces for data that crosses the `google.script.run` boundary as JSON.

**Belongs here if:**
- It is the return type of a `google.script.run` server call, **or**
- It is a parameter type passed *to* a server call that the client constructs

**Must not contain:**
- `GoogleAppsScript.*` types (GAS-only)
- Types only used inside GAS runtime (never serialised to JSON)
- Interfaces with methods (JSON can only carry data)

Included in **both** `tsconfig.json` and `tsconfig.client.json`. Because it is
a `.d.ts` file it emits no JS in either build.

```json
// tsconfig.json
"include": ["src/**/*.ts", "client/server-types.d.ts"]

// tsconfig.client.json
"include": ["client/**/*.ts"]   // picks up server-types.d.ts automatically
```

### `src/Types.ts` — server-only types
Interfaces used exclusively inside GAS: agent payloads, collaboration
service records, LLM client contracts, ambient `declare function` stubs for
flat-scope helpers, prompt constant declarations.

**Rule:** if the type references `GoogleAppsScript.*`, is only used in GAS
service IIFEs, or is never returned from a `google.script.run` call → it
stays here.

### `client/gas-client.d.ts` — browser ambients
Ambient declarations needed only in the browser context:
- `google.script.run` / `google.script.host` API shape
- CDN-loaded libraries (`FFmpeg`, `MultiSelectTabs`, etc.)
- Pragmatic `HTMLElement` / `Element` interface extensions to silence
  common DOM-access patterns (`.value`, `.checked`, `.disabled`, etc.)
  until proper typed helpers are added incrementally

Never included in `tsconfig.json` — it would conflict with the GAS type
environment.

---

## 3. Decision Flowchart for New Types

```
Is it the shape of data returned by google.script.run?
  YES → client/server-types.d.ts
  NO  → Does it reference GoogleAppsScript.* or GAS-only APIs?
          YES → src/Types.ts
          NO  → Is it a browser ambient (CDN lib, DOM extension)?
                  YES → client/gas-client.d.ts
                  NO  → src/Types.ts  (server-only, used internally)
```

---

## 4. Client Build Pipeline

`scripts/build_client.js` is the single script responsible for the client
build. It must:
1. Delete `dist_client/` (clean build every time)
2. Run `npx tsc -p tsconfig.client.json` — fail on any type error
3. Concatenate compiled `.js` files in the explicit order declared in
   `FILE_ORDER` (never rely on filesystem sort order)
4. Wrap the concatenation in `<script>…</script>` and write to
   `sidebar_js.html`

`npm run build` must invoke `build_client.js` **before** `tsc` (server build),
so the freshly-generated `sidebar_js.html` is copied to `dist/` by the
server build's asset-copy step.

```json
// package.json
"build": "node scripts/build_client.js && rm -rf dist && tsc && ..."
```

`dist_client/` must be in `.gitignore`. `sidebar_js.html` is a **generated
build artifact** but is committed because clasp needs it in the project root.

---

## 5. `tsconfig.client.json` Required Settings

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "none",
    "rootDir": "client",
    "outDir": "dist_client",
    "strict": false,
    "noImplicitAny": false,
    "noEmitOnError": true,
    "skipLibCheck": true,
    "lib": ["ES2020", "DOM"]
  },
  "include": ["client/**/*.ts"],
  "exclude": ["node_modules", "dist", "dist_client", "src"]
}
```

- `"module": "none"` — same as the server build. Functions defined at
  module top-level are globals, matching HTML `onclick="fn()"` handlers.
- `"noEmitOnError": true` — the build must fail on type errors so the
  gate is meaningful.
- Do **not** add `"types": ["google-apps-script"]` — GAS types must not
  leak into the browser compilation.

---

## 6. Client File Naming and Load Order

Name client modules with a numeric prefix so `FILE_ORDER` in
`build_client.js` is easy to maintain:

```
client/
├── gas-client.d.ts        ← browser ambients (not compiled to JS)
├── server-types.d.ts      ← shared contract (not compiled to JS)
├── 01-helpers.ts          ← utilities, runServer()
├── 02-*.ts … 09-*.ts     ← feature modules
├── tts/
│   ├── 01-*.ts … 08-*.ts ← TTS-specific modules
└── 10-dialog.ts           ← last (runs at startup)
```

`FILE_ORDER` in `build_client.js` is the authoritative load order. When
adding a new source file:
1. Create the file with the next available numeric prefix
2. Add its compiled path to `FILE_ORDER` at the correct position
3. Run `npm run build` to verify

---

## 7. `runServer` — Canonical Type Signature

The `runServer` helper wraps `google.script.run` in a Promise. Its TypeScript
signature must be:

```typescript
function runServer(fnName: string, ...args: any[]): Promise<any>
```

This is declared as `declare function runServer(...)` in `gas-client.d.ts`
so all client modules can call it without importing. The implementation lives
in `client/01-helpers.ts`.

**Do not** use the `arguments` object inside the implementation — use rest
parameters so the signature and body agree:

```typescript
function runServer(fnName: string, ...args: any[]): Promise<any> {
  return new Promise(function(resolve, reject) {
    var call = google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler(reject);
    (call as any)[fnName].apply(call, args);
  });
}
```

---

## 8. Adding a New `google.script.run` Call

When a new server function is added:
1. Add its return type to `client/server-types.d.ts` (if not already there)
2. Call it via `runServer('functionName', arg1, arg2)` on the client — no
   direct `google.script.run.functionName()` calls outside `01-helpers.ts`
3. Add the server function's parameter and return types to `src/Types.ts` if
   they are server-only, or to `client/server-types.d.ts` if they cross the
   boundary
4. Run `npm run build:all` — both compilations must pass

---

## 9. Incremental DOM Typing

The pragmatic `HTMLElement` / `Element` extensions in `gas-client.d.ts`
(`.value`, `.checked`, `.disabled`, etc.) are intentional scaffolding for
the initial migration. When editing a client module, prefer tightening DOM
access in that module:

```typescript
// Before (scaffolded — compiles but not precise)
var val = document.getElementById('my-input').value;

// After (precise — tighten as you touch the code)
var val = (document.getElementById('my-input') as HTMLInputElement).value;
```

Do not remove the `HTMLElement` extensions from `gas-client.d.ts` until all
call sites in that extension's property have been tightened.
