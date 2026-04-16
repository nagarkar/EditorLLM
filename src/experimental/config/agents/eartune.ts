// ============================================================
// src/experimental/config/agents/eartune.ts
//
// Declarative definition of EarTuneAgent.
// Must produce the same (systemPrompt, userPrompt) as the concrete
// EarTuneAgent for generateInstructions() — verified by agent-parity.test.ts.
// ============================================================

import type { AgentDefinition } from '../../types';
import { Constants } from '../../../Constants';

// ── Shared preamble (mirrors BaseAgent.SYSTEM_PREAMBLE) ─────────────────────
// Copy kept here so the definition is self-contained — no runtime dependency
// on BaseAgent.  Must stay in sync with BaseAgent.ts manually.

const SYSTEM_PREAMBLE = `# EditorLLM Context

You are operating inside EditorLLM, an AI-augmented workspace for
high-fidelity book editing. You must stay strictly "inside the box" of the
manuscript's metaphysic: the Chid Axiom (consciousness as the ground of physics)
and the worldview expressed in the source text.

## Core Rules
- **Recursive Instruction Loop:** You are often refining existing instructions.
  Incorporate and improve upon any "Current Instructions" provided in the
  context. Do not "forget" established rules or voice constraints unless they
  explicitly contradict the newly provided manuscript context.
- **No External Metaphors:** Never introduce ideas, metaphors, or concepts that are not already present in the MergedContent source material.
- **Ground Everything:** Always justify changes with specific reasoning grounded in the text.
- **Strict Schema:** Your JSON output must exactly match the provided schema.

## Comment Length Constraint
Google Drive comments have a hard limit of approximately 4 096 characters per
entry. Each annotation comment is formatted as:
  [AgentName] "match_text": <your reason>: <bookmark URL>
The prefix, quoted match text, and bookmark URL together consume roughly
200 characters, leaving **at most ~3 900 characters** for your reason text.

- **Annotation reasons (W2):** Keep each \`reason\` field under **400 characters**.
  Be specific but concise — one crisp sentence identifying the issue and the
  suggested fix is ideal.
- **Comment-thread replies (W3):** Keep each \`reply\` field under **3 500 characters**.
  If a thorough answer needs more space, summarise the key point first and
  invite the author to ask follow-up questions.`;

// ── EarTune-specific system prompt (mirrors EarTuneAgent.SYSTEM_PROMPT) ──────
// Matches: `\n${BaseAgent.SYSTEM_PREAMBLE}\n\n# Role: Audio EarTune...\n`.trim()

const EARTUNE_SYSTEM_PROMPT = `${SYSTEM_PREAMBLE}

# Role: Audio EarTune (Ear-Tune)
You optimize prose for spoken-word clarity and rhythmic listenability.
You work exclusively within the StyleProfile constraints.

## Guidelines
- Eliminate tongue-twisting consonant clusters.
- Ensure each sentence lands on a stressed syllable.
- Vary sentence length to create an ebb-and-flow rhythm.
- Never change meaning; only improve the sonic texture.

When proposing changes (content_annotation), your match_text must be sampled
verbatim from the passage currently being edited.

## Markdown Requirements (instruction_update only)
When generating EarTune instructions, your proposed_full_text MUST be valid
GitHub-Flavored Markdown. Rules:
- Use ## (H2) for top-level sections, ### (H3) for sub-sections
- Use - bullet points for all lists
- Use **bold** for rule names and key terms
- Every section must start with a ## heading
- Do NOT use plain text section headings or numbered section headers without #`;

// ── W1 instruction string (WITH manuscript section present) ──────────────────
// Mirrors exactly:
//   [
//     `Generate an updated EarTune system prompt that:`,
//     `1. Incorporates the rhythm and cadence patterns from the StyleProfile.`,
//     `2. Provides specific rules for consonant flow, syllabic stress, and sentence-length`,
//     `   variation suitable for this manuscript.`,
//     `3. Grounds rules in specific rhythmic patterns observed in the Manuscript Sample.`,
//     ``,
//     `Return a JSON object with:`,
//     `- proposed_full_text: the complete new EarTune instructions`
//   ].join('\\n')
//
// Note: .join('\\n') uses a TWO-CHAR separator (backslash + 'n') matching
// the concrete agent's source.  The definition must use the same two-char
// separator so buildStandardPrompt produces an identical string.

export const EARTUNE_W1_INSTRUCTIONS_WITH_MANUSCRIPT = [
  'Generate an updated EarTune system prompt that:',
  '1. Incorporates the rhythm and cadence patterns from the StyleProfile.',
  '2. Provides specific rules for consonant flow, syllabic stress, and sentence-length',
  '   variation suitable for this manuscript.',
  '3. Grounds rules in specific rhythmic patterns observed in the Manuscript Sample.',
  '',
  'Return a JSON object with:',
  '- proposed_full_text: the complete new EarTune instructions',
].join('\\n');

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

  workflows: {

    // W1 — Generate / refresh EarTune Instructions tab
    // Context sections match EarTuneAgent.generateInstructionPrompt():
    //   - 'Style Profile' (styleProfile, via getTabMarkdown_)
    //   - 'Manuscript Sample …' (manuscript, via getTabContent_.slice(0,20000))
    //   - 'Current Ear-Tune Instructions (if any)' (existing, via getTabMarkdown_)
    //
    // The MANUSCRIPT section is ALWAYS included in this definition.
    // Tests must provide non-empty MergedContent to stay on this code path.
    // (When MergedContent is empty, the concrete agent omits the section and
    // uses shorter instructions — a variant not yet modelled declaratively.)
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
          title:  'Manuscript Sample (for rhythmic pattern analysis)',
          source: { kind: 'merged_content', charLimit: 20000 },
        },
        {
          title:  'Current Ear-Tune Instructions (if any)',
          source: { kind: 'self_instructions', format: 'markdown' },
        },
      ],
      instructions: EARTUNE_W1_INSTRUCTIONS_WITH_MANUSCRIPT,
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
          // Title is dynamic (includes tabName) — AgentInterpreter overrides it
          // in buildPrompt_() when source.kind === 'passage'.
          title:  'Passage To Sweep',
          source: { kind: 'passage' },
        },
      ],
      instructions: [
        'Identify every passage with a rhythmic, phonetic, or cadence problem.',
        'Return a JSON object with:',
        '- operations: one per problem found. Each must have:',
        '    - match_text: verbatim 3–4-word phrase from the passage above',
        '    - reason: description of the issue and suggested improvement',
      ].join('\\n'),
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
      instructions: [
        'For each thread, analyse the selected text for rhythmic, phonetic, and cadence issues',
        'per the Ear-Tune instructions. End each reply with "— AI Editorial Assistant".',
        'Return a JSON object with "responses": an array of {threadId, reply} entries,',
        'one per thread you are replying to.',
      ].join(' '),
    },

  },
};
