# EditorLLM — Architecture & Design

## 1. Project Overview

EditorLLM is an AI-augmented book editing workspace that runs as a Google Apps Script add-on bound to a Google Doc. It provides a sidebar UI within Google Docs that orchestrates multiple AI agents — each specialising in a different editorial task — powered by Google's Gemini API.

The system is designed for high-fidelity manuscript editing, where a set of specialised agents analyse, audit, and refine prose while respecting the author's established voice, axioms, and structural patterns.

### Key capabilities

- **Multi-agent comment routing** — users tag comment threads with `@AI`, `@architect`, `@eartune`, `@stylist`, `@audit`, or `@auditor`; each thread is automatically dispatched to the appropriate agent.
- **StyleProfile generation** — the Structural Architect analyses the full manuscript and produces a binding style guide that constrains all other agents.
- **Ear-Tune editing** — the Audio Stylist proposes rhythmic, spoken-word-optimised rewrites.
- **Technical auditing** — the Logical Auditor checks axiom consistency, LaTeX captions, and physical constants.
- **Tab management** — automated creation of standard tabs, tab merging, and content routing between tabs.
- **Configurable models** — three Gemini model tiers (fast, thinking, deepseek) stored in script properties and configurable from the sidebar.

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Google Apps Script (V8 engine) |
| Language | TypeScript (`module: "none"`, flat global scope) |
| AI Backend | Gemini API (v1beta) via `UrlFetchApp` |
| Document API | `DocumentApp` (cached) + Docs Advanced Service REST API (live) |
| Drive API | Drive Advanced Service (comments, replies) |
| Build | `tsc` → `eslint` → `jest` |
| Deploy | `clasp push` (staging) / `clasp deploy` (production) |
| Package Manager | npm |

### Critical constraint: `module: "none"`

All TypeScript source files compile to a flat global scope. There are **no `import` or `export` statements** anywhere in the codebase. All types, classes, constants, and IIFE modules are globally available after compilation. This is a hard requirement of the Google Apps Script runtime.

---

## 3. Repository Structure

```
EditorLLM/
├── src/                          # TypeScript source
│   ├── Types.ts                  # Shared interfaces, constants, enums
│   ├── Prompts.ts                # System prompts for each agent
│   ├── StringProcessor.ts        # String utility (createStringArray)
│   ├── GeminiService.ts          # Gemini API wrapper (IIFE module)
│   ├── DocOps.ts                 # Document/tab management (IIFE module)
│   ├── CollaborationService.ts   # Matching, highlighting, commenting (IIFE module)
│   ├── BaseAgent.ts              # Abstract base class with registry
│   ├── ArchitectAgent.ts         # Structural Architect agent
│   ├── StylistAgent.ts           # Audio Stylist agent
│   ├── AuditAgent.ts             # Logical Auditor agent
│   ├── CommentAgent.ts           # @AI catch-all comment handler
│   ├── CommentProcessor.ts       # Comment routing orchestrator (IIFE module)
│   ├── TabMerger.ts              # Tab merge utility (IIFE module)
│   ├── Code.ts                   # Entry point, menu, server functions
│   └── __tests__/
│       ├── sanity.test.ts        # Type shape and constant integrity
│       ├── features.test.ts      # Feature-level (StringProcessor, TabMerger, result shapes)
│       ├── collaboration.test.ts # CollaborationService matching/annotation logic
│       └── agents.test.ts        # Agent prompts, thread parsing, routing, schemas
├── Sidebar.html                  # Main sidebar template
├── sidebar_css.html              # Sidebar styles (included via server-side template)
├── sidebar_js.html               # Sidebar client-side JavaScript
├── ModalDialog.html              # Configure dialog for agents
├── appsscript.json               # GAS manifest (scopes, advanced services)
├── .clasp.json                   # clasp binding (scriptId, filePushOrder)
├── tsconfig.json                 # TypeScript config
├── package.json                  # npm scripts and devDependencies
├── jest.config.cjs               # Jest configuration
├── jest.setup.js                 # GAS global mocks for test environment
├── eslint.config.mjs             # ESLint configuration
├── deploy.sh                     # Staging deploy script
├── deploy_prod.sh                # Production deploy script
├── initclasp.sh                  # One-time clasp setup
├── dist/                         # Compiled output (rootDir for clasp)
└── docs/
    └── design.md                 # This document
```

---

## 4. File Load Order

