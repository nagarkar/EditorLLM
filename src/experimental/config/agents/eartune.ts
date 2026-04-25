// ============================================================
// src/experimental/config/agents/eartune.ts
//
// Declarative definition of EarTuneAgent.
// Must produce the same (systemPrompt, userPrompt) as the concrete
// EarTuneAgent for generateInstructions() — verified by agent-parity.test.ts.
// ============================================================

import type { AgentDefinition } from '../../types';
import { Constants } from '../../../Constants';
import {
  SYSTEM_PREAMBLE,
  W1_FORMAT_GUIDELINES,
  EARTUNE_SYSTEM_PROMPT_BODY,
  EARTUNE_MANUAL_INNOVATION_PRESERVATION,
  EARTUNE_INSTRUCTION_QUALITY_RUBRIC,
  EARTUNE_W1_INSTRUCTIONS,
  EARTUNE_W2_INSTRUCTIONS,
  EARTUNE_W3_INSTRUCTIONS,
  
W2_PASSAGE_SECTION_TITLE
} from '../../../agentPrompts';

// ── EarTune-specific system prompt (mirrors EarTuneAgent.SYSTEM_PROMPT) ──────

const EARTUNE_SYSTEM_PROMPT = `${SYSTEM_PREAMBLE}

${EARTUNE_SYSTEM_PROMPT_BODY}
`.trim();

// ── Definition object ─────────────────────────────────────────────────────────

export const earTuneDefinition: AgentDefinition = {
  id:               'eartune',
  displayName:      'EarTune',
  description:      'Optimizes prose for spoken-word clarity and rhythmic listenability.',
  tags:             ['@eartune'],
  commentPrefix:    '[EarTune]',
  instructionTabName: Constants.TAB_NAMES.EAR_TUNE,

  systemPrompt: {
    kind: 'static',
    text: EARTUNE_SYSTEM_PROMPT,
  },

  instructionQualityRubric: EARTUNE_INSTRUCTION_QUALITY_RUBRIC,

  workflows: {

    // W1 — Generate / refresh EarTune Instructions tab
    // Context sections match EarTuneAgent.generateInstructionPrompt():
    //   - 'Style Profile' (styleProfile, via getTabMarkdown_)
    //   - 'Manual Innovation Preservation Contract' (static preservation rules)
    //   - 'Current Ear-Tune Instructions (if any)' (existing, via getTabMarkdown_)
    generateInstructions: {
      modelTier:            'fast',
      requiresStyleProfile: true,
      responseFormat:       'instruction_update',
      contextSections: [
        {
          title:  'Style Profile',
          source: { kind: 'style_profile', format: 'markdown' },
        },
        {
          title:  'Manual Innovation Preservation Contract',
          source: { kind: 'literal', text: EARTUNE_MANUAL_INNOVATION_PRESERVATION },
        },
        {
          title:  'Current Ear-Tune Instructions (if any)',
          source: { kind: 'self_instructions', format: 'markdown' },
        },
        {
          title:  'Last Generated Instructions',
          source: { kind: 'tab', tabName: '${instructionTabName} Scratch', format: 'plain', fallback: '(none — first run)' },
        },
      ],
      instructions: EARTUNE_W1_INSTRUCTIONS + '\n' + W1_FORMAT_GUIDELINES,
      postSteps: [{ kind: 'evaluate_instruction_quality' }],
    },

    // W2 — Annotate a manuscript tab with Ear-Tune highlights
    // Context sections match EarTuneAgent.generateTabAnnotationPrompt():
    //   - 'Style Profile' (plain text, via getTabContent_)
    //   - 'Ear-Tune Instructions' (plain text, via getTabContent_)
    //   - 'Passage To Sweep (from tab: "…")' (runtime, via passage arg)
    annotateTab: {
      modelTier:            'fast',
      requiresStyleProfile: true,
      responseFormat:       'annotation_operations',
      contextSections: [
        {
          title:  'Style Profile',
          source: { kind: 'style_profile', format: 'plain' },
        },
        {
          title:  'Ear-Tune Instructions',
          source: { kind: 'self_instructions', format: 'plain' },
        },
        {
          title: W2_PASSAGE_SECTION_TITLE,
          source: { kind: 'passage' },
        },
      ],
      instructions: EARTUNE_W2_INSTRUCTIONS,
      postSteps: [{ kind: 'validate_operations' }],
    },

    // W3 — Reply to @eartune comment threads
    // Context sections match EarTuneAgent.generateCommentResponsesPrompt():
    //   - 'Style Profile' (plain text)
    //   - 'Ear-Tune Instructions' (plain text)
    //   - 'Passage Context' (anchor-tab content)
    //   - 'Threads' (formatted threads)
    handleCommentThreads: {
      modelTier:            'fast',
      chunkSize:            10,
      requiresStyleProfile: true,
      responseFormat:       'thread_replies',
      contextSections: [
        {
          title:  'Style Profile',
          source: { kind: 'style_profile', format: 'plain' },
        },
        {
          title:  'Ear-Tune Instructions',
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
      instructions: EARTUNE_W3_INSTRUCTIONS,
  
    },

  },
};
