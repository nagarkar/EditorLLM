// ============================================================
// src/__tests__/experimental/agent-parity.test.ts
//
// Verifies that AgentInterpreter + a declarative AgentDefinition produces
// the identical (systemPrompt, userPrompt) pair that the concrete agent
// class would pass to GeminiService.generate() for the same workflow.
//
// Strategy:
//   Concrete side — load compiled dist/*.js files into a vm context seeded
//   with controlled service mocks. Run `new AgentClass().generateInstructions()`
//   inside the vm and capture what gets passed to GeminiService.generate.
//
//   Interpreted side — import AgentInterpreter and the definition directly
//   (ts-jest compiles the src/experimental/ sources). Pass the same mock
//   service values as constructor arguments and capture the same args.
//
//   Assert: systemPrompt and userPrompt match exactly.
//
// Why vm for the concrete side?
//   Concrete agents extend BaseAgent, a GAS flat-scope class (no ES export).
//   ts-jest cannot import it directly. The vm approach loads the compiled
//   GAS-style scripts into an isolated context where all class declarations
//   are in scope together (they share the same block scope within one script).
// ============================================================

import * as path from 'path';
import * as fs   from 'fs';
import * as vm   from 'vm';

import { AgentInterpreter, AgentServices } from '../../experimental/AgentInterpreter';
import { earTuneDefinition }               from '../../experimental/config/agents/eartune';
import { architectDefinition }             from '../../experimental/config/agents/architect';
import { Constants }                       from '../../Constants';

// ── Controlled test data ──────────────────────────────────────────────────────

const STYLE_PROFILE_MD = [
  '## Voice & Tone',
  '- First-person philosophical inquiry; intimate yet authoritative.',
  '- Rhetorical questions are used to invite the reader into the argument.',
  '',
  '## Sentence Rhythm',
  '- Alternates between long, meditative sentences and short declarative ones.',
  '',
  '## Vocabulary Register',
  '- Technical physics terms alongside Sanskrit philosophical vocabulary.',
  '',
  '## Structural Patterns',
  '- Chapters: Thesis → Observation → Formalization → Synthesis.',
  '',
  '## Thematic Motifs',
  '- Consciousness as the only irreducible axiom.',
].join('\n');
// Must be >= 200 chars for assertStyleProfileValid_ to pass.
// Length check (should be well over 200):
// console.assert(STYLE_PROFILE_MD.length >= 200);

const EARTUNE_INSTRUCTIONS_MD =
  '## Rhythm Rules\n- Favour stressed final syllables.\n- Limit consecutive unstressed monosyllables to three.';

const MERGED_CONTENT_PLAIN =
  'Seven More Sermons To The Dead Epilogue. ' +
  'The Dead, having received the wisdom of the seven sermons, wandered through time and space.';

// Gemini mock response for instruction_update workflows
const MOCK_INSTRUCTION_RESPONSE = { proposed_full_text: '__MOCK_PROPOSED_TEXT__' };

// ── Helpers ───────────────────────────────────────────────────────────────────

const DIST_DIR = path.join(__dirname, '../../../dist');

/**
 * Loads compiled GAS flat-scope files into an isolated vm context and runs
 * `new AgentClass().generateInstructions()` inside it.
 *
 * All services are injected as var declarations at the top of the script so
 * that GAS-style class bodies can reference them by name.  `var` declarations
 * become properties on the vm context object, so captured values are readable
 * after execution.
 *
 * Returns { systemPrompt, userPrompt } from the FIRST call to the mock
 * GeminiService.generate (i.e. the instruction-generation call).
 */
