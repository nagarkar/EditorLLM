// ============================================================
// Code.ts — Entry point, menu, and exposed server functions
// ============================================================

// Lazy singletons — classes may not be defined yet when Code.js loads
// (GAS file evaluation order is not guaranteed to follow filePushOrder).
let architectAgent_: ArchitectAgent;
let earTuneAgent_: EarTuneAgent;
let auditAgent_: AuditAgent;
let tetherAgent_: TetherAgent;
let generalPurposeAgent_: GeneralPurposeAgent;

function getArchitectAgent(): ArchitectAgent { return architectAgent_ ??= new ArchitectAgent(); }
function getEarTuneAgent(): EarTuneAgent { return earTuneAgent_ ??= new EarTuneAgent(); }
function getAuditAgent(): AuditAgent { return auditAgent_ ??= new AuditAgent(); }
function getTetherAgent(): TetherAgent { return tetherAgent_ ??= new TetherAgent(); }
function getGeneralPurposeAgent(): GeneralPurposeAgent { return generalPurposeAgent_ ??= new GeneralPurposeAgent(); }



function onOpen(): void {
  Tracer.clearAll();  // wipe stale job pills from prior sessions
  const ui = DocumentApp.getUi();
  ui.createMenu('EditorLLM')
    .addItem('Open Sidebar', 'showSidebar')
    .addSeparator()
    .addSubMenu(ui.createMenu('Architect')
      .addItem('Generate Instructions', 'architectGenerateInstructions')
      .addItem('Process Active Tab', 'architectAnnotateTab'))
    .addSubMenu(ui.createMenu('EarTune')
      .addItem('Generate Instructions', 'earTuneGenerateInstructions')
      .addItem('Process Active Tab', 'earTuneAnnotateTab'))
    .addSubMenu(ui.createMenu('Auditor')
      .addItem('Generate Instructions', 'auditorGenerateInstructions')
      .addItem('Process Active Tab', 'auditorAnnotateTab'))
    .addSubMenu(ui.createMenu('Tether')
      .addItem('Generate Instructions', 'tetherGenerateInstructions')
      .addItem('Process Active Tab', 'tetherAnnotateTab'))
    .addSubMenu(ui.createMenu('General Purpose')
      .addItem('Generate Instructions', 'generalPurposeAgentGenerateInstructions')
      .addItem('Process @AI Comments', 'commentProcessorRun'))
    .addSeparator()
    .addItem('Clear All Annotations', 'clearAllAnnotations')
    .addItem('Clear Active Tab Annotations', 'clearActiveTabAnnotations')
    .addSeparator()
    .addItem('Refresh All Instructions', 'refreshAllInstructionsMenu')
    .addItem('Merge Tabs', 'runMergeTabsMenu')
    .addItem('Copy All Logs', 'copyAllLogsMenu')
    .addToUi();
}

// --------------- Html includes (Sidebar template) ---------------

