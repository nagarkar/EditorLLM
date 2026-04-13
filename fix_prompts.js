const fs = require('fs');

let file = fs.readFileSync('src/__tests__/integration/helpers/prompts.ts', 'utf8');

file = file.replace(
  /export function formatThreadsForBatch[^}]+}/,
  \`export function formatThreadsForBatch(threads: TestThread[]): string {
  return threads.map(t => {
    const conv = t.conversation.map(m => \\\`**[\\$\{m.role}] \\$\{m.authorName}:** \\$\{m.content}\\\`).join('\\\\n');
    return (
      \\\`### Thread: \\$\{t.threadId}\\\\n\\\` +
      \\\`**Selected Text:** \\$\{t.selectedText}\\\\n\\\\n\\\` +
      \\\`**Conversation:**\\\\n\\$\{conv}\\\\n\\\\n\\\` +
      \\\`**Request:** \\$\{t.agentRequest}\\\`
    );
  }).join('\\\\n\\\\n');
}\`
);

// We will just do regex replacements for the section headers:
// e.g. MANUSCRIPT (excerpt):\n---\n${content}\n---\n -> ## Manuscript (excerpt)\n\n${content}\n

function replaceSection(str, oldHeader, newHeader) {
  let r = new RegExp(oldHeader + '\\\\n---\\\\n(\\\\$\\\\{[^}]+\\\\}|[^\\n]+)\\\\n---\\\\n', 'g');
  return str.replace(r, '## ' + newHeader + '\\n\\n$1\\n\\n'); // Extra newline due to standard builder padding
}

file = replaceSection(file, 'STYLE PROFILE:', 'Style Profile');
file = replaceSection(file, 'MANUSCRIPT \\\\(excerpt\\\\):', 'Manuscript (excerpt)');
file = replaceSection(file, 'MANUSCRIPT CONTEXT:', 'Manuscript Context');
file = replaceSection(file, 'THREADS:', 'Threads');
file = replaceSection(file, 'CURRENT EAR-TUNE INSTRUCTIONS \\\\(if any\\\\):', 'Current Ear-Tune Instructions (if any)');
file = replaceSection(file, 'EAR-TUNE INSTRUCTIONS:', 'Ear-Tune Instructions');
file = replaceSection(file, 'PASSAGE TO SWEEP \\\\(from tab: \\"\\\\$\\\\{opts\\\\.tabName\\\\}\\"\\\\):', 'Passage To Sweep (from tab: \\"\\${opts.tabName}\\")');
file = replaceSection(file, 'PASSAGE CONTEXT:', 'Passage Context');
file = replaceSection(file, 'CURRENT TECHNICAL AUDIT INSTRUCTIONS \\\\(if any\\\\):', 'Current Technical Audit Instructions (if any)');
file = replaceSection(file, 'MANUSCRIPT SAMPLE \\\\(for axiom extraction\\\\):', 'Manuscript Sample (for axiom extraction)');
file = replaceSection(file, 'TECHNICAL AUDIT INSTRUCTIONS:', 'Technical Audit Instructions');
file = replaceSection(file, 'PASSAGE TO AUDIT \\\\(from tab: \\"\\\\$\\\\{opts\\\\.tabName\\\\}\\"\\\\):', 'Passage To Audit (from tab: \\"\\${opts.tabName}\\")');
file = replaceSection(file, 'CURRENT COMMENT INSTRUCTIONS \\\\(if any\\\\):', 'Current Comment Instructions (if any)');
file = replaceSection(file, 'ANCHOR PASSAGE:', 'Anchor Passage');

// Also need to prepend ## Instructions to the remaining text at the bottom of the prompt blocks.
// In each builder, there's ` + \n \` instructions... \`
// Let's manually inject "## Instructions\n\n" where the instructions start for the prompts.

// Architect instructions
file = file.replace(/Analyse the writing style above/, '## Instructions\\n\\nAnalyse the writing style above');
file = file.replace(/For each thread, analyse the selected passage/, '## Instructions\\n\\nFor each thread, analyse the selected passage');

// EarTune
file = file.replace(/Generate an updated EarTune system prompt/, '## Instructions\\n\\nGenerate an updated EarTune system prompt');
file = file.replace(/Identify every passage with a rhythmic/, '## Instructions\\n\\nIdentify every passage with a rhythmic');
file = file.replace(/For each thread, analyse the selected text for rhythmic/, '## Instructions\\n\\nFor each thread, analyse the selected text for rhythmic');

// Audit
file = file.replace(/Generate a comprehensive TechnicalAudit system prompt/, '## Instructions\\n\\nGenerate a comprehensive TechnicalAudit system prompt');
file = file.replace(/Perform a full technical audit/, '## Instructions\\n\\nPerform a full technical audit');
file = file.replace(/For each thread, perform a targeted technical audit/, '## Instructions\\n\\nFor each thread, perform a targeted technical audit');

// Comment
file = file.replace(/Generate an updated Comment Instructions system prompt/, '## Instructions\\n\\nGenerate an updated Comment Instructions system prompt');
file = file.replace(/For each thread, respond to the request concisely/, '## Instructions\\n\\nFor each thread, respond to the request concisely');


fs.writeFileSync('src/__tests__/integration/helpers/prompts.ts', file);
