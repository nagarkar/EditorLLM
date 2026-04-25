#!/usr/bin/env node
// generate_prompt_constants.js
//
// Reads markdown source files from src/prompts/ and emits TypeScript constant
// files alongside the main source so they are:
//   - compiled by tsc into the GAS dist bundle (flat scope, no imports needed)
//   - importable by experimental/ config files and concrete agents via TypeScript
//   - editable as plain .md files with full IDE preview support
//
// Run automatically via `prebuild` in package.json.
// Commit the generated .ts files so the IDE and GAS deployment always have them.

const fs   = require('fs');
const path = require('path');

const PROMPTS_DIR = path.join(__dirname, '../src/prompts');
const SRC_DIR     = path.join(__dirname, '../src');

// Map from markdown filename → exported TypeScript constant name.
// All constants are generated into a single agentPrompts.ts file.
const MAPPINGS = [
  // Shared prompt elements
  { mdFile: 'system-preamble.md', constName: 'SYSTEM_PREAMBLE' },
  { mdFile: 'w1FormatGuidelines.md', constName: 'W1_FORMAT_GUIDELINES' },
  { mdFile: 'w2-passage-section-title.md', constName: 'W2_PASSAGE_SECTION_TITLE' },

  // EarTune Agent
  { mdFile: 'agents/eartune-system-role.md', constName: 'EARTUNE_SYSTEM_PROMPT_BODY' },
  { mdFile: 'agents/eartune-manual-innovation-preservation.md', constName: 'EARTUNE_MANUAL_INNOVATION_PRESERVATION' },
  { mdFile: 'agents/eartune-w1-instructions.md', constName: 'EARTUNE_W1_INSTRUCTIONS' },
  { mdFile: 'agents/eartune-w2-instructions.md', constName: 'EARTUNE_W2_INSTRUCTIONS' },
  { mdFile: 'agents/eartune-w3-instructions.md', constName: 'EARTUNE_W3_INSTRUCTIONS' },
  { mdFile: 'agents/eartune-rubric.md', constName: 'EARTUNE_INSTRUCTION_QUALITY_RUBRIC' },

  // Audit Agent
  { mdFile: 'agents/audit-system-role.md', constName: 'AUDIT_SYSTEM_PROMPT_BODY' },
  { mdFile: 'agents/audit-w1-instructions.md', constName: 'AUDIT_W1_INSTRUCTIONS' },
  { mdFile: 'agents/audit-w2-instructions.md', constName: 'AUDIT_W2_INSTRUCTIONS' },
  { mdFile: 'agents/audit-w3-instructions.md', constName: 'AUDIT_W3_INSTRUCTIONS' },
  { mdFile: 'agents/audit-rubric.md', constName: 'AUDIT_INSTRUCTION_QUALITY_RUBRIC' },

  // Tether Agent
  { mdFile: 'agents/tether-system-role.md', constName: 'TETHER_SYSTEM_PROMPT_BODY' },
  { mdFile: 'agents/tether-w1-instructions.md', constName: 'TETHER_W1_INSTRUCTIONS' },
  { mdFile: 'agents/tether-w2-instructions.md', constName: 'TETHER_W2_INSTRUCTIONS' },
  { mdFile: 'agents/tether-w3-instructions.md', constName: 'TETHER_W3_INSTRUCTIONS' },
  { mdFile: 'agents/tether-rubric.md', constName: 'TETHER_INSTRUCTION_QUALITY_RUBRIC' },

  // Architect Agent (no W2)
  { mdFile: 'agents/architect-system-role.md', constName: 'ARCHITECT_SYSTEM_PROMPT_BODY' },
  { mdFile: 'agents/architect-styleprofile-schema.md', constName: 'ARCHITECT_STYLEPROFILE_SCHEMA' },
  { mdFile: 'agents/architect-w1-instructions.md', constName: 'ARCHITECT_W1_INSTRUCTIONS' },
  { mdFile: 'agents/architect-w3-instructions.md', constName: 'ARCHITECT_W3_INSTRUCTIONS' },
  { mdFile: 'agents/architect-rubric.md', constName: 'ARCHITECT_INSTRUCTION_QUALITY_RUBRIC' },

  // GeneralPurpose Agent (no W2)
  { mdFile: 'agents/generalpurpose-system-role.md', constName: 'GENERALPURPOSE_SYSTEM_PROMPT_BODY' },
  { mdFile: 'agents/generalpurpose-w1-instructions.md', constName: 'GENERALPURPOSE_W1_INSTRUCTIONS' },
  { mdFile: 'agents/generalpurpose-w3-instructions.md', constName: 'GENERALPURPOSE_W3_INSTRUCTIONS' },
  { mdFile: 'agents/generalpurpose-rubric.md', constName: 'GENERALPURPOSE_INSTRUCTION_QUALITY_RUBRIC' },

  // TTS Agent
  { mdFile: 'agents/tts-system-role.md', constName: 'TTS_SYSTEM_PROMPT_BODY' },
  { mdFile: 'agents/tts-cast-role-policy-schema.md', constName: 'TTS_CAST_ROLE_POLICY_SCHEMA' },
  { mdFile: 'agents/tts-w1-instructions.md', constName: 'TTS_W1_INSTRUCTIONS' },
  { mdFile: 'agents/tts-w2-instructions.md', constName: 'TTS_W2_INSTRUCTIONS' },
  { mdFile: 'agents/tts-rubric.md', constName: 'TTS_INSTRUCTION_QUALITY_RUBRIC' },

  // Publisher Agent
  { mdFile: 'agents/publisher-system-role.md', constName: 'PUBLISHER_SYSTEM_PROMPT_BODY' },
  { mdFile: 'agents/publisher-w1-instructions.md', constName: 'PUBLISHER_W1_INSTRUCTIONS' },
  { mdFile: 'agents/publisher-w2-instructions.md', constName: 'PUBLISHER_W2_INSTRUCTIONS' },
  { mdFile: 'agents/publisher-rubric.md', constName: 'PUBLISHER_INSTRUCTION_QUALITY_RUBRIC' },
];

