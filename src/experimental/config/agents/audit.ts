// ============================================================
// src/experimental/config/agents/audit.ts
//
// Declarative definition of AuditAgent.
// Must produce the same (systemPrompt, userPrompt) as the concrete
// AuditAgent for each workflow — verified by agent-parity.test.ts.
// ============================================================

import type { AgentDefinition } from '../../types';
import { Constants } from '../../../Constants';
import {
  SYSTEM_PREAMBLE,
  W1_FORMAT_GUIDELINES,
  AUDIT_SYSTEM_PROMPT_BODY,
  AUDIT_INSTRUCTION_QUALITY_RUBRIC,
  AUDIT_W1_INSTRUCTIONS,
  AUDIT_W2_INSTRUCTIONS,
  AUDIT_W3_INSTRUCTIONS,
  
W2_PASSAGE_SECTION_TITLE
} from '../../../agentPrompts';

// ── Audit-specific system prompt (mirrors AuditAgent.SYSTEM_PROMPT) ──────────

const AUDIT_SYSTEM_PROMPT = `${SYSTEM_PREAMBLE}

${AUDIT_SYSTEM_PROMPT_BODY}
`.trim();

// ── Definition object ─────────────────────────────────────────────────────────

export const auditDefinition: AgentDefinition = {
  id:                 'audit',
  displayName:        'Logical Auditor',
  description:        'Verifies factual claims, technical notations, and core-framework consistency.',
  tags:               ['@audit', '@auditor'],
  commentPrefix:      '[Auditor]',
  instructionTabName: Constants.TAB_NAMES.TECHNICAL_AUDIT,

  systemPrompt: {
    kind: 'static',
    text: AUDIT_SYSTEM_PROMPT,
  },

  instructionQualityRubric: AUDIT_INSTRUCTION_QUALITY_RUBRIC,

  workflows: {

    // W1 — Generate / refresh TechnicalAudit instructions
    // Context sections match AuditAgent.generateInstructionPrompt():
    //   - 'Style Profile' (markdown via getTabMarkdown_)
    //   - 'Current Technical Audit Instructions (if any)' (markdown via getTabMarkdown_)
    //   - 'Manuscript Sample (for principle extraction)' (plain, sliced to 20000)
    // Note: AuditAgent puts CurrentInstructions BEFORE ManuscriptSample.
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
          title:  'Current Technical Audit Instructions (if any)',
          source: { kind: 'self_instructions', format: 'markdown' },
        },
        {
          title:  'Last Generated Instructions',
          source: { kind: 'tab', tabName: '${instructionTabName} Scratch', format: 'plain', fallback: '(none — first run)' },
        },
        {
          title:  'Manuscript Sample (for principle extraction)',
          source: { kind: 'manuscript', charLimit: 20000 },
        },
      ],
      instructions: AUDIT_W1_INSTRUCTIONS + '\n' + W1_FORMAT_GUIDELINES,
      postSteps: [{ kind: 'evaluate_instruction_quality' }],
    },

    // W2 — Annotate a manuscript tab with audit highlights
    // Context sections match AuditAgent.generateTabAnnotationPrompt():
    //   - 'Style Profile' (plain via getTabContent_)
    //   - 'Technical Audit Instructions' (plain via getTabContent_)
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
          title:  'Technical Audit Instructions',
          source: { kind: 'self_instructions', format: 'plain' },
        },
        {
          title: W2_PASSAGE_SECTION_TITLE,
          source: { kind: 'passage' },
        },
      ],
      instructions: AUDIT_W2_INSTRUCTIONS,
      postSteps: [{ kind: 'validate_operations' }],
    },

    // W3 — Reply to @audit / @auditor comment threads
    // Context sections match AuditAgent.generateCommentResponsesPrompt():
    //   - 'Style Profile' (plain)
    //   - 'Technical Audit Instructions' (plain)
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
          title:  'Technical Audit Instructions',
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
      instructions: AUDIT_W3_INSTRUCTIONS,
  
    },

  },
};
