// ============================================================
// Code.ts — Entry point, menu, and exposed server functions
// ============================================================

// Lazy singletons — classes may not be defined yet when Code.js loads
// (GAS file evaluation order is not guaranteed to follow filePushOrder).
let architectAgent_: ArchitectAgent;
let earTuneAgent_: EarTuneAgent;
let auditAgent_: AuditAgent;
let tetherAgent_: TetherAgent;
let commentAgent_: CommentAgent;

function getArchitectAgent(): ArchitectAgent { return architectAgent_ ??= new ArchitectAgent(); }
function getEarTuneAgent(): EarTuneAgent { return earTuneAgent_ ??= new EarTuneAgent(); }
function getAuditAgent(): AuditAgent { return auditAgent_ ??= new AuditAgent(); }
function getTetherAgent(): TetherAgent { return tetherAgent_ ??= new TetherAgent(); }
function getCommentAgent(): CommentAgent { return commentAgent_ ??= new CommentAgent(); }



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
    .addSeparator()
    .addItem('Process @AI Comments', 'commentProcessorRun')
    .addItem('Clear Annotations', 'clearAllAnnotations')
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
    .setTitle(EXTENSION_NAME)
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

// Highlight Color Configuration
function getHighlightColor(): string | null {
  return PropertiesService.getUserProperties().getProperty('HIGHLIGHT_COLOR') || HIGHLIGHT_COLOR;
}

function saveHighlightColor(color: string): void {
  PropertiesService.getUserProperties().setProperty('HIGHLIGHT_COLOR', color);
}

// Setup
function setupStandardTabs(): void {
  DocOps.ensureStandardTabs();
}

// ── Helper: wrap any menu action with job tracking ──────────
function runTrackedJob_(label: string, action: () => void, openSidebar = true): void {
  Tracer.startJob(label);
  if (openSidebar) showLogSidebar();
  try {
    action();
    Tracer.finishJob();
  } catch (e: any) {
    Tracer.error(`${label} failed: ${e.message}`);
    Tracer.failJob(e.message);
    throw e;
  }
}

// Architect
function architectGenerateExample(): void {
  runTrackedJob_('Architect → Generate Example', () => {
    BaseAgent.clearAllAgentCaches();
    getArchitectAgent().generateExample();
  });
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

// EARTUNE
function earTuneGenerateExample(): void {
  runTrackedJob_('EarTune → Generate Example', () => {
    BaseAgent.clearAllAgentCaches();
    getEarTuneAgent().generateExample();
  });
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

// Auditor
function auditorGenerateExample(): void {
  runTrackedJob_('Auditor → Generate Example', () => {
    BaseAgent.clearAllAgentCaches();
    getAuditAgent().generateExample();
  });
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

// Tether
function tetherGenerateExample(): void {
  runTrackedJob_('Tether → Generate Example', () => {
    BaseAgent.clearAllAgentCaches();
    getTetherAgent().generateExample();
  });
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
    const prefixes = ['[Architect]', '[EarTune]', '[Auditor]', '[Tether]', '[EditorLLM] '];
    Tracer.info(`[clearAllAnnotations] starting: ${tabs.length} tab(s), prefixes=${JSON.stringify(prefixes)}`);

    for (const tabName of tabs) {
      const tabId = DocOps.getTabIdByName(tabName);
      if (!tabId) {
        Tracer.warn(`[clearAllAnnotations] tab "${tabName}" has no ID — skipping`);
        continue;
      }
      Tracer.info(`[clearAllAnnotations] clearing tab "${tabName}" (id=${tabId})`);
      CollaborationService.clearAgentAnnotations(tabId, prefixes);
      CollaborationService.clearTabHighlights(tabName);
    }
    Tracer.info(`[clearAllAnnotations] done`);
  }, true);
}


/**
 * Web app entry point for E2E testing.
 *
 * Apps Script's Execution API (scripts.run) does NOT support container-bound
 * scripts. The only way to invoke a bound script from external code is via a
 * web app deployment (Deploy → New deployment → Web app).
 *
 * Supported routes (JSON POST body: { "fn": "<name>", "params": [...] }):
 *   fn: "commentProcessorRun"  → runs CommentProcessor.processAll()
 *   fn: "hasApiKey"            → returns true/false
 *
 * The web app must be deployed with:
 *   Execute as: Me (chinmay.nagarkar@gmail.com)
 *   Who has access: Anyone with Google account  (or Anyone)
 *
 * The caller must include an Authorization header with a valid Google OAuth2
 * token that has at minimum the `userinfo.email` scope. The function itself
 * runs with the script owner's credentials regardless of the caller's identity.
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
    } else if (fn === 'architectGenerateExample') {
      // Seeds MergedContent (if empty) and StyleProfile with example content.
      // No Gemini call — writes hardcoded ARCHITECT_EXAMPLE_CONTENT.
      getArchitectAgent().generateExample();
      result = { ok: true };
    } else if (fn === 'earTuneGenerateExample') {
      // Seeds the EarTune tab with example instructions.
      // No Gemini call — writes hardcoded EARTUNE_EXAMPLE_CONTENT.
      getEarTuneAgent().generateExample();
      result = { ok: true };
    } else if (fn === 'earTuneAnnotateTab') {
      // Runs a full EarTune sweep on the named tab.
      // Makes one fast-tier Gemini call; results are Drive comments on the tab.
      // params[0] = tabName (must match an existing tab title exactly)
      const [tabName] = params as string[];
      if (!tabName) throw new Error('earTuneAnnotateTab: params[0] (tabName) is required');
      getEarTuneAgent().annotateTab(tabName);
      result = { ok: true };
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

function commentAgentGenerateExample(): void {
  runTrackedJob_('Comment Agent → Generate Example', () => {
    BaseAgent.clearAllAgentCaches();
    getCommentAgent().generateExample();
  });
}

function commentAgentGenerateInstructions(): void {
  runTrackedJob_('Comment Agent → Generate Instructions', () => {
    BaseAgent.clearAllAgentCaches();
    getCommentAgent().generateInstructions();
  });
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
