// ============================================================
// src/__tests__/experimental/agent-parity.test.ts
//
// Verifies that AgentInterpreter + a declarative AgentDefinition produces
// the identical call signature that the concrete agent class would pass to
// GeminiService.generate() for the same workflow:
//   - systemPrompt
//   - userPrompt
//   - tier (model tier)
//   - schema (the JSON schema object, or undefined for plain_markdown)
//
// Also verifies that CollaborationService.processUpdate is called with the
// correct payload (workflow_type, review_tab, proposed_full_text), catching
// any instructionTabName typo in a definition.
//
// Strategy:
//   Concrete side — load compiled dist/*.js files into a vm context seeded
//   with controlled service mocks. Run `new AgentClass().generateInstructions()`
//   and capture all Gemini args + processUpdate arg.
//
//   Interpreted side — import AgentInterpreter and the definition directly
//   (ts-jest compiles src/experimental/). Pass the same mock service values
//   and capture the same args.
//
//   Assert: every captured field matches exactly.
// ============================================================

import * as path from 'path';
import * as fs   from 'fs';
import * as vm   from 'vm';

import { AgentInterpreter, AgentServices } from '../../experimental/AgentInterpreter';
import { earTuneDefinition }               from '../../experimental/config/agents/eartune';
import { architectDefinition }             from '../../experimental/config/agents/architect';
import { auditDefinition }                 from '../../experimental/config/agents/audit';
import { tetherDefinition }                from '../../experimental/config/agents/tether';
import { ttsDefinition }                   from '../../experimental/config/agents/tts';
import { generalPurposeDefinition }        from '../../experimental/config/agents/generalPurpose';
import { publisherDefinition }             from '../../experimental/config/agents/publisher';
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

const EARTUNE_INSTRUCTIONS_MD =
  '## Rhythm Rules\n- Favour stressed final syllables.\n- Limit consecutive unstressed monosyllables to three.';

const AUDIT_INSTRUCTIONS_MD =
  '## Chid Axioms\n- Consciousness is the ground of physics.\n- Observation collapses wavefunction.';

const TETHER_INSTRUCTIONS_MD =
  '## External Facts\n- Schrödinger equation is unambiguous.\n- Rig Veda pre-dates materialism.';

const GP_INSTRUCTIONS_MD =
  '## Response Style\n- Match the author\'s voice.\n- Keep replies under 60 words unless complex.';

const PUBLISHER_INSTRUCTIONS_MD =
  '## Metadata Tabs\n- Title: draft front-matter title page.\n- Copyright: include ISBN and Year placeholders.';

const MANUSCRIPT_PLAIN =
  'Seven More Sermons To The Dead Epilogue. ' +
  'The Dead, having received the wisdom of the seven sermons, wandered through time and space.';

// Gemini mock response for all W1 instruction workflows (now plain text — no JSON schema).
// This string intentionally does not start with '#' or '`' so extractMarkdownFromJsonWrapper
// passes it through unchanged, keeping the processUpdate assertion simple.
const MOCK_INSTRUCTION_RESPONSE = '__MOCK_PROPOSED_TEXT__';
const MOCK_TTS_INSTRUCTION_RESPONSE = [
  '## Overview',
  '- Audio rendering policy.',
  '',
  '## Cast Role Policy (do not delete)',
  '- Required for EditorLLM.',
  '',
  '| Cast Key | Role Type | Speaker Signals | Voice Name | Voice ID | Model ID | Stability | Similarity Boost | Notes |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  '| narrator | narrator | default narration | NOT PROVIDED | NOT PROVIDED | NOT PROVIDED | 0.60 | 0.75 | default fallback |',
].join('\n');
// Gemini mock for plain_markdown (GeneralPurposeAgent W1)
const MOCK_MARKDOWN_RESPONSE = '## Response Style\n- Be concise.\n';

// ── Snapshot type ─────────────────────────────────────────────────────────────

interface GeminiCallSnapshot {
  systemPrompt: string;
  userPrompt:   string;
  tier:         string;
  schema:       object | undefined;
}