Because GAS evaluates files sequentially in a flat scope, the order matters. `.clasp.json` defines `filePushOrder`:

1. `Types.js` — shared interfaces, constants
2. `Prompts.js` — system prompts (references `SYSTEM_PREAMBLE`)
3. `StringProcessor.js` — pure utility function
4. `GeminiService.js` — Gemini API wrapper (references `MODEL`, `MODEL_PROP_KEYS`, `DEFAULT_MODELS`)
5. `DocOps.js` — document operations (references `TAB_NAMES`)
6. `CollaborationService.js` — highlighting/commenting (references `DocOps`, `HIGHLIGHT_COLOR`)
7. `BaseAgent.js` — abstract base class (references `GeminiService`, `DocOps`, `MODEL`)
8. `ArchitectAgent.js` — extends `BaseAgent` (references `ARCHITECT_SYSTEM_PROMPT`)
9. `StylistAgent.js` — extends `BaseAgent`
10. `AuditAgent.js` — extends `BaseAgent`
11. `CommentAgent.js` — extends `BaseAgent`
12. `TabMerger.js` — tab merge utility (references `DocOps`, `TAB_NAMES`)
13. `CommentProcessor.js` — routing orchestrator (references `BaseAgent`, `DocOps`, `COMMENT_ANCHOR_TAB`)
14. `Code.js` — entry point (instantiates agents, initialises `CommentProcessor`)

Any new file must be inserted in the correct dependency position.

---

## 5. Design Patterns

### 5.1 IIFE Module Pattern

Stateless service modules use the Immediately Invoked Function Expression pattern to encapsulate private state while exposing a public API on a global `const`:

```typescript
const ServiceName = (() => {
  // private state and helpers (suffix with _)
  function privateHelper_(): void { ... }

  // public API
  function publicMethod(): string { ... }

  return { publicMethod };
})();
```

Used by: `GeminiService`, `DocOps`, `CollaborationService`, `TabMerger`, `CommentProcessor`.

### 5.2 Abstract Base Class + Static Registry

`BaseAgent` is an abstract class providing shared infrastructure:

- **Tab content cache** (`getTabContent_` / `clearCache`) — avoids redundant `DocumentApp` reads within a single execution.
- **Gemini call wrapper** (`callGemini_`) — delegates to `GeminiService.generateJson` with structured logging of tier, prompt previews, and timing.
- **RootUpdate schema** (`rootUpdateSchema_`) — the JSON schema shared by all agents that produce document updates.
- **Comment thread logger** (`logCommentThread_`) — structured logging of thread context at dispatch time.
- **Static registry** — every agent self-registers in the constructor. `BaseAgent.getAllAgents()` and `BaseAgent.clearAllAgentCaches()` eliminate the need for explicit agent lists.

Every concrete agent implements five abstract members:

| Member | Purpose |
|---|---|
| `tags: string[]` | Lowercase routing tags (e.g. `['@eartune', '@stylist']`) |
| `contextKeys: string[]` | Tab names needed for comment processing (pre-flight validation) |
| `handleCommentThread(thread)` | Workflow 3: reply to a comment thread; return a `ThreadReply`. No doc changes. |
| `generateInstructions()` | Workflow 1: refresh the agent's system prompt tab via `instruction_update` |
| `generateExample()` | Write example content to the agent's tabs |

Note also that `annotateTab(tabName)` is a concrete method on StylistAgent and AuditAgent (workflow 2) — not an abstract BaseAgent method.

### 5.3 Tag-Based Comment Routing

`CommentProcessor` is the orchestration layer between Drive comments and agents:

1. **`init(roster)`** — builds a `tag → agent` registry from each agent's `tags` array.
2. **`processAll()`** — fetches all Drive comments (with pagination), parses each into a `CommentThread`, looks up the tag in the registry, validates required tabs, dispatches to the agent, and posts the reply.

The tag is extracted from the **last message** in a thread — this means a user can redirect a thread to a different agent mid-conversation.

### 5.4 Dual-API Tab Management

`DocOps` uses two APIs with different trade-offs:

| API | Speed | Freshness | Use case |
|---|---|---|---|
| `DocumentApp` | Fast (cached at script start) | Stale for tabs created in the same run | Reading tab content, checking existence |
| Docs REST API (`Docs.Documents.batchUpdate`) | Slower (live) | Always fresh | Creating tabs, fetching tab registry |