// Load all markdown sources and generate a single agentPrompts.ts file
const constants = [];
for (const { mdFile, constName } of MAPPINGS) {
  const mdPath = path.join(PROMPTS_DIR, mdFile);

  if (!fs.existsSync(mdPath)) {
    console.error(`[generate_prompt_constants] ERROR: source not found: ${mdPath}`);
    process.exit(1);
  }

  const markdown = fs.readFileSync(mdPath, 'utf8').trim();
  const exportLine = `export const ${constName} = ${JSON.stringify(markdown)};`;
  constants.push(exportLine);
}

// Generate agentPrompts.ts with all constants
const tsPath = path.join(SRC_DIR, 'agentPrompts.ts');
const tsContent = [
  `// ============================================================`,
  `// src/agentPrompts.ts`,
  `//`,
  `// AUTO-GENERATED — do not edit directly.`,
  `// Sources: src/prompts/*.md and src/prompts/agents/*.md`,
  `// Regenerated by: node scripts/generate_prompt_constants.js (runs as prebuild)`,
  `//`,
  `// This file consolidates all prompt strings for agents (system prompts,`,
  `// W1/W2/W3 instructions, quality rubrics) from markdown sources so they can be:`,
  `//   - Imported by concrete agents (src/*Agent.ts)`,
  `//   - Imported by declarative definitions (src/experimental/config/agents/*.ts)`,
  `//   - Edited in the IDE with markdown preview`,
  `// ============================================================`,
  ``,
  ...constants,
  ``,
].join('\n');

const existing = fs.existsSync(tsPath) ? fs.readFileSync(tsPath, 'utf8') : null;
if (tsContent !== existing) {
  fs.writeFileSync(tsPath, tsContent, 'utf8');
  console.log(`[generate_prompt_constants] Written: src/agentPrompts.ts`);
} else {
  console.log(`[generate_prompt_constants] Up-to-date: src/agentPrompts.ts`);
}

console.log(`[generate_prompt_constants] Done (${MAPPINGS.length} sources processed).`);
