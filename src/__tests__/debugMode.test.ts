// debugMode.test.ts
// Tests for the Debug Mode preference gate and runTrackedJob_ sidebar gating.
//
// Code.ts functions live in GAS flat scope (no ES module exports). We load
// the setup helper below which runs dist/Code.js inside the Jest vm context
// and assigns all Code.js functions to the global object.

/* eslint-disable @typescript-eslint/no-explicit-any */

// Load Code.js globals into this Jest sandbox's global scope.
require('../../config/jest/jest.code.setup.js');

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Sets the stored value for DEBUG_MODE in the PropertiesService mock. */
function setStoredDebugMode(value: string | null): void {
  (PropertiesService.getUserProperties().getProperty as jest.Mock)
    .mockImplementation((key: string) => key === 'DEBUG_MODE' ? value : null);
}

/** Configures DocumentApp.getUi to simulate presence or absence of a UI context.
  * Returns the mock ui object so callers can assert on ui.showSidebar. */
function mockUiContext(available: boolean): { showSidebar: jest.Mock } | null {
  // Reset the vm-scoped uiContextCached_ let variable. Setting global.uiContextCached_
  // does NOT work because it's scoped inside the vm context, not on the Jest global.
  (global as any).__resetUiContextCache();
  if (available) {
    const mockUi = { showSidebar: jest.fn() };
    (DocumentApp as any).getUi = jest.fn().mockReturnValue(mockUi);
    // showLogSidebar calls HtmlService.createHtmlOutputFromFile(...).setTitle(...)
    // before calling ui.showSidebar. Ensure the HtmlService mock handles setTitle.
    const mockOutput = {
      setWidth: jest.fn().mockReturnThis(),
      setHeight: jest.fn().mockReturnThis(),
      setTitle: jest.fn().mockReturnThis(),
      setSandboxMode: jest.fn().mockReturnThis(),
    };
    (HtmlService as any).createHtmlOutputFromFile = jest.fn().mockReturnValue(mockOutput);
    return mockUi;
  } else {
    (DocumentApp as any).getUi = jest.fn().mockImplementation(() => {
      throw new Error('Cannot call DocumentApp.getUi() from this context');
    });
    return null;
  }
}

// ── Tests: getDebugMode ───────────────────────────────────────────────────────

describe('getDebugMode — preference loading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true by default when DEBUG_MODE key is absent', () => {
    setStoredDebugMode(null);
    expect((global as any).getDebugMode()).toBe(true);
  });

  it('returns true when DEBUG_MODE is stored as "true"', () => {
    setStoredDebugMode('true');
    expect((global as any).getDebugMode()).toBe(true);
  });

  it('returns false when DEBUG_MODE is stored as "false"', () => {
    setStoredDebugMode('false');
    expect((global as any).getDebugMode()).toBe(false);
  });
});

// ── Tests: saveDebugMode ──────────────────────────────────────────────────────

describe('saveDebugMode — preference persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('writes "true" to UserProperties key DEBUG_MODE when called with true', () => {
    (global as any).saveDebugMode(true);
    expect(PropertiesService.getUserProperties().setProperty)
      .toHaveBeenCalledWith('DEBUG_MODE', 'true');
  });

  it('writes "false" to UserProperties key DEBUG_MODE when called with false', () => {
    (global as any).saveDebugMode(false);
    expect(PropertiesService.getUserProperties().setProperty)
      .toHaveBeenCalledWith('DEBUG_MODE', 'false');
  });

  it('round-trips: save false → getDebugMode returns false, save true → true', () => {
    let stored: string | null = 'true';
    (PropertiesService.getUserProperties().setProperty as jest.Mock)
      .mockImplementation((key: string, v: string) => { if (key === 'DEBUG_MODE') stored = v; });
    (PropertiesService.getUserProperties().getProperty as jest.Mock)
      .mockImplementation((key: string) => key === 'DEBUG_MODE' ? stored : null);

    (global as any).saveDebugMode(false);
    expect((global as any).getDebugMode()).toBe(false);

    (global as any).saveDebugMode(true);
    expect((global as any).getDebugMode()).toBe(true);
  });
});

// ── Tests: runTrackedJob_ — Tracer gated on debug mode ────────────────────────