`fetchTabRegistry_()` uses a `fields` mask to fetch only tab metadata (no body content), keeping the REST call fast regardless of document size.

### 5.5 Three Workflow Types

All agent actions route through one of three workflows:

**Workflow 1 — `instruction_update`** (triggered by "Generate" sidebar buttons)
Agents call `generateInstructions()`. Gemini returns `proposed_full_text` + `operations`.
The agent assembles a `RootUpdate` with `workflow_type = 'instruction_update'` and `review_tab`,
then calls `CollaborationService.processUpdate()`. CollaborationService creates a `"<review_tab> Scratch"`
tab, writes the proposed text, and highlights + comments each operation.

**Workflow 2 — `content_annotation`** (triggered by "Ear-Tune" / "Audit" sidebar buttons)
Agents call `annotateTab(tabName)`. Gemini returns `operations` only. The agent assembles a
`RootUpdate` with `workflow_type = 'content_annotation'` and `target_tab`, then calls
`CollaborationService.processUpdate()`. CollaborationService first clears previous agent
comments on the tab (identified by the `[EditorLLM]` prefix), then highlights and comments
each operation — **no text replacement**.

**Workflow 3 — comment thread reply** (triggered by `CommentProcessor`)
Agents implement `handleCommentThread(thread)`. Gemini returns `{ reply: string }`. The agent
returns a `ThreadReply` which `CommentProcessor` posts as a Drive reply on the original thread.
No document changes occur.

`CollaborationService.processUpdate()` routes `instruction_update` and `content_annotation`;
workflow 3 does not go through `CollaborationService`.

**Agent comment prefix**: Every Drive comment created by an agent is prefixed with
`AGENT_COMMENT_PREFIX = '[EditorLLM] '`. This allows `content_annotation` runs to
selectively delete only agent-added comments when re-annotating a tab, preserving
user-added comments.

### 5.6 Model Tier System

Three configurable tiers map to Gemini model names stored in script properties:

| Tier | Constant | Default | Used by |
|---|---|---|---|
| `fast` | `MODEL.FAST` | `gemini-2.0-flash` | CommentAgent, StylistAgent |
| `thinking` | `MODEL.THINKING` | `gemini-2.5-pro-preview-03-25` | ArchitectAgent, AuditAgent |
| `deepseek` | `MODEL.DEEPSEEK` | `gemini-2.0-flash-thinking-exp-01-21` | Available for future agents |

Models are resolved at call time via `GeminiService.resolveModel_(tier)`: script properties first, then `DEFAULT_MODELS` fallback. The `thinking` tier adds a `thinkingConfig` with a `thinkingBudget` to the Gemini payload.

---

## 6. Data Flow

### Comment Processing Flow

```
User writes "@eartune Smooth this rhythm" as a comment on selected text
                          │
                          ▼
    CommentProcessor.processAll()
         │
         ├── Drive.Comments.list (paginated)
         │
         ├── buildThread_() per comment
         │     └── extract tag, agentRequest, selectedText, conversation
         │     └── resolveAnchorTabName_() if agent needs COMMENT_ANCHOR_TAB
         │
         ├── tag registry lookup → StylistAgent
         │
         ├── validateRequiredTabs_() (advisory logging)
         │
         ├── agent.handleCommentThread(thread)
         │     ├── reads StyleProfile, EarTune tabs
         │     ├── builds prompt with context + selected text + request
         │     ├── callGemini_() → { reply: string }
         │     └── returns ThreadReply with Gemini reply content
         │
         └── postReply_() → Drive.Replies.create
```

### Instruction Generation Flow

```
User clicks "Generate" on Structural Architect card
                          │
                          ▼
    architectGenerateInstructions()
         │
         ├── BaseAgent.clearAllAgentCaches()
         │
         ├── architectAgent.generateInstructions()
         │     ├── reads MergedContent tab
         │     ├── builds prompt asking for StyleProfile
         │     ├── callGemini_() → RootUpdate (instruction_update)
         │     └── CollaborationService.processUpdate()
         │           ├── creates "StyleProfile Scratch" tab
         │           ├── writes proposed_full_text
         │           └── highlights + comments each operation
         │
         └── User reviews Scratch tab, accepts/rejects changes
```

---

## 7. Standard Tab Layout

