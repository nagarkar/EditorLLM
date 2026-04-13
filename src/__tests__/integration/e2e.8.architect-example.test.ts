// ============================================================
// E2E 8: architectGenerateExample — tab content verification
//
// Runs setupStandardTabs + architectGenerateExample via doPost,
// then reads the StyleProfile tab via Docs REST and asserts expected
// example content.
//
// Zero-cost: no Gemini calls — architectGenerateExample writes
// hardcoded EXAMPLE_CONTENT from ArchitectAgent.ts.
// ============================================================

import { fetchTabs, getTabContent } from './helpers/drive';
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

describeE2E('E2E: architectGenerateExample — StyleProfile content verification', () => {
  it('setupStandardTabs + architectGenerateExample complete without error', () => {
    console.log('[E2E-8] setupStandardTabs…');
    const setupResult = runGasFunction(webAppUrl, 'setupStandardTabs', [], TOKEN());
    console.log(`[E2E-8] setupStandardTabs result: ${JSON.stringify(setupResult)}`);
    expect(setupResult).toBeDefined();

    console.log('[E2E-8] architectGenerateExample…');
    const exampleResult = runGasFunction(webAppUrl, 'architectGenerateExample', [], TOKEN());
    console.log(`[E2E-8] architectGenerateExample result: ${JSON.stringify(exampleResult)}`);
    expect(exampleResult).toEqual({ ok: true });
  }, TIMEOUT);

  it('StyleProfile tab contains the expected example headings and structure', () => {
    const content = getTabContent(DOC_ID, 'StyleProfile', TOKEN());
    console.log(`[E2E-8] StyleProfile content length: ${content.length}`);
    console.log(`[E2E-8] StyleProfile first 200 chars: "${content.slice(0, 200)}"`);
    expect(content.length).toBeGreaterThan(200);
    expect(content).toContain('Voice');
    expect(content).toContain('Sentence Rhythm');
    expect(content).toContain('Vocabulary Register');
    expect(content).toContain('Structural Patterns');
    expect(content).toContain('Thematic Motifs');
    expect(content).toContain('philosophical inquiry');
    expect(content).toContain('Chit');
  }, TIMEOUT);

  it('standard instruction tabs exist after setup', () => {
    const tabs = fetchTabs(DOC_ID, TOKEN());
    const tabNames = tabs.map(t => t.title);
    console.log(`[E2E-8] tabs: ${JSON.stringify(tabNames)}`);
    const expected = [
      'MergedContent',
      'Agentic Instructions',
      'Agentic Scratch',
      'StyleProfile',
      'EarTune Instructions',
      'Audit Instructions',
      'TetherInstructions',
      'Comment Instructions',
    ];
    for (const name of expected) {
      expect(tabNames).toContain(name);
    }
  }, TIMEOUT);
});
