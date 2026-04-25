import type { AgentDefinition } from '../../types';
import { Constants } from '../../../Constants';
import {
  SYSTEM_PREAMBLE,
  W1_FORMAT_GUIDELINES,
  TTS_SYSTEM_PROMPT_BODY,
  TTS_CAST_ROLE_POLICY_SCHEMA,
  TTS_INSTRUCTION_QUALITY_RUBRIC,
  TTS_W1_INSTRUCTIONS,
  TTS_W2_INSTRUCTIONS,
  W2_PASSAGE_SECTION_TITLE
} from '../../../agentPrompts';

import { ttsDirectivesSchema } from '../../../agentHelpers';

const TTS_SYSTEM_PROMPT = `${SYSTEM_PREAMBLE}

${TTS_SYSTEM_PROMPT_BODY}
`.trim();

export const ttsDefinition: AgentDefinition = {
  id:               'tts',
  displayName:      'TTS',
  description:      'Translates manuscript formatting and characters into text-to-speech parameters.',
  tags:             ['@tts'],
  commentPrefix:    '[TtsAgent]',
  instructionTabName: Constants.TAB_NAMES.TTS_INSTRUCTIONS,

  systemPrompt: {
    kind: 'static',
    text: TTS_SYSTEM_PROMPT,
  },

  instructionQualityRubric: TTS_INSTRUCTION_QUALITY_RUBRIC,

  workflows: {
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
          title:  'Current TTS Instructions (if any)',
          source: { kind: 'self_instructions', format: 'markdown' },
        },
        {
          title:  'Last Generated Instructions',
          source: { kind: 'tab', tabName: `${Constants.TAB_NAMES.TTS_INSTRUCTIONS} Scratch`, format: 'plain', fallback: '(none — first run)' },
        },
        {
          title:  'Manuscript Sample',
          source: { kind: 'manuscript', charLimit: 20000 },
        },
        {
          title:  'Cached ElevenLabs Voice Registry (voice_name => voice_id)',
          source: { kind: 'literal', text: 'NOT PROVIDED' },
        },
      ],
      instructions: TTS_W1_INSTRUCTIONS + '\n' + TTS_CAST_ROLE_POLICY_SCHEMA + '\n' + W1_FORMAT_GUIDELINES,
      postSteps: [{ kind: 'evaluate_instruction_quality' }],
    },

    annotateTab: {
      modelTier:            'fast',
      requiresStyleProfile: true,
      responseFormat:       'bookmark_directives',
      schemaProvider:       ttsDirectivesSchema,
      directiveBuilder:     (op: any) => ({
        type: 'tts',
        payload: {
          tts_model:          op.tts_model,
          voice_id:           op.voice_id,
          stability:          op.stability,
          similarity_boost:   op.similarity_boost,
        },
      }),
      contextSections: [
        {
          title:  'Style Profile',
          source: { kind: 'style_profile', format: 'plain' },
        },
        {
          title:  'TTS Instructions',
          source: { kind: 'self_instructions', format: 'plain' },
        },
        {
          title: W2_PASSAGE_SECTION_TITLE,
          source: { kind: 'passage' },
        },
      ],
      instructions: TTS_W2_INSTRUCTIONS,
    },
  },
};
