#!/usr/bin/env node
// fixgas.js — Post-build GAS compatibility pass
//
// TypeScript with "module": "none" still emits CommonJS boilerplate for files
// that contain ES module `export function` syntax:
//   Object.defineProperty(exports, "__esModule", { value: true });
//   exports.foo = foo;
//
// Google Apps Script (V8 runtime) has no CommonJS loader, so the `exports`
// variable is undefined and these lines throw at runtime. Since GAS uses flat
// scope (all function declarations are globally accessible without exports),
// stripping these lines is safe.
//
// This script is run as part of `npm run build` AFTER tsc compiles the source.

const fs   = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');

// Inserted at the top of any file that references 'exports'.
// Uses var (not const/let) so it is hoisted and works even in strict mode.
// The typeof check makes this idempotent: if another file or the runtime
// already defined exports, we reuse it.
const EXPORTS_SHIM =
  'var exports = typeof exports !== "undefined" ? exports : {};\n';

function collectJsFiles(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectJsFiles(full));
    } else if (entry.name.endsWith('.js')) {
      result.push(full);
    }
  }
  return result;
}

const files = collectJsFiles(distDir);

let fixed = 0;

for (const filePath of files) {
  const original = fs.readFileSync(filePath, 'utf8');

  // Does this file reference 'exports' at all?
  if (!original.includes('exports')) continue;

  let content = original;

  // Remove the __esModule defineProperty line — it's purely informational
  // metadata for CommonJS bundlers and serves no purpose in GAS.
  content = content.replace(
    /^Object\.defineProperty\(exports,\s*["']__esModule["'][^;]*;\n?/m,
    ''
  );

  // Prepend the exports shim (only if not already present).
  if (!content.startsWith(EXPORTS_SHIM)) {
    content = EXPORTS_SHIM + content;
  }

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    fixed++;
  }
}

console.log(`[fixgas] Patched ${fixed} file(s) for GAS exports compatibility.`);
