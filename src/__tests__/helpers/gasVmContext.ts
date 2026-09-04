import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

// __dirname = src/__tests__/helpers — project dist/ is three levels up
const DIST = path.join(__dirname, '../../../dist');

/**
 * Loads a compiled GAS IIFE module from dist/ into the current global scope.
 * Patches `const <varName>` → `<varName>` so the IIFE result lands on global.
 * Identical technique used in tracer.test.ts and service tests.
 */
export function loadCompiledGlobal(varName: string, fileName: string): void {
  const src = fs.readFileSync(path.join(DIST, fileName), 'utf8');
  const patched = src.replace(new RegExp('^const ' + varName + '\\b', 'm'), varName);
  new Function(patched)();
}

/**
 * Replaces global.UrlFetchApp.fetch with a jest mock returning the given shape.
 * - `body` is JSON-serialised as the response text (use for JSON API responses).
 * - `text` sets raw response text directly (overrides body).
 * - `bytes` is returned by getBlob().getBytes() (for binary responses).
 * Returns the mock function so callers can inspect calls.
 */
export function mockUrlFetch(opts: {
  code?: number;
  body?: object;
  text?: string;
  bytes?: number[];
}): jest.Mock {
  const responseText =
    opts.text !== undefined
      ? opts.text
      : opts.body !== undefined
      ? JSON.stringify(opts.body)
      : '{}';
  const mock = jest.fn().mockReturnValue({
    getResponseCode: jest.fn().mockReturnValue(opts.code ?? 200),
    getContentText: jest.fn().mockReturnValue(responseText),
    getBlob: jest.fn().mockReturnValue({
      getBytes: jest.fn().mockReturnValue(opts.bytes ?? [1, 2, 3]),
    }),
  });
  (global as any).UrlFetchApp = { fetch: mock };
  return mock;
}

/**
 * Loads the same GAS flat-scope bundle as production (agentHelpers → DocPropsCache →
 * DirectivePersistence → Code) into a fresh vm.Context.
 *
 * Jest's `global.DocPropsCache` (see jest.setup.js) calls `global.PropertiesService`
 * and must not be used in vm tests that replace `ctx.PropertiesService` with a mock.
 * This loader omits that global and runs the real `dist/DocPropsCache.js` in the
 * sandbox so `PropertiesService` / `CacheService` resolve on `ctx`.
 */
export function createEditorLlmCodeVmContext(): any {
  const agentHelpersJs = fs.readFileSync(path.join(DIST, 'agentHelpers.js'), 'utf8');
  const docPropsCacheJs = fs.readFileSync(path.join(DIST, 'DocPropsCache.js'), 'utf8');
  const directivePersistenceJs = fs.readFileSync(
    path.join(DIST, 'DirectivePersistence.js'),
    'utf8',
  );
  const codeJs = fs.readFileSync(path.join(DIST, 'Code.js'), 'utf8');

  const g = { ...global } as Record<string, unknown>;
  delete g.DocPropsCache;
  const ctx = Object.assign(vm.createContext({}), g);
  vm.runInContext(agentHelpersJs, ctx);
  vm.runInContext(docPropsCacheJs, ctx);
  vm.runInContext(directivePersistenceJs, ctx);
  vm.runInContext(codeJs, ctx);
  return ctx;
}

/**
 * Resets the Jest in-memory document cache (see config/jest/jest.setup.js).
 * Call from `beforeEach` when tests change DocumentProperties-backed state so
 * DocPropsCache.read does not return a stale entry from a prior test.
 */
export function clearJestDocumentPropertyCache_(): void {
  const store = (global as any).CacheService?._mockDocumentCache?._store;
  if (store && typeof store.clear === 'function') store.clear();
}
