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
      .addItem('Run Structural Audit', 'publisherRunStructuralAudit')
      .addItem('Build EPUB Package', 'publisherBuildEpubPackage')
      .addItem('Build ACX Package', 'publisherBuildAcxPackageFromAllAudio'))
    .addSubMenu(ui.createMenu('General Purpose')
      .addItem('Generate Instructions', 'generalPurposeAgentGenerateInstructions')
      .addItem('Process @AI Comments', 'commentProcessorRun'))
    .addSeparator()
    .addItem('Clear All Annotations', 'clearAllAnnotations')
    .addItem('Clear Active Tab Annotations', 'clearActiveTabAnnotations')
    .addItem('Force Clear Active Tab (override safety)', 'forceClearActiveTabAnnotations')
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

/**
 * Checks that the script is fully authorized (all manifest scopes granted,
 * including drive.file).  If not, shows an HTML modal dialog with a clickable
 * re-authorization link — ui.alert() cannot render hyperlinks.
 *
 * This is an editor extension (container-bound script), not a Workspace Add-on,
 * so drive.file automatically covers the active document once the user completes
 * the OAuth consent flow for the current manifest.  No per-file consent call is
 * needed.
 *
 * Returns true if fully authorized; false after prompting the user (caller should
 * abort so the user can authorize and retry).
 */
function checkDriveFileScope_(): boolean {
  const authInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
  if (authInfo.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.NOT_REQUIRED) {
    return true;
  }

  // Authorization is required — the token is missing one or more manifest scopes
  // (most likely drive.file, which was added to the manifest after the user last
  // authorized).  Show a modal with a clickable link so the user can re-authorize.
  const authUrl = authInfo.getAuthorizationUrl();
  const html = HtmlService
    .createHtmlOutput(
      '<div style="font-family:sans-serif; padding:16px 20px;">' +
      '<p style="margin:0 0 10px; font-size:13px; line-height:1.5;">' +
      'EditorLLM needs an additional permission to read and post comments on this document ' +
      '(<code>drive.file</code> scope).</p>' +
      '<p style="margin:0 0 16px; font-size:13px; line-height:1.5;">' +
      'Click the link below, complete the authorization, then retry the operation.</p>' +
      '<p style="margin:0;"><a href="' + authUrl + '" target="_blank" ' +
      'style="font-size:13px; font-weight:600; color:#1a73e8;">' +
      'Authorize EditorLLM &rarr;</a></p>' +
      '</div>'
    )
    .setWidth(420)
    .setHeight(200);
  DocumentApp.getUi().showModalDialog(html, 'EditorLLM — Authorization Required');
  return false;
}

/**
 * Ensures the script is fully authorized before running any Drive comment
 * operation.  Returns false after prompting the user so callers can abort
 * cleanly instead of surfacing a raw Drive.Comments "File not found" error.
 */
function ensureDriveFileScopeOrAbort_(operationLabel: string): boolean {
  if (checkDriveFileScope_()) return true;
  Tracer.warn(
    `[${operationLabel}] authorization incomplete — aborted pending user re-authorization`
  );
  return false;
}

// --------------- Html includes (Sidebar template) ---------------

