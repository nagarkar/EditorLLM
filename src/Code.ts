// ============================================================
// Code.ts — Entry point, menu, and exposed server functions
// ============================================================

// Singletons self-register in BaseAgent's constructor; no explicit list needed.
const architectAgent = new ArchitectAgent();
const stylistAgent = new StylistAgent();
const auditAgent = new AuditAgent();
const commentAgent = new CommentAgent();

// Initialise CommentProcessor from the registry rather than repeating the list.
CommentProcessor.init(BaseAgent.getAllAgents());

// --------------- Menu ---------------

function onOpen(): void {
  DocumentApp.getUi()
    .createMenu('EditorLLM')
    .addItem('Open Sidebar', 'showSidebar')
    .addSeparator()
    .addItem('Configure Architect', 'showArchitectConfig')
    .addItem('Configure Stylist', 'showStylistConfig')
    .addItem('Configure Auditor', 'showAuditorConfig')
    .addSeparator()
    .addItem('Process @AI Comments', 'commentProcessorRun')
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

// --------------- Config Dialogs ---------------

function showArchitectConfig(): void {
  showConfigDialog_('architect', 'Structural Architect');
}

function showStylistConfig(): void {
  showConfigDialog_('stylist', 'Audio Stylist');
}

function showAuditorConfig(): void {
  showConfigDialog_('auditor', 'Logical Auditor');
}

function showConfigDialog_(agentKey: string, agentLabel: string): void {
  const html = HtmlService.createHtmlOutputFromFile('ModalDialog')
    .setWidth(480)
    .setHeight(360);
  DocumentApp.getUi()
    .showModalDialog(html, `Configure — ${agentLabel}`);
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

// Setup
function setupStandardTabs(): void {
  DocOps.ensureStandardTabs();
}

// Architect
function architectGenerateExample(): void {
  BaseAgent.clearAllAgentCaches();
  architectAgent.generateExample();
}

function architectGenerateInstructions(): void {
  BaseAgent.clearAllAgentCaches();
  architectAgent.generateInstructions();
}

// Stylist
function stylistGenerateExample(): void {
  BaseAgent.clearAllAgentCaches();
  stylistAgent.generateExample();
}

function stylistGenerateInstructions(): void {
  BaseAgent.clearAllAgentCaches();
  stylistAgent.generateInstructions();
}

function stylistAnnotateTab(tabName: string): void {
  BaseAgent.clearAllAgentCaches();
  stylistAgent.annotateTab(tabName || TAB_NAMES.MERGED_CONTENT);
}

// Auditor
function auditorGenerateExample(): void {
  BaseAgent.clearAllAgentCaches();
  auditAgent.generateExample();
}

function auditorGenerateInstructions(): void {
  BaseAgent.clearAllAgentCaches();
  auditAgent.generateInstructions();
}

function auditorAnnotateTab(tabName: string): void {
  BaseAgent.clearAllAgentCaches();
  auditAgent.annotateTab(tabName || TAB_NAMES.MERGED_CONTENT);
}

// Comment Processor
function commentProcessorRun(): { replied: number; skipped: number; byAgent: Record<string, number> } {
  BaseAgent.clearAllAgentCaches();
  return CommentProcessor.processAll();
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
    fn     = body.fn     ?? '';
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
      result = CommentProcessor.processAll();
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
      architectAgent.generateExample();
      result = { ok: true };
    } else if (fn === 'stylistGenerateExample') {
      // Seeds the EarTune tab with example instructions.
      // No Gemini call — writes hardcoded STYLIST_EXAMPLE_CONTENT.
      stylistAgent.generateExample();
      result = { ok: true };
    } else if (fn === 'stylistAnnotateTab') {
      // Runs a full EarTune sweep on the named tab.
      // Makes one fast-tier Gemini call; results are Drive comments on the tab.
      // params[0] = tabName (must match an existing tab title exactly)
      const [tabName] = params as string[];
      if (!tabName) throw new Error('stylistAnnotateTab: params[0] (tabName) is required');
      stylistAgent.annotateTab(tabName);
      result = { ok: true };
    } else {
      return ContentService
        .createTextOutput(JSON.stringify({ error: `Unknown function: ${fn}` }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    Logger.log(`[doPost] ${fn} threw: ${msg}`);
    return ContentService
      .createTextOutput(JSON.stringify({ error: msg }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ result }))
    .setMimeType(ContentService.MimeType.JSON);
}

function commentAgentGenerateExample(): void {
  BaseAgent.clearAllAgentCaches();
  commentAgent.generateExample();
}

function commentAgentGenerateInstructions(): void {
  BaseAgent.clearAllAgentCaches();
  commentAgent.generateInstructions();
}

// Tab Merger
function mergeOneTabIntoMergeContent(tabName: string): { ok: boolean; name: string; message?: string } {
  return TabMerger.mergeOneTab(tabName);
}

function clearMergeTabContent(): { ok: boolean; message?: string } {
  return TabMerger.clearDestination();
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