| Tab Name | Parent | Purpose |
|---|---|---|
| `MergedContent` | (root) | Unified manuscript text, merged from chapter tabs |
| `Agentic Instructions` | (root) | Parent tab for all agent configuration |
| `StyleProfile` | Agentic Instructions | Generated style guide constraining all agents |
| `EarTune` | Agentic Instructions | Ear-Tune system prompt for the Audio Stylist |
| `TechnicalAudit` | Agentic Instructions | Audit rules for the Logical Auditor |
| `Comment Instructions` | Agentic Instructions | System prompt for the `@AI` comment responder |

Created by `DocOps.ensureStandardTabs()` on first run.

---

## 8. Testing Strategy

Tests run in Node.js via Jest — no GAS runtime required.

### Test categories

| Suite | File | Focus |
|---|---|---|
| Sanity | `sanity.test.ts` | Type shapes, constant values, enum integrity |
| Features | `features.test.ts` | StringProcessor, TabMerger result shapes, processAll result shape |
| Collaboration | `collaboration.test.ts` | findTextOrFallback matching, RootUpdate validation |
| Agents | `agents.test.ts` | Thread parsing, tag routing, prompt structure, schema shape, processAll flow, Drive API conventions |

### Testing approach

Because `module: "none"` means source files cannot be imported, tests **reproduce logic inline** and rely on TypeScript compile-time checking against the real declarations. Runtime values from the source are never `require`d — the test mirrors the expected shape and TypeScript's type system catches drift.

GAS globals (`DocumentApp`, `Drive`, `PropertiesService`, etc.) are mocked in `jest.setup.js`.

---

## 9. Build, Lint, Test, Deploy

### npm scripts

| Script | What it does |
|---|---|
| `build` | `tsc` → copies `appsscript.json` and `*.html` to `dist/` |
| `lint` | `eslint src/**/*.ts` |
| `test` | `jest` |
| `build:all` | `build` → `lint` → `test` (the quality gate) |
| `deploy:staging` | `build:all` → `clasp push` |
| `deploy:prod` | `build:all` → `clasp deploy` (versioned) |

### Deployment scripts

- **`deploy.sh`** — staging deploy with `--skip-tests` escape hatch. Validates `.clasp.json` and `scriptId` before pushing.
- **`deploy_prod.sh`** — production deploy. Creates an immutable Apps Script version, updates or creates a deployment, and patches `package.json` with the new deployment ID.
- **`initclasp.sh`** — one-time setup: `clasp login`, `clasp create`, moves `.clasp.json` to repo root.

### Golden rule

Every code change must pass `npm run build:all` before being pushed. The staging deploy enforces this automatically.

---

## 10. Configuration & Properties

| Property Store | Key | Purpose |
|---|---|---|
| Script Properties | `GEMINI_API_KEY` | Shared API key (admin-set) |
| Script Properties | `GEMINI_FAST_MODEL` | Configured fast model name |
| Script Properties | `GEMINI_THINKING_MODEL` | Configured thinking model name |
| Script Properties | `GEMINI_DEEPSEEK_MODEL` | Configured deepseek model name |
| User Properties | `GEMINI_API_KEY` | Per-user override API key |
| Document Properties | `mergeTabNames` | Saved comma-separated tab names for merging |

Resolution order for API key: Script Properties → User Properties.
Resolution order for models: Script Properties → `DEFAULT_MODELS` constant.

---

## 11. Logging Strategy

Structured logging uses `Logger.log` throughout (GAS convention). Log lines are prefixed with the class or module name in brackets.

### Key logging points

| Location | What is logged |
|---|---|
| `BaseAgent.callGemini_` | Tier, system prompt preview (100 chars), user prompt preview (200 chars), elapsed time, failures |
| `BaseAgent.getTabContent_` | Warning when a tab is empty or missing |
| `BaseAgent.logCommentThread_` | Thread ID, tag, anchor tab, selected text preview, agent request preview |
| `CommentProcessor.fetchComments_` | Page-by-page counts, total count |
| `CommentProcessor.buildThread_` | Parsed thread details, unrecognised tags |
| `CommentProcessor.processAll` | Skip reasons, dispatch target, final summary with `byAgent` JSON |
| `CommentProcessor.postReply_` | Success/failure per reply |
| `DocOps.fetchTabRegistry_` | Tab count, timing, per-tab title/ID |
| `DocOps.createTabViaApi_` | Title, parent, fallback path, timing |

---

## 12. Adding a New Agent

### Step 1: Create `src/NewAgent.ts`

