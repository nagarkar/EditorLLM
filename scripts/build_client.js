'use strict';
// Compiles client/**.ts → dist_client/, concatenates in declared order,
// and writes the result as sidebar_js.html (a <script>-wrapped HTML fragment).
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist_client');
const OUT  = path.join(ROOT, 'sidebar_js.html');

// Explicit load order — mirrors the original section order in sidebar_js.html.
// Each path is relative to dist_client/.
const FILE_ORDER = [
  '01-helpers.js',
  '02-style-score.js',
  '03-agents.js',
  '05-multiselect.js',
  '06-settings.js',
  '07-sweep.js',
  '08-publisher.js',
  '09-jobs.js',
  'tts/02-state.js',
  'tts/05-init.js',
  'tts/06-utils.js',
  'tts/07-directives.js',
  'tts/08-voices.js',
  '10-dialog.js',
  '11-custom-agents.js',
  '12-auto-cleanup.js',
  '13-team-analysis.js',
];

// 1. Clean dist_client
if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true, force: true });

// 2. Compile TypeScript
execSync('npx tsc -p tsconfig.client.json', { stdio: 'inherit', cwd: ROOT });

// 3. Concatenate in declared order
const chunks = FILE_ORDER.map(rel => {
  const abs = path.join(DIST, rel);
  if (!fs.existsSync(abs)) {
    throw new Error(`[build_client] Missing compiled file: ${abs}\n  Add it to FILE_ORDER or fix the tsconfig.`);
  }
  return `// ── ${rel} ──────────────────────────────\n` + fs.readFileSync(abs, 'utf8');
});

// 4. Wrap and write
// Provide an `exports` object so files that use `export function` don't throw
// at runtime. TypeScript with "module:none" still emits `exports.X = X` for
// exported symbols; assigning into this object is harmless — browser code
// never reads from it. The same pattern is used by fixgas.js for the server build.
const EXPORTS_SHIM = 'var exports = typeof exports !== "undefined" ? exports : {};\n';
const body = chunks.join('\n');
fs.writeFileSync(OUT, `<script>\n${EXPORTS_SHIM}${body}\n</script>\n`);

const kb = Math.round(Buffer.byteLength(body, 'utf8') / 1024);
console.log(`[build_client] sidebar_js.html written — ${FILE_ORDER.length} module(s), ${kb} KB`);