describe('runTrackedJob_ — Tracer gated on debug mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).__resetUiContextCache(); // clear vm-scoped uiContextCached_
    mockUiContext(false); // suppress sidebar path; not relevant here
  });

  it('calls Tracer.startJob and Tracer.finishJob when debug mode is ON', () => {
    setStoredDebugMode('true');
    (global as any).runTrackedJob_('job-debug-on', () => { /* no-op */ }, false);
    expect(Tracer.startJob).toHaveBeenCalledWith('job-debug-on');
    expect(Tracer.finishJob).toHaveBeenCalled();
  });

  it('does NOT call Tracer.startJob or Tracer.finishJob when debug mode is OFF', () => {
    setStoredDebugMode('false');
    (global as any).runTrackedJob_('job-debug-off', () => { /* no-op */ }, false);
    expect(Tracer.startJob).not.toHaveBeenCalled();
    expect(Tracer.finishJob).not.toHaveBeenCalled();
  });

  it('still executes the action when debug mode is OFF', () => {
    setStoredDebugMode('false');
    const action = jest.fn();
    (global as any).runTrackedJob_('job-debug-off-action', action, false);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('calls Tracer.error + Tracer.failJob and rethrows when the action throws (debug ON)', () => {
    setStoredDebugMode('true');
    const boom = new Error('agent exploded');
    expect(() => {
      (global as any).runTrackedJob_('failing-job', () => { throw boom; }, false);
    }).toThrow('agent exploded');
    expect(Tracer.error as jest.Mock)
      .toHaveBeenCalledWith(expect.stringContaining('agent exploded'));
    expect(Tracer.failJob).toHaveBeenCalledWith('agent exploded');
  });

  it('rethrows error but does NOT call Tracer.error/failJob when debug mode is OFF', () => {
    setStoredDebugMode('false');
    const boom = new Error('silent failure');
    expect(() => {
      (global as any).runTrackedJob_('failing-job-off', () => { throw boom; }, false);
    }).toThrow('silent failure');
    expect(Tracer.error as jest.Mock).not.toHaveBeenCalled();
    expect(Tracer.failJob).not.toHaveBeenCalled();
  });
});

// ── Tests: runTrackedJob_ — sidebar gate ─────────────────────────────────────

  describe('runTrackedJob_ — sidebar auto-open gate', () => {
  // Note: We cannot replace showLogSidebar on global and have runTrackedJob_
  // use the replacement, because Code.js closures bind showLogSidebar by name
  // at evaluation time. Instead we verify the real showLogSidebar's side-effect:
  // it calls DocumentApp.getUi().showSidebar(). When the sidebar is suppressed
  // the method is never called regardless.

  let uiMock: { showSidebar: jest.Mock } | null;

  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).__resetUiContextCache(); // clear vm-scoped uiContextCached_
    uiMock = null;
  });

  it('opens sidebar when debugMode=ON, openSidebar=true, and UI context available', () => {
    setStoredDebugMode('true');
    uiMock = mockUiContext(true);
    (global as any).runTrackedJob_('open-all-on', () => { /* no-op */ }, true);
    expect(uiMock!.showSidebar).toHaveBeenCalledTimes(1);
  });

  it('does NOT open sidebar when debugMode=OFF (even if openSidebar=true, UI available)', () => {
    setStoredDebugMode('false');
    uiMock = mockUiContext(true);
    (global as any).runTrackedJob_('debug-off', () => { /* no-op */ }, true);
    expect(uiMock!.showSidebar).not.toHaveBeenCalled();
  });

  it('does NOT open sidebar when openSidebar=false (even if debugMode=ON, UI available)', () => {
    setStoredDebugMode('true');
    uiMock = mockUiContext(true);
    (global as any).runTrackedJob_('sidebar-flag-false', () => { /* no-op */ }, false);
    expect(uiMock!.showSidebar).not.toHaveBeenCalled();
  });

  it('does NOT open sidebar when UI context unavailable (even if debugMode=ON, openSidebar=true)', () => {
    setStoredDebugMode('true');
    mockUiContext(false); // uses __resetUiContextCache internally, then sets getUi to throw
    // runTrackedJob_ probes hasUiContext_() first; it returns false → sidebar skipped
    (global as any).runTrackedJob_('no-ui', () => { /* no-op */ }, true);
    // getUi called once for the hasUiContext_ probe, not again (sidebar path not entered)
    expect(DocumentApp.getUi as jest.Mock).toHaveBeenCalledTimes(1);
  });

  it('Tracer.startJob is NOT called when debugMode=OFF (sidebar also suppressed)', () => {
    setStoredDebugMode('false');
    uiMock = mockUiContext(true);
    (global as any).runTrackedJob_('trace-gated', () => { /* no-op */ }, true);
    expect(uiMock!.showSidebar).not.toHaveBeenCalled();
    expect(Tracer.startJob).not.toHaveBeenCalled();
    expect(Tracer.finishJob).not.toHaveBeenCalled();
  });
});