function include(filename: string): string {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

const STARTUP_CACHE_TTL_SECS_ = 10;

function startupCache_(): GoogleAppsScript.Cache.Cache {
  return CacheService.getUserCache();
}

function startupCacheKey_(suffix: string): string {
  return `editorllm:${DocumentApp.getActiveDocument().getId()}:${suffix}`;
}

function getCachedJson_<T>(suffix: string): T | null {
  try {
    const raw = startupCache_().get(startupCacheKey_(suffix));
    return raw ? JSON.parse(raw) as T : null;
  } catch (_) {
    return null;
  }
}

function putCachedJson_(suffix: string, value: unknown, ttlSecs = STARTUP_CACHE_TTL_SECS_): void {
  try {
    startupCache_().put(startupCacheKey_(suffix), JSON.stringify(value), ttlSecs);
  } catch (_) {
    // Cache failures are non-fatal; treat them as a miss next time.
  }
}

function removeStartupCache_(suffixes: string[]): void {
  try {
    const cache = startupCache_();
    for (const suffix of suffixes) {
      cache.remove(startupCacheKey_(suffix));
    }
  } catch (_) {
    // Best-effort only.
  }
}

function invalidateTabMetadataStartupCache_(): void {
  removeStartupCache_(['tabNames']);
}

function invalidatePublisherWorkflowStartupCache_(): void {
  removeStartupCache_(['publisherWorkflowState']);
}

// --------------- Sidebar ---------------

/** Menu item: opens EditorLLM as a modeless floating dialog without requiring the sidebar first. */
function openEditorLLMDialog(): void {
  if (!checkDriveFileScope_()) return;
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
function listAvailableModels(service?: LlmServiceName, force?: boolean): string[] {
  return LLMFactory.listAvailableModelsForService(force ?? false, service);
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
  invalidateTabMetadataStartupCache_();
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
  const raw = DocPropsCache.read(keys.score);
  return {
    score:     raw !== null ? parseInt(raw, 10) : null,
    rationale: DocPropsCache.read(keys.rationale) ?? '',
    ts:        DocPropsCache.read(keys.ts) ?? '',
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
    if (!ensureDriveFileScopeOrAbort_('earTuneAnnotateTab')) return;
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
    if (!ensureDriveFileScopeOrAbort_('auditorAnnotateTab')) return;
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
    if (!ensureDriveFileScopeOrAbort_('tetherAnnotateTab')) return;
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
  Tracer.info(
    `[ttsAnnotateTab] received tabName=${JSON.stringify(tabName)}, ` +
    `getActiveTabName=${JSON.stringify(tabName ? '(not consulted)' : getActiveTabName())}, ` +
    `target=${JSON.stringify(target)}`
  );
  runTrackedJob_(`TTS → "${target || 'active tab'}"`, () => {
    if (!ensureDriveFileScopeOrAbort_('ttsAnnotateTab')) return;
    getTtsAgent().annotateTab(target as string);
  }, true);
}

function publisherGenerateInstructions(): void {
  runTrackedJob_('Publisher → Generate Instructions', () => {
    BaseAgent.clearAllAgentCaches();
    getPublisherAgent().generateInstructions();
    invalidatePublisherWorkflowStartupCache_();
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
    invalidateTabMetadataStartupCache_();
    invalidatePublisherWorkflowStartupCache_();
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
    invalidateTabMetadataStartupCache_();
    invalidatePublisherWorkflowStartupCache_();
  }, true);
  return result;
}

function buildStructuralAuditAudioTargets_(): string[] {
  const specialTabs = [
    Constants.TAB_NAMES.PUBLISHER_OPENING_CREDITS,
    Constants.TAB_NAMES.PUBLISHER_CLOSING_CREDITS,
  ];
  return Array.from(new Set(getManuscriptTabNames().concat(specialTabs)));
}

function publisherRunStructuralAudit(): {
  versionLabel: string;
  hasExplicitActiveVersion: boolean;
  versionFolderName: string;
  summary: {
    epubOk: boolean;
    audioOk: boolean;
  };
  commonChecks: Array<{ label: string; ok: boolean; detail: string }>;
  epub: {
    folderExists: boolean;
    folderUrl: string | null;
    checks: Array<{ label: string; ok: boolean; detail: string }>;
  };
  audio: {
    folderExists: boolean;
    folderUrl: string | null;
    checks: Array<{ label: string; ok: boolean; detail: string }>;
    actualFiles: string[];
  };
} {
  let result = {
    versionLabel: '0',
    hasExplicitActiveVersion: false,
    versionFolderName: '',
    summary: {
      epubOk: false,
      audioOk: false,
    },
    commonChecks: [] as Array<{ label: string; ok: boolean; detail: string }>,
    epub: {
      folderExists: false,
      folderUrl: null as string | null,
      checks: [] as Array<{ label: string; ok: boolean; detail: string }>,
    },
    audio: {
      folderExists: false,
      folderUrl: null as string | null,
      checks: [] as Array<{ label: string; ok: boolean; detail: string }>,
      actualFiles: [] as string[],
    },
  };
  runTrackedJob_('Publisher → Structural Audit', () => {
    BaseAgent.clearAllAgentCaches();

    const docId = DocumentApp.getActiveDocument().getId();
    const versionState = getStructuralAuditVersionLabel_();
    const versionFolderName = buildVersionFolderName(docId, versionState.label);

    const rootFolderId = findDriveFolderByName_(Constants.DRIVE_FOLDERS.ROOT);
    const booksFolderId = rootFolderId ? findDriveFolderChild_(rootFolderId, Constants.DRIVE_FOLDERS.BOOKS) : null;
    const projectFolderId = booksFolderId ? findDriveFolderChild_(booksFolderId, docId) : null;
    const versionFolderId = projectFolderId ? findDriveFolderChild_(projectFolderId, versionFolderName) : null;
    const epubFolderId = versionFolderId ? findDriveFolderChild_(versionFolderId, Constants.DRIVE_FOLDERS.EPUB) : null;
    const audioFolderId = versionFolderId ? findDriveFolderChild_(versionFolderId, Constants.DRIVE_FOLDERS.AUDIO) : null;

    const epubAssets = epubFolderId
      ? checkEpubAssets_(epubFolderId)
      : { contentDocx: false, coverPng: false, styleCss: false };
    const audioFiles = audioFolderId
      ? listDriveFilesInFolder_(audioFolderId, ` and mimeType='audio/mpeg' and name contains '.mp3'`, 'files(id,name)').map(file => file.name)
      : [];
    const audioTargets = buildStructuralAuditAudioTargets_();
    const audioChecks = audioTargets.map(target => {
      const matchedName = findMatchingAudioFileName_(audioFiles, target);
      const targetExists = DocOps.tabExists(target);
      return {
        label: target,
        ok: !!matchedName,
        detail: matchedName
          ? `Found ${matchedName}.`
          : (targetExists ? 'No matching MP3 found in the version Audio folder.' : 'Tab is missing and no matching MP3 was found.'),
      };
    });

    const epubChecks = [
      {
        label: 'content.docx',
        ok: epubAssets.contentDocx,
        detail: epubAssets.contentDocx ? 'Present in the version EPUB folder.' : 'Missing from the version EPUB folder.',
      },
      {
        label: 'cover.png',
        ok: epubAssets.coverPng,
        detail: epubAssets.coverPng ? 'Present in the version EPUB folder.' : 'Missing from the version EPUB folder.',
      },
      {
        label: 'style_inkfluence.css',
        ok: epubAssets.styleCss,
        detail: epubAssets.styleCss ? 'Present in the version EPUB folder.' : 'Missing from the version EPUB folder.',
      },
    ];

    result = {
      versionLabel: versionState.label,
      hasExplicitActiveVersion: versionState.explicit,
      versionFolderName,
      summary: {
        epubOk: epubChecks.every(check => check.ok),
        audioOk: audioChecks.every(check => check.ok),
      },
      commonChecks: [
        {
          label: versionState.explicit ? `Active Version: V${versionState.label}` : `Active Version: default V${versionState.label}`,
          ok: versionState.explicit,
          detail: versionState.explicit
            ? 'Document property PUBLISHER_ACTIVE_VERSION is set.'
            : 'No explicit active version is set; audit used the default V0 target.',
        },
        {
          label: `Version Folder: ${versionFolderName}`,
          ok: !!versionFolderId,
          detail: versionFolderId
            ? 'Found the versioned doc folder in EditorLLM/Books.'
            : 'Versioned doc folder is missing under EditorLLM/Books.',
        },
      ],
      epub: {
        folderExists: !!epubFolderId,
        folderUrl: epubFolderId ? `https://drive.google.com/drive/folders/${epubFolderId}` : null,
        checks: epubChecks,
      },
      audio: {
        folderExists: !!audioFolderId,
        folderUrl: audioFolderId ? `https://drive.google.com/drive/folders/${audioFolderId}` : null,
        checks: audioChecks,
        actualFiles: audioFiles,
      },
    };
    // Persist a compact summary so the sidebar status panel can show the
    // last audit result on the next load without re-running the full scan.
    try {
      const auditSummary = {
        ts: new Date().toISOString(),
        versionLabel: result.versionLabel,
        hasExplicitActiveVersion: result.hasExplicitActiveVersion,
        epubOk: result.summary.epubOk,
        audioOk: result.summary.audioOk,
        // cap audio checks to avoid hitting the 9 KB DocProps value limit
        epubChecks: result.epub.checks,
        audioChecks: result.audio.checks.slice(0, 20),
        commonChecks: result.commonChecks,
      };
      DocPropsCache.write(PUBLISHER_STRUCT_AUDIT_PROP_KEY_, JSON.stringify(auditSummary));
    } catch (_) {}
    invalidatePublisherWorkflowStartupCache_();
  }, true);
  return result;
}

// Comment Processor
function commentProcessorRun(): { replied: number; skipped: number; byAgent: Record<string, number> } {
  let result: { replied: number; skipped: number; byAgent: Record<string, number> } = { replied: 0, skipped: 0, byAgent: {} };
  runTrackedJob_('Process @AI Comments', () => {
    if (!ensureDriveFileScopeOrAbort_('commentProcessorRun')) return;
    BaseAgent.clearAllAgentCaches();
    // Ensure all built-in agents are instantiated before getAllAgents() — lazy singletons
    // won't self-register until their getter is called at least once.
    getArchitectAgent(); getEarTuneAgent(); getAuditAgent(); getTetherAgent(); getTtsAgent(); getGeneralPurposeAgent(); getPublisherAgent();
    // Instantiate custom agents that have W3 enabled so they self-register in BaseAgent.registry_.
    for (const def of CustomAgentService.listAll()) {
      if (def.workflows.w3) new CustomAgent(def);
    }
    CommentProcessor.init(BaseAgent.getAllAgents());
    result = CommentProcessor.processAll();
    Tracer.info(`[commentProcessorRun] replied=${result.replied}, skipped=${result.skipped}`);
  }, true);
  return result;
}

function clearAllAnnotations(): void {
  runTrackedJob_('Clear All Annotations', () => {
    if (!ensureDriveFileScopeOrAbort_('clearAllAnnotations')) return;
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
    if (!ensureDriveFileScopeOrAbort_('clearActiveTabAnnotations')) return;
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

function clearDirectivesOnTab(tabName: string, agentFilter?: string, opts?: { force?: boolean }): void {
  if (!DocOps.getTabByName(tabName)) {
    Tracer.warn(`[clearDirectivesOnTab] tab "${tabName}" not found`);
    return;
  }
  if (!opts?.force && !DocOps.isManagedTab(tabName)) {
    return;
  }
  if (opts?.force && !DocOps.isManagedTab(tabName)) {
    Tracer.warn(`[clearDirectivesOnTab] OVERRIDE — clearing tab "${tabName}" despite isManagedTab=false`);
  }
  const removed = DirectivePersistence.clearDirectivesOnTab(tabName, agentFilter);
  Tracer.info(`[clearDirectivesOnTab] removed ${removed} directive(s) from "${tabName}"`);
}

// ── Force-clear (override safety) ──────────────────────────────────────────
// Escape hatch for cleaning up annotations or directives that were written
// onto a tab that fails the isManagedTab check — typically stranded artefacts
// from before write-side guards were in place, or content placed on a tab
// the user has since moved into the never-processed subtree.
//
// All force paths emit Tracer.warn entries with the literal "OVERRIDE" so the
// audit trail is searchable in `clasp logs`.

function forceClearActiveTabAnnotations(): void {
  runTrackedJob_('Force Clear Active Tab', () => {
    const tabName = getActiveTabName();
    if (!tabName) {
      Tracer.warn('[forceClearActiveTabAnnotations] no active tab detected');
      return;
    }

    const ui = DocumentApp.getUi();
    const resp = ui.alert(
      'Force Clear (override safety)',
      `Clear ALL agent annotations and directives on "${tabName}"?\n\n` +
      'This bypasses the managed-tab safety check. Use only when stranded ' +
      'artefacts need cleanup on a non-managed tab.',
      ui.ButtonSet.OK_CANCEL
    );
    if (resp !== ui.Button.OK) {
      Tracer.info(`[forceClearActiveTabAnnotations] cancelled by user (tab="${tabName}")`);
      return;
    }

    if (!ensureDriveFileScopeOrAbort_('forceClearActiveTabAnnotations')) return;

    const tabId  = DocOps.getTabIdByName(tabName);
    const docTab = DocOps.getTabByName(tabName);
    if (!tabId || !docTab) {
      Tracer.warn(`[forceClearActiveTabAnnotations] tab "${tabName}" cannot be resolved`);
      return;
    }

    Tracer.warn(`[forceClearActiveTabAnnotations] OVERRIDE — clearing tab "${tabName}" (managed=${DocOps.isManagedTab(tabName)})`);
    const prefixes = ['[EarTune]', '[Auditor]', '[Tether]', '[Publisher]', '[Architect]'];
    // clearAgentAnnotations_ has no managed-tab gate of its own — proceed directly.
    CollaborationService.clearAgentAnnotations(tabId, tabName, docTab, prefixes);
    clearDirectivesOnTab(tabName, undefined, { force: true });
    CollaborationService.removeOrphanedEntitiesOnTab(tabName, { force: true });
    Tracer.info(`[forceClearActiveTabAnnotations] done`);
  }, true);
}

/**
 * Client-callable: clears directives on `tabName` ignoring the managed-tab
 * gate. Intended for the sidebar Force Clear flow.  Emits an OVERRIDE warn.
 */
function forceClearDirectivesOnTab(tabName: string, agentFilter?: string): void {
  clearDirectivesOnTab(tabName, agentFilter, { force: true });
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
    const result = TabMerger.createOrOverwriteManuscript(names);
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

// Create or Overwrite Manuscript
function createOrOverwriteManuscript(tabNames: string[]): { ok: boolean; successes: number; errors: string[] } {
  const result = TabMerger.createOrOverwriteManuscript(tabNames);
  invalidateTabMetadataStartupCache_();
  invalidatePublisherWorkflowStartupCache_();
  return result;
}

function getManuscriptTabNames(): string[] {
  return TabMerger.getSavedTabNames();
}

function saveManuscriptTabNames(csv: string): { ok: boolean } {
  return TabMerger.saveTabNames(csv);
}

// ── Managed Tabs (persistent watchlist, separate from merge tabs) ─────────────

/** DocumentProperties key for the user-maintained managed-tabs list. */
const MANAGED_TABS_PROP_KEY_ = 'managedTabNamesList';
const PUBLISHER_STRUCT_AUDIT_PROP_KEY_ = 'PUBLISHER_STRUCT_AUDIT';

/**
 * Returns the saved managed-tab names as an array.
 * Stored as a comma-separated string in DocumentProperties.
 */
function getManagedTabNamesList(): string[] {
  const raw = DocPropsCache.read(MANAGED_TABS_PROP_KEY_);
  if (!raw || !raw.trim()) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Persists the managed-tab names list to DocumentProperties.
 * Accepts a comma-separated string (same format as saveManuscriptTabNames).
 */
function saveManagedTabNamesList(csv: string): void {
  const names = csv.split(',').map(s => s.trim()).filter(Boolean);
  DocPropsCache.write(MANAGED_TABS_PROP_KEY_, names.join(','));
}

// ── ElevenLabs TTS server functions ──────────────────────────────────────────
// All functions below are called from the sidebar TTS panel via google.script.run.
// They delegate to ElevenLabsService (which owns all API key / model state)
// and follow the same naming convention: elevenLabs<Action>.

/**
 * Saves the ElevenLabs API key to UserProperties and eagerly refreshes the
 * voice-mapping cache so the directive panel shows human-readable names
 * immediately after the key is saved.
 */
function elevenLabsSaveApiKey(key: string): void {
  ElevenLabsService.saveApiKey(key);
  if (ElevenLabsService.hasApiKey()) {
    try {
      ElevenLabsService.prefetchVoiceMappings();
    } catch (_) {
      // Non-fatal — old cache (or no voices) is still acceptable.
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
 * Returns the user's ElevenLabs character quota for the credits-remaining
 * indicator in the sidebar.  Returns null on any failure (no key, network,
 * 401) so the UI can degrade silently — credits are decorative, not blocking.
 */
function elevenLabsGetUserSubscription(): ElevenLabsSubscription | null {
  try {
    return ElevenLabsService.getUserSubscription();
  } catch (e: any) {
    Tracer.warn(`[elevenLabsGetUserSubscription] ${e?.message || e}`);
    return null;
  }
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
  return getOrCreateDriveFolderByName_(Constants.DRIVE_FOLDERS.ROOT);
}

// ── Drive safety guard ────────────────────────────────────────────────────────
/**
 * Walks the Drive parent chain (max 10 hops) to verify that folderId is a
 * descendant of the EditorLLM root folder. Throws if the chain reaches a
 * Drive root without passing through the EditorLLM folder.
 * Call this before any write to a folder ID that was not created inline by
 * the current call chain (e.g. an externally-provided cover upload target).
 */
function assertInsideEditorLLMRoot_(folderId: string): void {
  const rootId = getOrCreateEditorLLMRootFolder_();
  if (folderId === rootId) return;
  let current = folderId;
  for (let depth = 0; depth < 10; depth++) {
    const file = Drive.Files.get(current, { fields: 'parents' } as any) as any;
    const parents: string[] = file?.parents || [];
    if (!parents.length) break;
    if (parents[0] === rootId) return;
    current = parents[0];
  }
  throw new Error(`Drive safety violation: folder "${folderId}" is not inside the EditorLLM root.`);
}

// ── EditorLLM/Books hierarchy ─────────────────────────────────────────────────

function getOrCreateBooksFolder_(): string {
  const rootId = getOrCreateEditorLLMRootFolder_();
  return getOrCreateDriveFolderByName_(Constants.DRIVE_FOLDERS.BOOKS, rootId);
}

function getOrCreateProjectFolder_(docId: string): string {
  const booksId = getOrCreateBooksFolder_();
  return getOrCreateDriveFolderByName_(docId, booksId);
}

function getOrCreateVersionFolder_(docId: string, label: string): string {
  const projectId = getOrCreateProjectFolder_(docId);
  return getOrCreateDriveFolderByName_(buildVersionFolderName(docId, label), projectId);
}

function getOrCreateVersionEpubFolder_(docId: string, label: string): string {
  const versionId = getOrCreateVersionFolder_(docId, label);
  return getOrCreateDriveFolderByName_(Constants.DRIVE_FOLDERS.EPUB, versionId);
}

function getOrCreateVersionAudioFolder_(docId: string, label: string): string {
  const versionId = getOrCreateVersionFolder_(docId, label);
  return getOrCreateDriveFolderByName_(Constants.DRIVE_FOLDERS.AUDIO, versionId);
}

// ── Version label helpers ─────────────────────────────────────────────────────

/** Returns the active version label from document properties, or throws if unset. */
function getActiveVersionLabel_(): string {
  const label = DocPropsCache.read('PUBLISHER_ACTIVE_VERSION');
  if (!label) throw new Error('No active version set. Create a version first from the Publisher sidebar.');
  return label;
}

/**
 * Returns the active version label, creating V0 automatically when none is set.
 * Used by TTS audio saves so they work without requiring explicit version setup.
 */
function getOrCreateDefaultVersionLabel_(): string {
  const existing = DocPropsCache.read('PUBLISHER_ACTIVE_VERSION');
  if (existing) return existing;
  const docId = DocumentApp.getActiveDocument().getId();
  const label = '0';
  getOrCreateVersionEpubFolder_(docId, label);
  getOrCreateVersionAudioFolder_(docId, label);
  DocPropsCache.write('PUBLISHER_ACTIVE_VERSION', label);
  return label;
}

// ── Audio folder (routes to active version) ───────────────────────────────────

function getOrCreateEditorLLMAudioFolder_(): string {
  const docId = DocumentApp.getActiveDocument().getId();
  const label = getOrCreateDefaultVersionLabel_();
  return getOrCreateVersionAudioFolder_(docId, label);
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

/** Finds a direct child folder by name; returns its ID or null if not found. */
function findDriveFolderChild_(parentId: string, folderName: string): string | null {
  const resp = Drive.Files.list({
    q: `'${parentId}' in parents and name="${folderName.replace(/"/g, '\\"')}" and mimeType="application/vnd.google-apps.folder" and trashed=false`,
    fields: 'files(id)',
    spaces: 'drive',
  } as any);
  const files: any[] = (resp as any).files || [];
  return files.length ? files[0].id as string : null;
}

/** Finds a Drive folder by name, optionally scoped to a direct parent. */
function findDriveFolderByName_(folderName: string, parentId?: string): string | null {
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const resp = Drive.Files.list({
    q: `mimeType="application/vnd.google-apps.folder" and name="${folderName.replace(/"/g, '\\"')}" and trashed=false${parentClause}`,
    fields: 'files(id)',
    spaces: 'drive',
  } as any);
  const files: any[] = (resp as any).files || [];
  return files.length ? files[0].id as string : null;
}

/** Permanently deletes all Drive files with the given name inside a folder. */
function deleteDriveFileByName_(folderId: string, fileName: string): void {
  const resp = Drive.Files.list({
    q: `'${folderId}' in parents and name="${fileName.replace(/"/g, '\\"')}" and trashed=false`,
    fields: 'files(id)',
    spaces: 'drive',
  } as any);
  const files: any[] = (resp as any).files || [];
  for (const f of files) Drive.Files.remove(f.id as string);
}

/** Checks which of content.docx / cover.png / style_inkfluence.css exist in an EPUB folder. */
function checkEpubAssets_(epubFolderId: string): { contentDocx: boolean; coverPng: boolean; styleCss: boolean } {
  const resp = Drive.Files.list({
    q: `'${epubFolderId}' in parents and trashed=false and (name='content.docx' or name='cover.png' or name='style_inkfluence.css')`,
    fields: 'files(name)',
    spaces: 'drive',
  } as any);
  const names = new Set(((resp as any).files || []).map((f: any) => f.name as string));
  return { contentDocx: names.has('content.docx'), coverPng: names.has('cover.png'), styleCss: names.has('style_inkfluence.css') };
}

function listDriveFilesInFolder_(
  folderId: string,
  querySuffix: string,
  fields = 'files(id,name)'
): Array<{ id: string; name: string }> {
  const resp = Drive.Files.list({
    q: `'${folderId}' in parents and trashed=false${querySuffix}`,
    fields,
    spaces: 'drive',
  } as any);
  const files: any[] = (resp as any).files || [];
  return files.map(file => ({
    id: file.id as string,
    name: file.name as string,
  }));
}

function sanitizeAudioArtifactToken_(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'untitled';
}

function findMatchingAudioFileName_(fileNames: string[], targetTabName: string): string | null {
  const prefix = `audio_${sanitizeAudioArtifactToken_(targetTabName)}`;
  const lowerNames = fileNames.map(name => String(name || '').toLowerCase());
  for (let i = 0; i < lowerNames.length; i++) {
    const lower = lowerNames[i];
    if (
      lower === `${prefix}.mp3` ||
      lower === `${prefix}_hq.mp3` ||
      lower === `${prefix}_directives.mp3` ||
      lower.indexOf(`${prefix}_`) === 0
    ) {
      return fileNames[i];
    }
  }
  return null;
}

function getStructuralAuditVersionLabel_(): { label: string; explicit: boolean } {
  const explicitLabel = DocPropsCache.read('PUBLISHER_ACTIVE_VERSION');
  if (explicitLabel && explicitLabel.trim()) {
    return { label: explicitLabel.trim(), explicit: true };
  }
  return { label: '0', explicit: false };
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

// ── Version management public API ─────────────────────────────────────────────

/** Returns the active version label, or null if none has been set. */
function publisherGetActiveVersion(): string | null {
  return DocPropsCache.read('PUBLISHER_ACTIVE_VERSION');
}

/** Sets the active version to an existing version label. */
function publisherSetActiveVersion(label: string): { ok: boolean; error?: string } {
  try {
    const docId = DocumentApp.getActiveDocument().getId();
    const projectFolderId = getOrCreateProjectFolder_(docId);
    const folderName = buildVersionFolderName(docId, label);
    const existing = Drive.Files.list({
      q: `'${projectFolderId}' in parents and name="${folderName.replace(/"/g, '\\"')}" and mimeType="application/vnd.google-apps.folder" and trashed=false`,
      fields: 'files(id)',
      spaces: 'drive',
    } as any);
    if (((existing as any).files || []).length === 0) {
      throw new Error(`Version "${label}" does not exist.`);
    }
    // Guard against concurrent version changes from multiple editors.
    const lock = LockService.getDocumentLock();
    if (lock.tryLock(3000)) {
      try {
        DocPropsCache.write('PUBLISHER_ACTIVE_VERSION', label);
      } finally {
        lock.releaseLock();
      }
    } else {
      DocPropsCache.write('PUBLISHER_ACTIVE_VERSION', label);
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/**
 * Lists all versions for this document by scanning its project folder in Drive.
 * Designed to be called asynchronously after sidebar load.
 */
function publisherListVersions(): Array<{
  label: string;
  folderId: string;
  createdTime: string;
  isActive: boolean;
  assets: { contentDocx: boolean; coverPng: boolean; styleCss: boolean };
}> {
  const docId = DocumentApp.getActiveDocument().getId();
  const activeLabel = DocPropsCache.read('PUBLISHER_ACTIVE_VERSION') || '';
  const projectFolderId = getOrCreateProjectFolder_(docId);
  const prefix = `${docId}_V`;

  const resp = Drive.Files.list({
    q: `'${projectFolderId}' in parents and mimeType="application/vnd.google-apps.folder" and trashed=false`,
    fields: 'files(id,name,createdTime)',
    orderBy: 'createdTime',
    spaces: 'drive',
  } as any);

  return ((resp as any).files || [])
    .filter((f: any) => String(f.name).startsWith(prefix))
    .map((f: any) => {
      const label = String(f.name).slice(prefix.length);
      const epubFolderId = findDriveFolderChild_(f.id as string, Constants.DRIVE_FOLDERS.EPUB);
      const assets = epubFolderId
        ? checkEpubAssets_(epubFolderId)
        : { contentDocx: false, coverPng: false, styleCss: false };
      return {
        label,
        folderId: f.id as string,
        createdTime: (f.createdTime as string) || '',
        isActive: label === activeLabel,
        assets,
      };
    });
}

/**
 * Creates a new version folder with EPUB/ and Audio/ subfolders.
 * Copies existing assets from the active version. Does NOT set the new version as active.
 * Throws (via validateVersionLabel) if the label is empty, contains invalid chars,
 * or already exists.
 */
function publisherCreateVersion(label: string): { ok: boolean; error?: string } {
  try {
    const cleanLabel = validateVersionLabel(label);
    const docId = DocumentApp.getActiveDocument().getId();
    const projectFolderId = getOrCreateProjectFolder_(docId);
    const folderName = buildVersionFolderName(docId, cleanLabel);

    // Reject duplicate labels.
    const existing = Drive.Files.list({
      q: `'${projectFolderId}' in parents and name="${folderName.replace(/"/g, '\\"')}" and mimeType="application/vnd.google-apps.folder" and trashed=false`,
      fields: 'files(id)',
      spaces: 'drive',
    } as any);
    if (((existing as any).files || []).length > 0) {
      throw new Error(`A version with label "${cleanLabel}" already exists. Choose a different label.`);
    }

    const versionFolderId = getOrCreateDriveFolderByName_(folderName, projectFolderId);
    assertInsideEditorLLMRoot_(versionFolderId);
    const newEpubFolderId = getOrCreateDriveFolderByName_(Constants.DRIVE_FOLDERS.EPUB, versionFolderId);
    getOrCreateDriveFolderByName_(Constants.DRIVE_FOLDERS.AUDIO, versionFolderId);

    // Copy assets from the currently active version (if any).
    const activeLabel = DocPropsCache.read('PUBLISHER_ACTIVE_VERSION');
    if (activeLabel) {
      const activeVersionFolderId = findDriveFolderChild_(
        projectFolderId,
        buildVersionFolderName(docId, activeLabel)
      );
      if (activeVersionFolderId) {
        const activeEpubFolderId = findDriveFolderChild_(activeVersionFolderId, Constants.DRIVE_FOLDERS.EPUB);
        if (activeEpubFolderId) {
          for (const fileName of ['content.docx', 'cover.png', 'style_inkfluence.css']) {
            const fileResp = Drive.Files.list({
              q: `'${activeEpubFolderId}' in parents and name="${fileName}" and trashed=false`,
              fields: 'files(id)',
              spaces: 'drive',
            } as any);
            const fileHits: any[] = (fileResp as any).files || [];
            if (fileHits.length) copyDriveFileIntoFolder_(fileHits[0].id as string, newEpubFolderId);
          }
        }
      }
    }

    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** Permanently deletes a version folder and all its contents. Clears the active version if it matches. */
function publisherDeleteVersion(label: string): { ok: boolean; error?: string } {
  try {
    const docId = DocumentApp.getActiveDocument().getId();
    const projectFolderId = getOrCreateProjectFolder_(docId);
    const folderName = buildVersionFolderName(docId, label);

    const resp = Drive.Files.list({
      q: `'${projectFolderId}' in parents and name="${folderName.replace(/"/g, '\\"')}" and mimeType="application/vnd.google-apps.folder" and trashed=false`,
      fields: 'files(id)',
      spaces: 'drive',
    } as any);
    const files: any[] = (resp as any).files || [];
    if (!files.length) throw new Error(`Version "${label}" not found.`);

    Drive.Files.remove(files[0].id as string);

    if (DocPropsCache.read('PUBLISHER_ACTIVE_VERSION') === label) {
      DocPropsCache.remove('PUBLISHER_ACTIVE_VERSION');
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** Returns the Drive web URL for a version folder. */
function publisherGetVersionDriveUrl(label: string): { ok: boolean; url?: string; error?: string } {
  try {
    const docId = DocumentApp.getActiveDocument().getId();
    const projectFolderId = getOrCreateProjectFolder_(docId);
    const folderName = buildVersionFolderName(docId, label);

    const resp = Drive.Files.list({
      q: `'${projectFolderId}' in parents and name="${folderName.replace(/"/g, '\\"')}" and mimeType="application/vnd.google-apps.folder" and trashed=false`,
      fields: 'files(id)',
      spaces: 'drive',
    } as any);
    const files: any[] = (resp as any).files || [];
    if (!files.length) throw new Error(`Version "${label}" not found.`);

    return { ok: true, url: `https://drive.google.com/drive/folders/${files[0].id as string}` };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/**
 * Returns true if the active version's EPUB folder already contains any files.
 * The sidebar uses this to show a write-guard confirmation before building.
 */
function publisherCheckVersionHasFiles(): { ok: boolean; hasFiles?: boolean; error?: string } {
  try {
    const label = getActiveVersionLabel_();
    const docId = DocumentApp.getActiveDocument().getId();
    const epubFolderId = getOrCreateVersionEpubFolder_(docId, label);
    const resp = Drive.Files.list({
      q: `'${epubFolderId}' in parents and trashed=false`,
      fields: 'files(id)',
      pageSize: 1,
      spaces: 'drive',
    } as any);
    return { ok: true, hasFiles: ((resp as any).files || []).length > 0 };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/**
 * Accepts a base64-encoded image from the sidebar and saves it as cover.png
 * in the active version's EPUB folder, replacing any prior cover file.
 */
function publisherUploadCoverImage(base64Data: string, mimeType: string): { ok: boolean; error?: string } {
  try {
    const docId = DocumentApp.getActiveDocument().getId();
    const label = getActiveVersionLabel_();
    const epubFolderId = getOrCreateVersionEpubFolder_(docId, label);
    assertInsideEditorLLMRoot_(epubFolderId);

    const bytes = Utilities.base64Decode(base64Data);
    const blob = Utilities.newBlob(bytes, mimeType, 'cover.png');

    deleteDriveFileByName_(epubFolderId, 'cover.png');
    Drive.Files.create(
      { name: 'cover.png', parents: [epubFolderId], mimeType: mimeType },
      blob,
      { fields: 'id' }
    );
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/**
 * Sidebar entry: walks the Publisher/Cover tab, generates one Nano Banana Pro
 * image per concept (using the prior baseline image + the concept's prompt
 * text), saves each to EditorLLM/images, and inserts the new image into the
 * doc just after the prior baseline so it becomes the new baseline.
 */
function publisherGenerateCoverImages(): {
  ok: boolean;
  folderName?: string;
  folderUrl?: string;
  results?: Array<{
    conceptName: string | null;
    conceptNumber: number | null;
    status: 'generated' | 'skipped' | 'failed';
    fileName?: string;
    fileUrl?: string;
    archivedAs?: string;
    error?: string;
  }>;
  error?: string;
} {
  let result: {
    ok: boolean;
    folderName?: string;
    folderUrl?: string;
    results?: Array<{
      conceptName: string | null;
      conceptNumber: number | null;
      status: 'generated' | 'skipped' | 'failed';
      fileName?: string;
      fileUrl?: string;
      archivedAs?: string;
      error?: string;
    }>;
    error?: string;
  } = { ok: false, error: 'Cover image generation failed.' };

  runTrackedJob_('Publisher → Generate Cover Images', () => {
    try {
      const out = CoverImageGenerator.generateCoverImages();
      result = { ok: true, ...out };
    } catch (e: any) {
      result = { ok: false, error: e.message };
    }
  }, true);

  return result;
}

function readPublisherTabContentMap_(tabNames: string[]): Record<string, string> {
  const byName: Record<string, string> = {};
  for (const name of Array.from(new Set(tabNames))) {
    byName[name] = DocOps.getTabContent(name);
  }
  return byName;
}

interface LastStructuralAudit_ {
  ts: string;
  versionLabel: string;
  hasExplicitActiveVersion: boolean;
  epubOk: boolean;
  audioOk: boolean;
  epubChecks: Array<{ label: string; ok: boolean; detail: string }>;
  audioChecks: Array<{ label: string; ok: boolean; detail: string }>;
  commonChecks: Array<{ label: string; ok: boolean; detail: string }>;
}

function getPublisherWorkflowState(): {
  instructions: { done: boolean; missingReason: string | null };
  tabs: { done: boolean; present: string[]; missing: string[] };
  structuralAudit: { done: boolean; detail: string; lastAudit: LastStructuralAudit_ | null };
  publish: {
    status: 'done' | 'partial' | 'pending';
    epubReady: boolean;
    acxReady: boolean;
    audioFiles: number;
    detail: string;
  };
} {
  const cached = getCachedJson_<{
    instructions: { done: boolean; missingReason: string | null };
    tabs: { done: boolean; present: string[]; missing: string[] };
    structuralAudit: { done: boolean; detail: string; lastAudit: LastStructuralAudit_ | null };
    publish: {
      status: 'done' | 'partial' | 'pending';
      epubReady: boolean;
      acxReady: boolean;
      audioFiles: number;
      detail: string;
    };
  }>('publisherWorkflowState');
  if (cached) return cached;

  const requiredPublisherTabs = [
    Constants.TAB_NAMES.PUBLISHER_COPYRIGHT,
    Constants.TAB_NAMES.PUBLISHER_ABOUT_AUTHOR,
    Constants.TAB_NAMES.PUBLISHER_SALES,
    Constants.TAB_NAMES.PUBLISHER_HOOKS,
    Constants.TAB_NAMES.PUBLISHER_COVER,
    Constants.TAB_NAMES.PUBLISHER_OPENING_CREDITS,
    Constants.TAB_NAMES.PUBLISHER_CLOSING_CREDITS,
  ];
  const epubRequiredTabs = [
    Constants.TAB_NAMES.PUBLISHER_COPYRIGHT,
    Constants.TAB_NAMES.MANUSCRIPT,
    Constants.TAB_NAMES.PUBLISHER_ABOUT_AUTHOR,
  ];
  const tabContentByName = readPublisherTabContentMap_([
    Constants.TAB_NAMES.PUBLISHER_INSTRUCTIONS,
    ...requiredPublisherTabs,
    ...epubRequiredTabs,
  ]);

  const instructionsContent = tabContentByName[Constants.TAB_NAMES.PUBLISHER_INSTRUCTIONS] || '';
  const instructionsDone = !isBlankPublisherContent(instructionsContent);

  const presentPublisherTabs = requiredPublisherTabs.filter(name => !isBlankPublisherContent(tabContentByName[name] || ''));
  const missingPublisherTabs = requiredPublisherTabs.filter(name => presentPublisherTabs.indexOf(name) === -1);

  const structuralAuditMissing = [
    ...(instructionsDone ? [] : [Constants.TAB_NAMES.PUBLISHER_INSTRUCTIONS]),
    ...missingPublisherTabs,
  ];
  const audioFiles = listEditorLLMAudioFiles().length;
  const epubReady = epubRequiredTabs.every(name => !isBlankPublisherContent(tabContentByName[name] || ''));
  const acxReady = audioFiles > 0;
  const publishStatus: 'done' | 'partial' | 'pending' =
    epubReady && acxReady ? 'done' : (epubReady || acxReady ? 'partial' : 'pending');

  let lastAudit: LastStructuralAudit_ | null = null;
  try {
    const raw = DocPropsCache.read(PUBLISHER_STRUCT_AUDIT_PROP_KEY_);
    if (raw) lastAudit = JSON.parse(raw) as LastStructuralAudit_;
  } catch (_) {}

  const state = {
    instructions: {
      done: instructionsDone,
      missingReason: instructionsDone ? null : 'Publisher Instructions is blank or missing.',
    },
    tabs: {
      done: missingPublisherTabs.length === 0,
      present: presentPublisherTabs,
      missing: missingPublisherTabs,
    },
    structuralAudit: {
      done: structuralAuditMissing.length === 0,
      detail: structuralAuditMissing.length === 0
        ? 'Publisher Instructions and required publisher tabs are present.'
        : `Missing required publisher artifacts: ${structuralAuditMissing.join(', ')}.`,
      lastAudit,
    },
    publish: {
      status: publishStatus,
      epubReady,
      acxReady,
      audioFiles,
      detail: `EPUB ${epubReady ? 'ready' : 'not ready'} • ACX ${acxReady ? `ready (${audioFiles} mp3)` : 'needs mp3 audio'}`,
    },
  };
  putCachedJson_('publisherWorkflowState', state);
  return state;
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
  const docId = doc.getId();
  const label = getActiveVersionLabel_();
  const epubFolderId = getOrCreateVersionEpubFolder_(docId, label);
  assertInsideEditorLLMRoot_(epubFolderId);
  const versionFolderName = buildVersionFolderName(docId, label);

  Tracer.info(`[publisherBuildEpubPackage] version="${versionFolderName}" doc="${doc.getName()}"`);

  // Assemble content into a temporary Google Doc for export.
  const tempDocFile = createGoogleDocInFolder_(`${doc.getName()} Export_V${label}`, epubFolderId);
  Tracer.info(`[publisherBuildEpubPackage] temp doc created id=${tempDocFile.id}`);

  const tempDoc = DocumentApp.openById(tempDocFile.id as string);
  const tempBody = tempDoc.getBody();
  DocOps.clearBodySafely(tempBody);

  const sequence = [
    Constants.TAB_NAMES.PUBLISHER_COPYRIGHT,
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

  // Export the assembled doc as DOCX.
  const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const exportUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(tempDocFile.id as string)}/export?mimeType=${encodeURIComponent(docxMime)}`;
  const response = UrlFetchApp.fetch(exportUrl, {
    method: 'get',
    headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
    muteHttpExceptions: true,
  });
  Tracer.info(`[publisherBuildEpubPackage] DOCX export response code=${response.getResponseCode()}`);
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error(`DOCX export failed (${response.getResponseCode()}).`);
  }

  // Clean up temp doc now that we have the blob.
  Drive.Files.remove(tempDocFile.id as string);

  // Write content.docx into the EPUB folder (overwrite if present).
  deleteDriveFileByName_(epubFolderId, 'content.docx');
  Drive.Files.create(
    { name: 'content.docx', parents: [epubFolderId], mimeType: docxMime },
    response.getBlob().setName('content.docx'),
    { fields: 'id' }
  );
  Tracer.info('[publisherBuildEpubPackage] saved content.docx');

  // Write style_inkfluence.css from the Visual Styles tab (if present).
  const visualStylesMarkdown = DocOps.getTabContent(Constants.TAB_NAMES.PUBLISHER_VISUAL_STYLES);
  if (visualStylesMarkdown && visualStylesMarkdown.trim()) {
    const cssContent = extractCssFromTab(visualStylesMarkdown);
    deleteDriveFileByName_(epubFolderId, 'style_inkfluence.css');
    Drive.Files.create(
      { name: 'style_inkfluence.css', parents: [epubFolderId], mimeType: 'text/css' },
      Utilities.newBlob(cssContent, 'text/css', 'style_inkfluence.css'),
      { fields: 'id' }
    );
    Tracer.info('[publisherBuildEpubPackage] saved style_inkfluence.css');
  }

  invalidatePublisherWorkflowStartupCache_();

  return {
    ok: true,
    folderName: versionFolderName,
    folderUrl: `https://drive.google.com/drive/folders/${epubFolderId}`,
    fileName: 'content.docx',
  };
}

function publisherBuildAcxPackageImpl_(audioFileIds: string[]): { ok: true; folderName: string; folderUrl: string; copied: string[] } {
  if (!Array.isArray(audioFileIds) || !audioFileIds.length) {
    throw new Error('No audio files selected.');
  }

  const docId = DocumentApp.getActiveDocument().getId();
  const label = getActiveVersionLabel_();
  const audioFolderId = getOrCreateVersionAudioFolder_(docId, label);
  assertInsideEditorLLMRoot_(audioFolderId);
  const versionFolderName = buildVersionFolderName(docId, label);

  Tracer.info(`[publisherBuildAcxPackage] version="${versionFolderName}" files=${audioFileIds.length}`);

  const copiedNames: string[] = [];
  for (const fileId of audioFileIds) {
    const copied = copyDriveFileIntoFolder_(fileId, audioFolderId);
    copiedNames.push(copied.name);
    Tracer.info(`[publisherBuildAcxPackage] copied "${copied.name}"`);
  }

  return {
    ok: true,
    folderName: versionFolderName,
    folderUrl: `https://drive.google.com/drive/folders/${audioFolderId}`,
    copied: copiedNames,
  };
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
 * Returns the title of the tab the user currently has open.
 * Falls back to the first tab if getActiveTab() is not supported or returns null.
 */
function getActiveTabName(): string | null {
  const cached = getCachedJson_<string | null>('activeTabName');
  if (cached !== null) return cached;

  const doc = DocumentApp.getActiveDocument();
  const active = (doc as any).getActiveTab?.();
  if (active) {
    const title = active.getTitle() as string;
    putCachedJson_('activeTabName', title);
    return title;
  }
  const tabs = doc.getTabs();
  const fallback = tabs.length > 0 ? tabs[0].getTitle() : null;
  putCachedJson_('activeTabName', fallback);
  return fallback;
}

// Tab list (used by sidebar dropdowns)
function getTabNames(): string[] {
  const cached = getCachedJson_<string[]>('tabNames');
  if (cached) return cached;

  const doc = DocumentApp.getActiveDocument();
  const names: string[] = [];

  function collect(tabs: GoogleAppsScript.Document.Tab[]): void {
    for (const tab of tabs) {
      names.push(tab.getTitle());
      collect(tab.getChildTabs());
    }
  }

  collect(doc.getTabs());
  putCachedJson_('tabNames', names);
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

/**
 * Returns TTS directives for the tab. Break directives are augmented with a
 * `_previewText` field (first two words of tab text after the break position)
 * so the directive list can show a live location hint.
 */
function getTabDirectives(tabName: string): any[] {
  const directives = getDirectivesOnTab_(tabName, 'TtsAgent');
  const hasBreaks = directives.some((d: any) => d.type === 'break');
  if (!hasBreaks) return directives;
  const tabText = DocOps.getTabContent(tabName);
  return directives.map((d: any) => {
    if (d.type === 'break' && Number.isFinite(d._insertPos)) {
      const words = tabText.slice(d._insertPos as number).trimStart().split(/\s+/).slice(0, 2).join(' ');
      return { ...d, _previewText: words };
    }
    return d;
  });
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

function addBreakDirectiveFromSelection(
  tabName: string,
  timeMs: number
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
    throw new Error('Place the cursor in the document before adding a break.');
  }
  const surrounding = cursor.getSurroundingText();
  if (!surrounding) {
    throw new Error('Cursor must be inside text before adding a break.');
  }
  const off = cursor.getSurroundingTextOffset();
  const len = surrounding.getText().length;
  if (len <= 0 || off < 0 || off >= len) {
    throw new Error('Cursor must be placed before a character to add a break.');
  }

  const range = docTab.newRange()
    .addElement(surrounding, off, off)
    .build();
  DirectivePersistence.createDirectiveAtRange(
    docTab,
    'TtsAgent',
    'break',
    { timeMs },
    range
  );
  return true;
}

function locateDirectivePositions_(directives: any[]): any[] {
  return directives
    .filter((d: any) => Number.isFinite(d._insertPos) && d._insertPos >= 0)
    .sort((a: any, b: any) => a._insertPos - b._insertPos);
}

/**
 * Collapses break directives that share the EXACT same `_insertPos` into a
 * single break with the maximum duration.  Breaks at distinct positions are
 * always preserved — even when no TTS event sits between them — because the
 * text between them must be voiced followed by silence at each break point.
 *
 * Same-position duplicates do happen in practice, e.g. when an LLM emits an
 * explicit break for "..." and the auto-injected ellipsis break also matches
 * the same offset.  In that case the longest duration wins.
 *
 * Breaks before the first TTS directive are discarded (no voice context).
 * A break is trailing (and discarded) only when its `_insertPos` is at or
 * beyond `tabTextLength` — i.e. there is no text remaining after the break.
 */
function deduplicateConsecutiveBreaks_(sortedEvents: any[], tabTextLength: number): any[] {
  const result: any[] = [];
  let pendingBreak: any | null = null;
  let seenFirstTts = false;

  const flushPending = () => {
    if (pendingBreak !== null) {
      result.push(pendingBreak);
      pendingBreak = null;
    }
  };

  for (const event of sortedEvents) {
    if (event.type === 'tts') {
      seenFirstTts = true;
      flushPending();
      result.push(event);
    } else if (event.type === 'break') {
      if (!seenFirstTts) continue; // ignore breaks before first TTS
      const ms = Number(event.payload?.timeMs ?? 0);
      if (pendingBreak === null) {
        pendingBreak = { ...event, payload: { timeMs: ms } };
      } else if (pendingBreak._insertPos === event._insertPos) {
        // Same cursor location — keep the longer duration.
        const prevMs = Number(pendingBreak.payload?.timeMs ?? 0);
        pendingBreak = { ...pendingBreak, payload: { timeMs: Math.max(prevMs, ms) } };
      } else {
        // Different cursor location — both breaks are valid; flush the
        // previous one and start tracking the new one.  Text between them
        // must still be voiced.
        flushPending();
        pendingBreak = { ...event, payload: { timeMs: ms } };
      }
    }
  }
  // Discard trailing break only when there is no text remaining after it.
  if (pendingBreak !== null && pendingBreak._insertPos < tabTextLength) {
    result.push(pendingBreak);
  }
  return result;
}

/**
 * Core audio segment builder — pure function with injected ElevenLabs caller for testability.
 *
 * Processes all TTS + break directives for a tab and produces a flat array of
 * AudioSegmentItem values ready for client-side assembly:
 *   - {type:'audio', audioBase64}  — MP3 bytes from a single ElevenLabs call
 *   - {type:'break', durationMs}   — silence to be generated client-side via ffmpeg
 *
 * Algorithm:
 *   1. Sort all events by _insertPos.
 *   2. Deduplicate consecutive breaks (keep the longest); discard breaks before
 *      the first TTS event and breaks whose _insertPos >= tabText.length (nothing
 *      to voice after them).
 *   3. Walk events in order.  A TTS event updates the current voice and generates
 *      audio for text[event._insertPos .. nextEvent._insertPos).  The first TTS
 *      event also includes preamble text from position 0.
 *   4. When a TTS event switches voice_id relative to the previous TTS event and
 *      no explicit break has been seen between them, a 1 s silence is
 *      auto-inserted before the new voice begins.
 *   5. A break event appends a break item, then generates audio for the text
 *      that follows it (still under the current voice) up to the next event.
 *   6. If the result contains any audio, a 2 s silence is prepended and appended
 *      to the entire sequence (leader/trailer silence).
 *   7. Stitching request IDs are accumulated per voice across the entire tab,
 *      including across break boundaries, so ElevenLabs maintains prosody continuity.
 */
function buildAudioSegments_(
  allDirectives: any[],
  tabText: string,
  useStitching: boolean,
  callElevenLabs: (
    text: string,
    voiceId: string,
    modelId: string,
    prevIds: string[],
    voiceSettings: { stability: number; similarity_boost: number }
  ) => { audioBytes: number[]; requestId: string }
): AudioSegmentItem[] {
  const located = locateDirectivePositions_(allDirectives);
  const ttsDirectives = located.filter((d: any) => d.type === 'tts');
  if (!ttsDirectives.length) return [];

  // Merge and deduplicate
  const allEvents = [...located].sort((a: any, b: any) => a._insertPos - b._insertPos);
  const events = deduplicateConsecutiveBreaks_(allEvents, tabText.length);

  const result: AudioSegmentItem[] = [];
  const requestIdsByVoice: Record<string, string[]> = {};
  let currentDirective: any | null = null;
  let firstTtsSeen = false;
  let prevVoiceId: string | null = null;
  let breakSeenSinceTts = false;

  function generateAudio_(text: string, directive: any): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const voiceId = directive.voice_id as string;
    const prevIds = stitchingIdsForVoice(voiceId, requestIdsByVoice, useStitching);
    const res = callElevenLabs(
      trimmed,
      voiceId,
      directive.tts_model as string,
      prevIds,
      { stability: directive.stability ?? 0.6, similarity_boost: directive.similarity_boost ?? 0.75 }
    );
    recordRequestId(voiceId, res.requestId, requestIdsByVoice);
    result.push({ type: 'audio', audioBase64: Utilities.base64Encode(res.audioBytes) });
  }

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const nextPos = i + 1 < events.length ? events[i + 1]._insertPos : tabText.length;

    if (event.type === 'tts') {
      const voiceId = event.voice_id as string;
      // Auto-insert 1s silence at voice switches with no explicit break.
      if (prevVoiceId !== null && voiceId !== prevVoiceId && !breakSeenSinceTts) {
        result.push({ type: 'break', durationMs: 1000 });
      }
      // First TTS event includes the preamble (text before position 0..event.pos).
      const textStart = !firstTtsSeen ? 0 : event._insertPos;
      firstTtsSeen = true;
      currentDirective = event;
      prevVoiceId = voiceId;
      breakSeenSinceTts = false;
      generateAudio_(tabText.slice(textStart, nextPos), currentDirective);

    } else if (event.type === 'break') {
      breakSeenSinceTts = true;
      const durationMs = Number(event.payload?.timeMs ?? 0);
      if (durationMs > 0) {
        result.push({ type: 'break', durationMs });
      }
      // Text after the break (up to the next event) is voiced by the current directive.
      if (currentDirective) {
        generateAudio_(tabText.slice(event._insertPos, nextPos), currentDirective);
      }
    }
  }

  // Wrap the entire recording with 2s silence at start and end.
  const hasAudio = result.some(s => s.type === 'audio');
  if (hasAudio) {
    result.unshift({ type: 'break', durationMs: 2000 });
    result.push({ type: 'break', durationMs: 2000 });
  }

  return result;
}

function setActiveTabByName(tabName: string): void {
  const tab = DocOps.getTabByName(tabName);
  if (tab) {
    DocumentApp.getActiveDocument().setActiveTab(tab as any);
    putCachedJson_('activeTabName', tabName);
  }
}

function getTabContent(tabName: string): string {
  return DocOps.getTabContent(tabName);
}

// ── Custom Agents ─────────────────────────────────────────────────────────────

/** Returns all custom agents visible to the current user (own + document-shared). */
function listCustomAgents(): { agents: CustomAgentDefinition[]; currentUserEmail: string } {
  const email = (() => { try { return Session.getActiveUser().getEmail() ?? ''; } catch (_) { return ''; } })();
  return { agents: CustomAgentService.listAll(), currentUserEmail: email };
}

/**
 * Validates and saves (or updates) a custom agent definition.
 * Pass `id` to update an existing agent; omit to create a new one.
 * Returns the saved definition (with generated id and timestamps).
 */
function saveCustomAgent(def: Partial<CustomAgentDefinition>): { ok: boolean; agent?: CustomAgentDefinition; error?: string } {
  try {
    const saved = CustomAgentService.save(def);
    return { ok: true, agent: saved };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** Deletes a custom agent by id. Only the owner can delete document-shared agents. */
function deleteCustomAgent(id: string): { ok: boolean; error?: string } {
  try {
    CustomAgentService.remove(id);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/**
 * Promotes a user-stored agent to Document Properties, making it visible to
 * all collaborators. The owner's email is stored with the definition so others
 * know who to contact for changes.
 */
function promoteCustomAgentToDocument(id: string): { ok: boolean; agent?: CustomAgentDefinition; error?: string } {
  try {
    const agent = CustomAgentService.promoteToDocument(id);
    return { ok: true, agent };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** Promotes an agent to Script Properties so all users across all documents can use it. */
function promoteCustomAgentToScript(id: string): { ok: boolean; agent?: CustomAgentDefinition; error?: string } {
  try {
    const agent = CustomAgentService.promoteToScript(id);
    return { ok: true, agent };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** Moves a document-shared agent back to User Properties (owner only). */
function demoteCustomAgentToUser(id: string): { ok: boolean; agent?: CustomAgentDefinition; error?: string } {
  try {
    const agent = CustomAgentService.demoteToUser(id);
    return { ok: true, agent };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ── Annotation auto-cleanup ────────────────────────────────────────────────

/**
 * Time-based trigger handler — invoked by GAS scheduler, not by the sidebar.
 * Polls for resolved agent-created comments and clears their annotation artifacts.
 */
function autoCleanupAnnotations(): void {
  try {
    const result = AnnotationAutoCleanup.run();
    Tracer.info(
      `[autoCleanupAnnotations] cleared=${result.cleared} ` +
      `skipped=${result.skipped} errors=${result.errors}`
    );
  } catch (e: any) {
    Tracer.error(`[autoCleanupAnnotations] ${e}`);
  }
}

function enableAnnotationAutoCleanup(intervalMinutes: number): { ok: boolean; error?: string } {
  try {
    AnnotationAutoCleanup.installTrigger(intervalMinutes);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

function disableAnnotationAutoCleanup(): { ok: boolean; error?: string } {
  try {
    AnnotationAutoCleanup.removeTrigger();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

function getAnnotationAutoCleanupStatus(): { enabled: boolean; intervalMinutes?: number } {
  return AnnotationAutoCleanup.status();
}

/**
 * Runs W2 (annotateTab) for the named custom agent on the given tab.
 * tabName defaults to the currently active tab.
 */
function runCustomAgentAnnotate(agentId: string, tabName?: string): void {
  const def = CustomAgentService.findById(agentId);
  if (!def) throw new Error(`Custom agent id=${agentId} not found.`);
  const target = tabName || getActiveTabName();
  if (!target) throw new Error('No active tab detected.');
  runTrackedJob_(`${def.displayName} → "${target}"`, () => {
    if (!ensureDriveFileScopeOrAbort_('runCustomAgentAnnotate')) return;
    BaseAgent.clearAllAgentCaches();
    new CustomAgent(def).annotateTab(target);
  }, true);
}

/**
 * Runs W3 (handleCommentThreads) for all custom agents that have W3 enabled.
 * Called via the existing "Process @AI Comments" flow; exposed separately so
 * the UI can also trigger it standalone.
 */
function runCustomAgentComments(): { replied: number; skipped: number; byAgent: Record<string, number> } {
  let result: { replied: number; skipped: number; byAgent: Record<string, number> } = { replied: 0, skipped: 0, byAgent: {} };
  runTrackedJob_('Process Custom Agent Comments', () => {
    if (!ensureDriveFileScopeOrAbort_('runCustomAgentComments')) return;
    BaseAgent.clearAllAgentCaches();
    for (const def of CustomAgentService.listAll()) {
      if (def.workflows.w3) new CustomAgent(def);
    }
    CommentProcessor.init(BaseAgent.getAllAgents());
    result = CommentProcessor.processAll();
  }, true);
  return result;
}

// ── W6 — Run with Context ────────────────────────────────────────────────────

/**
 * W6: Reads a content tab, applies the agent's system prompt + instruction/context
 * tabs + a user-supplied refine action, and writes the result to an output tab.
 * The output tab must already exist — this function never creates tabs.
 */
function runCustomAgentW6(
  agentId: string,
  contentTabName: string,
  refineAction: string,
  outputTabName: string
): { ok: boolean; outputTabName: string; error?: string } {
  const def = CustomAgentService.findById(agentId);
  if (!def) return { ok: false, outputTabName, error: `Agent id=${agentId} not found.` };

  // Output tab must exist
  const outputDocTab = DocOps.getTabByName(outputTabName);
  if (!outputDocTab) {
    return {
      ok: false, outputTabName,
      error: `Output tab "${outputTabName}" not found. Please create it first.`,
    };
  }

  // Read content tab
  const content = MarkdownService.tabToMarkdown(contentTabName);
  if (!content || !content.trim()) {
    return { ok: false, outputTabName, error: `Content tab "${contentTabName}" is empty or not found.` };
  }

  let result = '';
  runTrackedJob_(`${def.displayName} W6 — "${contentTabName}" → "${outputTabName}"`, () => {
    // Build system prompt: agent system prompt + instruction tab
    const instructions = def.instructionTabName ? MarkdownService.tabToMarkdown(def.instructionTabName) : '';
    const systemParts: string[] = [def.systemPrompt];
    if (instructions) systemParts.push('\n\n## Agent Instructions\n\n' + instructions);
    const systemPrompt = systemParts.join('');

    // Build user prompt: context + content + refine action
    const context = def.contextTabName ? MarkdownService.tabToMarkdown(def.contextTabName) : '';
    const userParts: string[] = [];
    if (context) userParts.push('## Context\n\n' + context);
    userParts.push('## Content to Process\n\n' + content);
    userParts.push('## Refine Action\n\n' + refineAction);
    userParts.push(
      '## Your Task\n\n' +
      'Apply the refine action to the content above. ' +
      'Write the full output in GitHub-Flavoured Markdown. ' +
      'Output the refined content directly — no preamble, no meta-commentary.'
    );
    const userPrompt = userParts.join('\n\n');

    result = String(GeminiService.generate(systemPrompt, userPrompt, Constants.MODEL.THINKING));

    // Write to output tab (overwrite)
    MarkdownService.writeMarkdownToBody(result, outputDocTab.getBody());
  }, true);

  return { ok: true, outputTabName };
}

// ── Agent export / import ────────────────────────────────────────────────────

/**
 * Exports agent definitions to a JSON string.
 * When ids is empty or omitted, all visible agents are exported.
 * Each entry includes bundled tab content for instruction and context tabs
 * so the agent can be fully recreated in another document.
 */
function exportCustomAgents(ids?: string[]): { ok: boolean; json?: string; error?: string } {
  // Always-on Tracer job so the result is visible in the Logs panel
  // regardless of debug-mode setting (same pattern as runStartupJob_).
  Tracer.startJob('Export Agents');
  try {
    const json = CustomAgentService.exportAgents(ids || []);
    let count = 0;
    try { count = (JSON.parse(json) as { agents: unknown[] }).agents.length; } catch (_) {}
    Tracer.info(`Exported ${count} agent(s) to JSON.`);
    Tracer.finishJob();
    return { ok: true, json };
  } catch (e: any) {
    Tracer.error(`Export failed: ${e.message}`);
    Tracer.failJob(e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Imports agents from a JSON string produced by exportCustomAgents().
 * Each agent is saved to User Properties (personal tier).
 * Agents whose tag already exists are skipped (not overwritten) — this is
 * logged as a warning so the user can see exactly which tags collided.
 */
function importCustomAgents(json: string): { ok: boolean; imported: number; skipped: string[]; errors: string[] } {
  // Always-on Tracer job so skips, errors, and successes are all visible
  // in the Logs panel and "Copy all logs" output.
  Tracer.startJob('Import Agents');
  try {
    const result = CustomAgentService.importAgents(json);
    if (result.imported > 0) {
      Tracer.info(`Imported ${result.imported} agent(s).`);
    }
    if (result.skipped.length) {
      Tracer.warn(
        `Skipped ${result.skipped.length} agent(s) — tag already exists in this document: ` +
        result.skipped.join(', ') +
        '. To reimport with a different name, also change the @tag in the JSON.'
      );
    }
    if (result.errors.length) {
      Tracer.error(`Import errors: ${result.errors.join('; ')}`);
    }
    if (result.imported === 0 && result.skipped.length === 0 && result.errors.length === 0) {
      Tracer.warn('No agents were found in the import payload.');
    }
    Tracer.finishJob();
    return { ok: true, ...result };
  } catch (e: any) {
    Tracer.error(`Import failed: ${e.message}`);
    Tracer.failJob(e.message);
    return { ok: false, imported: 0, skipped: [], errors: [e.message] };
  }
}

// ── Agent Team CRUD ───────────────────────────────────────────────────────────

/**
 * Returns all agent teams visible to the current user.
 */
function listAgentTeams(): AgentTeamDefinition[] {
  return AgentTeamService.listAll();
}

/**
 * Saves (creates or updates) an agent team definition.
 */
function saveAgentTeam(def: Partial<AgentTeamDefinition>): { ok: boolean; team?: AgentTeamDefinition; error?: string } {
  try {
    const team = AgentTeamService.save(def);
    return { ok: true, team };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/**
 * Deletes an agent team by id.
 */
function deleteAgentTeam(id: string): { ok: boolean; error?: string } {
  try {
    AgentTeamService.remove(id);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/**
 * Promotes a user-owned team to Document Properties.
 */
function promoteAgentTeamToDocument(id: string): { ok: boolean; team?: AgentTeamDefinition; error?: string } {
  try {
    const team = AgentTeamService.promoteToDocument(id);
    return { ok: true, team };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/**
 * Exports agent teams to a JSON string.
 */
function exportAgentTeams(ids?: string[]): { ok: boolean; json?: string; error?: string } {
  try {
    const json = AgentTeamService.exportTeams(ids || []);
    return { ok: true, json };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/**
 * Imports agent teams from a JSON string.
 */
function importAgentTeams(json: string): { ok: boolean; imported: number; skipped: string[]; errors: string[] } {
  try {
    const result = AgentTeamService.importTeams(json);
    return { ok: true, ...result };
  } catch (e: any) {
    return { ok: false, imported: 0, skipped: [], errors: [e.message] };
  }
}

// ── Agentic Team Analysis ─────────────────────────────────────────────────────

/**
 * Starts or continues an Agentic Team Analysis.
 * Called in a loop by the client until status === 'complete'.
 *
 * One analysis per (team + sourceTab + calendar day).
 * To restart, delete the output tab.
 */
function startOrContinueTeamAnalysis(teamId: string, sourceTabName: string, outputTabName: string): TeamAnalysisResult {
  return AgentTeamAnalysis.startOrContinue(teamId, sourceTabName, outputTabName);
}

// ── Manifest Generation ───────────────────────────────────────────────────────

/**
 * Builds an AudioManifest from TTS directives on the specified tab.
 * Sections are ordered by document position (same order as audio generation).
 *
 * - TTS directives → speech sections with voice/model params
 * - Break directives → silence sections with duration
 *
 * Returns null if the tab does not exist or has no TTS directives.
 */
function buildManifest(tabName: string): AudioManifest | null {
  const tab = DocOps.getTabByName(tabName);
  if (!tab) return null;

  const directives = DirectivePersistence.listDirectivesOnTab(tabName);
  if (!directives.length) return null;

  const doc = DocumentApp.getActiveDocument();

  // Full body text — offsets from _rangeStart align with body.getText() positions
  // because buildBodyTextIndex_ adds exactly 1 character between paragraph children,
  // matching the \n separator that body.getText() produces.
  const bodyText = tab.getBody().getText();

  // ── Semantic rule: a break directive is a PAUSE, not a speaker change.
  //
  // A TTS directive sets the current voice and that voice remains active for
  // all text until the *next* TTS directive changes it.  Break directives
  // within a voice region simply split it into speech+silence+speech segments
  // — all using the same voice.
  //
  // Algorithm:
  //   • Keep running voice state (curVoice*).
  //   • Keep textPos = start of the next speech segment within the current voice.
  //   • On a TTS directive  → flush speech [textPos, pos) in current voice,
  //                           update voice, advance textPos.
  //   • On a break directive → flush speech [textPos, pos) in current voice,
  //                            emit silence, advance textPos (voice unchanged).
  //   • After all directives → flush any remaining text in current voice.

  const rawSections: ManifestSection[] = [];

  const voiceMap = ElevenLabsService.ensureVoiceMappings() ?? {};

  let curVoiceId         = '';
  let curVoiceName       = '';
  let curTtsModel        = '';
  let curStability       = 0.5;
  let curSimilarityBoost = 0.75;
  let hasVoice           = false;
  let textPos            = 0;   // start of next speech segment

  function flushSpeech_(upTo: number): void {
    if (!hasVoice || upTo <= textPos) return;
    const text = bodyText.slice(textPos, upTo).trim();
    if (!text) return;
    rawSections.push({
      id:              Utilities.getUuid().replace(/-/g, ''),
      type:            'speech',
      text,
      voiceId:         curVoiceId,
      voiceName:       curVoiceName,
      ttsModel:        curTtsModel,
      stability:       curStability,
      similarityBoost: curSimilarityBoost,
    });
  }

  for (const d of (directives as any[])) {
    // _rangeStart === -1 for directives outside the body text index (table cells etc.)
    const pos: number = d._rangeStart >= 0 ? d._rangeStart : -1;

    if (d.type === 'tts') {
      if (pos >= 0) flushSpeech_(pos);
      // Switch voice.
      curVoiceId         = d.voice_id ?? '';
      curVoiceName       = (voiceMap as Record<string, string>)[curVoiceId] ?? '';
      curTtsModel        = d.tts_model ?? '';
      curStability       = typeof d.stability       === 'number' ? d.stability       : 0.5;
      curSimilarityBoost = typeof d.similarity_boost === 'number' ? d.similarity_boost : 0.75;
      hasVoice           = true;
      if (pos >= 0) textPos = pos;
    } else {
      // break / ellipsis_break — pause in the current voice.
      if (pos >= 0) flushSpeech_(pos);
      const durationMs: number =
        (typeof d.payload?.timeMs      === 'number' ? d.payload.timeMs      : 0) ||
        (typeof d.payload?.duration_ms === 'number' ? d.payload.duration_ms : 0);
      rawSections.push({
        id:         Utilities.getUuid().replace(/-/g, ''),
        type:       'silence',
        durationMs,
      });
      if (pos >= 0) textPos = pos;   // resume after the pause at the same position
    }
  }

  // Flush any remaining text after the last directive.
  flushSpeech_(bodyText.length);

  // Collapse consecutive silence sections: sum durations, keep the first id.
  const sections: ManifestSection[] = [];
  for (const section of rawSections) {
    const prev = sections[sections.length - 1];
    if (section.type === 'silence' && prev && prev.type === 'silence') {
      (prev as any).durationMs += (section as any).durationMs;
    } else {
      sections.push(section);
    }
  }

  // Log each section and the total.
  const speechCount  = sections.filter((s: any) => s.type === 'speech').length;
  const silenceCount = sections.filter((s: any) => s.type === 'silence').length;
  sections.forEach((s: any, i: number) => {
    if (s.type === 'speech') {
      Tracer.info(`buildManifest: section ${i + 1} — speech | voice: ${s.voiceName || s.voiceId} | ${s.text.length} chars`);
    } else {
      Tracer.info(`buildManifest: section ${i + 1} — silence | ${s.durationMs} ms`);
    }
  });
  Tracer.info(`buildManifest: exported ${sections.length} section(s) total — ${speechCount} speech, ${silenceCount} silence — tab: "${tabName}"`);

  const manifest: AudioManifest = {
    version:       1,
    documentTitle: doc.getName(),
    tabName,
    generatedAt:   new Date().toISOString(),
    sections,
  };

  return manifest;
}

/**
 * Builds an AudioManifest for a special (credits / about-author) tab.
 *
 * If the tab has TTS directives, defers to buildManifest.
 * If not, falls back to the raw body text as a single speech section with an
 * empty voiceId — the user can assign a voice in the desktop app.
 *
 * allowMultiple = false → throws if the result contains more than 1 speech section.
 */
function buildSpecialManifest_(tabName: string, allowMultiple: boolean): AudioManifest | null {
  const tab = DocOps.getTabByName(tabName);
  if (!tab) return null;

  const fromDirectives = buildManifest(tabName);
  if (fromDirectives) {
    if (!allowMultiple) {
      const speechCount = fromDirectives.sections.filter((s: any) => s.type === 'speech').length;
      if (speechCount > 1) {
        throw new Error(
          `"${tabName}" must have exactly 1 TTS directive but found ${speechCount}. ` +
          'Remove the extra directives before exporting.',
        );
      }
    }
    return fromDirectives;
  }

  // Fallback: raw body text as a single voiceless speech section.
  const bodyText = tab.getBody().getText().trim();
  if (!bodyText) return null;

  const doc = DocumentApp.getActiveDocument();
  const sections: ManifestSection[] = [{
    id:              Utilities.getUuid().replace(/-/g, ''),
    type:            'speech',
    text:            bodyText,
    voiceId:         '',
    voiceName:       '',
    ttsModel:        '',
    stability:       0.5,
    similarityBoost: 0.75,
  }];

  Tracer.info(`buildSpecialManifest_: built fallback section from raw text — tab: "${tabName}"`);
  return {
    version:       1,
    documentTitle: doc.getName(),
    tabName,
    generatedAt:   new Date().toISOString(),
    sections,
  };
}

function exportPartialManifest(tabName: string): PartialManifest | null {
  // Publisher tabs that contain no audio content — export not meaningful.
  const PROHIBITED: Record<string, string> = {
    [Constants.TAB_NAMES.PUBLISHER_SALES]:
      'Sales copy is for EPUB publishing, not ACX audio. Cannot export as a manifest.',
    [Constants.TAB_NAMES.PUBLISHER_HOOKS]:
      'Hooks are for EPUB publishing, not ACX audio. Cannot export as a manifest.',
    [Constants.TAB_NAMES.PUBLISHER_COVER]:
      'Cover tab contains design prompts, not audio content. Cannot export as a manifest.',
    [Constants.TAB_NAMES.PUBLISHER_VISUAL_STYLES]:
      'Visual Styles is for EPUB styling. Cannot export as a manifest.',
    [Constants.TAB_NAMES.PUBLISHER_COPYRIGHT]:
      'Copyright tab is document metadata, not audio content. Cannot export as a manifest.',
    [Constants.TAB_NAMES.PUBLISHER_INSTRUCTIONS]:
      'Publisher Instructions is a system-prompt tab. Cannot export as a manifest.',
  };

  // Special audio section tabs — exported under a named root key only.
  const SPECIAL: Record<string, { key: PartialManifestKind; allowMultiple: boolean }> = {
    [Constants.TAB_NAMES.PUBLISHER_OPENING_CREDITS]: { key: 'openingCredits', allowMultiple: false },
    [Constants.TAB_NAMES.PUBLISHER_CLOSING_CREDITS]: { key: 'closingCredits', allowMultiple: false },
    [Constants.TAB_NAMES.PUBLISHER_ABOUT_AUTHOR]:    { key: 'aboutAuthor',    allowMultiple: true  },
  };

  const prohibited = PROHIBITED[tabName];
  if (prohibited) throw new Error(prohibited);

  const specialConfig = SPECIAL[tabName];
  if (specialConfig) {
    const inner = buildSpecialManifest_(tabName, specialConfig.allowMultiple);
    if (!inner) return null;
    return { [specialConfig.key]: inner } as PartialManifest;
  }

  // Chapter tab: include chapter + all available credits (best-effort).
  const chapter = buildManifest(tabName);
  if (!chapter) return null;

  const result: PartialManifest = { chapter };

  try {
    const oc = buildSpecialManifest_(Constants.TAB_NAMES.PUBLISHER_OPENING_CREDITS, false);
    if (oc) result.openingCredits = oc;
  } catch (_) { /* non-fatal */ }

  try {
    const cc = buildSpecialManifest_(Constants.TAB_NAMES.PUBLISHER_CLOSING_CREDITS, false);
    if (cc) result.closingCredits = cc;
  } catch (_) { /* non-fatal */ }

  try {
    const aa = buildSpecialManifest_(Constants.TAB_NAMES.PUBLISHER_ABOUT_AUTHOR, true);
    if (aa) result.aboutAuthor = aa;
  } catch (_) { /* non-fatal */ }

  return result;
}
