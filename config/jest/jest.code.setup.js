// config/jest/jest.code.setup.js
// Extra setup for debugMode.test.ts: loads dist/Code.js and explicitly assigns
// every function declaration to the Jest global object.
//
// Jest wraps each test file in a jsdom / node VM sandbox. vm.runInThisContext
// and new Function() both put their `function` declarations into the *eval*
// scope, not into Jest's `global`. The only reliable way is to parse the
// compiled JS and extract the symbols explicitly.

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const codeSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'dist', 'Code.js'),
  'utf8'
);

// Create a new VM context seeded with everything that currently lives on global
// (all the GAS mocks from jest.setup.js). Then run Code.js inside that context.
// After execution, copy every new symbol back onto jest's own global.
const ctx = Object.assign(
  vm.createContext({}),
  global   // seed with GAS mocks, jest, etc.
);

vm.runInContext(codeSource, ctx);

// Copy everything the Code.js evaluation defined back onto Jest's global.
// We use Object.getOwnPropertyNames to capture non-enumerable entries too.
for (const key of Object.getOwnPropertyNames(ctx)) {
  if (!(key in global)) {
    try {
      global[key] = ctx[key];
    } catch (_) {
      // some properties are read-only — skip them
    }
  }
}

// Also explicitly copy well-known Code.js functions (in case they existed in
// the seed context and were thus skipped by the `!(key in global)` guard).
const CODE_FUNCTIONS = [
  'getDebugMode', 'saveDebugMode', 'getUserPref', 'saveUserPref',
  'getHighlightColor', 'saveHighlightColor',
  'runTrackedJob_', 'hasUiContext_', 'showLogSidebar',
  'architectGenerateInstructions', 'earTuneGenerateInstructions',
  'auditorGenerateInstructions', 'tetherGenerateInstructions',
  'generalPurposeAgentGenerateInstructions',
];
for (const fn of CODE_FUNCTIONS) {
  if (typeof ctx[fn] === 'function') {
    global[fn] = ctx[fn];
  }
}

// ── resetUiContextCache — for use in tests ────────────────────────────────────
// `uiContextCached_` is a `let` inside Code.js (module scope within the vm ctx).
// Setting `global.uiContextCached_` does NOT affect it. This helper lets tests
// directly reset the vm-scoped variable between tests so hasUiContext_() re-probes.
global.__resetUiContextCache = function() {
  ctx.uiContextCached_ = undefined;
};

