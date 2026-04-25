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

  // Emit var aliases for ALL_CAPS exported constants (e.g. W1_FORMAT_GUIDELINES).
  //
  // `export function foo(){}` compiles to:
  //   function foo() {}      ← function DECLARATION is a flat-scope global ✓
  //   exports.foo = foo;
  //
  // `export const BAR = "..."` compiles to:
  //   exports.BAR = "...";   ← no standalone variable, NOT a flat-scope global ✗
  //
  // For ALL_CAPS names (conventional constant names), add a `var` alias so the
  // value is accessible as a bare global in GAS flat scope.
  // Skip `exports.X = void 0` (TypeScript's initialiser guard).
  //
  // Two-pass strategy:
  //   Pass A — single-line assignments (scalar values, strings, etc.).
  //            Excludes lines whose RHS begins with `[` or `{` to avoid
  //            injecting a `var` declaration inside a multi-line literal.
  //   Pass B — multi-line array literals that close with `\n];`.
  //            Inserts the alias after the closing bracket.
  // Pass A: single-line ALL_CAPS exports (scalars, strings, chained-init lines).
  // Skip void-0 guards and lines whose value begins with `[` or `{` (multi-line literals).
  // Uses a callback so the RHS can be checked after whitespace trimming —
  // avoids the `\s*` backtracking pitfall that makes `(?![{)` lookaheads unreliable.
  content = content.replace(
    /^exports\.([A-Z][A-Z0-9_]+)\s*=\s*(.+)$/gm,
    (match, name, rhs) => {
      const v = rhs.trimStart();
      if (/^void\b/.test(v) || /^[[\{]/.test(v)) return match;
      return `${match}\nvar ${name} = exports.${name};`;
    }
  );
  // Pass B: multi-line array ALL_CAPS exports — insert var alias after `];`.
  content = content.replace(
    /(exports\.([A-Z][A-Z0-9_]+)\s*=\s*\[[\s\S]*?\n\];)/g,
    (match, _full, name) => `${match}\nvar ${name} = exports.${name};`
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