function include(filename: string): string {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// --------------- Sidebar ---------------

function showSidebar(): void {
  const html = HtmlService.createTemplateFromFile('Sidebar')
    .evaluate()
    .setTitle(Constants.EXTENSION_NAME)
    .setWidth(320);
  DocumentApp.getUi().showSidebar(html);
}

/** Opens the live-log sidebar (replaces any open sidebar). */
function showLogSidebar(): void {
  const html = HtmlService.createHtmlOutputFromFile('LogSidebar')
    .setTitle('EditorLLM Logs')
    .setWidth(320);
  DocumentApp.getUi().showSidebar(html);
}

// --------------- Config Dialogs ---------------

function showApiKeyConfig(): void {
  const html = HtmlService.createHtmlOutputFromFile('ApiKeyDialog')
    .setWidth(340)
    .setHeight(200);
  DocumentApp.getUi().showModalDialog(html, 'Set API Key');
}

// --------------- Server functions exposed to sidebar/dialog ---------------

// API key management
function saveApiKey(key: string): void {
  GeminiService.saveApiKey(key);
}

function hasApiKey(): boolean {
  return GeminiService.hasApiKey();
}

// Model configuration
function listAvailableModels(): string[] {
  return GeminiService.listGenerateContentModels();
}

function getModelConfig(): { fast: string; thinking: string; deepseek: string } {
  return GeminiService.getModelConfig();
}

function saveModelConfig(fast: string, thinking: string, deepseek: string): void {
  GeminiService.saveModelConfig(fast, thinking, deepseek);
}

// ── Generic user-preference helpers ──────────────────────────────────
// All user preferences are stored in UserProperties so they apply to
// the current user across every document they open.
function getUserPref(key: string, defaultVal: string): string {
  return PropertiesService.getUserProperties().getProperty(key) ?? defaultVal;
}
function saveUserPref(key: string, value: string): void {
  PropertiesService.getUserProperties().setProperty(key, value);
}

// ── Highlight Color ───────────────────────────────────────────────────
function getHighlightColor(): string {
  return getUserPref('HIGHLIGHT_COLOR', Constants.HIGHLIGHT_COLOR);
}
function saveHighlightColor(color: string): void {
  saveUserPref('HIGHLIGHT_COLOR', color);
}

// ── Debug Mode (boolean, default ON) ─────────────────────────────────
function getDebugMode(): boolean {
  return getUserPref('DEBUG_MODE', 'true') === 'true';
}
function saveDebugMode(enabled: boolean): void {
  saveUserPref('DEBUG_MODE', String(enabled));
}

// Setup
function setupStandardTabs(): void {
  DocOps.ensureStandardTabs();
}

/**
 * Returns the most-recently-persisted StyleProfile quality score.
 * Written by BaseAgent.evaluateStyleProfile_() after each Architect instruction run.
 * Returns { score: null } when no evaluation has been run yet for this document.
 */
function getStyleProfileScore(): { score: number | null; rationale: string; ts: string } {
  const props = PropertiesService.getDocumentProperties().getProperties();
  const raw = props['STYLE_PROFILE_SCORE'];
  return {
    score:     raw !== undefined ? parseInt(raw, 10) : null,
    rationale: props['STYLE_PROFILE_RATIONALE'] ?? '',
    ts:        props['STYLE_PROFILE_EVAL_TS']   ?? '',
  };
}

// ── Helper: wrap any menu action with job tracking ──────────
function runTrackedJob_(label: string, action: () => void, openSidebar = true): void {
  // Open the log sidebar only when Debug Mode is enabled AND the caller has
  // flagged this job as sidebar-worthy AND a UI context is available.
  // doPost (web app) and time-driven triggers do NOT have a UI context —
  // calling getUi() there throws "Cannot call DocumentApp.getUi() from this context".
  const isDebug = getDebugMode();
  if (openSidebar && isDebug && hasUiContext_()) {
    showLogSidebar();
  }

  // Gate tracing on debug mode.  When debug is OFF we skip startJob() entirely
  // so getActiveJobId_() returns null and every subsequent Tracer.info/warn/error
  // call exits immediately without touching CacheService (~250 ms per call saved).
  if (isDebug) {
    Tracer.startJob(label);
  }
  try {
    action();
    if (isDebug) Tracer.finishJob();
  } catch (e: any) {
    if (isDebug) {
      Tracer.error(`${label} failed: ${e.message}`);
      Tracer.failJob(e.message);
    }
    throw e;
  }
}

// ── Client-side Tracer Exposure ──────────────────────────────
function startJob(label: string): string { return Tracer.startJob(label); }
function finishJob(): void { Tracer.finishJob(); }
function traceInfo(msg: string, jobId?: string): void { Tracer.info(msg, jobId); }
function traceError(msg: string, jobId?: string): void { Tracer.error(msg, jobId); }
function getJobDashboard(): any { return Tracer.getJobDashboard(); }

/**
 * Writes multiple log entries in a single server round-trip.
 * Each entry: { level: 'INFO' | 'WARN' | 'ERROR', msg: string, jobId?: string }
 * Replaces N sequential traceInfo / traceError calls with one batchTrace call,
 * saving ~100–200 ms of GAS round-trip overhead per entry collapsed.
 */
function batchTrace(entries: Array<{ level: string; msg: string; jobId?: string }>): void {
  for (const e of entries) {
    const lvl = (e.level || '').toUpperCase();
    if (lvl === 'ERROR') Tracer.error(e.msg, e.jobId);
    else if (lvl === 'WARN') Tracer.warn(e.msg, e.jobId);
    else Tracer.info(e.msg, e.jobId);
  }
}

/** Returns true when a UI context is available (i.e. not doPost / triggers).
 *  Result is cached — within one GAS execution the context never changes. */
// GAS flat scope: var (not let) so vm.runInContext places it on the sandbox object,
// which allows the test setup to reset it via ctx.uiContextCached_ = undefined.
// Behaviour in GAS runtime is identical to let.
var uiContextCached_: boolean | undefined;
function hasUiContext_(): boolean {
  if (uiContextCached_ !== undefined) return uiContextCached_;
  try {
    DocumentApp.getUi();
    uiContextCached_ = true;
  } catch (_) {
    uiContextCached_ = false;
  }
  return uiContextCached_;
}


function architectGenerateInstructions(): void {
  runTrackedJob_('Architect → Generate Instructions', () => {
    BaseAgent.clearAllAgentCaches();
    getArchitectAgent().generateInstructions();
  });
}

function architectAnnotateTab(tabName?: string): void {
  DocumentApp.getUi().alert('ArchitectAgent does not support full-tab sweeps. It generates the StyleProfile and responds to @architect comments.');
}


function earTuneGenerateInstructions(): void {
  runTrackedJob_('EarTune → Generate Instructions', () => {
    BaseAgent.clearAllAgentCaches();
    getEarTuneAgent().generateInstructions();
  });
}

function earTuneAnnotateTab(tabName?: string): void {
  BaseAgent.clearAllAgentCaches();
  const target = tabName || getActiveTabName();
  runTrackedJob_(`EarTune → "${target || 'active tab'}"`, () => {
    getEarTuneAgent().annotateTab(target as string);
  }, true);
}


function auditorGenerateInstructions(): void {
  runTrackedJob_('Auditor → Generate Instructions', () => {
    BaseAgent.clearAllAgentCaches();
    getAuditAgent().generateInstructions();
  });
}

function auditorAnnotateTab(tabName?: string): void {
  BaseAgent.clearAllAgentCaches();
  const target = tabName || getActiveTabName();
  runTrackedJob_(`Audit → "${target || 'active tab'}"`, () => {
    getAuditAgent().annotateTab(target as string);
  }, true);
}


function tetherGenerateInstructions(): void {
  runTrackedJob_('Tether → Generate Instructions', () => {
    BaseAgent.clearAllAgentCaches();
    getTetherAgent().generateInstructions();
  });
}

function tetherAnnotateTab(tabName?: string): void {
  BaseAgent.clearAllAgentCaches();
  const target = tabName || getActiveTabName();
  runTrackedJob_(`Tether → "${target || 'active tab'}"`, () => {
    getTetherAgent().annotateTab(target as string);
  }, true);
}

// Comment Processor
function commentProcessorRun(): { replied: number; skipped: number; byAgent: Record<string, number> } {
  let result: { replied: number; skipped: number; byAgent: Record<string, number> } = { replied: 0, skipped: 0, byAgent: {} };
  runTrackedJob_('Process @AI Comments', () => {
    BaseAgent.clearAllAgentCaches();
    // Ensure all agents are instantiated before getAllAgents() — lazy singletons
    // won't self-register until their getter is called at least once.
    getArchitectAgent(); getEarTuneAgent(); getAuditAgent(); getTetherAgent(); getGeneralPurposeAgent();
    CommentProcessor.init(BaseAgent.getAllAgents());
    result = CommentProcessor.processAll();
    Tracer.info(`[commentProcessorRun] replied=${result.replied}, skipped=${result.skipped}`);
  }, true);
  return result;
}

function clearAllAnnotations(): void {
  runTrackedJob_('Clear All Annotations', () => {
    BaseAgent.clearAllAgentCaches();
    const tabs = getTabNames();
    const prefixes = [
      '[EarTune]',   // EarTuneAgent  — content_annotation
      '[Auditor]',   // AuditAgent    — content_annotation
      '[Tether]',    // TetherAgent   — content_annotation
      '[Architect]', // ArchitectAgent — instruction_update only (no annotation triples today,
                     //                  but prefix is listed defensively for future changes)
      // '[GeneralPurpose]' intentionally absent: GeneralPurposeAgent only generates
      // instruction_update workflows and comment replies — it never creates the
      // bookmark + highlight + Drive-comment annotation triple. Add it here if that
      // ever changes.
    ];
    Tracer.info(`[clearAllAnnotations] starting: ${tabs.length} tab(s), prefixes=${JSON.stringify(prefixes)}`);

    // Document-wide Drive sweep (tabIds = null) so that agent comments on
    // deleted/renamed tabs — whose IDs are no longer in the registry — are
    // also removed. clearAgentAnnotationsBulk also handles named-range and
    // bookmark cleanup per annotation, and invokes the color-sweep fallback
    // internally for any old-style annotations it encounters.
    CollaborationService.clearAgentAnnotationsBulk(null, prefixes);

    // Safety-net color sweep: catches any orphaned highlights that have no
    // corresponding Drive comment (e.g. annotation step 3 succeeded but the
    // comment was later deleted externally). This is intentional and expected
    // for "Clear All" — it is not the same as the fallback warn path inside
    // clearAgentAnnotationsBulk.
    for (const tabName of tabs) {
      if (!CollaborationService.clearTabHighlights(tabName)) {
        Tracer.warn(`[clearAllAnnotations] tab "${tabName}" not found during safety sweep`);
      }
    }
    Tracer.info(`[clearAllAnnotations] done`);
  }, true);
}

function clearActiveTabAnnotations(): void {
  runTrackedJob_('Clear Active Tab Annotations', () => {
    const tabName = getActiveTabName();
    if (!tabName) {
      Tracer.warn('[clearActiveTabAnnotations] no active tab detected');
      return;
    }
    const tabId  = DocOps.getTabIdByName(tabName);
    const docTab = DocOps.getTabByName(tabName);
    if (!tabId || !docTab) {
      Tracer.warn(`[clearActiveTabAnnotations] tab "${tabName}" has no ID or could not be resolved`);
      return;
    }
    const prefixes = ['[EarTune]', '[Auditor]', '[Tether]', '[Architect]'];
    Tracer.info(`[clearActiveTabAnnotations] clearing tab "${tabName}" (id=${tabId})`);
    // clearAgentAnnotations handles named-range highlight clearing per annotation
    // and invokes the color-sweep fallback internally for old-style annotations.
    CollaborationService.clearAgentAnnotations(tabId, tabName, docTab, prefixes);
    Tracer.info(`[clearActiveTabAnnotations] done`);
  });
}


/**
 * Menu item: regenerates all agent instructions sequentially within a single
 * tracked job. Order: Architect (StyleProfile first — all others depend on it),
 * then EarTune → Audit → Tether → Comment.
 */
function refreshAllInstructionsMenu(): void {
  runTrackedJob_('Refresh All Instructions', () => {
    BaseAgent.clearAllAgentCaches();
    Tracer.info('[refreshAllInstructionsMenu] Step 1/5: Architect (StyleProfile)');
    getArchitectAgent().generateInstructions();

    BaseAgent.clearAllAgentCaches();
    Tracer.info('[refreshAllInstructionsMenu] Step 2/5: EarTune');
    getEarTuneAgent().generateInstructions();

    BaseAgent.clearAllAgentCaches();
    Tracer.info('[refreshAllInstructionsMenu] Step 3/5: Auditor');
    getAuditAgent().generateInstructions();

    BaseAgent.clearAllAgentCaches();
    Tracer.info('[refreshAllInstructionsMenu] Step 4/5: Tether');
    getTetherAgent().generateInstructions();

    BaseAgent.clearAllAgentCaches();
    Tracer.info('[refreshAllInstructionsMenu] Step 5/5: General Purpose Agent');
    getGeneralPurposeAgent().generateInstructions();

    Tracer.info('[refreshAllInstructionsMenu] All instructions refreshed.');
  });
}

/**
 * Menu item: merges the saved tab list into MergedContent.
 * If no tab names have been saved yet, shows the same error as the sidebar.
 */
function runMergeTabsMenu(): void {
  const names = TabMerger.getSavedTabNames();
  if (!names.length) {
    DocumentApp.getUi().alert('Enter at least one tab name to merge.');
    return;
  }
  runTrackedJob_(`Merge Tabs (${names.length})`, () => {
    Tracer.info(`[runMergeTabsMenu] Merging ${names.length} tab(s): ${JSON.stringify(names)}`);
    const result = TabMerger.mergeAllTabs(names);
    if (result.errors.length) {
      Tracer.error(`[runMergeTabsMenu] Merge errors: ${result.errors.join('; ')}`);
    }
    Tracer.info(`[runMergeTabsMenu] Merged ${result.successes}/${names.length} tab(s) into MergedContent.`);
    if (!result.ok) {
      throw new Error(`Merge completed with ${result.errors.length} error(s): ${result.errors.join('; ')}`);
    }
  });
}

/**
 * Web app entry point for E2E testing and server-to-server agentic calls.
 *
 * Apps Script's Execution API (scripts.run) does NOT support container-bound
 * scripts. The only way to invoke a bound script from external code is via a
 * web app deployment (Deploy → New deployment → Web app).
 *
 * Supported routes (JSON POST body: { "fn": "<name>", "params": [...] }):
 *
 *   Utility
 *   -------
 *   fn: "commentProcessorRun"      → CommentProcessor.processAll()
 *   fn: "hasApiKey"                → GeminiService.hasApiKey() → boolean
 *   fn: "setScriptProperty"        → set a ScriptProperty key/value (E2E key seeding)
 *   fn: "setupStandardTabs"        → DocOps.ensureStandardTabs() (idempotent)
 *
 *   W2 Annotation (per-tab sweeps)
 *   -------------------------------
 *   fn: "earTuneAnnotateTab"       → EarTuneAgent.annotateTab(tabName)
 *   fn: "annotateSelectedTabs"     → sweep multiple tabs for eartune/audit/tether
 *
 *   W1 Instruction generation
 *   -------------------------
 *   fn: "architectGenerateInstructions"    → ArchitectAgent.generateInstructions()
 *   fn: "earTuneGenerateInstructions"      → EarTuneAgent.generateInstructions()
 *   fn: "auditorGenerateInstructions"      → AuditAgent.generateInstructions()
 *   fn: "tetherGenerateInstructions"       → TetherAgent.generateInstructions()
 *   fn: "generalPurposeAgentGenerateInstructions" → GeneralPurposeAgent.generateInstructions()
 *
 * The web app must be deployed with:
 *   Execute as: Me (chinmay.nagarkar@gmail.com)
 *   Who has access: Anyone with Google account  (or Anyone)
 *
 * The caller must include an Authorization header with a valid Google OAuth2
 * token that has at minimum the `userinfo.email` scope.
 */
function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  let fn = '';
  let params: unknown[] = [];
  try {
    const body = e?.postData?.contents ? JSON.parse(e.postData.contents) : {};
    fn = body.fn ?? '';
    params = body.params ?? [];
  } catch {
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'Invalid JSON body' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  let result: unknown;
  try {
    BaseAgent.clearAllAgentCaches();
    if (fn === 'commentProcessorRun') {
      result = commentProcessorRun();
    } else if (fn === 'hasApiKey') {
      result = GeminiService.hasApiKey();
    } else if (fn === 'setScriptProperty') {
      // Utility for E2E tests: sets a single Script Property.
      // params[0] = key, params[1] = value
      const [propKey, propValue] = params as string[];
      if (!propKey) throw new Error('setScriptProperty: params[0] (key) is required');
      PropertiesService.getScriptProperties().setProperty(propKey, propValue ?? '');
      result = { ok: true };
    } else if (fn === 'setupStandardTabs') {
      // Ensures the full standard tab hierarchy exists (idempotent).
      DocOps.ensureStandardTabs();
      result = { ok: true };
    } else if (fn === 'earTuneAnnotateTab') {
      // Runs a full EarTune sweep on the named tab.
      // Makes one fast-tier Gemini call; results are Drive comments on the tab.
      // params[0] = tabName (must match an existing tab title exactly)
      const [tabName] = params as string[];
      if (!tabName) throw new Error('earTuneAnnotateTab: params[0] (tabName) is required');
      getEarTuneAgent().annotateTab(tabName);
      result = { ok: true };
    } else if (fn === 'architectGenerateInstructions') {
      // W1: regenerates the StyleProfile. All downstream agents depend on this.
      // Called by the sidebar's Full Instruction Refresh chain (step 1, serial).
      architectGenerateInstructions();
      result = { ok: true };
    } else if (fn === 'earTuneGenerateInstructions') {
      // W1: regenerates EarTune instructions from StyleProfile + MergedContent.
      // Runs in parallel with auditor/tether/comment after Architect completes.
      earTuneGenerateInstructions();
      result = { ok: true };
    } else if (fn === 'auditorGenerateInstructions') {
      // W1: regenerates TechnicalAudit instructions from StyleProfile + MergedContent.
      // Runs in parallel with eartune/tether/comment after Architect completes.
      auditorGenerateInstructions();
      result = { ok: true };
    } else if (fn === 'tetherGenerateInstructions') {
      // W1: regenerates TetherInstructions from StyleProfile + MergedContent.
      // Runs in parallel with eartune/audit/comment after Architect completes.
      tetherGenerateInstructions();
      result = { ok: true };
    } else if (fn === 'generalPurposeAgentGenerateInstructions') {
      // W1: regenerates General Purpose Instructions from StyleProfile.
      // Runs in parallel with eartune/audit/tether after Architect completes.
      generalPurposeAgentGenerateInstructions();
      result = { ok: true };
    } else if (fn === 'annotateSelectedTabs') {
      // Runs an annotation sweep over a list of explicit tab names for a given agent.
      // params[0] = agentKey ('eartune' | 'audit' | 'tether')
      // params[1] = tabNames (string[])
      const [agentKey, tabNamesRaw] = params as [string, string[]];
      if (!agentKey) throw new Error('annotateSelectedTabs: params[0] (agentKey) is required');
      const tabNames = Array.isArray(tabNamesRaw) ? tabNamesRaw : [];
      if (!tabNames.length) throw new Error('annotateSelectedTabs: params[1] (tabNames) must be a non-empty array');
      result = annotateSelectedTabs(agentKey, tabNames);
    } else {
      return ContentService
        .createTextOutput(JSON.stringify({ error: `Unknown function: ${fn}` }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    Tracer.error(`[doPost] ${fn} threw: ${msg}`);
    return ContentService
      .createTextOutput(JSON.stringify({ error: msg }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ result }))
    .setMimeType(ContentService.MimeType.JSON);
}


function generalPurposeAgentGenerateInstructions(): void {
  runTrackedJob_('General Purpose → Generate Instructions', () => {
    BaseAgent.clearAllAgentCaches();
    getGeneralPurposeAgent().generateInstructions();
  });
}

/**
 * Sweeps an annotation agent over an explicit list of named tabs.
 * Exposed to the sidebar via google.script.run and to E2E tests via doPost.
 *
 * agentKey: 'eartune' | 'audit' | 'tether'
 * tabNames: array of tab title strings (must exactly match existing tab titles)
 *
 * Each tab is processed sequentially; per-tab errors are caught and collected
 * rather than aborting the entire sweep. The overall tracked job succeeds even
 * on partial errors — callers should check the returned errors array.
 */
function annotateSelectedTabs(
  agentKey: string,
  tabNames: string[]
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  type AnnotatingAgent = { annotateTab: (name: string) => void };
  const agentGetters: Record<string, () => AnnotatingAgent> = {
    eartune: getEarTuneAgent as () => AnnotatingAgent,
    audit:   getAuditAgent   as () => AnnotatingAgent,
    tether:  getTetherAgent  as () => AnnotatingAgent,
  };
  const agentGetter = agentGetters[agentKey];
  if (!agentGetter) throw new Error(`annotateSelectedTabs: unknown agentKey "${agentKey}"`);

  const label = `${agentKey} → ${tabNames.length} tab(s)`;
  runTrackedJob_(label, () => {
    const agent = agentGetter();
    for (const name of tabNames) {
      try {
        Tracer.info(`[annotateSelectedTabs] sweeping "${name}" with ${agentKey}`);
        agent.annotateTab(name);
        BaseAgent.clearAllAgentCaches();
      } catch (e: any) {
        const msg = `"${name}": ${e.message}`;
        Tracer.error(`[annotateSelectedTabs] ${msg}`);
        errors.push(msg);
      }
    }
  });

  return { ok: errors.length === 0, errors };
}

// --------------- Live-log sidebar server functions ---------------

/** Returns log entries for a specific job with seq > sinceSeq. */
function getLogsSince(jobId: string, sinceSeq: number): LogEntry[] {
  return Tracer.getLogs(jobId, sinceSeq);
}

/** Returns the status of a specific job. */
function getJobStatus(jobId: string): { label: string; done: boolean; error: string | null } {
  return Tracer.getJobStatus(jobId);
}

/** Returns all tracked jobs (newest first) for the sidebar job picker. */
function getJobList(): JobMeta[] {
  return Tracer.getJobList();
}

/** Returns all log entries from every tracked job this session (for "copy all" in sidebars). */
function getAllSessionLogs(): LogEntry[] {
  return Tracer.getAllLogs();
}

/**
 * Removes all completed (done) jobs from the registry.
 * A job is "completed" when its status is done=true (success or error).
 * Returns the remaining job list.
 */
function removeCompletedJobs(): JobMeta[] {
  const dashboard = Tracer.getJobDashboard();
  const completedIds = dashboard
    .filter(j => j.done)
    .map(j => j.id);
  if (completedIds.length === 0) return Tracer.getJobList();
  return Tracer.removeJobs(completedIds);
}

/**
 * Opens a modal dialog showing all session log entries as plain text,
 * ready to be copied. Not a tracked job — just a read-only log viewer.
 */
function copyAllLogsMenu(): void {
  const logs = Tracer.getAllLogs();
  const lines = logs.map(e => `${e.ts}  ${e.level.padEnd(5)}  ${e.msg}`);
  const logText = lines.length
    ? lines.join('\n')
    : '(No log entries in this session.)';
  const template = HtmlService.createTemplateFromFile('CopyLogsDialog');
  (template as any).logText = logText;
  const html = template.evaluate().setWidth(560).setHeight(420);
  DocumentApp.getUi().showModalDialog(html, 'All Session Logs');
}

// Tab Merger
function runMergeAllTabs(tabNames: string[]): { ok: boolean; successes: number; errors: string[] } {
  return TabMerger.mergeAllTabs(tabNames);
}

function getMergeTabNames(): string[] {
  return TabMerger.getSavedTabNames();
}

function saveMergeTabs(csv: string): { ok: boolean } {
  return TabMerger.saveTabNames(csv);
}

/**
 * Returns the title of the tab the user currently has open.
 * Falls back to the first tab if getActiveTab() is not supported or returns null.
 */
function getActiveTabName(): string | null {
  const doc = DocumentApp.getActiveDocument();
  const active = (doc as any).getActiveTab?.();
  if (active) return active.getTitle() as string;
  const tabs = doc.getTabs();
  return tabs.length > 0 ? tabs[0].getTitle() : null;
}

// Tab list (used by sidebar dropdowns)
function getTabNames(): string[] {
  const doc = DocumentApp.getActiveDocument();
  const names: string[] = [];

  function collect(tabs: GoogleAppsScript.Document.Tab[]): void {
    for (const tab of tabs) {
      names.push(tab.getTitle());
      collect(tab.getChildTabs());
    }
  }

  collect(doc.getTabs());
  return names;
}
