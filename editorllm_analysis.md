# EditorLLM — Deep Scan: Automation Opportunities & Agentic Improvements

> Scan date: 2026-04-13 | Files read: `Code.ts`, `BaseAgent.ts`, `ArchitectAgent.ts`, `EarTuneAgent.ts`, `AuditAgent.ts`, `TetherAgent.ts`, `TabMerger.ts`, `Types.ts`, `CommentProcessor.ts`, `CollaborationService.ts`, `docs/design.md`, `docs/user_manual/main.md`, test suites, `package.json`.

---

## 1. Key Automatable Workflows

### 1.1 ✅ HIGH PRIORITY — Merge + Full Instruction Refresh (Chained)

**Current manual chain (4 hand-clicks minimum):**
```
Edit chapters → Merge → Generate StyleProfile → Generate EarTune Instructions
                                             → Generate Audit Instructions
                                             → Generate Tether Instructions
                                             → Generate Comment Instructions
```

**Problem:** Every time `MergedContent` changes, all dependent instruction tabs
(StyleProfile, EarTune, TechnicalAudit, TetherInstructions, Comment Instructions)
are stale. The user must manually regenerate each one.

**Design:**
- **Merge Now** always chains into Full Instruction Refresh automatically.
- After the merge step completes, the sidebar shows: *"Merge complete. Full Instruction Refresh in progress — see Log Sidebar."*
- The full refresh runs as a tracked job visible in the log sidebar as usual.
- StyleProfile is generated **first** (synchronously, Architect) since all others depend on it.
- Downstream agents (EarTune, Audit, Tether, Comment) run **in parallel** via independent `doPost` calls fired from the sidebar client after the Architect job completes, avoiding browser-side load and GAS per-execution quota.

```typescript
// Server: expose each W1 via doPost route
// fn: 'architectGenerateInstructions' | 'earTuneGenerateInstructions' |
//     'auditorGenerateInstructions'   | 'tetherGenerateInstructions'  |
//     'commentAgentGenerateInstructions'

// Sidebar client (sidebar_js.html) — after Merge Now succeeds:
async function runFullInstructionRefresh() {
  setStatus('Merge complete. Full Instruction Refresh in progress — see Log Sidebar.');
  // Step 1: StyleProfile (all others depend on it)
  await callServer('architectGenerateInstructions');
  // Step 2: Downstream agents — fire in parallel, each is its own GAS execution
  await Promise.all([
    callServer('earTuneGenerateInstructions'),
    callServer('auditorGenerateInstructions'),
    callServer('tetherGenerateInstructions'),
    callServer('commentAgentGenerateInstructions'),
  ]);
  setStatus('Full Instruction Refresh complete.');
}
```

**Why `doPost` for parallel execution:** GAS is single-threaded per execution. By
firing four independent HTTP POST calls from the browser, each gets its own GAS
execution context and quota, giving effective parallelism. Each call updates the
log (Tracer) in CacheService as usual.

---

### 1.2 ✅ MEDIUM PRIORITY — Multi-Tab Annotation Dialog

Currently `earTuneAnnotateTab` / `auditorAnnotateTab` / `tetherAnnotateTab` each
target only the *active* tab. Instead of a "sweep all" button, add a **multi-select
tab dialog** in the sidebar:

- Shows all document tabs as checkboxes.
- Pre-checks tabs from the saved merge list as a sensible default.
- On confirm, iterates the selected tabs sequentially, logging progress per-tab.
- Applies to whichever agent (EarTune / Audit / Tether) triggered the dialog.

```typescript
// Server: new doPost route 'annotateSelectedTabs'
// params[0] = agent ('eartune' | 'audit' | 'tether')
// params[1] = tabNames (string[])
function annotateSelectedTabs(agentKey: string, tabNames: string[]): void {
  const agent = { eartune: getEarTuneAgent, audit: getAuditAgent,
                  tether: getTetherAgent }[agentKey]?.();
  if (!agent) throw new Error(`Unknown agent: ${agentKey}`);
  runTrackedJob_(`${agentKey} → ${tabNames.length} tab(s)`, () => {
    for (const name of tabNames) {
      Tracer.info(`[annotateSelectedTabs] sweeping "${name}"`);
      (agent as any).annotateTab(name);
      BaseAgent.clearAllAgentCaches();
    }
  });
}
```

---

## 2. Architectural Observations

### 2.1 Boilerplate Repetition Across Agents