function captureConcretePrompts(
  agentClass: string,
  distFiles: string[],
  tabContent: Record<string, string>,
  tabMarkdown: Record<string, string>,
  geminiResponse: object
): { systemPrompt: string; userPrompt: string } {

  // Build a self-contained script: mocks first, then GAS source files, then run.
  const mockSetup = `
var _calls = [];
var GeminiService = {
  generate: function(sys, user, tier, opts) {
    _calls.push({ systemPrompt: sys, userPrompt: user, tier: tier });
    return ${JSON.stringify(geminiResponse)};
  }
};
var CollaborationService = {
  processUpdate: function(u) {}
};
var DocOps = {
  getTabContent: function(name) {
    var t = ${JSON.stringify(tabContent)};
    return t[name] !== undefined ? t[name] : '';
  },
  ensureStandardTabs: function() {},
  getTabIdByName:     function() { return null; },
  tabExists:          function() { return false; }
};
var MarkdownService = {
  tabToMarkdown: function(name) {
    var t = ${JSON.stringify(tabMarkdown)};
    return t[name] !== undefined ? t[name] : '';
  }
};
var Tracer = {
  info:  function() {},
  warn:  function() {},
  error: function() {}
};
var PropertiesService = {
  getDocumentProperties: function() {
    return { getProperty: function() { return null; }, setProperty: function() {}, setProperties: function() {} };
  },
  getUserProperties: function() {
    return { getProperty: function() { return null; } };
  },
  getScriptProperties: function() {
    return { getProperty: function() { return null; } };
  }
};
var CacheService = {
  getUserCache:   function() { return { get: function() { return null; }, put: function() {} }; },
  getScriptCache: function() { return { get: function() { return null; }, put: function() {} }; }
};
var Utilities = { sleep: function() {} };
var Logger    = { log: function() {} };
`;

  const agentSource = distFiles
    .map(f => fs.readFileSync(path.join(DIST_DIR, f), 'utf8'))
    .join('\n');

  const runScript = `
var _agent = new ${agentClass}();
_agent.generateInstructions();
`;

  const ctx = vm.createContext({});
  vm.runInContext(mockSetup + '\n' + agentSource + '\n' + runScript, ctx);

  const calls: Array<{ systemPrompt: string; userPrompt: string }> = (ctx as any)._calls;
  if (!calls || calls.length === 0) {
    throw new Error(`[captureConcretePrompts] No GeminiService.generate calls captured for ${agentClass}`);
  }
  return { systemPrompt: calls[0].systemPrompt, userPrompt: calls[0].userPrompt };
}

/**
 * Runs AgentInterpreter.generateInstructions() with injected mock services
 * and returns the (systemPrompt, userPrompt) captured from the FIRST
 * GeminiService.generate call.
 */
function captureInterpreterPrompts(
  agentClass: 'eartune' | 'architect',
  tabContent: Record<string, string>,
  tabMarkdown: Record<string, string>,
  geminiResponse: object
): { systemPrompt: string; userPrompt: string } {

  const definition = agentClass === 'eartune' ? earTuneDefinition : architectDefinition;

  const calls: Array<{ systemPrompt: string; userPrompt: string }> = [];

  const svc: AgentServices = {
    gemini: {
      generate(sys, user, tier, opts) {
        calls.push({ systemPrompt: sys, userPrompt: user });
        return geminiResponse;
      },
    },
    docOps: {
      getTabContent:     (name) => tabContent[name]  ?? '',
      ensureStandardTabs: ()    => {},
    },
    markdown: {
      tabToMarkdown: (name) => tabMarkdown[name] ?? '',
    },
    collab: {
      processUpdate: () => {},
    },
  };

  const interpreter = new AgentInterpreter(definition, svc);
  interpreter.generateInstructions();

  if (calls.length === 0) {
    throw new Error('[captureInterpreterPrompts] No GeminiService.generate calls captured');
  }
  return { systemPrompt: calls[0].systemPrompt, userPrompt: calls[0].userPrompt };
}

// ── EarTuneAgent parity tests ─────────────────────────────────────────────────

describe('EarTuneAgent — W1 generateInstructions parity (with non-empty manuscript)', () => {

  const tabContent = {
    MergedContent: MERGED_CONTENT_PLAIN,
  };
  const tabMarkdown = {
    StyleProfile:           STYLE_PROFILE_MD,
    'EarTune Instructions': EARTUNE_INSTRUCTIONS_MD,
  };

  let concrete:    { systemPrompt: string; userPrompt: string };
  let interpreted: { systemPrompt: string; userPrompt: string };

  beforeAll(() => {
    // Concrete: load Types.js + Constants.js + BaseAgent.js + EarTuneAgent.js
    concrete = captureConcretePrompts(
      'EarTuneAgent',
      ['Types.js', 'Constants.js', 'BaseAgent.js', 'EarTuneAgent.js'],
      tabContent,
      tabMarkdown,
      MOCK_INSTRUCTION_RESPONSE
    );

    // Interpreted
    interpreted = captureInterpreterPrompts(
      'eartune',
      tabContent,
      tabMarkdown,
      MOCK_INSTRUCTION_RESPONSE
    );
  });

  it('systemPrompt matches concrete agent', () => {
    expect(interpreted.systemPrompt).toBe(concrete.systemPrompt);
  });

  it('userPrompt matches concrete agent', () => {
    expect(interpreted.userPrompt).toBe(concrete.userPrompt);
  });
});

// ── ArchitectAgent parity tests ───────────────────────────────────────────────

