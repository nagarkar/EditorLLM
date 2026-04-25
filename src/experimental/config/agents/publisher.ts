// ============================================================
// src/experimental/config/agents/publisher.ts
//
// Declarative definition of PublisherAgent — W1 and W2 only.
// W5 (generatePublishingTabs) requires extending WorkflowDef.responseFormat
// with a 'tab_generation' variant and AgentDefinition.workflows with a
// generatePublishingTabs key; it is not modelled here yet.
//
// Must produce the same (systemPrompt, userPrompt) as the concrete
// PublisherAgent for each modelled workflow — verified by agent-parity.test.ts.
// ============================================================

import type { AgentDefinition } from '../../types';
import { Constants } from '../../../Constants';
import {
  SYSTEM_PREAMBLE,
  W1_FORMAT_GUIDELINES,
  PUBLISHER_SYSTEM_PROMPT_BODY,
  PUBLISHER_INSTRUCTION_QUALITY_RUBRIC,
  PUBLISHER_W1_INSTRUCTIONS,
  PUBLISHER_W2_INSTRUCTIONS,
  W2_PASSAGE_SECTION_TITLE,
} from '../../../agentPrompts';

// ── Publisher-specific system prompt (mirrors PublisherAgent.SYSTEM_PROMPT) ──

const PUBLISHER_SYSTEM_PROMPT = `${SYSTEM_PREAMBLE}

${PUBLISHER_SYSTEM_PROMPT_BODY}
`.trim();

// ── Definition object ─────────────────────────────────────────────────────────

export const publisherDefinition: AgentDefinition = {
  id:                 'publisher',
  displayName:        'Publisher',
  description:        'Bridges polished prose to publishing assets for KDP ebook and ACX/Audible upload.',
  tags:               ['@publisher'],
  commentPrefix:      '[Publisher]',
  instructionTabName: Constants.TAB_NAMES.PUBLISHER_INSTRUCTIONS,

  systemPrompt: {
    kind: 'static',
    text: PUBLISHER_SYSTEM_PROMPT,
  },

  instructionQualityRubric: PUBLISHER_INSTRUCTION_QUALITY_RUBRIC,

  workflows: {

    // W1 — Generate / refresh Publisher Instructions
    // Context sections match PublisherAgent.generateInstructionPrompt():
    //   - 'Style Profile' (markdown via getTabMarkdown_)
    //   - 'Current Publisher Instructions (if any)' (markdown via getTabMarkdown_)
    //   - 'Last Generated Instructions' (plain, from Scratch tab)
    //   - 'Manuscript Sample' (plain, sliced to 20000)
    // responseFormat is 'plain_markdown' — no JSON schema, raw string from Gemini.
    generateInstructions: {
      modelTier:            'thinking',
      requiresStyleProfile: true,
      responseFormat:       'plain_markdown',
      contextSections: [
        {
          title:  'Style Profile',
          source: { kind: 'style_profile', format: 'markdown' },
        },
        {
          title:  'Current Publisher Instructions (if any)',
          source: { kind: 'self_instructions', format: 'markdown' },
        },
        {
          title:  'Last Generated Instructions',
          source: { kind: 'tab', tabName: '${instructionTabName} Scratch', format: 'plain', fallback: '(none — first run)' },
        },
        {
          title:  'Manuscript Sample',
          source: { kind: 'manuscript', charLimit: 20000 },
        },
      ],
      instructions: PUBLISHER_W1_INSTRUCTIONS + '\n' + W1_FORMAT_GUIDELINES,
      postSteps: [{ kind: 'evaluate_instruction_quality' }],
    },

    // W2 — Structural audit of Manuscript
    // PublisherAgent.annotateManuscriptStructure() always operates on Manuscript,
    // never on a user-selected tab. Call interpreter.annotateTab(MANUSCRIPT) to match.
    // Context sections match PublisherAgent.generateStructuralAuditPrompt():
    //   - 'Style Profile' (plain via getTabContent_)
    //   - 'Publisher Instructions' (plain via getTabContent_, falls back to SYSTEM_PROMPT)
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
          title:  'Publisher Instructions',
          source: { kind: 'self_instructions', format: 'plain' },
        },
        {
          title: W2_PASSAGE_SECTION_TITLE,
          source: { kind: 'passage' },
        },
      ],
      instructions: PUBLISHER_W2_INSTRUCTIONS,
      postSteps: [{ kind: 'validate_operations' }],
    },

  },
};
