# EditorLLM

AI-augmented book editing workspace for Google Docs. Runs as a Google Apps Script add-on, providing a sidebar with four editorial agents — Architect, Stylist, Auditor, and Comment — each backed by the Gemini API.

---

## Prerequisites

| Tool | Version | Required for | Install |
|------|---------|-------------|---------|
| Node.js | ≥ 18 | everything | https://nodejs.org |
| npm | ≥ 9 | everything | bundled with Node |
| clasp | ≥ 2.4 | deployment | `npm install -g @google/clasp` |
| gcloud | any | Drive/Docs integration tests | https://cloud.google.com/sdk/docs/install |
| Google account | — | deployment + integration tests | — |

Install project dependencies once after cloning:

```bash
npm install
```

---

## Environment variables

### Unit tests (`npm test`)

No environment variables required. All GAS globals are mocked.

### Integration tests (`npm run test:integration`)

Integration tests make real Gemini API calls and need credentials. Run the interactive setup script once:

```bash
bash src/__tests__/integration/setup-test-env.sh
```

The script asks for:

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | **Yes** | Gemini API key. Get one at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey). |
| `GOOGLE_DOC_ID` | For Drive tests | ID of the test Google Doc. Found in the doc URL: `docs.google.com/document/d/<THIS_PART>/edit`. |
| `GOOGLE_TOKEN` | Auto | Never set manually. Fetched from `gcloud` automatically at test startup. See gcloud setup below. |

#### gcloud setup (one time, required for Drive/Docs tests)

`GOOGLE_TOKEN` is fetched automatically from gcloud each time tests run, so it never expires from your point of view. The one-time setup:

**1. Install gcloud**

```bash
# macOS (Homebrew)
brew install --cask google-cloud-sdk

# or download directly
# https://cloud.google.com/sdk/docs/install
```

**2. Create a custom OAuth 2.0 client** (required — Google blocks the default gcloud client for Drive/Docs/Script scopes)

> **Why a custom client?** Running `gcloud auth application-default login` with Drive or Docs scopes using the built-in gcloud client ID gives "This app is blocked" in the browser. You must use your own OAuth 2.0 Desktop App client registered in your GCP project.

Steps:
1. Go to [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials) in your GCP project.
2. Click **Create Credentials → OAuth client ID**.
3. Application type: **Desktop app**. Name it anything (e.g. `EditorLLM local`).
4. Click **Create**, then **Download JSON**.
5. Save the file to `$HOME/.config/gcloud/editorllm-oauth-client.json`.

**3. Authenticate with Drive, Docs, and Script scopes**

```bash
gcloud auth application-default login \
  --client-id-file="$HOME/.config/gcloud/editorllm-oauth-client.json" \
  --scopes="https://www.googleapis.com/auth/cloud-platform,\
            https://www.googleapis.com/auth/drive,\
            https://www.googleapis.com/auth/documents,\
            https://www.googleapis.com/auth/script.external_request,\
            https://www.googleapis.com/auth/script.scriptapp,\
            https://www.googleapis.com/auth/userinfo.email"
```

This opens a browser. Sign in with the Google account that owns the test document.

> **Why `application-default` and not `gcloud auth login --enable-gdrive-access`?**
> `gcloud auth login --enable-gdrive-access` only adds the Drive scope. Integration
> tests also call the Docs REST API, which requires `documents`. The `userinfo.email`
> scope is required by the E2E web app endpoint to verify the caller's identity.
> The `application-default login` command lets you specify exact scopes so all APIs
> work with a single token.

**4. Enable the required APIs** in your GCP project (once, in the console):

- Drive API — `https://console.developers.google.com/apis/api/drive.googleapis.com`
- Docs API — `https://console.developers.google.com/apis/api/docs.googleapis.com`

**5. Ensure the test document has at least one tab**

The E2E test anchors its `@AI` comment to the first tab of `GOOGLE_DOC_ID`. If the document has no tabs, the test setup fails. Open the doc and confirm at least one tab exists.

After this, `npm run test:integration` fetches a fresh token automatically on every run. If gcloud is not installed or not authenticated, the test runner **always stops immediately** with step-by-step fix instructions — regardless of whether `GOOGLE_DOC_ID` is set.

#### E2E test additional setup

> **Why a web app instead of the Apps Script Execution API?**
> The Execution API (`scripts.run`) does not support container-bound scripts — scripts
> attached to a Google Doc/Sheet always return HTTP 404 from that endpoint. EditorLLMTest
> is bound to the test document, so the E2E test instead POSTs to a `doPost()` web app
> endpoint that routes calls to the same production functions.