Every concrete agent repeats the same `handleCommentThreads` loop skeleton:
subgroup by `anchorTabName`, iterate chunks, call Gemini, normalise. This is
~60 lines replicated 4 times. Consider extracting to `BaseAgent`:

```typescript
// BaseAgent
protected handleCommentThreadsBase(
  threads: CommentThread[],
  buildPrompt: (subgroup: CommentThread[], passageContext: string) => string,
  tier: ModelTier,
): ThreadReply[] { /* shared loop */ }
```

Each agent then only implements `buildPrompt` (already done via `generateCommentResponsesPrompt`).

### 2.2 `doPost` Route Coverage Gap

`doPost` supports `earTuneAnnotateTab` and `commentProcessorRun` but **not**:
- `architectGenerateInstructions`
- `auditorGenerateInstructions`
- `tetherGenerateInstructions`
- `runFullRefresh` (when implemented)

For E2E test coverage and external trigger automation, these should be added.

### 2.3 Instruction Tab Read Inconsistency

- `ArchitectAgent.generateInstructions` reads `MergedContent` as **plain text** and `StyleProfile` as **Markdown**.
- `AuditAgent` and `TetherAgent` read `MergedContent` as plain text but slice to only 6,000 chars.
- `EarTuneAgent` reads neither `MergedContent` nor the manuscript — only `StyleProfile` and its own existing instructions.

EarTune instructions never see the manuscript. If the manuscript changes significantly,
EarTune instructions can drift. Feed EarTune the same **20,000 char** excerpt of
`MergedContent` used by the Architect, keeping char limits consistent across all agents.

### 2.4 Missing `generateInstructions` E2E Coverage

Integration tests cover `earTuneAnnotateTab` (W2) and `commentProcessorRun` (W3),
but `generateInstructions` (W1) for Architect, EarTune, Audit, and Tether have
**no E2E test coverage**. This is the most expensive workflow (Thinking tier)
and most likely to silently regress.

### 2.5 StyleProfile is the Single Point of Failure

Every downstream agent — EarTune, Audit, Tether, Comment — reads `StyleProfile`.
If the Architect generates a malformed or empty StyleProfile, all other agents
degrade silently.

**Guard placement: at consumption, not production.** Any agent that reads
`StyleProfile` should validate it on the way in via `getTabMarkdown_` / `getTabContent_`
before building its prompt:

```typescript
// BaseAgent — add a shared helper:
protected assertStyleProfileValid_(content: string): void {
  const h2Count = (content.match(/^## /gm) || []).length;
  if (!content.trim() || h2Count < 3 || content.length < 200) {
    throw new Error(
      '[EditorLLM] StyleProfile appears incomplete (< 3 sections or < 200 chars). '
      + 'Run Architect → Generate Instructions first.'
    );
  }
}
// Each agent calls this after reading StyleProfile:
const styleProfile = this.getTabMarkdown_(TAB_NAMES.STYLE_PROFILE);
this.assertStyleProfileValid_(styleProfile);
```

---

## 3. Test Coverage Analysis

| Suite | Coverage | Gap |
|---|---|---|
| `sanity.test.ts` | TAB_NAMES, MODEL constants, comment tag declarations | Missing `TetherAgent` tag registration check |
| `features.test.ts` | TabMerger shapes, StringProcessor | No test for `getSavedTabNames()` migration shim |
| `collaboration.test.ts` | `findTextOrFallback`, `RootUpdate` validation | No test for `clearAgentAnnotationsBulk` |
| `agents.test.ts` | Prompt structure, routing, batch schema | W1 (`generateInstructions`) prompt shape untested |
| `markdown.test.ts` | `MarkdownService` round-trips | Appears comprehensive |
| `tracer.test.ts` | Tracer log ring, job lifecycle | Comprehensive |
| **Integration** | `earTuneAnnotateTab` W2, EarTune W2, comment W3 | W1 `generateInstructions` for all 4 agents, `setupStandardTabs`, batch clear |

---

## 4. 2025 Agentic AI Best Practices — Applied to EditorLLM

Based on current research into production agentic systems:

### 4.1 Structured Eval & Quality Scoring (High Impact)

**Trend:** LLM-as-judge evaluation loops. After an agent produces output, a
second lightweight model evaluates quality against a rubric.

**EditorLLM application:** After `generateInstructions`, call a fast-tier Gemini
with a simple "score this StyleProfile: does it have Voice, Rhythm, Vocabulary,
Structure, Motif sections? Rate 0-5." Write score to `DocumentProperties`. Surface
in sidebar. Block `runFullRefresh` if score < 3.

