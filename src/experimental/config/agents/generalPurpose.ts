// ============================================================
// src/experimental/config/agents/generalPurpose.ts
//
// Declarative definition of GeneralPurposeAgent.
// Must produce the same (systemPrompt, userPrompt) as the concrete
// GeneralPurposeAgent for each workflow — verified by agent-parity.test.ts.
// ============================================================

import type { AgentDefinition } from '../../types';
import { Constants } from '../../../Constants';
import {
  SYSTEM_PREAMBLE,
  W1_FORMAT_GUIDELINES,
  GENERALPURPOSE_SYSTEM_PROMPT_BODY,
  GENERALPURPOSE_INSTRUCTION_QUALITY_RUBRIC,
  GENERALPURPOSE_W1_INSTRUCTIONS,
  GENERALPURPOSE_W3_INSTRUCTIONS,
} from '../../../agentPrompts';

// ── GP-specific system prompt fallback (mirrors GeneralPurposeAgent.SYSTEM_PROMPT) ──

const GENERAL_PURPOSE_SYSTEM_PROMPT = `${SYSTEM_PREAMBLE}

${GENERALPURPOSE_SYSTEM_PROMPT_BODY}
`.trim();

// ── Definition object ─────────────────────────────────────────────────────────

export const generalPurposeDefinition: AgentDefinition = {
  id:                 'general-purpose',
  displayName:        'Comment Agent',
  description:        'Responds to @AI comment threads in a voice consistent with the manuscript StyleProfile.',
  tags:               ['@ai'],
  commentPrefix:      '[AI]',
  instructionTabName: Constants.TAB_NAMES.GENERAL_PURPOSE_INSTRUCTIONS,

  // System prompt is dynamic: read from the instructions tab at runtime,
  // falling back to the hardcoded prompt when the tab is empty.
  systemPrompt: {
    kind:     'tab',
    tabName:  Constants.TAB_NAMES.GENERAL_PURPOSE_INSTRUCTIONS,
    fallback: GENERAL_PURPOSE_SYSTEM_PROMPT,
  },

  instructionQualityRubric: GENERALPURPOSE_INSTRUCTION_QUALITY_RUBRIC,

  workflows: {

    // W1 — Generate / refresh General Purpose Instructions tab
    // Context sections match GeneralPurposeAgent.generateInstructionPrompt():
    //   - 'Style Profile' (markdown via getTabMarkdown_)
    //   - 'Current General Purpose Instructions (if any)' (markdown via getTabMarkdown_)
    // responseFormat is 'plain_markdown' — no JSON schema, raw string from Gemini.
    // The interpreter applies extractMarkdownFromJsonWrapper_ automatically.
    generateInstructions: {
      modelTier:            'fast',
      requiresStyleProfile: true,
      responseFormat:       'plain_markdown',
      contextSections: [
        {
          title:  'Style Profile',
          source: { kind: 'style_profile', format: 'markdown' },
        },
        {
          title:  'Current General Purpose Instructions (if any)',
          source: { kind: 'self_instructions', format: 'markdown' },
        },
        {
          title:  'Last Generated Instructions',
          source: { kind: 'tab', tabName: '${instructionTabName} Scratch', format: 'plain', fallback: '(none — first run)' },
        },
      ],
      instructions: GENERALPURPOSE_W1_INSTRUCTIONS + '\n' + W1_FORMAT_GUIDELINES,
      postSteps: [{ kind: 'evaluate_instruction_quality' }],
    },

    // W3 — Reply to @ai comment threads
    // Context sections match GeneralPurposeAgent.generateCommentResponsesPrompt():
    //   - 'Anchor Passage' (anchor-tab content — may be empty)
    //   - 'Threads' (formatted threads)
    // Note: GP agent uses 'Anchor Passage' (not 'Passage Context' like other agents).
    handleCommentThreads: {
      modelTier:            'fast',
      chunkSize:            10,
      requiresStyleProfile: false,
      responseFormat:       'thread_replies',
      contextSections: [
        {
          title:  'Anchor Passage',
          source: { kind: 'anchor_tab' },
        },
        {
          title:  'Threads',
          source: { kind: 'threads' },
        },
      ],
      instructions: GENERALPURPOSE_W3_INSTRUCTIONS,
    },

  },
};
