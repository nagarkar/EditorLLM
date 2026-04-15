const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const vm = require('vm');

  

const distFiles = [
  'Types.js',
  'BaseAgent.js',
  'ArchitectAgent.js',
  'EarTuneAgent.js',
  'AuditAgent.js',
  'GeneralPurposeAgent.js'
];

const allCode = distFiles.map(f => fs.readFileSync(path.join(__dirname, '../dist', f), 'utf8')).join('\n;\n');
vm.runInThisContext(allCode);

console.error("Compiling test fixtures...");
execSync('npx tsc src/__tests__/integration/fixtures/testDocument.ts --esModuleInterop --skipLibCheck || true', { stdio: 'inherit' });
const { FIXTURES, ARCHITECT_THREADS, CHAPTER_1_THREADS } = require('../src/__tests__/integration/fixtures/testDocument.js');

// ---------------------------------------------------------------------------
// Build User Manual preamble
// Reads docs/user_manual/main.md and all section files linked in its ToC.
// ---------------------------------------------------------------------------
const userManualDir = path.join(__dirname, '../docs/user_manual');
const mainManualPath = path.join(userManualDir, 'main.md');
const mainManualContent = fs.readFileSync(mainManualPath, 'utf8');

// Parse ToC links of the form [Text](filename.md) — e.g., [Setup](01-setup.md)
const tocLinkRe = /\[.*?\]\((\d{2}-[^)]+\.md)\)/g;
const sectionFiles = [];
let _m;
while ((_m = tocLinkRe.exec(mainManualContent)) !== null) {
  sectionFiles.push(_m[1]);
}

// Extract the header/intro from main.md (everything before the first inline
// section content that follows the first '---\n\n#' separator).
const firstSectionSep = mainManualContent.indexOf('\n---\n\n#');
const manualIntro = firstSectionSep !== -1
  ? mainManualContent.slice(0, firstSectionSep).trim()
  : mainManualContent.trim();

// Read each linked section file in ToC order.
const sectionContents = sectionFiles.map(file => {
  const sectionPath = path.join(userManualDir, file);
  if (!fs.existsSync(sectionPath)) {
    console.error(`Warning: linked section file not found: ${file}`);
    return `<!-- ${file} not found -->`;
  }
  return fs.readFileSync(sectionPath, 'utf8').trim();
});

// Concatenate: intro + each section, separated by ---
const fullManual = [manualIntro, ...sectionContents].join('\n\n---\n\n');

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
let out = '';

out += `# EditorLLM Full Prompt Specification\n\n`;

out += `## User Manual\n\n`;
out += `<!-- Programmatically generated from docs/user_manual/main.md and linked section files -->\n\n`;
out += fullManual + '\n\n';

const agents = [
  { name: 'ArchitectAgent', instance: new ArchitectAgent(), threads: ARCHITECT_THREADS },
  { name: 'EarTuneAgent', instance: new EarTuneAgent(), threads: CHAPTER_1_THREADS },
  { name: 'AuditAgent', instance: new AuditAgent(), threads: CHAPTER_1_THREADS },
  { name: 'GeneralPurposeAgent', instance: new GeneralPurposeAgent(), threads: CHAPTER_1_THREADS }
];

for (const agent of agents) {
  out += `---\n\n`;
  out += `# ${agent.name}\n\n`;
  
  out += `## SYSTEM_PROMPT\n\n`;
  out += '```markdown\n' + agent.instance.SYSTEM_PROMPT + '\n```\n\n';

  out += `## Instructions Prompt (generateInstructionPrompt)\n\n`;
  try {
    const instr = agent.instance.generateInstructionPrompt({
      manuscript: FIXTURES.MERGED_CONTENT,
      styleProfile: FIXTURES.STYLE_PROFILE,
      existingEarTune: "Existing eartune rules...",
      existingAudit: "Existing audit rules...",
      existingInstructions: "Existing comment instructions..."
    });
    out += '```markdown\n' + instr + '\n```\n\n';
  } catch (e) {
    if (e.message.includes('not implemented')) {
      out += `*Not Implemented for ${agent.name}*\n\n`;
    } else {
      console.error(e);
    }
  }

  out += `## Tab Annotation Prompt (generateTabAnnotationPrompt)\n\n`;
  try {
    const tabAnnot = agent.instance.generateTabAnnotationPrompt({
      styleProfile: FIXTURES.STYLE_PROFILE,
      earTuneInstructions: "Draft Ear Tune instructions.",
      auditInstructions: "Draft audit instructions.",
      passage: FIXTURES.MERGED_CONTENT,
      tabName: "Chapter 1"
    });
    out += '```markdown\n' + tabAnnot + '\n```\n\n';
  } catch (e) {
    if (e.message.includes('not implemented')) {
      out += `*Not Implemented for ${agent.name}*\n\n`;
    } else {
      console.error(e);
    }
  }

  out += `## Comment Responses Prompt (generateCommentResponsesPrompt)\n\n`;
  try {
    const comms = agent.instance.generateCommentResponsesPrompt({
      styleProfile: FIXTURES.STYLE_PROFILE,
      earTuneInstructions: "Draft Ear Tune instructions.",
      auditInstructions: "Draft audit instructions.",
      passageContext: FIXTURES.MERGED_CONTENT,
      manuscript: FIXTURES.MERGED_CONTENT,
      anchorContent: FIXTURES.MERGED_CONTENT,
      threads: agent.threads
    });
    out += '```markdown\n' + comms + '\n```\n\n';
  } catch (e) {
    if (e.message.includes('not implemented')) {
      out += `*Not Implemented for ${agent.name}*\n\n`;
    } else {
      console.error(e);
    }
  }
}

const docsPath = path.join(__dirname, '../docs');
if (!fs.existsSync(docsPath)) {
  fs.mkdirSync(docsPath, { recursive: true });
}
const outFile = path.join(docsPath, 'full_prompts.md');
fs.writeFileSync(outFile, out, 'utf8');
console.error(`Successfully wrote prompt specification to docs/full_prompts.md`);
