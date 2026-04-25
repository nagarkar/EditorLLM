// ============================================================
// Code.ts — Entry point, menu, and exposed server functions
// ============================================================

// Lazy singletons — classes may not be defined yet when Code.js loads
// (GAS file evaluation order is not guaranteed to follow filePushOrder).
let architectAgent_: ArchitectAgent;
let earTuneAgent_: EarTuneAgent;
let auditAgent_: AuditAgent;
let tetherAgent_: TetherAgent;
let ttsAgent_: TtsAgent;
let generalPurposeAgent_: GeneralPurposeAgent;
let publisherAgent_: PublisherAgent;

function getArchitectAgent(): ArchitectAgent {
  return architectAgent_ ??= new ArchitectAgent();
}
function getEarTuneAgent(): EarTuneAgent {
  return earTuneAgent_ ??= new EarTuneAgent();
}
function getAuditAgent(): AuditAgent {
  return auditAgent_ ??= new AuditAgent();
}
function getTetherAgent(): TetherAgent {
  return tetherAgent_ ??= new TetherAgent();
}
function getTtsAgent(): TtsAgent {
  return ttsAgent_ ??= new TtsAgent();
}
function getGeneralPurposeAgent(): GeneralPurposeAgent {
  return generalPurposeAgent_ ??= new GeneralPurposeAgent();
}
function getPublisherAgent(): PublisherAgent {
  return publisherAgent_ ??= new PublisherAgent();
}

/** DocumentProperties keys for instruction-quality scores (`agentHelpers` — same bundle). */
declare function instructionQualityDocumentPropKeysForAgentId_(agentId: string): {
  score: string;
  rationale: string;
  ts: string;
};

/** Directive named range codec (`agentHelpers` — same GAS bundle). */
declare function decodeDirectiveNamedRangeName(name: string): any;

// GAS add-on event shape — not typed in @types/google-apps-script; cast required.
function onOpen(e?: any): void {
  // In add-on mode the script loads before the user grants authorization.
  // AuthMode.NONE means consent has not been given — any call to
  // PropertiesService, CacheService, or DocumentApp.getUi() will throw
  // "You do not have permission". Show a single authorize item and return.
  // In container-bound mode e?.authMode is LIMITED (never NONE), so this
  // branch is never taken and behavior is identical to before.
  if (e?.authMode === ScriptApp.AuthMode.NONE) {
    DocumentApp.getUi()
      .createAddonMenu()
      .addItem('Authorize EditorLLM', 'authorizeAddon_')
      .addToUi();
    return;
  }

  Tracer.clearAll();  // wipe stale job pills from prior sessions

  const ui = DocumentApp.getUi();
  ui.createAddonMenu()
    .addItem('Open', 'openEditorLLMDialog')
//    .addSeparator()
//    .addItem('Open Sidebar', 'showSidebar')
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
    .addSubMenu(ui.createMenu('TTS')
      .addItem('Generate Instructions', 'ttsGenerateInstructions')
      .addItem('Process Active Tab', 'ttsAnnotateTab'))
    .addSubMenu(ui.createMenu('Publisher')
      .addItem('Generate Instructions', 'publisherGenerateInstructions')
      .addItem('Generate All Publishing Tabs', 'publisherGenerateAllTabs')
      .addItem('Generate Missing Publishing Tabs', 'publisherGenerateMissingTabs')
      .addItem('Generate Table of Contents', 'publisherGenerateTableOfContents')
      .addItem('Run Structural Audit', 'publisherRunStructuralAudit')
      .addItem('Build EPUB Package', 'publisherBuildEpubPackage')
      .addItem('Build ACX Package', 'publisherBuildAcxPackageFromAllAudio'))
    .addSubMenu(ui.createMenu('General Purpose')
      .addItem('Generate Instructions', 'generalPurposeAgentGenerateInstructions')
      .addItem('Process @AI Comments', 'commentProcessorRun'))
    .addSeparator()
    .addItem('Clear All Annotations', 'clearAllAnnotations')
    .addItem('Clear Active Tab Annotations', 'clearActiveTabAnnotations')
    .addSeparator()
    .addItem('Refresh All Instructions', 'refreshAllInstructionsMenu')
    .addItem('Create Manuscript', 'runMergeTabsMenu')
    .addItem('Copy All Logs', 'copyAllLogsMenu')
    .addToUi();
}

function onInstall(e: any): void {
  onOpen(e);
}

/**
 * Called from the "Authorize EditorLLM" menu item shown when authMode is NONE.
 * Displaying any UI triggers GAS to begin the OAuth consent flow; the full
 * menu will appear on the next onOpen after the user grants access.
 */
function authorizeAddon_(): void {
  const ui = DocumentApp.getUi();
  ui.alert(
    'EditorLLM',
    'Authorization complete. Please close and reopen this document to load the full menu.',
    ui.ButtonSet.OK
  );
}

// --------------- Html includes (Sidebar template) ---------------

