// ============================================================
// E2E 2: hasApiKey doPost smoke test
//
// PURPOSE
// -------
// Lightest-weight E2E test — verifies the GAS web app is reachable
// and that the API key seeded by seedTestEnvironment() is readable
// from ScriptProperties. This catches deployment failures, broken
// web app URLs, and authentication issues before heavier tests run.
//
// WORKFLOW
// --------
//   1. seedTestEnvironment() pushes GEMINI_API_KEY and model overrides
//      into GAS ScriptProperties via doPost('setScriptProperty').
//   2. Calls doPost('hasApiKey') → expects true.
//
// EXECUTION MODEL
// ---------------
//   • Run via: npm run test:e2e-parallel (included in parallel batch)
//   • Requires: GEMINI_API_KEY, GOOGLE_DOC_ID, GOOGLE_TOKEN, webAppUrl
//   • No Gemini model calls — completes in ~2s
//   • Automatically skipped when credentials are absent
// ============================================================

import { runGasFunction, getWebAppUrl } from './helpers/gas';
import { INTEGRATION_CONFIG } from './config';
import { seedTestEnvironment } from './helpers/e2e-utils';

const DOC_ID = INTEGRATION_CONFIG.googleDocId;
const TOKEN = () => process.env.GOOGLE_TOKEN ?? INTEGRATION_CONFIG.googleToken;
const TIMEOUT = 5 * 60 * 1000;

let webAppUrl = '';
try { webAppUrl = getWebAppUrl(); } catch { /* not set yet */ }
const hasCredentials = Boolean(DOC_ID && process.env.GOOGLE_TOKEN && webAppUrl);
const describeE2E = hasCredentials ? describe : describe.skip;

beforeAll(() => {
  if (hasCredentials) seedTestEnvironment(webAppUrl, TOKEN());
}, TIMEOUT);

describeE2E('E2E: hasApiKey doPost route (smoke test)', () => {
  it('returns true when GEMINI_API_KEY is present in ScriptProperties', () => {
    const result = runGasFunction(webAppUrl, 'hasApiKey', [], TOKEN());
    console.log(`[E2E-2 hasApiKey] result: ${JSON.stringify(result)}`);
    expect(result).toBe(true);
  }, TIMEOUT);
});