describe('ArchitectAgent — W1 generateInstructions parity', () => {

  const tabContent = {
    MergedContent: MERGED_CONTENT_PLAIN,
  };
  const tabMarkdown = {
    StyleProfile: STYLE_PROFILE_MD,
  };

  let concrete:    { systemPrompt: string; userPrompt: string };
  let interpreted: { systemPrompt: string; userPrompt: string };

  beforeAll(() => {
    // Concrete: load Types.js + Constants.js + BaseAgent.js + ArchitectAgent.js.
    // ArchitectAgent.generateInstructions() makes TWO Gemini calls:
    //   [0] — instruction generation (W1 prompt we compare)
    //   [1] — evaluateStyleProfile_ quality check (different system prompt)
    // We capture both but only assert on index 0.
    concrete = captureConcretePrompts(
      'ArchitectAgent',
      ['Types.js', 'Constants.js', 'BaseAgent.js', 'ArchitectAgent.js'],
      tabContent,
      tabMarkdown,
      MOCK_INSTRUCTION_RESPONSE
    );

    // Interpreted: definition declares postStep: evaluate_style_profile,
    // so it also makes a second Gemini call. captureInterpreterPrompts returns index 0.
    interpreted = captureInterpreterPrompts(
      'architect',
      tabContent,
      tabMarkdown,
      MOCK_INSTRUCTION_RESPONSE
    );
  });

  it('systemPrompt matches concrete agent', () => {
    expect(interpreted.systemPrompt).toBe(concrete.systemPrompt);
  });

  it('userPrompt matches concrete agent', () => {
    expect(interpreted.userPrompt).toBe(concrete.userPrompt);
  });
});

// ── Sanity checks on the definition objects ───────────────────────────────────

describe('AgentDefinition sanity checks', () => {

  it('earTuneDefinition has required fields', () => {
    expect(earTuneDefinition.id).toBe('eartune');
    expect(earTuneDefinition.commentPrefix).toBe('[EarTune]');
    expect(earTuneDefinition.instructionTabName).toBe(Constants.TAB_NAMES.EAR_TUNE);
    expect(earTuneDefinition.workflows.generateInstructions).toBeDefined();
    expect(earTuneDefinition.workflows.annotateTab).toBeDefined();
    expect(earTuneDefinition.workflows.handleCommentThreads).toBeDefined();
  });

  it('architectDefinition has required fields', () => {
    expect(architectDefinition.id).toBe('architect');
    expect(architectDefinition.commentPrefix).toBe('[Architect]');
    expect(architectDefinition.instructionTabName).toBe(Constants.TAB_NAMES.STYLE_PROFILE);
    expect(architectDefinition.workflows.generateInstructions).toBeDefined();
    expect(architectDefinition.workflows.generateInstructions!.requiresStyleProfile).toBe(false);
    expect(architectDefinition.workflows.generateInstructions!.modelTier).toBe('thinking');
  });

  it('earTuneDefinition W1 has 3 context sections in correct order', () => {
    const w1 = earTuneDefinition.workflows.generateInstructions!;
    expect(w1.contextSections).toHaveLength(3);
    expect(w1.contextSections[0].source.kind).toBe('style_profile');
    expect(w1.contextSections[1].source.kind).toBe('merged_content');
    expect(w1.contextSections[2].source.kind).toBe('self_instructions');
  });

  it('architectDefinition W1 has 2 context sections: merged_content first, style_profile second', () => {
    const w1 = architectDefinition.workflows.generateInstructions!;
    expect(w1.contextSections).toHaveLength(2);
    expect(w1.contextSections[0].source.kind).toBe('merged_content');
    expect(w1.contextSections[1].source.kind).toBe('style_profile');
  });

  it('architectDefinition W1 has evaluate_style_profile postStep', () => {
    const postSteps = architectDefinition.workflows.generateInstructions!.postSteps;
    expect(postSteps?.some(s => s.kind === 'evaluate_style_profile')).toBe(true);
  });

  it('systemPrompt contains SYSTEM_PREAMBLE for both agents', () => {
    const preambleSnippet = '# EditorLLM Context';
    expect(earTuneDefinition.systemPrompt.kind).toBe('static');
    expect((earTuneDefinition.systemPrompt as any).text).toContain(preambleSnippet);
    expect(architectDefinition.systemPrompt.kind).toBe('static');
    expect((architectDefinition.systemPrompt as any).text).toContain(preambleSnippet);
  });

  it('earTuneDefinition systemPrompt ends with EarTune-specific role section', () => {
    const sp = (earTuneDefinition.systemPrompt as any).text as string;
    expect(sp).toContain('# Role: Audio EarTune (Ear-Tune)');
    expect(sp).toContain('rhythmic listenability');
  });

  it('architectDefinition systemPrompt ends with Architect-specific role section', () => {
    const sp = (architectDefinition.systemPrompt as any).text as string;
    expect(sp).toContain('# Role: Structural Architect (Style Mimic)');
    expect(sp).toContain('StyleProfile');
  });
});
