// ============================================================
// src/experimental/config/agents/architect.ts
//
// Declarative definition of ArchitectAgent.
// Must produce the same (systemPrompt, userPrompt) as the concrete
// ArchitectAgent for generateInstructions() — verified by agent-parity.test.ts.
// ============================================================

import type { AgentDefinition } from '../../types';
import { Constants } from '../../../Constants';

// ── Shared preamble (mirrors BaseAgent.SYSTEM_PREAMBLE) ─────────────────────

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

// ── Architect-specific system prompt (mirrors ArchitectAgent.SYSTEM_PROMPT) ──
// Matches: `\n${BaseAgent.SYSTEM_PREAMBLE}\n\n# Role: Structural Architect...\n`.trim()

const ARCHITECT_SYSTEM_PROMPT = `${SYSTEM_PREAMBLE}

# Role: Structural Architect (Style Mimic)
You analyze the  manuscript and synthesize a StyleProfile —
a precise description of the author's voice, sentence rhythm, structural patterns,
vocabulary register, and thematic motifs. This profile constrains all other agents.

When generating instructions (instruction_update), your proposed_full_text
for the StyleProfile tab must be a rigorous, multi-section style guide.

## Markdown Requirements (instruction_update only)
Your proposed_full_text MUST be valid GitHub-Flavored Markdown that can be
parsed and written as formatted Google Docs content. Formatting rules:
- Top-level sections use ## (H2) headings (e.g. ## Voice & Tone)
- Sub-sections use ### (H3) headings
- Use - bullet points for lists; do NOT use • or other bullet characters
- Use **bold** for field names and key terms
- Use *italic* sparingly for emphasis
- Do NOT use bare plain text for section titles — always use # headings
- Every section heading must be followed by at least one bullet or paragraph
- Do NOT output fenced code blocks in a StyleProfile`;

// ── W1 instruction string ─────────────────────────────────────────────────────
// Mirrors exactly:
//   [
//     `Analyse the writing style above and produce a comprehensive StyleProfile.`,
//     `Return a JSON object with:`,
//     `- proposed_full_text: your full StyleProfile document (markdown)`
//   ].join('\\n')
//
// Note: .join('\\n') uses a TWO-CHAR separator (backslash + 'n').

export const ARCHITECT_W1_INSTRUCTIONS = [
  'Analyse the writing style above and produce a comprehensive StyleProfile.',
  'Return a JSON object with:',
  '- proposed_full_text: your full StyleProfile document (markdown)',
].join('\\n');

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

  workflows: {

    // W1 — Generate / refresh the StyleProfile tab
    // Context sections match ArchitectAgent.generateInstructionPrompt():
    //   - 'Manuscript (excerpt)' (plain text via getTabContent_, sliced 0-20000)
    //   - 'Current Style Profile (if any)' (markdown via getTabMarkdown_)
    //
    // Key differences from other agents:
    //   - requiresStyleProfile: false — Architect GENERATES the profile, never guards on it
    //   - modelTier: 'thinking' — uses the highest quality model
    //   - postSteps: evaluate_style_profile — LLM-as-judge quality check after writing
    generateInstructions: {
      modelTier:            'thinking',
      requiresStyleProfile: false,
      responseFormat:       'instruction_update',
      contextSections: [
        {
          // Concrete uses getTabContent_ (plain text, NOT markdown)
          title:  'Manuscript (excerpt)',
          source: { kind: 'merged_content', charLimit: 20000 },
        },
        {
          // Concrete uses getTabMarkdown_ (markdown)
          title:  'Current Style Profile (if any)',
          source: { kind: 'style_profile', format: 'markdown' },
        },
      ],
      instructions: ARCHITECT_W1_INSTRUCTIONS,
      postSteps: [{ kind: 'evaluate_style_profile' }],
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
          source: { kind: 'merged_content', charLimit: 20000 },
        },
        {
          title:  'Threads',
          source: { kind: 'threads' },
        },
      ],
      instructions: [
        'For each thread, analyse the selected passage for structural, motif, or voice concerns',
        'relative to the manuscript and StyleProfile. End each reply with "— AI Editorial Assistant".',
        'Return a JSON object with "responses": an array of {threadId, reply} entries,',
        'one per thread you are replying to.',
      ].join(' '),
    },

  },
};