### 4.2 Parallel Agent Execution (Medium Impact)

**Trend:** Run independent agents concurrently using async orchestration.

**EditorLLM constraint:** GAS is single-threaded. True parallelism requires splitting
into multiple independent GAS executions via time-based triggers or `ScriptApp.run`.
The Web App (`doPost`) pattern already supports this — each HTTP call is its own execution.

**Practical approach:** After ArchitectAgent finishes (StyleProfile is stable),
fire three separate `doPost` calls from the sidebar's client-side JS:
```javascript
// sidebar_js.html after StyleProfile generation completes:
await Promise.all([
  callServer('earTuneGenerateInstructions'),
  callServer('auditorGenerateInstructions'),
  callServer('tetherGenerateInstructions'),
]);
```
This gives true concurrent I/O with separate GAS execution quotas.

### 4.3 Memory / Context Compression (Medium Impact)

**Trend:** RAG (Retrieval-Augmented Generation) and chunked context compression.

**EditorLLM application:** `MergedContent` is currently read as a monolithic blob,
truncated at 20,000 chars (Architect) or 6,000 chars (Audit/Tether). A **semantic
chunker** could pre-process chapters into a `ChapterIndex` tab: one summary
paragraph per chapter with the most axiom-dense excerpts. This would give agents
much higher coverage of a long manuscript within the same token budget.

### 4.4 Model Context Protocol (MCP) Integration (Future)

**Trend:** MCP is emerging as the standard interface for agents to call external
tools (web search, databases, APIs).

**EditorLLM application:** Tether Agent is a natural fit — it validates external
historical/scientific claims. Giving it a web-search MCP tool would let it
*actually* verify citations rather than relying on Gemini's training-time knowledge.
Implementation: the GAS `doPost` could proxy to an MCP-capable endpoint.

### 4.5 Deterministic Pre/Post Processing Guards (High Impact)

**Trend:** "Treat agents like software, not chatbots" — surround LLM calls with
deterministic validators.

**EditorLLM gaps:**
- `annotationSchema_()` validates that `operations` is an array but not that
  `match_text` has at least 3 words (the agent instruction says "3–4 words").
- `proposed_full_text` for W1 is accepted as-is; no minimum-length or
  well-formedness check before writing to the instruction tab.

Add a `validateAndFilterOperations_()` post-processor in `BaseAgent`.
(`match_text` deduplication can be addressed in a later pass once the above guards are in.)

### 4.6 Human-in-the-Loop Approval Checkpoints (Already Partially Implemented)

The Scratch tab pattern is a solid HITL mechanism. Google Docs' built-in
**Compare documents** tool (`Tools → Compare documents`) covers diff review
adequately without requiring custom implementation.

### 4.7 Observability: Persistent Log Archive

The `Tracer` / CacheService approach is good for real-time viewing but logs
evaporate after 6 hours. At the end of each `runTrackedJob_`, append a timestamped
summary to a **Script Property** log store (or a hidden Document Property string),
then expose it via **EditorLLM → View Log Archive** menu item that opens a modal
with the last N session summaries. No separate tab required.

---

## 5. Quick-Win Summary Table

| Priority | Automation / Improvement | Effort | API Cost |
|---|---|---|---|
| 🔴 High | Merge → auto-chain Full Instruction Refresh | Medium (sidebar + doPost routes) | Thinking × 4 |
| 🔴 High | Parallel downstream instructions via `Promise.all` + `doPost` | Medium | Thinking × 3 |
| 🟡 Medium | Multi-tab annotation dialog (select tabs per agent) | Medium | Fast × N |
| 🟡 Medium | `assertStyleProfileValid_()` guard on agent input | Low | None |
| 🟡 Medium | W1 E2E integration tests for all agents | Medium | Thinking |
| 🟡 Medium | `validateAndFilterOperations_()` guard | Low | None |
| 🟡 Medium | EarTune reads 20K char MergedContent excerpt for instruction gen | Low | Fast |
| 🟢 Low | Persistent Log Archive via menu (`View Log Archive`) | Low | None |
| 🟢 Low | LLM-as-judge quality scoring for instruction generation | Medium | Fast |
| 🟢 Low | Semantic chapter index / RAG-lite for manuscript coverage | High | Fast |
| 🟢 Future | MCP web-search tool for Tether Agent | High | External |
