// ============================================================
// E2E 7: EarTuneAgent W2 — earTuneAnnotateTab on isolated temp tab
//
// PURPOSE
// -------
// End-to-end test for the full EarTune annotation pipeline: creates
// an isolated temporary tab, inserts rhythmically flawed prose, runs
// the real earTuneAnnotateTab() in GAS, and verifies that [EarTune]
// comments land on the correct tab via the Drive API.
//
// WORKFLOW
// --------
//   1. seedTestEnvironment() → seeds API key and model overrides.
//   2. setupStandardTabs() → ensures all agent tabs exist.
//   3. Creates a temporary tab ("E2E-EarTune-<timestamp>").
//   4. Inserts FIXTURE_PROSE (intentionally rhythmically weak text).
//   5. Calls earTuneAnnotateTab(tempTabName) via doPost.
//   6. Lists all Drive comments → filters by temp tab anchor.
//   7. Asserts:
//      - At least one agent comment with [EarTune] prefix exists
//      - Comments are anchored to the correct temp tab ID
//   8. afterAll deletes the temp tab (and its comments cascade-delete).
//
// FIXTURE PROSE
// -------------
// Intentionally contains:
//   - Excessive alliteration ("consciousness research... researchers who researched")
//   - Monotonous passive voice chains ("are measured... are recorded... are analyzed")
//   - Redundant tautologies ("systematic system systematically...")
//   - Knowledge-of-knowledge loops ("knowledge builds upon knowledge...")
//   This guarantees EarTune finds issues even with model variation.
//
// ISOLATION MODEL
// ---------------
// Uses a unique timestamped tab name per run to avoid cross-test
// interference. The temp tab is created via Docs REST API and deleted
// in afterAll. All EarTune annotations are anchored to this tab only.
//
// EXECUTION MODEL
// ---------------
//   • Run via: npm run test:e2e-parallel (included in parallel batch)
//   • Requires: GEMINI_API_KEY, GOOGLE_DOC_ID, GOOGLE_TOKEN, webAppUrl
//   GAS calls: 2 (setupStandardTabs, earTuneAnnotateTab) — ~30-40s total
//   Does NOT call commentProcessorRun() — no GAS queueing contention
// ============================================================

import {
  createDocTab,
  deleteDocTab,
  listAllComments,
  insertTextIntoTab,
} from './helpers/drive';
import { runGasFunction, getWebAppUrl } from './helpers/gas';
import { INTEGRATION_CONFIG } from './config';
import { seedTestEnvironment } from './helpers/e2e-utils';

const DOC_ID = INTEGRATION_CONFIG.googleDocId;
const TOKEN = () => process.env.GOOGLE_TOKEN ?? INTEGRATION_CONFIG.googleToken;
const TIMEOUT = 5 * 60 * 1000;
const LONG_TIMEOUT = 10 * 60 * 1000;

// Prose with intentional rhythmic weaknesses to reliably trigger EarTune.
const FIXTURE_PROSE = `\
The consciousness paradigm has long been studied by researchers who have researched \
consciousness research across many research institutions. The nature of awareness \
was analyzed by philosophers who philosophically pondered philosophical questions \
of a philosophical nature about philosophy and philosophical consciousness.

Quantum properties are measured by instruments. Results are recorded by scientists. \
Data is analyzed by algorithms. Conclusions are drawn by reviewers. Reports are \
submitted by authors. Feedback is provided by editors. Revisions are made by writers. \
The cycle is repeated by the process.

The systematic system systematically processes systematic data through systematic \
processing systems. Each procedural procedure procedurally follows procedural \
protocols in a procedurally systematic procedure. The algorithmic algorithm \
algorithmically calculates algorithmic calculations through the algorithm.

Knowledge builds upon knowledge, building on the knowledge that knowledge itself \
is built from known knowable things we know we need to know in order to know. \
The careful, methodical, systematic, deliberate, intentional approach was adopted. \
Results showed that results were consistent with earlier results from prior results.`;

let webAppUrl = '';
try { webAppUrl = getWebAppUrl(); } catch { /* not set yet */ }
const hasCredentials = Boolean(DOC_ID && process.env.GOOGLE_TOKEN && webAppUrl);
const describeE2E = hasCredentials ? describe : describe.skip;

beforeAll(() => {
  if (hasCredentials) seedTestEnvironment(webAppUrl, TOKEN());
}, TIMEOUT);

describeE2E('E2E: EarTuneAgent W2 — earTuneAnnotateTab on isolated temp tab', () => {
  let tempTabId = '';
  const RUN_ID = Date.now();
  const tempTabName = `E2E-EarTune-${RUN_ID}`;

  beforeAll(() => {
    console.log('[E2E-7] setupStandardTabs…');
    runGasFunction(webAppUrl, 'setupStandardTabs', [], TOKEN());
    console.log(`[E2E-7] creating temp tab "${tempTabName}"…`);
    tempTabId = createDocTab(DOC_ID, tempTabName, TOKEN());
    console.log(`[E2E-7] tempTabId: ${tempTabId}`);
    insertTextIntoTab(DOC_ID, tempTabId, FIXTURE_PROSE, TOKEN());
    console.log('[E2E-7] fixture prose inserted');
  }, LONG_TIMEOUT);

  afterAll(() => {
    if (tempTabId) {
      try {
        deleteDocTab(DOC_ID, tempTabId, TOKEN());
        console.log(`[E2E-7] afterAll: temp tab ${tempTabId} deleted`);
      } catch (e: any) {
        console.warn(`[E2E-7] afterAll: failed to delete temp tab — ${e?.message}`);
      }
    }
  }, LONG_TIMEOUT);

  it('earTuneAnnotateTab completes and creates at least one [EarTune] comment on the temp tab', () => {
    console.log(`[E2E-7] calling earTuneAnnotateTab("${tempTabName}")…`);
    runGasFunction(webAppUrl, 'earTuneAnnotateTab', [tempTabName], TOKEN());
    console.log('[E2E-7] earTuneAnnotateTab returned');

    const allComments = listAllComments(DOC_ID, TOKEN());
    const onTempTab = allComments.filter(c => {
      try {
        const anchor = JSON.parse(c.anchor ?? '{}');
        return anchor?.a?.[0]?.lt?.tb?.id === tempTabId;
      } catch { return false; }
    });
    const agentComments = onTempTab.filter(c => c.content?.startsWith('[EarTune]'));
    console.log(
      `[E2E-7] Drive comments on temp tab: ${onTempTab.length} total, ` +
      `${agentComments.length} from agent`
    );
    if (agentComments.length > 0) {
      console.log(`[E2E-7] first agent comment: "${agentComments[0].content?.slice(0, 120)}"`);
    }
    expect(agentComments.length).toBeGreaterThanOrEqual(1);

    // Every [EarTune] comment must embed a bookmark URL (verifies that
    // annotateOperation_ step 1 — bookmark creation — succeeded and the URL
    // was recorded in the comment body for the deletion path to use later).
    agentComments.forEach(c => {
      expect(c.content).toMatch(/#bookmark=/);
    });
  }, LONG_TIMEOUT);
});
