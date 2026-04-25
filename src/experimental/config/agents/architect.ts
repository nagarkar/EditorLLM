// ============================================================
// src/experimental/config/agents/architect.ts
//
// Declarative definition of ArchitectAgent.
// Must produce the same (systemPrompt, userPrompt) as the concrete
// ArchitectAgent for generateInstructions() — verified by agent-parity.test.ts.
// ============================================================

import type { AgentDefinition } from '../../types';
import { Constants } from '../../../Constants';
import {
  SYSTEM_PREAMBLE,
  W1_FORMAT_GUIDELINES,
  ARCHITECT_SYSTEM_PROMPT_BODY,
  ARCHITECT_INSTRUCTION_QUALITY_RUBRIC,
  ARCHITECT_W1_INSTRUCTIONS,
  ARCHITECT_STYLEPROFILE_SCHEMA,
  ARCHITECT_W3_INSTRUCTIONS,
} from '../../../agentPrompts';

// ── Architect-specific system prompt (mirrors ArchitectAgent.SYSTEM_PROMPT) ──

const ARCHITECT_SYSTEM_PROMPT = `${SYSTEM_PREAMBLE}

${ARCHITECT_SYSTEM_PROMPT_BODY}
`.trim();

// ── Definition object ─────────────────────────────────────────────────────────

export const architectDefinition: AgentDefinition = {
  id:               'architect',
  displayName:      'Structural Architect',
  description:      'Analyses the manuscript and synthesizes a StyleProfile that constrains all other agents.',
  tags:             ['@architect'],
  commentPrefix:    '[Architect]',
  instructionTabName: Constants.TAB_NAMES.STYLE_PROFILE,

  systemPrompt: {
    kind: 'static',
    text: ARCHITECT_SYSTEM_PROMPT,
  },

  instructionQualityRubric:           ARCHITECT_INSTRUCTION_QUALITY_RUBRIC,

  workflows: {

    // W1 — Generate / refresh the StyleProfile tab
    // Context sections match ArchitectAgent.generateInstructionPrompt():
    //   - 'Manuscript (excerpt)' (plain text via getTabContent_, sliced 0-20000)
    //   - 'Current Style Profile (if any)' (markdown via getTabMarkdown_)
    //
    // Key differences from other agents:
    //   - requiresStyleProfile: false — Architect GENERATES the profile, never guards on it
    //   - modelTier: 'thinking' — uses the highest quality model
    //   - postSteps: evaluate_instruction_quality — LLM-as-judge after writing
    generateInstructions: {
      modelTier:            'thinking',
      requiresStyleProfile: false,
      responseFormat:       'instruction_update',
      contextSections: [
        {
          // Concrete uses getTabContent_ (plain text, NOT markdown)
          title:  'Manuscript (excerpt)',
          source: { kind: 'manuscript', charLimit: 20000 },
        },
        {
          // Concrete uses getTabMarkdown_ (markdown)
          title:  'Current Style Profile (if any)',
          source: { kind: 'style_profile', format: 'markdown' },
        },
        {
          title:  'Last Generated Instructions',
          source: { kind: 'tab', tabName: '${instructionTabName} Scratch', format: 'plain', fallback: '(none — first run)' },
        },
      ],
      instructions: ARCHITECT_W1_INSTRUCTIONS + '\n' + ARCHITECT_STYLEPROFILE_SCHEMA + '\n' + W1_FORMAT_GUIDELINES,
      postSteps: [{ kind: 'evaluate_instruction_quality' }],
    },

    // W3 — Reply to @architect comment threads
    // Context sections match ArchitectAgent.generateCommentResponsesPrompt():
    //   - 'Style Profile' (plain text)
    //   - 'Manuscript Context' (plain text, sliced 0-20000)
    //   - 'Threads' (formatted threads)
    handleCommentThreads: {
      modelTier:            'thinking',
      chunkSize:            5,
      requiresStyleProfile: false,
      responseFormat:       'thread_replies',
      contextSections: [
        {
          title:  'Style Profile',
          source: { kind: 'style_profile', format: 'plain' },
        },
        {
          title:  'Manuscript Context',
          source: { kind: 'manuscript', charLimit: 20000 },
        },
        {
          title:  'Threads',
          source: { kind: 'threads' },
        },
      ],
      instructions: ARCHITECT_W3_INSTRUCTIONS,
    },

  },
};
