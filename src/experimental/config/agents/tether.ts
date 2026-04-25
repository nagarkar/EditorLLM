// ============================================================
// src/experimental/config/agents/tether.ts
//
// Declarative definition of TetherAgent.
// Must produce the same (systemPrompt, userPrompt) as the concrete
// TetherAgent for each workflow — verified by agent-parity.test.ts.
// ============================================================

import type { AgentDefinition } from '../../types';
import { Constants } from '../../../Constants';
import {
  SYSTEM_PREAMBLE,
  W1_FORMAT_GUIDELINES,
  TETHER_SYSTEM_PROMPT_BODY,
  TETHER_INSTRUCTION_QUALITY_RUBRIC,
  TETHER_W1_INSTRUCTIONS,
  TETHER_W2_INSTRUCTIONS,
  TETHER_W3_INSTRUCTIONS,
  
W2_PASSAGE_SECTION_TITLE
} from '../../../agentPrompts';

// ── Tether-specific system prompt (mirrors TetherAgent.SYSTEM_PROMPT) ────────

const TETHER_SYSTEM_PROMPT = `${SYSTEM_PREAMBLE}

${TETHER_SYSTEM_PROMPT_BODY}
`.trim();

// ── Definition object ─────────────────────────────────────────────────────────

export const tetherDefinition: AgentDefinition = {
  id:                 'tether',
  displayName:        'External Anchor',
  description:        'Bridges the manuscript framework with the external historical, scientific, and scholarly record.',
  tags:               ['@tether', '@ref'],
  commentPrefix:      '[Tether]',
  instructionTabName: Constants.TAB_NAMES.TETHER_INSTRUCTIONS,

  systemPrompt: {
    kind: 'static',
    text: TETHER_SYSTEM_PROMPT,
  },

  instructionQualityRubric: TETHER_INSTRUCTION_QUALITY_RUBRIC,

  workflows: {

    // W1 — Generate / refresh TetherInstructions
    // Context sections match TetherAgent.generateInstructionPrompt():
    //   - 'Style Profile' (markdown via getTabMarkdown_)
    //   - 'Manuscript Sample (for Fact-Checking Context)' (plain, sliced to 6000)
    //   - 'Current Tether Instructions (if any)' (markdown via getTabMarkdown_)
    // Note: TetherAgent puts ManuscriptSample BEFORE CurrentInstructions.
    generateInstructions: {
      modelTier:            'thinking',
      requiresStyleProfile: true,
      responseFormat:       'instruction_update',
      contextSections: [
        {
          title:  'Style Profile',
          source: { kind: 'style_profile', format: 'markdown' },
        },
        {
          title:  'Manuscript Sample (for Fact-Checking Context)',
          source: { kind: 'manuscript', charLimit: 6000 },
        },
        {
          title:  'Current Tether Instructions (if any)',
          source: { kind: 'self_instructions', format: 'markdown' },
        },
        {
          title:  'Last Generated Instructions',
          source: { kind: 'tab', tabName: '${instructionTabName} Scratch', format: 'plain', fallback: '(none — first run)' },
        },
      ],
      instructions: TETHER_W1_INSTRUCTIONS + '\n' + W1_FORMAT_GUIDELINES,
      postSteps: [{ kind: 'evaluate_instruction_quality' }],
    },

    // W2 — Annotate a manuscript tab with tether validation highlights
    // Context sections match TetherAgent.generateTabAnnotationPrompt():
    //   - 'Style Profile' (plain via getTabContent_)
    //   - 'Tether Instructions' (plain via getTabContent_)
    //   - passage (uniform W2 title from Constants)
    annotateTab: {
      modelTier:            'thinking',
      requiresStyleProfile: true,
      responseFormat:       'annotation_operations',
      contextSections: [
        {
          title:  'Style Profile',
          source: { kind: 'style_profile', format: 'plain' },
        },
        {
          title:  'Tether Instructions',
          source: { kind: 'self_instructions', format: 'plain' },
        },
        {
          title: W2_PASSAGE_SECTION_TITLE,
          source: { kind: 'passage' },
        },
      ],
      instructions: TETHER_W2_INSTRUCTIONS,
      postSteps: [{ kind: 'validate_operations' }],
    },

    // W3 — Reply to @tether / @ref comment threads
    // Context sections match TetherAgent.generateCommentResponsesPrompt():
    //   - 'Style Profile' (plain)
    //   - 'Tether Instructions' (plain)
    //   - 'Passage Context' (anchor-tab content)
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
          title:  'Tether Instructions',
          source: { kind: 'self_instructions', format: 'plain' },
        },
        {
          title:  'Passage Context',
          source: { kind: 'anchor_tab' },
        },
        {
          title:  'Threads',
          source: { kind: 'threads' },
        },
      ],
      instructions: TETHER_W3_INSTRUCTIONS,
  
    },

  },
};