interface AgentSnapshot {
  geminiCall: GeminiCallSnapshot;  // first (W1) Gemini call
  update:     object | undefined;  // processUpdate payload
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DIST_DIR = path.join(__dirname, '../../../dist');

/**
 * Loads compiled GAS flat-scope files into an isolated vm context and runs
 * `new AgentClass().generateInstructions()` inside it.
 *
 * Returns the FIRST Gemini call (W1 prompt) and the processUpdate payload.
 */
function captureConcreteSnapshot(
  agentClass: string,
  distFiles: string[],
  tabContent: Record<string, string>,
  tabMarkdown: Record<string, string>,
  geminiResponse: object | string
): AgentSnapshot {

  const mockSetup = `
var _calls = [];
var _updates = [];
var GeminiService = {
  generate: function(sys, user, tier, opts) {
    _calls.push({ systemPrompt: sys, userPrompt: user, tier: tier, schema: opts && opts.schema });
    return ${JSON.stringify(geminiResponse)};
  }
};
var CollaborationService = {
  processUpdate: function(u) { _updates.push(JSON.parse(JSON.stringify(u))); }
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

  const calls: GeminiCallSnapshot[] = (ctx as any)._calls;
  if (!calls || calls.length === 0) {
    throw new Error(`[captureConcreteSnapshot] No GeminiService.generate calls for ${agentClass}`);
  }
  const updates: object[] = (ctx as any)._updates;

  return {
    geminiCall: calls[0],
    update:     updates?.[0],
  };
}

/**
 * Runs AgentInterpreter.generateInstructions() with injected mock services
 * and returns the FIRST Gemini call snapshot and the processUpdate payload.
 */
function captureInterpreterSnapshot(
  agentKey: 'eartune' | 'architect' | 'audit' | 'tether' | 'tts' | 'general-purpose' | 'publisher',
  tabContent: Record<string, string>,
  tabMarkdown: Record<string, string>,
  geminiResponse: object | string
): AgentSnapshot {

  const definitionMap = {
    'eartune':         earTuneDefinition,
    'architect':       architectDefinition,
    'audit':           auditDefinition,
    'tether':          tetherDefinition,
    'tts':             ttsDefinition,
    'general-purpose': generalPurposeDefinition,
    'publisher':       publisherDefinition,
  };
  const definition = definitionMap[agentKey];

  const calls: GeminiCallSnapshot[] = [];
  let capturedUpdate: object | undefined;

  const svc: AgentServices = {
    gemini: {
      generate(sys, user, tier, opts) {
        calls.push({ systemPrompt: sys, userPrompt: user, tier, schema: opts?.schema });
        return geminiResponse;
      },
    },
    docOps: {
      getTabContent:      (name) => tabContent[name]  ?? '',
      ensureStandardTabs: ()     => {},
    },
    markdown: {
      tabToMarkdown: (name) => tabMarkdown[name] ?? '',
    },
    collab: {
      processUpdate: (u) => { capturedUpdate = JSON.parse(JSON.stringify(u)); },
    },
  };

  const interpreter = new AgentInterpreter(definition, svc);
  interpreter.generateInstructions();

  if (calls.length === 0) {
    throw new Error('[captureInterpreterSnapshot] No GeminiService.generate calls captured');
  }

  return {
    geminiCall: calls[0],
    update:     capturedUpdate,
  };
}

/** Minimal GAS shims to instantiate agent classes from dist/ (no generateInstructions). */
const AGENT_VM_MINIMAL_SHELL = `
var Tracer = { info: function(){}, warn: function(){}, error: function(){} };
var PropertiesService = {
  getDocumentProperties: function() {
    return { getProperty: function(){ return null; }, setProperty: function(){}, setProperties: function(){} };
  },
  getUserProperties: function() { return { getProperty: function(){ return null; } }; },
  getScriptProperties: function() { return { getProperty: function(){ return null; } }; }
};
var CacheService = {
  getUserCache:   function() { return { get: function(){ return null; }, put: function(){} }; },
  getScriptCache: function() { return { get: function(){ return null; }, put: function(){} }; }
};
var Utilities = { sleep: function() {} };
var Logger = { log: function() {} };
`;

/**
 * Reads `getInstructionQualityRubric()` and `getAgentId()` from a concrete
 * agent class in the compiled dist bundle.
 */
function readConcreteInstructionQualityMirror(
  agentClass: string,
  distFiles: string[],
): { rubric: string; agentId: string } {
  const agentSource = distFiles
    .map(f => fs.readFileSync(path.join(DIST_DIR, f), 'utf8'))
    .join('\n');
  const runScript = `
var _inst = new ${agentClass}();
__rubric = _inst.getInstructionQualityRubric();
__agentId = _inst.getAgentId();
`;
  const ctx = vm.createContext({});
  vm.runInContext(AGENT_VM_MINIMAL_SHELL + '\n' + agentSource + '\n' + runScript, ctx);
  return {
    rubric:  (ctx as any).__rubric,
    agentId: (ctx as any).__agentId,
  };
}

// ── EarTuneAgent parity tests ─────────────────────────────────────────────────

describe('EarTuneAgent — W1 generateInstructions parity (StyleProfile-only)', () => {

  const tabContent  = { [Constants.TAB_NAMES.MANUSCRIPT]: MANUSCRIPT_PLAIN };
  const tabMarkdown = {
    [Constants.TAB_NAMES.STYLE_PROFILE]: STYLE_PROFILE_MD,
    [Constants.TAB_NAMES.EAR_TUNE]:      EARTUNE_INSTRUCTIONS_MD,
  };

  let concrete:    AgentSnapshot;
  let interpreted: AgentSnapshot;

  beforeAll(() => {
    concrete = captureConcreteSnapshot(
      'EarTuneAgent',
      ['Types.js', 'Constants.js', 'agentHelpers.js', 'w1FormatGuidelines.js', 'agentPrompts.js', 'BaseAgent.js', 'EarTuneAgent.js'],
      tabContent, tabMarkdown, MOCK_INSTRUCTION_RESPONSE
    );
    interpreted = captureInterpreterSnapshot(
      'eartune', tabContent, tabMarkdown, MOCK_INSTRUCTION_RESPONSE
    );
  });

  it('systemPrompt matches', () => {
    expect(interpreted.geminiCall.systemPrompt).toBe(concrete.geminiCall.systemPrompt);
  });

  it('userPrompt matches', () => {
    expect(interpreted.geminiCall.userPrompt).toBe(concrete.geminiCall.userPrompt);
  });

  it('tier is fast', () => {
    expect(interpreted.geminiCall.tier).toBe('fast');
    expect(concrete.geminiCall.tier).toBe('fast');
  });

  it('schema is undefined (plain text mode — no JSON schema)', () => {
    expect(interpreted.geminiCall.schema).toBeUndefined();
    expect(concrete.geminiCall.schema).toBeUndefined();
  });

  it('processUpdate payload matches — review_tab points to EAR_TUNE tab', () => {
    expect(interpreted.update).toEqual(concrete.update);
    expect((interpreted.update as any)?.review_tab).toBe(Constants.TAB_NAMES.EAR_TUNE);
    expect((interpreted.update as any)?.workflow_type).toBe('instruction_update');
    expect((interpreted.update as any)?.proposed_full_text).toBe('__MOCK_PROPOSED_TEXT__');
  });
});

// ── ArchitectAgent parity tests ───────────────────────────────────────────────

describe('ArchitectAgent — W1 generateInstructions parity', () => {

  const tabContent  = { [Constants.TAB_NAMES.MANUSCRIPT]: MANUSCRIPT_PLAIN };
  const tabMarkdown = { [Constants.TAB_NAMES.STYLE_PROFILE]: STYLE_PROFILE_MD };

  let concrete:    AgentSnapshot;
  let interpreted: AgentSnapshot;

  beforeAll(() => {
    // ArchitectAgent makes TWO Gemini calls: [0] W1, [1] evaluateInstructions (judge).
    // We only assert on call [0].
    concrete = captureConcreteSnapshot(
      'ArchitectAgent',
      ['Types.js', 'Constants.js', 'agentHelpers.js', 'w1FormatGuidelines.js', 'agentPrompts.js', 'BaseAgent.js', 'ArchitectAgent.js'],
      tabContent, tabMarkdown, MOCK_INSTRUCTION_RESPONSE
    );
    interpreted = captureInterpreterSnapshot(
      'architect', tabContent, tabMarkdown, MOCK_INSTRUCTION_RESPONSE
    );
  });

  it('systemPrompt matches', () => {
    expect(interpreted.geminiCall.systemPrompt).toBe(concrete.geminiCall.systemPrompt);
  });

  it('userPrompt matches', () => {
    expect(interpreted.geminiCall.userPrompt).toBe(concrete.geminiCall.userPrompt);
  });

  it('tier is thinking', () => {
    expect(interpreted.geminiCall.tier).toBe('thinking');
    expect(concrete.geminiCall.tier).toBe('thinking');
  });

  it('schema is undefined (plain text mode — no JSON schema)', () => {
    expect(interpreted.geminiCall.schema).toBeUndefined();
    expect(concrete.geminiCall.schema).toBeUndefined();
  });

  it('processUpdate payload matches — review_tab points to STYLE_PROFILE tab', () => {
    expect(interpreted.update).toEqual(concrete.update);
    expect((interpreted.update as any)?.review_tab).toBe(Constants.TAB_NAMES.STYLE_PROFILE);
    expect((interpreted.update as any)?.workflow_type).toBe('instruction_update');
    expect((interpreted.update as any)?.proposed_full_text).toBe('__MOCK_PROPOSED_TEXT__');
  });
});

// ── AuditAgent parity tests ───────────────────────────────────────────────────

describe('AuditAgent — W1 generateInstructions parity', () => {

  const tabContent  = { [Constants.TAB_NAMES.MANUSCRIPT]: MANUSCRIPT_PLAIN };
  const tabMarkdown = {
    [Constants.TAB_NAMES.STYLE_PROFILE]:  STYLE_PROFILE_MD,
    [Constants.TAB_NAMES.TECHNICAL_AUDIT]: AUDIT_INSTRUCTIONS_MD,
  };

  let concrete:    AgentSnapshot;
  let interpreted: AgentSnapshot;

  beforeAll(() => {
    concrete = captureConcreteSnapshot(
      'AuditAgent',
      ['Types.js', 'Constants.js', 'agentHelpers.js', 'w1FormatGuidelines.js', 'agentPrompts.js', 'BaseAgent.js', 'AuditAgent.js'],
      tabContent, tabMarkdown, MOCK_INSTRUCTION_RESPONSE
    );
    interpreted = captureInterpreterSnapshot(
      'audit', tabContent, tabMarkdown, MOCK_INSTRUCTION_RESPONSE
    );
  });

  it('systemPrompt matches', () => {
    expect(interpreted.geminiCall.systemPrompt).toBe(concrete.geminiCall.systemPrompt);
  });

  it('userPrompt matches', () => {
    expect(interpreted.geminiCall.userPrompt).toBe(concrete.geminiCall.userPrompt);
  });

  it('tier is thinking', () => {
    expect(interpreted.geminiCall.tier).toBe('thinking');
    expect(concrete.geminiCall.tier).toBe('thinking');
  });

  it('schema is undefined (plain text mode — no JSON schema)', () => {
    expect(interpreted.geminiCall.schema).toBeUndefined();
    expect(concrete.geminiCall.schema).toBeUndefined();
  });

  it('processUpdate payload matches — review_tab points to TECHNICAL_AUDIT tab', () => {
    expect(interpreted.update).toEqual(concrete.update);
    expect((interpreted.update as any)?.review_tab).toBe(Constants.TAB_NAMES.TECHNICAL_AUDIT);
    expect((interpreted.update as any)?.workflow_type).toBe('instruction_update');
  });
});

// ── TetherAgent parity tests ──────────────────────────────────────────────────

describe('TetherAgent — W1 generateInstructions parity', () => {

  const tabContent  = { [Constants.TAB_NAMES.MANUSCRIPT]: MANUSCRIPT_PLAIN };
  const tabMarkdown = {
    [Constants.TAB_NAMES.STYLE_PROFILE]:        STYLE_PROFILE_MD,
    [Constants.TAB_NAMES.TETHER_INSTRUCTIONS]:  TETHER_INSTRUCTIONS_MD,
  };

  let concrete:    AgentSnapshot;
  let interpreted: AgentSnapshot;

  beforeAll(() => {
    concrete = captureConcreteSnapshot(
      'TetherAgent',
      ['Types.js', 'Constants.js', 'agentHelpers.js', 'w1FormatGuidelines.js', 'agentPrompts.js', 'BaseAgent.js', 'TetherAgent.js'],
      tabContent, tabMarkdown, MOCK_INSTRUCTION_RESPONSE
    );
    interpreted = captureInterpreterSnapshot(
      'tether', tabContent, tabMarkdown, MOCK_INSTRUCTION_RESPONSE
    );
  });

  it('systemPrompt matches', () => {
    expect(interpreted.geminiCall.systemPrompt).toBe(concrete.geminiCall.systemPrompt);
  });

  it('userPrompt matches', () => {
    expect(interpreted.geminiCall.userPrompt).toBe(concrete.geminiCall.userPrompt);
  });

  it('tier is thinking', () => {
    expect(interpreted.geminiCall.tier).toBe('thinking');
    expect(concrete.geminiCall.tier).toBe('thinking');
  });

  it('schema is undefined (plain text mode — no JSON schema)', () => {
    expect(interpreted.geminiCall.schema).toBeUndefined();
    expect(concrete.geminiCall.schema).toBeUndefined();
  });

  it('processUpdate payload matches — review_tab points to TETHER_INSTRUCTIONS tab', () => {
    expect(interpreted.update).toEqual(concrete.update);
    expect((interpreted.update as any)?.review_tab).toBe(Constants.TAB_NAMES.TETHER_INSTRUCTIONS);
    expect((interpreted.update as any)?.workflow_type).toBe('instruction_update');
  });
});

// ── TtsAgent parity tests ─────────────────────────────────────────────

describe('TtsAgent — W1 generateInstructions parity', () => {

  const tabContent  = { [Constants.TAB_NAMES.MANUSCRIPT]: MANUSCRIPT_PLAIN };
  const tabMarkdown = {
    [Constants.TAB_NAMES.STYLE_PROFILE]:        STYLE_PROFILE_MD,
    [Constants.TAB_NAMES.TTS_INSTRUCTIONS]:     "Some old TTS instructions.",
  };

  let concrete:    AgentSnapshot;
  let interpreted: AgentSnapshot;

  beforeAll(() => {
    concrete = captureConcreteSnapshot(
      'TtsAgent',
      ['Types.js', 'Constants.js', 'agentHelpers.js', 'w1FormatGuidelines.js', 'agentPrompts.js', 'BaseAgent.js', 'TtsAgent.js'],
      tabContent, tabMarkdown, MOCK_TTS_INSTRUCTION_RESPONSE
    );
    interpreted = captureInterpreterSnapshot(
      'tts', tabContent, tabMarkdown, MOCK_TTS_INSTRUCTION_RESPONSE
    );
  });

  it('systemPrompt matches', () => {
    expect(interpreted.geminiCall.systemPrompt).toBe(concrete.geminiCall.systemPrompt);
  });

  it('userPrompt matches', () => {
    expect(interpreted.geminiCall.userPrompt).toBe(concrete.geminiCall.userPrompt);
  });

  it('tier is fast', () => {
    expect(interpreted.geminiCall.tier).toBe('fast');
    expect(concrete.geminiCall.tier).toBe('fast');
  });

  it('schema is undefined (plain text mode — no JSON schema)', () => {
    expect(interpreted.geminiCall.schema).toBeUndefined();
    expect(concrete.geminiCall.schema).toBeUndefined();
  });

  it('processUpdate payload matches — review_tab points to TTS_INSTRUCTIONS tab', () => {
    expect(interpreted.update).toEqual(concrete.update);
    expect((interpreted.update as any)?.review_tab).toBe(Constants.TAB_NAMES.TTS_INSTRUCTIONS);
    expect((interpreted.update as any)?.workflow_type).toBe('instruction_update');
  });
});

describe('TtsAgent — W1 validation', () => {
  it('fails when generated markdown omits the required Cast Role Policy heading', () => {
    const tabContent  = { [Constants.TAB_NAMES.MANUSCRIPT]: MANUSCRIPT_PLAIN };
    const tabMarkdown = {
      [Constants.TAB_NAMES.STYLE_PROFILE]:    STYLE_PROFILE_MD,
      [Constants.TAB_NAMES.TTS_INSTRUCTIONS]: 'Some old TTS instructions.',
    };

    expect(() => captureConcreteSnapshot(
      'TtsAgent',
      ['Types.js', 'Constants.js', 'agentHelpers.js', 'w1FormatGuidelines.js', 'agentPrompts.js', 'BaseAgent.js', 'TtsAgent.js'],
      tabContent,
      tabMarkdown,
      MOCK_INSTRUCTION_RESPONSE
    )).toThrow('missing required section "## Cast Role Policy (do not delete)"');
  });
});

// ── GeneralPurposeAgent parity tests ─────────────────────────────────────────

describe('GeneralPurposeAgent — W1 generateInstructions parity', () => {

  const tabContent  = {};
  const tabMarkdown = {
    [Constants.TAB_NAMES.STYLE_PROFILE]:                STYLE_PROFILE_MD,
    [Constants.TAB_NAMES.GENERAL_PURPOSE_INSTRUCTIONS]: GP_INSTRUCTIONS_MD,
  };

  let concrete:    AgentSnapshot;
  let interpreted: AgentSnapshot;

  beforeAll(() => {
    concrete = captureConcreteSnapshot(
      'GeneralPurposeAgent',
      ['Types.js', 'Constants.js', 'agentHelpers.js', 'w1FormatGuidelines.js', 'agentPrompts.js', 'BaseAgent.js', 'GeneralPurposeAgent.js'],
      tabContent, tabMarkdown, MOCK_MARKDOWN_RESPONSE
    );
    interpreted = captureInterpreterSnapshot(
      'general-purpose', tabContent, tabMarkdown, MOCK_MARKDOWN_RESPONSE
    );
  });

  it('systemPrompt matches', () => {
    expect(interpreted.geminiCall.systemPrompt).toBe(concrete.geminiCall.systemPrompt);
  });

  it('userPrompt matches', () => {
    expect(interpreted.geminiCall.userPrompt).toBe(concrete.geminiCall.userPrompt);
  });

  it('tier is fast', () => {
    expect(interpreted.geminiCall.tier).toBe('fast');
    expect(concrete.geminiCall.tier).toBe('fast');
  });

  it('schema is undefined (plain_markdown — no JSON schema)', () => {
    expect(interpreted.geminiCall.schema).toBeUndefined();
    expect(concrete.geminiCall.schema).toBeUndefined();
  });

  it('processUpdate payload matches — review_tab points to GENERAL_PURPOSE_INSTRUCTIONS tab', () => {
    expect(interpreted.update).toEqual(concrete.update);
    expect((interpreted.update as any)?.review_tab).toBe(Constants.TAB_NAMES.GENERAL_PURPOSE_INSTRUCTIONS);
    expect((interpreted.update as any)?.workflow_type).toBe('instruction_update');
  });
});

// ── Instruction-quality rubric / keys — definition matches dist concrete ─────

const IQ_DIST_BASE = ['Types.js', 'Constants.js', 'agentHelpers.js', 'w1FormatGuidelines.js', 'agentPrompts.js', 'BaseAgent.js'];

describe('Instruction quality — AgentDefinition matches concrete agent (dist)', () => {

  it('EarTuneAgent', () => {
    const m = readConcreteInstructionQualityMirror('EarTuneAgent', [...IQ_DIST_BASE, 'EarTuneAgent.js']);
    expect(earTuneDefinition.instructionQualityRubric).toBe(m.rubric);
    expect(earTuneDefinition.id).toBe(m.agentId);
  });

  it('ArchitectAgent', () => {
    const m = readConcreteInstructionQualityMirror('ArchitectAgent', [...IQ_DIST_BASE, 'ArchitectAgent.js']);
    expect(architectDefinition.instructionQualityRubric).toBe(m.rubric);
    expect(architectDefinition.id).toBe(m.agentId);
  });

  it('AuditAgent', () => {
    const m = readConcreteInstructionQualityMirror('AuditAgent', [...IQ_DIST_BASE, 'AuditAgent.js']);
    expect(auditDefinition.instructionQualityRubric).toBe(m.rubric);
    expect(auditDefinition.id).toBe(m.agentId);
  });

  it('TetherAgent', () => {
    const m = readConcreteInstructionQualityMirror('TetherAgent', [...IQ_DIST_BASE, 'TetherAgent.js']);
    expect(tetherDefinition.instructionQualityRubric).toBe(m.rubric);
    expect(tetherDefinition.id).toBe(m.agentId);
  });

  it('TtsAgent', () => {
    const m = readConcreteInstructionQualityMirror('TtsAgent', [...IQ_DIST_BASE, 'TtsAgent.js']);
    expect(ttsDefinition.instructionQualityRubric).toBe(m.rubric);
    expect(ttsDefinition.id).toBe(m.agentId);
  });

  it('GeneralPurposeAgent', () => {
    const m = readConcreteInstructionQualityMirror('GeneralPurposeAgent', [...IQ_DIST_BASE, 'GeneralPurposeAgent.js']);
    expect(generalPurposeDefinition.instructionQualityRubric).toBe(m.rubric);
    expect(generalPurposeDefinition.id).toBe(m.agentId);
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

  it('auditDefinition has required fields', () => {
    expect(auditDefinition.id).toBe('audit');
    expect(auditDefinition.commentPrefix).toBe('[Auditor]');
    expect(auditDefinition.instructionTabName).toBe(Constants.TAB_NAMES.TECHNICAL_AUDIT);
    expect(auditDefinition.tags).toEqual(['@audit', '@auditor']);
    expect(auditDefinition.workflows.generateInstructions!.modelTier).toBe('thinking');
    expect(auditDefinition.workflows.annotateTab).toBeDefined();
    expect(auditDefinition.workflows.handleCommentThreads!.chunkSize).toBe(5);
  });

  it('tetherDefinition has required fields', () => {
    expect(tetherDefinition.id).toBe('tether');
    expect(tetherDefinition.commentPrefix).toBe('[Tether]');
    expect(tetherDefinition.instructionTabName).toBe(Constants.TAB_NAMES.TETHER_INSTRUCTIONS);
    expect(tetherDefinition.tags).toEqual(['@tether', '@ref']);
    expect(tetherDefinition.workflows.generateInstructions!.modelTier).toBe('thinking');
    expect(tetherDefinition.workflows.handleCommentThreads!.chunkSize).toBe(5);
  });

  it('ttsDefinition has required fields', () => {
    expect(ttsDefinition.id).toBe('tts');
    expect(ttsDefinition.commentPrefix).toBe('[TtsAgent]');
    expect(ttsDefinition.instructionTabName).toBe(Constants.TAB_NAMES.TTS_INSTRUCTIONS);
    expect(ttsDefinition.tags).toEqual(['@tts']);
    expect(ttsDefinition.workflows.generateInstructions!.modelTier).toBe('fast');
  });

  it('generalPurposeDefinition has required fields', () => {
    expect(generalPurposeDefinition.id).toBe('general-purpose');
    expect(generalPurposeDefinition.tags).toEqual(['@ai']);
    expect(generalPurposeDefinition.instructionTabName).toBe(Constants.TAB_NAMES.GENERAL_PURPOSE_INSTRUCTIONS);
    expect(generalPurposeDefinition.systemPrompt.kind).toBe('tab');
    expect(generalPurposeDefinition.workflows.generateInstructions!.responseFormat).toBe('plain_markdown');
    expect(generalPurposeDefinition.workflows.annotateTab).toBeUndefined();
  });

  it('earTuneDefinition W1 has 5 context sections in correct order', () => {
    const w1 = earTuneDefinition.workflows.generateInstructions!;
    expect(w1.contextSections).toHaveLength(5);
    expect(w1.contextSections[0].source.kind).toBe('style_profile');
    expect(w1.contextSections[1].source.kind).toBe('manuscript');
    expect(w1.contextSections[2].source.kind).toBe('literal');
    expect(w1.contextSections[3].source.kind).toBe('self_instructions');
    expect(w1.contextSections[4].source.kind).toBe('tab');
    expect((w1.contextSections[4].source as any).tabName).toBe('${instructionTabName} Scratch');
  });

  it('architectDefinition W1 has 3 context sections: manuscript, style_profile, scratch tab', () => {
    const w1 = architectDefinition.workflows.generateInstructions!;
    expect(w1.contextSections).toHaveLength(3);
    expect(w1.contextSections[0].source.kind).toBe('manuscript');
    expect(w1.contextSections[1].source.kind).toBe('style_profile');
    expect(w1.contextSections[2].source.kind).toBe('tab');
    expect((w1.contextSections[2].source as any).tabName).toBe('${instructionTabName} Scratch');
  });

  it('auditDefinition W1 has 4 context sections: style_profile, self_instructions, tab, manuscript', () => {
    const w1 = auditDefinition.workflows.generateInstructions!;
    expect(w1.contextSections).toHaveLength(4);
    expect(w1.contextSections[0].source.kind).toBe('style_profile');
    expect(w1.contextSections[1].source.kind).toBe('self_instructions');
    expect(w1.contextSections[2].source.kind).toBe('tab');
    expect((w1.contextSections[2].source as any).tabName).toBe('${instructionTabName} Scratch');
    expect(w1.contextSections[3].source.kind).toBe('manuscript');
    expect((w1.contextSections[3].source as any).charLimit).toBe(20000);
  });

  it('tetherDefinition W1 has 4 context sections: style_profile, manuscript, self_instructions, tab', () => {
    const w1 = tetherDefinition.workflows.generateInstructions!;
    expect(w1.contextSections).toHaveLength(4);
    expect(w1.contextSections[0].source.kind).toBe('style_profile');
    expect(w1.contextSections[1].source.kind).toBe('manuscript');
    expect((w1.contextSections[1].source as any).charLimit).toBe(6000);
    expect(w1.contextSections[2].source.kind).toBe('self_instructions');
    expect(w1.contextSections[3].source.kind).toBe('tab');
    expect((w1.contextSections[3].source as any).tabName).toBe('${instructionTabName} Scratch');
  });

  it('all W2 definitions use the uniform passage section title from Constants', () => {
    const expected = W2_PASSAGE_SECTION_TITLE;
    const earTunePassage = earTuneDefinition.workflows.annotateTab!.contextSections
      .find(s => s.source.kind === 'passage')!;
    const auditPassage = auditDefinition.workflows.annotateTab!.contextSections
      .find(s => s.source.kind === 'passage')!;
    const tetherPassage = tetherDefinition.workflows.annotateTab!.contextSections
      .find(s => s.source.kind === 'passage')!;
    const ttsPassage = ttsDefinition.workflows.annotateTab!.contextSections
      .find(s => s.source.kind === 'passage')!;
    expect(earTunePassage.title).toBe(expected);
    expect(auditPassage.title).toBe(expected);
    expect(tetherPassage.title).toBe(expected);
    expect(ttsPassage.title).toBe(expected);
  });

  it('architectDefinition W1 postStep is evaluate_instruction_quality only', () => {
    const postSteps = architectDefinition.workflows.generateInstructions!.postSteps;
    expect(postSteps).toEqual([{ kind: 'evaluate_instruction_quality' }]);
  });

  it('systemPrompt contains SYSTEM_PREAMBLE for all agents', () => {
    const preambleSnippet = '# EditorLLM Context';
    for (const def of [earTuneDefinition, architectDefinition, auditDefinition, tetherDefinition, generalPurposeDefinition, publisherDefinition]) {
      if (def.systemPrompt.kind === 'static') {
        expect(def.systemPrompt.text).toContain(preambleSnippet);
      } else {
        // tab-based fallback must also contain the preamble
        expect(def.systemPrompt.fallback).toContain(preambleSnippet);
      }
    }
  });

  it('publisherDefinition W2 passage section uses the uniform W2 title', () => {
    const passage = publisherDefinition.workflows.annotateTab!.contextSections
      .find(s => s.source.kind === 'passage')!;
    expect(passage.title).toBe(W2_PASSAGE_SECTION_TITLE);
  });
});

// ── PublisherAgent parity tests ───────────────────────────────────────────────

describe('PublisherAgent — W1 generateInstructions parity', () => {

  const tabContent  = { [Constants.TAB_NAMES.MANUSCRIPT]: MANUSCRIPT_PLAIN };
  const tabMarkdown = {
    [Constants.TAB_NAMES.STYLE_PROFILE]:           STYLE_PROFILE_MD,
    [Constants.TAB_NAMES.PUBLISHER_INSTRUCTIONS]:  PUBLISHER_INSTRUCTIONS_MD,
  };

  let concrete:    AgentSnapshot;
  let interpreted: AgentSnapshot;

  beforeAll(() => {
    concrete = captureConcreteSnapshot(
      'PublisherAgent',
      ['Types.js', 'Constants.js', 'agentHelpers.js', 'w1FormatGuidelines.js', 'agentPrompts.js',
       'PublisherHelpers.js', 'BaseAgent.js', 'PublisherAgent.js'],
      tabContent, tabMarkdown, MOCK_INSTRUCTION_RESPONSE
    );
    interpreted = captureInterpreterSnapshot(
      'publisher', tabContent, tabMarkdown, MOCK_INSTRUCTION_RESPONSE
    );
  });

  it('systemPrompt matches', () => {
    expect(interpreted.geminiCall.systemPrompt).toBe(concrete.geminiCall.systemPrompt);
  });

  it('userPrompt matches', () => {
    expect(interpreted.geminiCall.userPrompt).toBe(concrete.geminiCall.userPrompt);
  });

  it('tier is thinking', () => {
    expect(interpreted.geminiCall.tier).toBe('thinking');
    expect(concrete.geminiCall.tier).toBe('thinking');
  });

  it('schema is undefined (plain_markdown — no JSON schema)', () => {
    expect(interpreted.geminiCall.schema).toBeUndefined();
    expect(concrete.geminiCall.schema).toBeUndefined();
  });

  it('processUpdate payload matches — review_tab points to PUBLISHER_INSTRUCTIONS', () => {
    expect(interpreted.update).toEqual(concrete.update);
    expect((interpreted.update as any)?.review_tab).toBe(Constants.TAB_NAMES.PUBLISHER_INSTRUCTIONS);
    expect((interpreted.update as any)?.workflow_type).toBe('instruction_update');
    expect((interpreted.update as any)?.proposed_full_text).toBe('__MOCK_PROPOSED_TEXT__');
  });
});
import { W2_PASSAGE_SECTION_TITLE } from '../../agentPrompts';
