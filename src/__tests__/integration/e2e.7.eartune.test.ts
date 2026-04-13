// ============================================================
// E2E 7: EarTuneAgent W2 — earTuneAnnotateTab on isolated temp tab
//
// What this test proves:
//   • setupStandardTabs(), architectGenerateExample(), earTuneGenerateExample()
//     complete without error (tab setup + content seeding)
//   • earTuneAnnotateTab() runs the full EarTune W2 pipeline on real content
//   • Drive comments land on the intended tab (anchor filtering by tab ID)
//   • Agent comments carry the [EarTune] prefix
//   • Cleanup (deleteDocTab) safely removes the temp tab and its annotations
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
const TIMEOUT      = 5  * 60 * 1000;
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
    console.log('[E2E-7] architectGenerateExample…');
    runGasFunction(webAppUrl, 'architectGenerateExample', [], TOKEN());
    console.log('[E2E-7] earTuneGenerateExample…');
    runGasFunction(webAppUrl, 'earTuneGenerateExample', [], TOKEN());
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
  }, LONG_TIMEOUT);
});