function include(filename: string): string {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// --------------- Sidebar ---------------

/** Menu item: opens EditorLLM as a modeless floating dialog without requiring the sidebar first. */
function openEditorLLMDialog(): void {
  openAsDialog('Sidebar', Constants.EXTENSION_NAME);
}

/**
 * Like runTrackedJob_ but always creates a Tracer job regardless of debug mode.
 * Use for startup / one-off operations whose errors should always be visible in
 * the Logs panel.  Does not auto-open the sidebar.
 */
function runStartupJob_(label: string, action: () => void): void {
  Tracer.startJob(label);
  try {
    action();
    Tracer.finishJob();
  } catch (e: any) {
    Tracer.error(`${label} failed: ${e.message}`);
    Tracer.failJob(e.message);
  }
}

function showSidebar(showLogs = false): void {
  const tmpl = HtmlService.createTemplateFromFile('Sidebar');
  (tmpl as any).autoShowLogs = showLogs;
  const html = tmpl.evaluate()
    .setTitle(Constants.EXTENSION_NAME)
    .setWidth(320);
  DocumentApp.getUi().showSidebar(html);
}

/** Default size for `openAsDialog` — keep in sync with DialogWrapper template vars. */
const DIALOG_WRAPPER_WIDTH_  = 1100;
const DIALOG_WRAPPER_HEIGHT_ = 750;

/**
 * Opens any sidebar HTML file in a floating dialog (modeless).
 * The file is evaluated as a GAS template (resolving <?= ?> tags), then its
 * body content is injected into DialogWrapper.html which adds the dialog
 * header, minimize/restore controls, and the same main ↔ log toggle as the
 * sidebar (one panel at a time).
 *
 * Uses `showModelessDialog` (not `showModalDialog`) so the host window can be
 * moved by dragging its title bar — modal dialogs in Apps Script are fixed.
 * The document stays usable while the dialog is open.
 *
 * Portability: pass any .html filename; DialogWrapper is a generic shell.
 */
function openAsDialog(filename: string, title: string): void {
  const tmpl = HtmlService.createTemplateFromFile(filename);
  (tmpl as any).autoShowLogs = false;
  const inner = tmpl.evaluate().getContent();
  const bodyMatch = inner.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : inner;

  const wrapper = HtmlService.createTemplateFromFile('DialogWrapper');
  (wrapper as any).content       = bodyContent;
  (wrapper as any).title         = title;
  (wrapper as any).dialogWidth   = DIALOG_WRAPPER_WIDTH_;
  (wrapper as any).dialogHeight  = DIALOG_WRAPPER_HEIGHT_;
  const output = (wrapper as any).evaluate()
    .setWidth(DIALOG_WRAPPER_WIDTH_)
    .setHeight(DIALOG_WRAPPER_HEIGHT_)
    .setTitle(title);
  DocumentApp.getUi().showModelessDialog(output, title);
}

// --------------- Server functions exposed to sidebar/dialog ---------------

// API key management
function saveApiKey(key: string): void {
  GeminiService.saveApiKey(key);
}

function saveGeminiApiKey(key: string): void {
  GeminiService.saveApiKey(key);
}

function saveOpenAiApiKey(key: string): void {
  OpenAIService.saveApiKey(key);
}

function hasApiKey(): boolean {
  return LLMFactory.hasApiKeyForSelectedService();
}

/** Sidebar: whether the user saved GEMINI_API_KEY in User Properties (script-only counts as false → show "unset"). */
function geminiHasUserApiKey(): boolean {
  return GeminiService.hasUserApiKey();
}

function openAiHasUserApiKey(): boolean {
  return OpenAIService.hasUserApiKey();
}

// Model configuration
function listAvailableModels(force?: boolean): string[] {
  return GeminiService.listGenerateContentModels(force ?? false);
}

function getModelConfig(): {
  service: LlmServiceName;
  gemini: { fast: string; thinking: string; deepseek: string };
  openai: { fast: string; thinking: string };
} {
  return {
    service: LLMFactory.getSelectedService(),
    gemini: GeminiService.getModelConfig(),
    openai: OpenAIService.getModelConfig(),
  };
}

function saveModelConfig(cfg: {
  service: LlmServiceName;
  gemini: { fast: string; thinking: string; deepseek: string };
  openai: { fast: string; thinking: string };
}): void {
  LLMFactory.saveSelectedService(cfg.service);
  GeminiService.saveModelConfig(cfg.gemini.fast, cfg.gemini.thinking, cfg.gemini.deepseek);
  OpenAIService.saveModelConfig(cfg.openai.fast, cfg.openai.thinking);
  BaseAgent.reinitializeAllAgents();
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
 * Written by ArchitectAgent.evaluateInstructions() after each Architect W1 run
 * (keys: `${getAgentId()}_score` / `_rationale` / `_eval_ts` with id `architect`).
 * Returns { score: null } when no evaluation has been run yet for this document.
 */
function getStyleProfileScore(): { score: number | null; rationale: string; ts: string } {
  return readInstructionScoreProps_(instructionQualityDocumentPropKeysForAgentId_('architect'));
}

/** One agent instruction quality row (keys from `instructionQualityDocumentPropKeysForAgentId_`). */
function readInstructionScoreProps_(keys: { score: string; rationale: string; ts: string }): {
  score: number | null;
  rationale: string;
  ts: string;
} {
  const props = PropertiesService.getDocumentProperties().getProperties();
  const raw = props[keys.score];
  return {
    score:     raw !== undefined ? parseInt(String(raw), 10) : null,
    rationale: props[keys.rationale] ?? '',
    ts:        props[keys.ts] ?? '',
  };
}

/**
 * Persisted LLM-as-judge scores for EarTune, Audit, Tether, and General Purpose
 * instruction tabs (written by each agent's evaluateInstructions()).
 */
function getInstructionQualityScores(): {
  earTune: { score: number | null; rationale: string; ts: string };
  audit: { score: number | null; rationale: string; ts: string };
  tether: { score: number | null; rationale: string; ts: string };
  generalPurpose: { score: number | null; rationale: string; ts: string };
  tts: { score: number | null; rationale: string; ts: string };
} {
  return {
    earTune: readInstructionScoreProps_(instructionQualityDocumentPropKeysForAgentId_('eartune')),
    audit: readInstructionScoreProps_(instructionQualityDocumentPropKeysForAgentId_('audit')),
    tether: readInstructionScoreProps_(instructionQualityDocumentPropKeysForAgentId_('tether')),
    generalPurpose: readInstructionScoreProps_(instructionQualityDocumentPropKeysForAgentId_('general-purpose')),
    tts: readInstructionScoreProps_(instructionQualityDocumentPropKeysForAgentId_('tts')),
  };
}

// ── Helper: wrap any menu action with job tracking ──────────
function runTrackedJob_(label: string, action: () => void, openSidebar = true): void {
  // Open the log sidebar only when Debug Mode is enabled AND the caller has
  // flagged this job as sidebar-worthy AND a UI context is available AND
  // the user is not running from the dialog wrapper (which manages its own log view).
  // doPost (web app) and time-driven triggers do NOT have a UI context —
  // calling getUi() there throws "Cannot call DocumentApp.getUi() from this context".
  const isDebug = getDebugMode();
  if (openSidebar && isDebug && hasUiContext_() && !isDialogOpen_()) {
    showSidebar(true);  // opens combined sidebar pre-switched to log view
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

/**
 * Returns true when the EditorLLM dialog wrapper is currently open.
 * The dialog calls `setDialogOpen(true)` before starting each job so that
 * `runTrackedJob_` skips `showSidebar()` — the dialog manages its own log view.
 * The flag is stored in UserCache with a 10-minute TTL; it naturally expires
 * if the dialog crashes without clearing it.
 */
function isDialogOpen_(): boolean {
  try {
    return CacheService.getUserCache().get('editorllm_dialog_open') === 'true';
  } catch (_) {
    return false;
  }
}

/**
 * Called by the dialog wrapper before starting a job.
 * Sets a short-lived UserCache flag so `runTrackedJob_` does not open/switch
 * the sidebar.  Also called with `open = false` when the dialog closes
 * (best-effort — not guaranteed if the dialog is force-closed).
 */
function setDialogOpen(open: boolean): void {
  try {
    const cache = CacheService.getUserCache();
    if (open) {
      cache.put('editorllm_dialog_open', 'true', 600); // 10-minute TTL
    } else {
      cache.remove('editorllm_dialog_open');
    }
  } catch (_) { /* non-fatal */ }
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

function ttsGenerateInstructions(): void {
  runTrackedJob_('TTS → Generate Instructions', () => {
    BaseAgent.clearAllAgentCaches();
    getTtsAgent().generateInstructions();
  });
}

function ttsAnnotateTab(tabName?: string): void {
  BaseAgent.clearAllAgentCaches();
  const target = tabName || getActiveTabName();
  runTrackedJob_(`TTS → "${target || 'active tab'}"`, () => {
    getTtsAgent().annotateTab(target as string);
  }, true);
}

function publisherGenerateInstructions(): void {
  runTrackedJob_('Publisher → Generate Instructions', () => {
    BaseAgent.clearAllAgentCaches();
    getPublisherAgent().generateInstructions();
  });
}

function publisherGenerateAllTabs(): {
  requestedTabs: string[];
  writtenTabs: string[];
  missingTabs: string[];
  unexpectedTabs: string[];
} {
  let result = { requestedTabs: [], writtenTabs: [], missingTabs: [], unexpectedTabs: [] } as {
    requestedTabs: string[];
    writtenTabs: string[];
    missingTabs: string[];
    unexpectedTabs: string[];
  };
  runTrackedJob_('Publisher → Generate All Publishing Tabs', () => {
    BaseAgent.clearAllAgentCaches();
    result = getPublisherAgent().generatePublishingTabs('all');
  }, true);
  return result;
}

function publisherGenerateMissingTabs(): {
  requestedTabs: string[];
  writtenTabs: string[];
  missingTabs: string[];
  unexpectedTabs: string[];
} {
  let result = { requestedTabs: [], writtenTabs: [], missingTabs: [], unexpectedTabs: [] } as {
    requestedTabs: string[];
    writtenTabs: string[];
    missingTabs: string[];
    unexpectedTabs: string[];
  };
  runTrackedJob_('Publisher → Generate Missing Publishing Tabs', () => {
    BaseAgent.clearAllAgentCaches();
    result = getPublisherAgent().generatePublishingTabs('missing');
  }, true);
  return result;
}

function publisherRunStructuralAudit(): void {
  runTrackedJob_('Publisher → Structural Audit', () => {
    BaseAgent.clearAllAgentCaches();
    getPublisherAgent().annotateManuscriptStructure();
  }, true);
}

// Comment Processor
function commentProcessorRun(): { replied: number; skipped: number; byAgent: Record<string, number> } {
  let result: { replied: number; skipped: number; byAgent: Record<string, number> } = { replied: 0, skipped: 0, byAgent: {} };
  runTrackedJob_('Process @AI Comments', () => {
    BaseAgent.clearAllAgentCaches();
    // Ensure all agents are instantiated before getAllAgents() — lazy singletons
    // won't self-register until their getter is called at least once.
    getArchitectAgent(); getEarTuneAgent(); getAuditAgent(); getTetherAgent(); getTtsAgent(); getGeneralPurposeAgent(); getPublisherAgent();
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
      '[Publisher]', // PublisherAgent — content_annotation on Manuscript
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
    // internally for any old-style annotations it encounters on affected tabs.
    CollaborationService.clearAgentAnnotationsBulk(null, prefixes);

    // Safety-net: remove every named range + bookmark on each managed-eligible tab.
    // DocOps.isManagedTab() centralises the never-processed-subtree check and the
    // user allowlist check — no need to compute neverSubtree at the call site.
    for (const tabName of tabs) {
      if (!DocOps.isManagedTab(tabName)) continue;
      CollaborationService.removeOrphanedEntitiesOnTab(tabName);
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
    if (!DocOps.isManagedTab(tabName)) {
      return;
    }
    const tabId  = DocOps.getTabIdByName(tabName);
    const docTab = DocOps.getTabByName(tabName);
    if (!tabId || !docTab) {
      Tracer.warn(`[clearActiveTabAnnotations] tab "${tabName}" has no ID or could not be resolved`);
      return;
    }
    const prefixes = ['[EarTune]', '[Auditor]', '[Tether]', '[Publisher]', '[Architect]'];
    Tracer.info(`[clearActiveTabAnnotations] clearing tab "${tabName}" (id=${tabId})`);
    CollaborationService.clearAgentAnnotations(tabId, tabName, docTab, prefixes);
    clearDirectivesOnTab(tabName);
    CollaborationService.removeOrphanedEntitiesOnTab(tabName);
    Tracer.info(`[clearActiveTabAnnotations] done`);
  });
}

function clearDirectivesOnTab(tabName: string, agentFilter?: string): void {
  if (!DocOps.getTabByName(tabName)) {
    Tracer.warn(`[clearDirectivesOnTab] tab "${tabName}" not found`);
    return;
  }
  if (!DocOps.isManagedTab(tabName)) {
    return;
  }
  const removed = DirectivePersistence.clearDirectivesOnTab(tabName, agentFilter);
  Tracer.info(`[clearDirectivesOnTab] removed ${removed} directive(s) from "${tabName}"`);
}


/**
 * Menu item: regenerates all agent instructions sequentially within a single
 * tracked job. Order: Architect (StyleProfile first — all others depend on it),
 * then EarTune → Audit → Tether → TTS → Publisher → Comment.
 */
function refreshAllInstructionsMenu(): void {
  runTrackedJob_('Refresh All Instructions', () => {
    BaseAgent.clearAllAgentCaches();
    Tracer.info('[refreshAllInstructionsMenu] Step 1/6: Architect (StyleProfile)');
    getArchitectAgent().generateInstructions();

    BaseAgent.clearAllAgentCaches();
    Tracer.info('[refreshAllInstructionsMenu] Step 2/6: EarTune');
    getEarTuneAgent().generateInstructions();

    BaseAgent.clearAllAgentCaches();
    Tracer.info('[refreshAllInstructionsMenu] Step 3/6: Auditor');
    getAuditAgent().generateInstructions();

    BaseAgent.clearAllAgentCaches();
    Tracer.info('[refreshAllInstructionsMenu] Step 4/6: Tether');
    getTetherAgent().generateInstructions();

    BaseAgent.clearAllAgentCaches();
    Tracer.info('[refreshAllInstructionsMenu] Step 5/6: TTS');
    getTtsAgent().generateInstructions();

    BaseAgent.clearAllAgentCaches();
    BaseAgent.clearAllAgentCaches();
    Tracer.info('[refreshAllInstructionsMenu] Step 6/7: Publisher');
    getPublisherAgent().generateInstructions();

    BaseAgent.clearAllAgentCaches();
    Tracer.info('[refreshAllInstructionsMenu] Step 7/7: General Purpose Agent');
    getGeneralPurposeAgent().generateInstructions();

    Tracer.info('[refreshAllInstructionsMenu] All instructions refreshed.');
  });
}

/**
 * Menu item: creates the Manuscript tab from the saved tab list.
 * If no tab names have been saved yet, shows the same error as the sidebar.
 */
function runMergeTabsMenu(): void {
  const names = TabMerger.getSavedTabNames();
  if (!names.length) {
    DocumentApp.getUi().alert('Enter at least one tab name to merge.');
    return;
  }
  runTrackedJob_(`Create Manuscript (${names.length})`, () => {
    Tracer.info(`[runMergeTabsMenu] Creating Manuscript from ${names.length} tab(s): ${JSON.stringify(names)}`);
    const result = TabMerger.mergeAllTabs(names);
    if (result.errors.length) {
      Tracer.error(`[runMergeTabsMenu] Merge errors: ${result.errors.join('; ')}`);
    }
    Tracer.info(`[runMergeTabsMenu] Created Manuscript from ${result.successes}/${names.length} tab(s).`);
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
 *   fn: "hasApiKey"                → selected LLM service hasApiKey() → boolean
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
      result = LLMFactory.hasApiKeyForSelectedService();
    } else if (fn === 'setScriptProperty') {
      // Utility for E2E tests: sets a single Script Property.
      // params[0] = key, params[1] = value
      //
      // Special case — GEMINI_API_KEY: resolveApiKey_() checks UserProperties
      // before ScriptProperties, so clearing only ScriptProperties leaves the key
      // reachable via UserProperties (where saveApiKey() stores it). Writing to
      // both stores ensures E2E-6 (no-key test) reliably blocks Gemini calls, and
      // afterAll restoring via the same route leaves both stores in a valid state.
      const [propKey, propValue] = params as string[];
      if (!propKey) throw new Error('setScriptProperty: params[0] (key) is required');
      PropertiesService.getScriptProperties().setProperty(propKey, propValue ?? '');
      if (propKey === 'GEMINI_API_KEY' || propKey === 'OPENAI_API_KEY') {
        PropertiesService.getUserProperties().setProperty(propKey, propValue ?? '');
      }
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
      // W1: regenerates EarTune instructions from StyleProfile + Manuscript.
      // Runs in parallel with auditor/tether/comment after Architect completes.
      earTuneGenerateInstructions();
      result = { ok: true };
    } else if (fn === 'auditorGenerateInstructions') {
      // W1: regenerates TechnicalAudit instructions from StyleProfile + Manuscript.
      // Runs in parallel with eartune/tether/comment after Architect completes.
      auditorGenerateInstructions();
      result = { ok: true };
    } else if (fn === 'tetherGenerateInstructions') {
      // W1: regenerates TetherInstructions from StyleProfile + Manuscript.
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
    tts:     getTtsAgent     as () => AnnotatingAgent,
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

// ── Managed Tabs (persistent watchlist, separate from merge tabs) ─────────────

/** DocumentProperties key for the user-maintained managed-tabs list. */
const MANAGED_TABS_PROP_KEY_ = 'managedTabNamesList';

/**
 * Returns the saved managed-tab names as an array.
 * Stored as a comma-separated string in DocumentProperties.
 */
function getManagedTabNamesList(): string[] {
  const raw = PropertiesService.getDocumentProperties().getProperty(MANAGED_TABS_PROP_KEY_);
  if (!raw || !raw.trim()) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Persists the managed-tab names list to DocumentProperties.
 * Accepts a comma-separated string (same format as saveMergeTabs).
 */
function saveManagedTabNamesList(csv: string): void {
  const names = csv.split(',').map(s => s.trim()).filter(Boolean);
  PropertiesService.getDocumentProperties().setProperty(MANAGED_TABS_PROP_KEY_, names.join(','));
}

// ── ElevenLabs TTS server functions ──────────────────────────────────────────
// All functions below are called from the sidebar TTS panel via google.script.run.
// They delegate to ElevenLabsService (which owns all API key / model state)
// and follow the same naming convention: elevenLabs<Action>.

/**
 * Saves the ElevenLabs API key to DocumentProperties and eagerly refreshes both
 * the voice-mapping cache and the pronunciation dictionary cache so the
 * directive panel shows human-readable names and generation uses correct
 * pronunciation rules immediately after the key is saved.
 */
function elevenLabsSaveApiKey(key: string): void {
  ElevenLabsService.saveApiKey(key);
  if (ElevenLabsService.hasApiKey()) {
    try {
      ElevenLabsService.prefetchVoiceMappings();
    } catch (_) {
      // Non-fatal — old cache (or no voices) is still acceptable.
    }
    try {
      ElevenLabsService.prefetchPronunciationDictionaries();
    } catch (_) {
      // Non-fatal — TTS still works without pronunciation overrides.
    }
  }
}

/**
 * Warm ElevenLabs caches after the popup/sidebar DOM has rendered.
 * This avoids running external fetches too early during add-on startup.
 */
function elevenLabsWarmCachesOnUiOpen(): void {
  if (!ElevenLabsService.hasApiKey()) return;

  try {
    ElevenLabsService.prefetchVoiceMappings();
  } catch (e: any) {
    Tracer.warn(`[elevenLabsWarmCachesOnUiOpen] voice mappings preload failed: ${e?.message || e}`);
  }

  try {
    ElevenLabsService.prefetchPronunciationDictionaries();
  } catch (e: any) {
    Tracer.warn(`[elevenLabsWarmCachesOnUiOpen] pronunciation dictionaries preload failed: ${e?.message || e}`);
  }
}

/** Returns true when an ElevenLabs API key has been configured. */
function elevenLabsHasApiKey(): boolean {
  return ElevenLabsService.hasApiKey();
}

/**
 * Returns voices available to the user, optionally filtered by use-case.
 * @param useCase  'narration' | 'conversational' | 'characters' | '' (all)
 */
function elevenLabsListVoices(useCase: string): ElevenLabsVoice[] {
  return ElevenLabsService.listVoices(useCase || undefined);
}

/** Returns all TTS-capable models from the ElevenLabs API. */
function elevenLabsListModels(): ElevenLabsModel[] {
  return ElevenLabsService.listModels();
}

/**
 * Returns the plain-text content of the tab the user currently has active.
 * Called by the sidebar TTS panel immediately before sending text to ElevenLabs
 * so that the correct tab is always read at generation time.
 */
function elevenLabsGetActiveTabText(): string {
  const doc    = DocumentApp.getActiveDocument();
  const active = (doc as any).getActiveTab?.();
  if (active) {
    return (active as any).asDocumentTab().getBody().getText() as string;
  }
  const tabs = doc.getTabs();
  if (!tabs.length) return '';
  return (tabs[0] as any).asDocumentTab().getBody().getText() as string;
}

/**
 * Returns the Drive folder ID for "EditorLLM/Audio", creating it (and its
 * parent "EditorLLM" folder) if either does not yet exist.
 *
 * Files created inside this folder are within the `drive.file` OAuth scope
 * because this script created the folder.
 */
function getOrCreateDriveFolderByName_(folderName: string, parentId?: string): string {
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const query = Drive.Files.list({
    q:      `mimeType="application/vnd.google-apps.folder" and name="${folderName.replace(/"/g, '\\"')}" and trashed=false${parentClause}`,
    fields: 'files(id)',
    spaces: 'drive',
  } as any);
  const files: any[] = (query as any).files || [];
  if (files.length > 0) return files[0].id as string;

  const created = Drive.Files.create(
    parentId
      ? { name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }
      : { name: folderName, mimeType: 'application/vnd.google-apps.folder' },
    undefined,
    { fields: 'id' }
  );
  return (created as any).id as string;
}

function getOrCreateEditorLLMRootFolder_(): string {
  return getOrCreateDriveFolderByName_('EditorLLM');
}

function getOrCreateEditorLLMAudioFolder_(): string {
  const parentId = getOrCreateEditorLLMRootFolder_();
  return getOrCreateDriveFolderByName_('Audio', parentId);
}

function getOrCreateEditorLLMPackagesFolder_(): string {
  const parentId = getOrCreateEditorLLMRootFolder_();
  return getOrCreateDriveFolderByName_('Packages', parentId);
}

function listEditorLLMAudioFiles(): Array<{ id: string; name: string; createdTime?: string; size?: string }> {
  const folderId = getOrCreateEditorLLMAudioFolder_();
  const resp = Drive.Files.list({
    q: `'${folderId}' in parents and trashed=false and mimeType='audio/mpeg' and name contains '.mp3'`,
    fields: 'files(id,name,createdTime,size)',
    orderBy: 'name',
    spaces: 'drive',
  } as any);
  const files: any[] = (resp as any).files || [];
  return files.map(file => ({
    id: file.id as string,
    name: file.name as string,
    createdTime: file.createdTime as string | undefined,
    size: file.size as string | undefined,
  }));
}

function copyDriveFileIntoFolder_(fileId: string, folderId: string): { id: string; name: string } {
  const meta = Drive.Files.get(fileId, { fields: 'name,mimeType' } as any) as any;
  const copied = Drive.Files.copy(
    {
      name: meta.name,
      parents: [folderId],
      mimeType: meta.mimeType,
    },
    fileId,
    { fields: 'id,name' }
  ) as any;
  return { id: copied.id as string, name: copied.name as string };
}

function createGoogleDocInFolder_(name: string, folderId: string): { id: string; name: string } {
  const created = Drive.Files.create(
    {
      name,
      parents: [folderId],
      mimeType: 'application/vnd.google-apps.document',
    },
    undefined,
    { fields: 'id,name' }
  ) as any;
  return { id: created.id as string, name: created.name as string };
}

function buildPublisherArtifactStamp_(date: Date): string {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'ddMMyy_HHmmss');
}

function normalizeTextColorForLightExport_(element: any): void {
  if (!element || typeof element.editAsText !== 'function') return;
  const text = element.editAsText();
  const len = text.getText().length;
  if (len > 0) text.setForegroundColor(0, len - 1, '#000000');
}

function normalizeElementForLightExport_(element: GoogleAppsScript.Document.Element): void {
  const type = element.getType();
  if (type === DocumentApp.ElementType.PARAGRAPH || type === DocumentApp.ElementType.LIST_ITEM) {
    normalizeTextColorForLightExport_(element as any);
    return;
  }
  if (type === DocumentApp.ElementType.TABLE) {
    const table = element.asTable();
    for (let r = 0; r < table.getNumRows(); r++) {
      const row = table.getRow(r);
      for (let c = 0; c < row.getNumCells(); c++) {
        const cell = row.getCell(c);
        for (let i = 0; i < cell.getNumChildren(); i++) {
          normalizeElementForLightExport_(cell.getChild(i));
        }
      }
    }
  }
}

function appendBodyToBody_(
  sourceBody: GoogleAppsScript.Document.Body,
  destinationBody: GoogleAppsScript.Document.Body
): void {
  const numChildren = sourceBody.getNumChildren();
  for (let i = 0; i < numChildren; i++) {
    const element = sourceBody.getChild(i).copy();
    const type = element.getType();
    if (type === DocumentApp.ElementType.PARAGRAPH) {
      const appended = destinationBody.appendParagraph(element as GoogleAppsScript.Document.Paragraph);
      normalizeElementForLightExport_(appended);
    } else if (type === DocumentApp.ElementType.TABLE) {
      const appended = destinationBody.appendTable(element as GoogleAppsScript.Document.Table);
      normalizeElementForLightExport_(appended);
    } else if (type === DocumentApp.ElementType.LIST_ITEM) {
      const appended = destinationBody.appendListItem(element as GoogleAppsScript.Document.ListItem);
      normalizeElementForLightExport_(appended);
    }
  }
}

function publisherGenerateTableOfContents(): { entries: number } {
  const mergedTab = DocOps.getTabByName(Constants.TAB_NAMES.MANUSCRIPT);
  if (!mergedTab) throw new Error('Manuscript tab is missing.');

  const body = mergedTab.getBody();
  const lines: string[] = ['## Table of Contents'];
  let count = 0;

  for (let i = 0; i < body.getNumChildren(); i++) {
    const child = body.getChild(i);
    if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;
    const para = child.asParagraph();
    const text = para.getText().trim();
    if (!text) continue;

    const heading = para.getHeading();
    if (heading === DocumentApp.ParagraphHeading.HEADING1) {
      lines.push(`- ${text}`);
      count++;
    } else if (heading === DocumentApp.ParagraphHeading.HEADING2) {
      lines.push(`  - ${text}`);
      count++;
    } else if (heading === DocumentApp.ParagraphHeading.HEADING3) {
      lines.push(`    - ${text}`);
      count++;
    }
  }

  const tocMarkdown = count > 0 ? lines.join('\n') : '## Table of Contents\n\n_No heading-based table of contents could be generated from Manuscript._';
  MarkdownService.markdownToTab(tocMarkdown, Constants.TAB_NAMES.PUBLISHER_TOC, Constants.TAB_NAMES.PUBLISHER_ROOT);
  return { entries: count };
}

function countPublisherAnnotationsOnManuscript_(): number {
  const docId = DocumentApp.getActiveDocument().getId();
  let pageToken: string | undefined;
  let count = 0;

  do {
    const resp = (Drive.Comments as any).list(docId, {
      fields: 'comments(content),nextPageToken',
      pageSize: 100,
      pageToken,
    });
    const comments: any[] = (resp as any)?.comments || [];
    for (const comment of comments) {
      const content = String(comment?.content || '');
      if (content.includes('[Publisher]')) count++;
    }
    pageToken = (resp as any)?.nextPageToken || undefined;
  } while (pageToken);

  return count;
}

function getPublisherWorkflowState(): {
  instructions: { done: boolean; missingReason: string | null };
  tabs: { done: boolean; present: string[]; missing: string[] };
  toc: { done: boolean; detail: string };
  structuralAudit: { done: boolean; annotationCount: number; detail: string };
  publish: {
    status: 'done' | 'partial' | 'pending';
    epubReady: boolean;
    acxReady: boolean;
    audioFiles: number;
    detail: string;
  };
} {
  const requiredPublisherTabs = [
    Constants.TAB_NAMES.PUBLISHER_TITLE,
    Constants.TAB_NAMES.PUBLISHER_COPYRIGHT,
    Constants.TAB_NAMES.PUBLISHER_ABOUT_AUTHOR,
    Constants.TAB_NAMES.PUBLISHER_SALES,
    Constants.TAB_NAMES.PUBLISHER_HOOKS,
    Constants.TAB_NAMES.PUBLISHER_COVER,
  ];

  const instructionsContent = DocOps.getTabContent(Constants.TAB_NAMES.PUBLISHER_INSTRUCTIONS);
  const instructionsDone = !isBlankPublisherContent(instructionsContent);

  const presentPublisherTabs = requiredPublisherTabs.filter(name => !isBlankPublisherContent(DocOps.getTabContent(name)));
  const missingPublisherTabs = requiredPublisherTabs.filter(name => presentPublisherTabs.indexOf(name) === -1);

  const tocContent = DocOps.getTabContent(Constants.TAB_NAMES.PUBLISHER_TOC);
  const tocDone = !isBlankPublisherContent(tocContent);

  const annotationCount = countPublisherAnnotationsOnManuscript_();
  const audioFiles = listEditorLLMAudioFiles().length;

  const epubRequiredTabs = [
    Constants.TAB_NAMES.PUBLISHER_TITLE,
    Constants.TAB_NAMES.PUBLISHER_COPYRIGHT,
    Constants.TAB_NAMES.PUBLISHER_TOC,
    Constants.TAB_NAMES.MANUSCRIPT,
    Constants.TAB_NAMES.PUBLISHER_ABOUT_AUTHOR,
  ];
  const epubReady = epubRequiredTabs.every(name => !isBlankPublisherContent(DocOps.getTabContent(name)));
  const acxReady = audioFiles > 0;
  const publishStatus: 'done' | 'partial' | 'pending' =
    epubReady && acxReady ? 'done' : (epubReady || acxReady ? 'partial' : 'pending');

  return {
    instructions: {
      done: instructionsDone,
      missingReason: instructionsDone ? null : 'Publisher Instructions is blank or missing.',
    },
    tabs: {
      done: missingPublisherTabs.length === 0,
      present: presentPublisherTabs,
      missing: missingPublisherTabs,
    },
    toc: {
      done: tocDone,
      detail: tocDone ? 'Table of Contents tab is present.' : 'Table of Contents has not been generated yet.',
    },
    structuralAudit: {
      done: annotationCount > 0,
      annotationCount,
      detail: annotationCount > 0
        ? `${annotationCount} live [Publisher] annotation(s) on Manuscript.`
        : 'No live [Publisher] structural-audit annotations detected on Manuscript.',
    },
    publish: {
      status: publishStatus,
      epubReady,
      acxReady,
      audioFiles,
      detail: `EPUB ${epubReady ? 'ready' : 'not ready'} • ACX ${acxReady ? `ready (${audioFiles} mp3)` : 'needs mp3 audio'}`,
    },
  };
}

function publisherBuildEpubPackage(): { ok: boolean; folderName?: string; folderUrl?: string; fileName?: string; error?: string } {
  let result: { ok: boolean; folderName?: string; folderUrl?: string; fileName?: string; error?: string } =
    { ok: false, error: 'EPUB packaging failed.' };
  let failure: string | null = null;

  runStartupJob_('Publisher → Build EPUB', () => {
    try {
      result = publisherBuildEpubPackageImpl_();
    } catch (e: any) {
      failure = e.message || String(e);
      throw e;
    }
  });

  if (failure) return { ok: false, error: failure };
  return result;
}

function publisherBuildAcxPackage(audioFileIds: string[]): { ok: boolean; folderName?: string; folderUrl?: string; copied?: string[]; error?: string } {
  let result: { ok: boolean; folderName?: string; folderUrl?: string; copied?: string[]; error?: string } =
    { ok: false, error: 'ACX packaging failed.' };
  let failure: string | null = null;

  runStartupJob_('Publisher → Build ACX', () => {
    try {
      result = publisherBuildAcxPackageImpl_(audioFileIds);
    } catch (e: any) {
      failure = e.message || String(e);
      throw e;
    }
  });

  if (failure) return { ok: false, error: failure };
  return result;
}

function publisherBuildAcxPackageFromAllAudio(): { ok: boolean; folderName?: string; folderUrl?: string; copied?: string[]; error?: string } {
  const files = listEditorLLMAudioFiles();
  return publisherBuildAcxPackage(files.map(file => file.id));
}

function publisherBuildEpubPackageImpl_(): { ok: true; folderName: string; folderUrl: string; fileName: string } {
  DocOps.ensureStandardTabs();
  const doc = DocumentApp.getActiveDocument();
  const packagesFolderId = getOrCreateEditorLLMPackagesFolder_();
  const now = new Date();
  const isoDate = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const hhmmss = Utilities.formatDate(now, Session.getScriptTimeZone(), 'HHmmss');
  const artifactStamp = buildPublisherArtifactStamp_(now);
  const packageFolderName = buildPublisherPackageFolderName(doc.getName(), isoDate, hhmmss);
  const packageFolderId = getOrCreateDriveFolderByName_(packageFolderName, packagesFolderId);

  Tracer.info(`[publisherBuildEpubPackage] package folder="${packageFolderName}" doc="${doc.getName()}"`);

  const tempDocFile = createGoogleDocInFolder_(`${doc.getName()} EPUB Export_${artifactStamp}`, packageFolderId);
  Tracer.info(`[publisherBuildEpubPackage] temp doc created id=${tempDocFile.id}`);

  const tempDoc = DocumentApp.openById(tempDocFile.id as string);
  const tempBody = tempDoc.getBody();
  DocOps.clearBodySafely(tempBody);

  const sequence = [
    Constants.TAB_NAMES.PUBLISHER_TITLE,
    Constants.TAB_NAMES.PUBLISHER_COPYRIGHT,
    Constants.TAB_NAMES.PUBLISHER_TOC,
    Constants.TAB_NAMES.MANUSCRIPT,
    Constants.TAB_NAMES.PUBLISHER_ABOUT_AUTHOR,
  ];

  for (let i = 0; i < sequence.length; i++) {
    const tab = DocOps.getTabByName(sequence[i]);
    if (!tab) throw new Error(`Required tab "${sequence[i]}" is missing.`);
    Tracer.info(`[publisherBuildEpubPackage] appending tab "${sequence[i]}"`);
    appendBodyToBody_(tab.getBody(), tempBody);
    if (i < sequence.length - 1) tempBody.appendPageBreak();
  }
  tempDoc.saveAndClose();

  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(tempDocFile.id as string)}/export?mimeType=application/epub%2Bzip`;
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
    muteHttpExceptions: true,
  });
  Tracer.info(`[publisherBuildEpubPackage] export response code=${response.getResponseCode()}`);
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error(`EPUB export failed (${response.getResponseCode()}).`);
  }

  const epubName = `${doc.getName()}_${artifactStamp}.epub`;
  const file = Drive.Files.create(
    { name: epubName, parents: [packageFolderId], mimeType: 'application/epub+zip' },
    response.getBlob().setName(epubName),
    { fields: 'id,name,webViewLink' }
  ) as any;
  Tracer.info(`[publisherBuildEpubPackage] created file="${file.name}" folderId=${packageFolderId}`);

  return {
    ok: true,
    folderName: packageFolderName,
    folderUrl: `https://drive.google.com/drive/folders/${packageFolderId}`,
    fileName: file.name as string,
  };
}

function publisherBuildAcxPackageImpl_(audioFileIds: string[]): { ok: true; folderName: string; folderUrl: string; copied: string[] } {
  if (!Array.isArray(audioFileIds) || !audioFileIds.length) {
    throw new Error('No audio files selected.');
  }

  const doc = DocumentApp.getActiveDocument();
  const packagesFolderId = getOrCreateEditorLLMPackagesFolder_();
  const now = new Date();
  const isoDate = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const hhmmss = Utilities.formatDate(now, Session.getScriptTimeZone(), 'HHmmss');
  const packageFolderName = buildPublisherPackageFolderName(doc.getName(), isoDate, hhmmss);
  const packageFolderId = getOrCreateDriveFolderByName_(packageFolderName, packagesFolderId);
  const acxFolderId = getOrCreateDriveFolderByName_('ACX Audio', packageFolderId);

  Tracer.info(`[publisherBuildAcxPackage] package folder="${packageFolderName}" files=${audioFileIds.length}`);

  const copiedNames: string[] = [];
  for (const fileId of audioFileIds) {
    const copied = copyDriveFileIntoFolder_(fileId, acxFolderId);
    copiedNames.push(copied.name);
    Tracer.info(`[publisherBuildAcxPackage] copied "${copied.name}"`);
  }

  return {
    ok: true,
    folderName: packageFolderName,
    folderUrl: `https://drive.google.com/drive/folders/${acxFolderId}`,
    copied: copiedNames,
  };
}

/**
 * Converts `text` to speech using ElevenLabs and saves the resulting MP3 to
 * the "EditorLLM/audio" folder in the user's Google Drive.  Returns:
 *   • `audioBase64`   — for immediate in-dialog playback via a blob URL.
 *   • `driveUrl`      — a shareable Drive download link (persists after the
 *                       dialog is closed).
 *   • `driveFileName` — the filename saved in Drive (shown in the TTS overlay).
 *
 * Drive save failures are non-fatal: the audio is still returned so the user
 * can play it back in the dialog even if Drive is unavailable.
 *
 * ElevenLabs accepts ≈5 000 chars per request on the standard tier; the
 * dialog truncates text client-side before calling this function.
 */
function elevenLabsTextToSpeech(
  text:    string,
  voiceId: string,
  modelId: string
): { ok: boolean; audioBase64?: string; driveUrl?: string; driveFileId?: string; driveFileName?: string; mimeType?: string; error?: string } {
  try {
    const audioBase64 = ElevenLabsService.textToSpeech(text, voiceId, modelId || undefined);

    // Save to Drive for a permanent shareable link.
    // Uses the existing Advanced Drive Service (Drive v3) rather than DriveApp
    // so we stay consistent with CollaborationService and avoid a second Drive
    // client.  Drive.Files.create uploads the blob and returns the new file
    // resource; Drive.Permissions.create makes it readable by anyone with the link.
    let driveUrl:      string | undefined;
    let driveFileId:   string | undefined;
    let driveFileName: string | undefined;
    try {
      const folderId = getOrCreateEditorLLMAudioFolder_();
      const bytes    = Utilities.base64Decode(audioBase64);
      const filename = 'tts_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12) + '.mp3';
      const blob     = Utilities.newBlob(bytes, 'audio/mpeg', filename);
      const fileRes  = Drive.Files.create(
        { name: filename, mimeType: 'audio/mpeg', parents: [folderId] },
        blob,
        { fields: 'id' }
      );
      driveFileId   = (fileRes as any).id as string;
      driveFileName = filename;
      Drive.Permissions.create(
        { role: 'reader', type: 'anyone' },
        driveFileId,
        { sendNotificationEmail: false }
      );
      driveUrl = `https://drive.google.com/uc?id=${driveFileId}&export=download`;
    } catch (driveErr: any) {
      Tracer.warn(`[elevenLabsTextToSpeech] Drive save failed: ${driveErr.message}`);
    }

    return { ok: true, audioBase64, driveUrl, driveFileId, driveFileName, mimeType: 'audio/mpeg' };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** Saves the document's preferred ElevenLabs voice ID to DocumentProperties. */
function elevenLabsSaveVoicePreference(voiceId: string): void {
  ElevenLabsService.saveVoiceId(voiceId);
}

/** Saves the document's preferred ElevenLabs model ID to DocumentProperties. */
function elevenLabsSaveModelPreference(modelId: string): void {
  ElevenLabsService.saveModelId(modelId);
}

/**
 * Returns the document's saved voice + model preferences.
 * `voiceId` is null when no preferred voice has been selected for this document.
 * `modelId` always returns a value (saved preference or the default model).
 */
function elevenLabsGetPreferences(): { voiceId: string | null; modelId: string } {
  return {
    voiceId: ElevenLabsService.getSavedVoiceId(),
    modelId: ElevenLabsService.getModelId(),
  };
}

/**
 * Returns the cached {voiceId → voiceName} mapping from CacheService, or null
 * if it has not been populated yet.
 */
function elevenLabsGetVoiceMappings(): Record<string, string> | null {
  return ElevenLabsService.getVoiceMappings();
}

/** Returns cached voice mappings, fetching and caching them if needed. */
function elevenLabsEnsureVoiceMappings(): Record<string, string> | null {
  return ElevenLabsService.ensureVoiceMappings();
}

/**
 * Returns the cached pronunciation dictionaries (id, version_id, name, graphemes)
 * from CacheService, or null if they have not been prefetched yet.
 * The TTS dialog can use this to show the user which dictionaries will be
 * applied to the next generation.
 */
function elevenLabsGetPronunciationDictionaries(): ElevenLabsPronunciationDictionary[] | null {
  return ElevenLabsService.getCachedPronunciationDictionaries();
}

/**
 * Re-fetches all pronunciation dictionaries from ElevenLabs, rebuilds the
 * cache, and returns the refreshed list.  Called when the user clicks
 * "Refresh" in the pronunciation overlay — handles the case where the cache
 * was empty at startup (e.g. API key was set after onOpen ran).
 */
function elevenLabsRefreshPronunciationDictionaries(): ElevenLabsPronunciationDictionary[] {
  ElevenLabsService.prefetchPronunciationDictionaries();
  return ElevenLabsService.getCachedPronunciationDictionaries() ?? [];
}

/**
 * Persists the user's selected pronunciation dictionary ID to DocumentProperties.
 * DocumentProperties are per-document (shared across all editors of this doc).
 */
function elevenLabsSaveSelectedDictionaryId(id: string): void {
  ElevenLabsService.saveSelectedDictionaryId(id);
}

/** Returns the saved selected pronunciation dictionary ID, or null if none set. */
function elevenLabsGetSelectedDictionaryId(): string | null {
  return ElevenLabsService.getSelectedDictionaryId();
}

/** Persists last-generation metadata so the dialog can recall it on next open. */
function elevenLabsSaveLastGeneration(meta: ElevenLabsLastGenMeta): void {
  ElevenLabsService.saveLastGeneration(meta);
}

/** Returns the persisted last-generation metadata, or null if none exists. */
function elevenLabsGetLastGeneration(): ElevenLabsLastGenMeta | null {
  return ElevenLabsService.getLastGeneration();
}

/**
 * Fetches the audio bytes for the last saved generation from Google Drive and
 * returns them as base64 so the dialog can populate its audio player.
 *
 * The file was created by this script (Drive.Files.create) so it is within the
 * `drive.file` OAuth scope.  UrlFetchApp is used with the user's OAuth token
 * so the Drive API returns the binary content directly (avoids the large-file
 * redirect that `https://drive.google.com/uc?export=download` triggers).
 */
function elevenLabsLoadLastAudio(): { audioBase64: string; mimeType: string } | null {
  const meta = ElevenLabsService.getLastGeneration();
  if (!meta || !meta.fileId) return null;
  try {
    const token = ScriptApp.getOAuthToken();
    const url   = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(meta.fileId)}?alt=media`;
    const resp  = UrlFetchApp.fetch(url, {
      headers:            { Authorization: `Bearer ${token}` },
      muteHttpExceptions: true,
    });
    const code = resp.getResponseCode();
    if (code < 200 || code >= 300) return null;
    return {
      audioBase64: Utilities.base64Encode(resp.getBlob().getBytes()),
      mimeType:    'audio/mpeg',
    };
  } catch (_) {
    return null;
  }
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

/**
 * Returns the raw user-configured allowlist of tabs eligible for managed
 * destructive operations, or null when all non-blocked tabs are eligible.
 *
 * TODO: Wire allowlist from persistent config when product policy is finalized.
 * @see DocOps.getUserAllowedManagedTabs
 */
function getUserAllowedManagedTabs(): ManagedTabsList {
  return DocOps.getUserAllowedManagedTabs();
}

/**
 * Returns all document tab names that pass the `isManagedTab` check —
 * i.e. are not in the never-processed subtree and are in the user allowlist
 * (when one is configured). Used by the sweep overlay so it only shows
 * tabs that can actually receive agent operations.
 */
function getManageableTabNames(): string[] {
  return getTabNames().filter(name => DocOps.isManagedTab(name));
}

// ── Directive Management ────────────────────────────────

function getDirectivesOnTab_(tabName: string, agentFilter?: string): any[] {
  return DirectivePersistence.listDirectivesOnTab(tabName, agentFilter);
}

/** Backward-compatible UI helper: TTS panel asks for TtsAgent directives only. */
function getTabDirectives(tabName: string): any[] {
  return getDirectivesOnTab_(tabName, 'TtsAgent');
}

function jumpToDirective(tabName: string, namedRangeName: string): boolean {
  const tab = DocOps.getTabByName(tabName);
  if (!tab) return false;

  const dec = decodeDirectiveNamedRangeName(namedRangeName);
  if (!dec.ok) return false;

  const doc = DocumentApp.getActiveDocument();
  const bookmark = tab.getBookmarks().find(b => {
    try {
      return bookmarkIdToWire_(b.getId()) === dec.bookmarkId;
    } catch {
      return false;
    }
  });
  if (bookmark) {
    doc.setCursor(bookmark.getPosition());
    return true;
  }

  const nr = tab.getNamedRanges().find(r => r.getName() === namedRangeName);
  const range = nr?.getRange();
  if (!range) return false;
  doc.setSelection(range);
  return true;
}

function updateDirective(tabName: string, namedRangeName: string, newType: string, newPayload: Record<string, unknown>): boolean {
  return DirectivePersistence.updateDirectivePayload(tabName, namedRangeName, newType, newPayload);
}

function updateTtsDirective(tabName: string, _bookmarkId: string, oldName: string, newPayload: any): boolean {
  const dec = decodeDirectiveNamedRangeName(oldName);
  if (!dec.ok || dec.agent !== 'TtsAgent') return false;
  return updateDirective(tabName, oldName, 'tts', {
    tts_model: newPayload.tts_model,
    voice_id: newPayload.voice_id,
    stability: newPayload.stability,
    similarity_boost: newPayload.similarity_boost,
  });
}

function deleteDirective(tabName: string, namedRangeName: string): boolean {
  Tracer.info(`[deleteDirective] tab="${tabName}" range="${namedRangeName}"`);
  try {
    if (!DirectivePersistence.deleteDirective(tabName, namedRangeName)) {
      throw new Error(`Directive "${namedRangeName}" not found on tab "${tabName}".`);
    }
    const dec = decodeDirectiveNamedRangeName(namedRangeName);
    if (dec.ok) {
      Tracer.info(`[deleteDirective] deleted directiveId="${dec.directiveId}" on tab="${tabName}"`);
    }
    return true;
  } catch (e: any) {
    const msg = e?.message || String(e);
    Tracer.error(`[deleteDirective] failed for tab="${tabName}" range="${namedRangeName}": ${msg}`);
    throw e;
  }
}

function deleteTtsDirective(tabName: string, _bookmarkId: string, namedRangeName: string): boolean {
  const dec = decodeDirectiveNamedRangeName(namedRangeName);
  if (!dec.ok || dec.agent !== 'TtsAgent') return false;
  return deleteDirective(tabName, namedRangeName);
}

function addTtsDirectiveFromSelection(
  tabName: string,
  payload: {
    tts_model: string;
    voice_id: string;
    stability: number;
    similarity_boost: number;
  }
): boolean {
  const activeTab = getActiveTabName();
  if (!activeTab || activeTab !== tabName) {
    throw new Error(`Active tab must be "${tabName}" when adding a directive.`);
  }

  const doc = DocumentApp.getActiveDocument();
  const docTab = DocOps.getTabByName(tabName);
  if (!docTab) {
    throw new Error(`Tab "${tabName}" not found.`);
  }

  const cursor = doc.getCursor();
  if (!cursor) {
    throw new Error('Place the cursor in the document before adding a directive.');
  }
  const surrounding = cursor.getSurroundingText();
  if (!surrounding) {
    throw new Error('Cursor must be inside text before adding a directive.');
  }
  const off = cursor.getSurroundingTextOffset();
  const len = surrounding.getText().length;
  if (len <= 0 || off < 0 || off >= len) {
    throw new Error('Cursor must be placed before a character to add a directive.');
  }

  const range = docTab.newRange()
    .addElement(surrounding, off, off)
    .build();
  DirectivePersistence.createDirectiveAtRange(
    docTab,
    'TtsAgent',
    'tts',
    {
      tts_model: payload.tts_model,
      voice_id: payload.voice_id,
      stability: payload.stability,
      similarity_boost: payload.similarity_boost,
    },
    range
  );
  return true;
}

function locateDirectivePositions_(directives: any[]): any[] {
  return directives
    .filter((d: any) => Number.isFinite(d._insertPos) && d._insertPos >= 0)
    .sort((a: any, b: any) => a._insertPos - b._insertPos);
}

function injectBreakTags_(text: string, segmentStart: number, breaks: any[]): string {
  if (!breaks.length) return text;
  let out = '';
  let cursor = 0;
  for (const br of breaks) {
    const rel = br._insertPos - segmentStart;
    if (rel < 0 || rel > text.length) continue;
    out += text.slice(cursor, rel);
    const ms = Number(br.payload?.timeMs);
    if (Number.isFinite(ms) && ms > 0) {
      out += `<break time="${Math.round(ms)}ms" />`;
    }
    cursor = rel;
  }
  out += text.slice(cursor);
  return out;
}

/**
 * Renames the Drive audio file created by a previous TTS generation.
 * The `.mp3` extension is appended automatically if not already present.
 */
function elevenLabsRenameAudioFile(fileId: string, newName: string): boolean {
  try {
    const safeName = newName.trim().endsWith('.mp3') ? newName.trim() : newName.trim() + '.mp3';
    Drive.Files.update({ name: safeName }, fileId);
    return true;
  } catch (e: any) {
    Tracer.warn(`[elevenLabsRenameAudioFile] failed: ${e.message}`);
    return false;
  }
}

/**
 * Generates audio from TTS directives on the given tab, stitching each
 * voice-change segment sequentially.  When `useStitching` is true, each
 * ElevenLabs request receives the previous request IDs so the API can
 * maintain prosody continuity across voice-switch boundaries.
 *
 * Returns the combined MP3 as base64 and a Drive download link.
 */

/**
 * Generates a short audio preview for a single TTS directive.
 *
 * Uses the SAME segment-boundary logic as {@link elevenLabsTextToSpeechFromDirectives}:
 *   • Locate ALL TTS directives on the tab together so relative positions are
 *     computed consistently (the locator advances its search cursor through the
 *     located list, so locating directives one-at-a-time can return different
 *     positions).
 *   • Segment i starts at position 0 when i === 0, otherwise at
 *     `located[i]._matchPos`.  This mirrors the generation function exactly and
 *     avoids the bug where previewing the first directive skips to the second
 *     one because the bookmark cursor (`_matchPos`) sits at the END of the
 *     match range rather than the start of the segment.
 *   • The segment is capped at the next directive's position (or end of text).
 *   • Only the first sentence (up to 400 chars) is sent to the API.
 *
 * No Drive file is created; audio bytes are returned as base64 for immediate
 * playback in the sidebar.
 */
function elevenLabsPreviewDirective(
  tabName: string,
  directiveName: string,
): { ok: boolean; audioBase64?: string; mimeType?: string; error?: string } {
  try {
    // Locate ALL TTS directives together — same as the full generation path.
    const allRaw    = getDirectivesOnTab_(tabName, 'TtsAgent');
    const tabText   = DocOps.getTabContent(tabName);
    const ttsRaw    = allRaw.filter((d: any) => d.type === 'tts');
    const located   = locateDirectivePositions_(ttsRaw);

    const idx = located.findIndex((d: any) => d.name === directiveName);
    if (idx < 0) return { ok: false, error: 'Directive not found or could not locate in tab text.' };

    const directive = located[idx];

    // Segment boundaries: identical to elevenLabsTextToSpeechFromDirectives.
    const segStart  = idx === 0 ? 0 : directive._insertPos;
    const segEnd    = idx + 1 < located.length ? located[idx + 1]._insertPos : tabText.length;

    if (segStart >= segEnd) return { ok: false, error: 'Directive segment is empty.' };

    // Extract first sentence from the segment (cap at 400 chars).
    const segText = tabText.slice(segStart, segEnd).trim();
    const cap     = segText.slice(0, 400);
    const sentEnd = cap.search(/[.!?](\s|$)/);
    const preview = (sentEnd >= 0 ? cap.slice(0, sentEnd + 1) : cap).trim();

    if (!preview) return { ok: false, error: 'No speakable text found in directive segment.' };

    Tracer.info(`[elevenLabsPreviewDirective] idx=${idx} start=${segStart} end=${segEnd} preview="${preview.slice(0, 80)}…"`);

    const audioBase64 = ElevenLabsService.textToSpeech(
      preview,
      directive.voice_id,
      directive.tts_model || undefined,
    );
    return { ok: true, audioBase64, mimeType: 'audio/mpeg' };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

function elevenLabsTextToSpeechFromDirectives(
  tabName: string,
  useStitching: boolean
): { ok: boolean; audioBase64?: string; driveUrl?: string; driveFileId?: string; driveFileName?: string; segmentCount?: number; error?: string } {
  try {
    const directives = getDirectivesOnTab_(tabName, 'TtsAgent');
    if (!directives.length) {
      return { ok: false, error: 'No directives found on this tab.' };
    }

    const tabText = DocOps.getTabContent(tabName);
    if (!tabText.trim()) {
      return { ok: false, error: 'Tab is empty.' };
    }

    const located = locateDirectivePositions_(directives);
    const ttsDirectives = located.filter((d: any) => d.type === 'tts');
    const breakDirectives = located.filter((d: any) => d.type === 'break');

    if (!ttsDirectives.length) {
      return { ok: false, error: 'No TTS directives found on this tab.' };
    }

    if (!located.length) {
      return { ok: false, error: 'No directives with locatable positions in tab text.' };
    }

    // Build text segments: TTS directive[i] covers text[pos[i]..pos[i+1]) or end.
    // The preamble before the first directive is read in the first TTS voice.
    type Segment = { text: string; directive: any };
    const segments: Segment[] = [];
    for (let i = 0; i < ttsDirectives.length; i++) {
      const start = i === 0 ? 0 : ttsDirectives[i]._insertPos;
      const end   = i + 1 < ttsDirectives.length ? ttsDirectives[i + 1]._insertPos : tabText.length;
      const segmentBreaks = breakDirectives.filter((d: any) => d._insertPos >= start && d._insertPos <= end);
      const text = injectBreakTags_(tabText.slice(start, end), start, segmentBreaks).trim();
      if (text) segments.push({ text, directive: ttsDirectives[i] });
    }

    // Generate audio for each segment.
    // Request IDs are tracked per voice so stitching only provides continuity
    // hints to the same voice — passing IDs from a different voice is meaningless.
    const audioChunks: number[][] = [];
    const requestIdsByVoice: Record<string, string[]> = {};

    for (const seg of segments) {
      const voiceId = seg.directive.voice_id;
      const prevIds = stitchingIdsForVoice(voiceId, requestIdsByVoice, useStitching);
      const result = ElevenLabsService.textToSpeechWithStitching(
        seg.text,
        voiceId,
        seg.directive.tts_model,
        prevIds,
        { stability: seg.directive.stability ?? 0.6, similarity_boost: seg.directive.similarity_boost ?? 0.75 }
      );
      audioChunks.push(result.audioBytes as number[]);
      recordRequestId(voiceId, result.requestId, requestIdsByVoice);
    }

    // Concatenate all MP3 byte arrays.
    const combined: number[] = [];
    for (const chunk of audioChunks) { for (const b of chunk) combined.push(b); }
    const audioBase64 = Utilities.base64Encode(combined);

    // Save to Drive under EditorLLM/audio folder.
    let driveUrl:      string | undefined;
    let driveFileId:   string | undefined;
    let driveFileName: string | undefined;
    try {
      const folderId = getOrCreateEditorLLMAudioFolder_();
      const filename  = 'tts_directives_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12) + '.mp3';
      const blob      = Utilities.newBlob(combined, 'audio/mpeg', filename);
      const fileRes   = Drive.Files.create(
        { name: filename, mimeType: 'audio/mpeg', parents: [folderId] },
        blob,
        { fields: 'id' }
      );
      driveFileId   = (fileRes as any).id as string;
      driveFileName = filename;
      Drive.Permissions.create({ role: 'reader', type: 'anyone' }, driveFileId, { sendNotificationEmail: false });
      driveUrl = `https://drive.google.com/uc?id=${driveFileId}&export=download`;
    } catch (driveErr: any) {
      Tracer.warn(`[elevenLabsTextToSpeechFromDirectives] Drive save failed: ${driveErr.message}`);
    }

    return { ok: true, audioBase64, driveUrl, driveFileId, driveFileName, segmentCount: segments.length };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

function setActiveTabByName(tabName: string): void {
  const tab = DocOps.getTabByName(tabName);
  if (tab) {
    DocumentApp.getActiveDocument().setActiveTab(tab as any);
  }
}

function getTabContent(tabName: string): string {
  return DocOps.getTabContent(tabName);
}
