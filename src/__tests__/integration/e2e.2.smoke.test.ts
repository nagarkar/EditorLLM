// ============================================================
// E2E 2: hasApiKey doPost smoke test
//
// Verifies the hasApiKey route works and that the API key seeded
// via seedTestEnvironment is readable from ScriptProperties.
// Fast: ~2 s, no Gemini calls.
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