**One-time web app deployment (first run only)**

1. Run `clasp push` to upload the script.
2. Open the Apps Script editor: `https://script.google.com/d/<SCRIPT_ID>/edit`
3. Click **Deploy → New deployment**.
4. Set **Type** to **Web app**. Configure:
   - **Execute as:** Me *(runs with your credentials)*
   - **Who has access:** Anyone with Google account
5. Click **Deploy** and copy the `/exec` URL.
6. Add it to `.clasp.json`:

```json
"webAppUrl": "https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec"
```

After this, **never repeat the above** — `gas-redeploy.sh` re-points the same deployment to new code automatically on every push (see [Deploy](#deploy)).

**What the E2E test does:**
1. Seeds `GEMINI_API_KEY` from `.env.integration` into Script Properties so the web app can call Gemini.
2. Posts a uniquely-tagged `@AI` comment on the first existing tab of `GOOGLE_DOC_ID`.
3. Calls `commentProcessorRun()` via `doPost()`.
4. Verifies the agent replied with the `[EditorLLM]` prefix and AI Editorial Assistant signature.
5. Deletes the test comment. Document content is never modified.

**Running E2E tests:**

```bash
# All E2E tests
npm run test:e2e

# One test by name pattern (substring match, no redeploy needed)
npm run test:e2e -- -t "multi-thread"
npm run test:e2e -- -t "StylistAgent"
npm run test:e2e -- -t "idempotent"
```

Credentials are saved to `.env.integration` at the project root (gitignored). The integration test runner loads this file automatically — no manual `export` needed.

To update credentials at any time, re-run the setup script. It preserves existing values as defaults.

> **Note on "Force exiting Jest":** after integration tests finish you may see `Force exiting Jest: Have you considered using --detectOpenHandles...`. This is expected — it is the message Jest prints when `forceExit: true` fires to clean up open handles left by the `xmlhttprequest` package. It is not an error.

You can also set variables directly in your shell (shell values take precedence over the file):

```bash
export GEMINI_API_KEY="your-key-here"
npm run test:integration
```

---

## Build

Compiles TypeScript source under `src/` to `dist/` and copies HTML and manifest assets:

```bash
npm run build
```

Output in `dist/` is what gets pushed to Google Apps Script. Never edit `dist/` manually.

---

## Lint

Runs ESLint over all TypeScript source files:

```bash
npm run lint
```

The linter enforces no `import`/`export` statements (required by the GAS flat-scope model) and standard TypeScript rules.

---

## Tests

### Unit tests

Fast, network-free tests with all GAS globals mocked:

```bash
npm test
```

These cover agent logic, collaboration service routing, schema shapes, and type contracts. Run in under 10 seconds.

### Integration tests

Real Gemini API calls — require `GEMINI_API_KEY` to be set (see [Environment variables](#environment-variables) above):

```bash
npm run test:integration
```

Coverage per agent:

| Agent | W1 (generateInstructions) | W2 (annotateTab) | W3 (handleCommentThread) |
|-------|--------------------------|-----------------|--------------------------|
| ArchitectAgent | ✓ 3 tests — thinking model | N/A (no annotateTab) | ✓ 4 tests — thinking model |
| StylistAgent | ✓ 4 tests — fast model | ✓ 5 tests — fast model | ✓ 4 tests — fast model |
| AuditAgent | ✓ 4 tests — thinking model | ✓ 5 tests — thinking model | ✓ 5 tests — thinking model |
| CommentAgent | ✓ 4 tests — fast model | N/A (no annotateTab) | ✓ 6 tests — fast model |

Tests that use the **thinking model** (`gemini-2.5-pro`) have a 120 s timeout per test. Fast model tests have a 60 s timeout. Expect a full integration run to take 5–15 minutes depending on API latency.

#### Running a single integration test file

Pass a filename pattern as a positional argument — Jest matches it against file paths as a regex:

```bash
npx jest --config jest.integration.config.cjs collaboration.integration
npx jest --config jest.integration.config.cjs architect.integration
npx jest --config jest.integration.config.cjs stylist.integration
npx jest --config jest.integration.config.cjs audit.integration
npx jest --config jest.integration.config.cjs commentAgent.integration
```

Or use the full path if you prefer to be explicit:

```bash
npx jest --config jest.integration.config.cjs src/__tests__/integration/collaboration.integration.test.ts
```

#### Running a single unit test file

Same pattern, without the config flag:

```bash
npx jest collaboration
npx jest agents
npx jest sanity
npx jest features
```

#### Running a single test by name

Use `-t` to match a test name (or partial name) within a file:

```bash
# Run only the "clearAgentAnnotations_ — pagination" describe block
npx jest --config jest.integration.config.cjs collaboration.integration -t "pagination"

# Run only the unit test named "preserves user comments"
npx jest collaboration -t "preserves user comments"
```

### Full gate (build + lint + unit tests)

```bash
npm run build:all
```

This is what the deploy scripts run before pushing to GAS.

---

## Deploy

### First-time setup

If this is a fresh clone and the GAS project does not yet exist:

```bash
bash initclasp.sh
```

This authenticates with `clasp`, creates the Apps Script project, and writes `.clasp.json`. If the project already exists (`.clasp.json` is present with a real `scriptId`), skip this step.

To verify clasp is authenticated without deploying anything:

```bash
clasp list
```

### Two-environment model

| Environment | Script ID | Bound document | Purpose |
|-------------|-----------|----------------|---------|
| **Staging** | `1zWDCD44...` (in `.clasp.json`) | Test doc (`171gwEEG...`) | All WIP pushes and integration/E2E testing |
| **Production** | `1B1grAkw...` (in `.clasp.prod.json`) | Real content doc | Stable, versioned releases only |

`deploy.sh` always pushes to the staging script (reads from `.clasp.json`).
`deploy_prod.sh` temporarily swaps `.clasp.json` to `.clasp.prod.json` for the push, then restores it — so your working directory always points at staging.

### Quick iteration — `gas-redeploy.sh`

Use this script whenever GAS source files change and you need to push + verify quickly, without running the full unit/integration test pyramid:

```bash
# Build + push + new version snapshot + update deployment + all E2E tests
./gas-redeploy.sh

# Same, but run only one test (fastest iteration loop)
./gas-redeploy.sh --test "multi-thread"
./gas-redeploy.sh --test "StylistAgent"
./gas-redeploy.sh --test "idempotent"

# Push + redeploy only, skip tests entirely
./gas-redeploy.sh --no-e2e
```

What `gas-redeploy.sh` does on every run:
1. `npm run build` — compile TypeScript → `dist/`
2. `clasp push --force` — upload to Apps Script HEAD
3. `POST /versions` — snapshot HEAD as a new numbered version
4. `GET /deployments/{id}` — fetch current deployment config
5. `PUT /deployments/{id}` — re-point to new version (web app config from `appsscript.json`)
6. Smoke-check the `/exec` URL (HTTP 302 expected)
7. `npm run test:e2e` (or the filtered subset via `--test`)

The `/exec` URL **never changes** — the same URL in `.clasp.json` serves every push.

If you only changed test helpers (`src/__tests__/`) and no GAS code, skip the script entirely:

```bash
npm run test:e2e                      # all E2E tests, no redeploy
npm run test:e2e -- -t "multi-thread" # one test, no redeploy
```

### Full staging pipeline — `deploy.sh`

`deploy.sh` runs the complete test pyramid before pushing. Use it before merging or releasing:

```bash
./deploy.sh
```

Steps in order:

| Step | What runs | Flag to skip |
|------|-----------|-------------|
| 1 | `npm run build:all` — build + lint + unit tests | `--skip-tests` |
| 2 | `npm run test:integration` — real Gemini API | `--skip-integration` |
| 3–7 | `gas-redeploy.sh --skip-build` — push + version + deploy + smoke + E2E | `--skip-e2e` skips E2E |

`--skip-build` is passed automatically so the build from step 1 is not repeated.

```bash
# Skip integration + E2E (only unit tests + push)
./deploy.sh --skip-integration

# Skip E2E only
./deploy.sh --skip-e2e

# Emergency hotfix — no tests, build + push only
./deploy.sh --skip-tests
```

| Scenario | Command |
|----------|---------|
| Changed GAS code, quick check | `./gas-redeploy.sh` |
| Changed GAS code, one failing test | `./gas-redeploy.sh --test "pattern"` |
| Changed test helpers only | `npm run test:e2e -- -t "pattern"` |
| Full staging pipeline | `./deploy.sh` |
| Push without running tests | `./gas-redeploy.sh --no-e2e` |
| Ready to release | `./deploy_prod.sh` |

### Deploy to production (versioned)

Runs the full build gate, pushes to the **production** script, and creates a new versioned deployment:

```bash
bash deploy_prod.sh
```

The deployment ID is read from the `DEPLOYMENT_ID` environment variable or from the `deploy:prod` entry in `package.json`. Use `--dry-run` to preview commands without executing:

```bash
bash deploy_prod.sh --dry-run
```

---

## Project structure

```
├── src/
│   ├── Types.ts                  # Shared interfaces, constants, type aliases
│   ├── Prompts.ts                # System prompts for all agents
│   ├── GeminiService.ts          # Gemini API client (synchronous, JSON output)
│   ├── BaseAgent.ts              # Abstract base: schema builders, context loading
│   ├── ArchitectAgent.ts         # W1 + W3 — style profile and structural review
│   ├── StylistAgent.ts           # W1 + W2 + W3 — ear-tune rhythm annotation
│   ├── AuditAgent.ts             # W1 + W2 + W3 — technical/physics audit
│   ├── CommentAgent.ts           # W1 + W3 — @AI comment thread replies
│   ├── CollaborationService.ts   # Drive comment CRUD, annotation routing
│   ├── CommentProcessor.ts       # Polls Drive comments, routes to agents
│   ├── DocOps.ts                 # Tab read/write helpers
│   ├── MarkdownService.ts        # Markdown rendering helpers
│   ├── StringProcessor.ts        # Text matching utilities
│   ├── TabMerger.ts              # Merges tab content for context
│   └── Code.ts                   # GAS entry point — top-level functions and menu
│
├── src/__tests__/
│   ├── sanity.test.ts            # Type shape and constant integrity checks
│   ├── agents.test.ts            # Agent prompt and schema contract tests
│   ├── collaboration.test.ts     # CollaborationService routing tests
│   ├── features.test.ts          # End-to-end workflow fixture tests
│   ├── markdown.test.ts          # MarkdownService unit tests
│   └── integration/
│       ├── setup-test-env.sh     # Interactive credential setup script
│       ├── config.ts             # Reads GEMINI_API_KEY etc. from process.env
│       ├── fixtures/
│       │   └── testDocument.ts   # Manuscript fixtures with planted defects
│       ├── helpers/
│       │   ├── drive.ts          # Drive/Docs REST API helpers (comments, tabs)
│       │   ├── gas.ts            # web app doPost helper (E2E)
│       │   ├── gemini.ts         # Real Gemini API caller (synchronous XHR)
│       │   ├── prompts.ts        # Prompt builders mirroring agent methods
│       │   └── schemas.ts        # JSON schemas for Gemini response validation
│       ├── architect.integration.test.ts
│       ├── stylist.integration.test.ts
│       ├── audit.integration.test.ts
│       ├── commentAgent.integration.test.ts
│       ├── collaboration.integration.test.ts
│       └── e2e.test.ts           # Full E2E: @AI comment → agent reply via web app doPost()
│
├── Sidebar.html                  # Add-on sidebar markup
├── sidebar_js.html               # Sidebar JavaScript (injected at runtime)
├── appsscript.json               # GAS manifest (copied to dist/ on build)
├── .clasp.json                   # clasp config for staging script (rootDir: dist)
├── .clasp.prod.json              # clasp config for production script (not used by tests)
├── tsconfig.json                 # TypeScript compiler options
├── jest.config.cjs               # Unit test config (excludes integration/)
├── jest.integration.config.cjs   # Integration test config (excludes e2e)
├── jest.e2e.config.cjs           # E2E test config (targets e2e.test.ts only)
├── jest.setup.js                 # GAS mock globals for unit tests
├── jest.integration.setup.js     # GAS mock globals + gcloud token fetch + .env.integration loader
├── .env.integration              # Gitignored credentials (created by setup script)
├── initclasp.sh                  # First-time GAS project setup
├── gas-redeploy.sh               # Quick iteration: build + push + version + redeploy + E2E
├── deploy.sh                     # Full staging pipeline: lint + unit + integration + gas-redeploy.sh
└── deploy_prod.sh                # Production: push to prod script + versioned deployment
```

---

## Three-workflow model

Every agent implements up to three workflows:

| Workflow | Agent method | Trigger | Output |
|----------|-------------|---------|--------|
| **W1** instruction_update | `generateInstructions()` | "Regenerate" button in sidebar → reviews Scratch tab → replaces the agent's Instructions tab | `{ proposed_full_text, operations }` |
| **W2** content_annotation | `annotateTab(tabName)` | "Run" button in sidebar (uses the active tab) | `{ operations }` — adds Drive comments, no text replacement |
| **W3** comment thread reply | `handleCommentThread()` | `@agent` tag in a Drive comment thread | `{ reply }` or `{ response }` (CommentAgent) — reply only, no doc changes |

ArchitectAgent and CommentAgent have no W2 (`annotateTab`). CommentAgent W3 returns `{ response }` instead of `{ reply }`.