```typescript
class NewAgent extends BaseAgent {
  readonly tags = ['@newtag'];
  readonly contextKeys = [TAB_NAMES.SOME_TAB];

  handleCommentThread(thread: CommentThread): ThreadReply {
    this.logCommentThread_(thread, 'handleCommentThread');
    // ... build prompt, call callGemini_(), process update
    return { threadId: thread.threadId, content: 'Summary. — AI Editorial Assistant' };
  }

  generateInstructions(): void { /* ... */ }
  generateExample(): void { /* ... */ }
}
```

### Step 2: Add system prompt to `src/Prompts.ts`

```typescript
const NEW_AGENT_SYSTEM_PROMPT = `${SYSTEM_PREAMBLE}\n\nROLE: Your New Agent\n...`;
const NEW_AGENT_EXAMPLE_CONTENT = `# Example content...`;
```

### Step 3: Instantiate in `src/Code.ts`

```typescript
const newAgent = new NewAgent();
// BaseAgent.getAllAgents() auto-includes it — no other init needed.
```

### Step 4: Add to `.clasp.json` `filePushOrder`

Insert `"dist/NewAgent.js"` after `BaseAgent.js` and before `CommentProcessor.js`.

### Step 5: Expose server functions (if the agent has sidebar actions)

```typescript
function newAgentGenerateExample(): void {
  BaseAgent.clearAllAgentCaches();
  newAgent.generateExample();
}
```

### Step 6: Add UI (optional)

Add a card in `Sidebar.html` and corresponding JS handlers in `sidebar_js.html`.

### Step 7: Add tests

- `sanity.test.ts` — tag and contextKeys declarations
- `agents.test.ts` — prompt structure and ThreadReply contract

### What you do NOT touch

`CommentProcessor.ts`, `BaseAgent.ts`, `DocOps.ts`, `GeminiService.ts`, `CollaborationService.ts`, `TabMerger.ts` — all agent-agnostic. The static registry and tag-based routing handle discovery automatically.

---

## 13. Drive & Docs API Reference

### Drive Comments API (v3)

| Operation | Call | Argument Order |
|---|---|---|
| List comments | `Drive.Comments.list(fileId, opts)` | `opts: { includeDeleted, fields, maxResults, pageToken }` |
| Create reply | `Drive.Replies.create(resource, fileId, commentId, opts)` | `resource: { content }`, `opts: { fields }` |
| Create comment | `Drive.Comments.create(resource, fileId, opts)` | `resource: { content, anchor }` |

Response field: `list.comments` (v3) or `list.items` (v2 fallback).

### Docs REST API (v1)

| Operation | Call |
|---|---|
| Create tab | `Docs.Documents.batchUpdate({ requests: [{ addDocumentTab }] }, docId)` |
| Get tab metadata | `Docs.Documents.get(docId, { includeTabsContent: true, fields: 'tabs(tabProperties,childTabs(...))' })` |
| Replace text in tab | `UrlFetchApp.fetch` to `https://docs.googleapis.com/v1/documents/{id}:batchUpdate` with `replaceAllText` + `tabsCriteria` |

The `fields` mask on `Documents.get` is critical for performance — without it, the API returns the full body content of every tab.

---

## 14. Error Handling Patterns

- **Gemini model not found** — `GeminiService.callApi_` catches the error, fetches the live model list via `listGenerateContentModels()`, and includes it in the error message to guide the user.
- **Tab not found** — `DocOps.getTabContent` returns `''` (empty string, never throws). Agents handle empty content gracefully.
- **Drive reply failure** — `CommentProcessor.postReply_` catches and logs but does not rethrow, so one failed reply doesn't abort the entire batch.
- **Agent throws during comment processing** — `CommentProcessor.processAll` catches per-thread, increments `skipped`, and continues to the next thread.
- **Pre-flight tab validation** — `validateRequiredTabs_` is advisory only (logs warnings, never throws). Missing context degrades quality but doesn't crash.

---

## 15. Security & Permissions

- **API key storage** — script properties (shared key, set by admin) take precedence; user properties (per-user override) are the fallback. Keys are never logged.
- **OAuth scopes** — defined in `appsscript.json`. The script uses `drive.file` (not `drive`), `documents.currentonly`, and `script.external_request`.
- **Document IDs** — `TabMerger.sanitizePlatformError_` strips document IDs from error messages before surfacing them in the UI.
