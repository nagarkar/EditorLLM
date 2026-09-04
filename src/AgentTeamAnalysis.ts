// ============================================================
// AgentTeamAnalysis.ts — Runs a round-robin multi-agent
// paragraph analysis for a named Agent Team.
//
// Workflow:
//   1. Extract paragraphs (> 10 words) and headings from the source tab.
//   2. For each paragraph, agents A→B→C each respond in turn; each
//      agent sees the full prior output as context.
//   3. Output is written to a user-specified output tab that MUST already
//      exist — this module never creates tabs.
//   4. Progress (lastProcessedIndex) is stored in Document Properties so
//      the analysis can be chunked across multiple GAS executions.
//   5. Quota errors fail immediately — no silent suppression.
//
// To restart, clear the output tab body or use a different output tab.
// ============================================================

const AgentTeamAnalysis = (() => {

  const PROGRESS_PREFIX = 'team_analysis_progress::';
  // Stop processing after this many ms to stay well inside the 6-min GAS limit.
  const MAX_ELAPSED_MS = 4 * 60 * 1000;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function progressKey_(sourceTabName: string, outputTabName: string): string {
    return PROGRESS_PREFIX + sourceTabName + '::' + outputTabName;
  }

  /**
   * Extracts headings and paragraphs with > 10 words from the source tab body.
   * Returns an array of { kind: 'heading'|'paragraph', text } items.
   */
  function extractParagraphs_(sourceTabName: string): Array<{ kind: 'heading' | 'paragraph'; text: string }> {
    const docTab = DocOps.getTabByName(sourceTabName);
    if (!docTab) return [];

    const body = docTab.getBody();
    const count = body.getNumChildren();
    const results: Array<{ kind: 'heading' | 'paragraph'; text: string }> = [];

    for (let i = 0; i < count; i++) {
      const child = body.getChild(i);
      const type = child.getType();

      if (type === DocumentApp.ElementType.PARAGRAPH) {
        const para = child.asParagraph();
        const heading = para.getHeading();

        if (
          heading === DocumentApp.ParagraphHeading.HEADING1 ||
          heading === DocumentApp.ParagraphHeading.HEADING2 ||
          heading === DocumentApp.ParagraphHeading.HEADING3 ||
          heading === DocumentApp.ParagraphHeading.HEADING4 ||
          heading === DocumentApp.ParagraphHeading.HEADING5 ||
          heading === DocumentApp.ParagraphHeading.HEADING6
        ) {
          const text = para.getText().trim();
          if (text) results.push({ kind: 'heading', text });
        } else {
          const text = para.getText().trim();
          if (text && text.split(/\s+/).length > 10) {
            results.push({ kind: 'paragraph', text });
          }
        }
      }
    }

    return results;
  }

  /**
   * Reads the current text content of an existing tab.
   * Returns '' if the tab doesn't exist.
   */
  function readOutputTab_(tabName: string): string {
    const docTab = DocOps.getTabByName(tabName);
    if (!docTab) return '';
    return docTab.getBody().getText();
  }

  /**
   * Overwrites the output tab body with the full in-memory buffer.
   * The tab MUST already exist — this function never creates it.
   * Returns the new buffer (same as passed in, for chaining convenience).
   */
  function writeOutputTab_(tabName: string, buffer: string): void {
    const docTab = DocOps.getTabByName(tabName);
    if (!docTab) throw new Error(`Output tab "${tabName}" not found. Please create it first.`);
    MarkdownService.writeMarkdownToBody(buffer, docTab.getBody());
  }

  /**
   * Appends a chunk to the in-memory buffer and overwrites the output tab.
   * Returns the updated buffer.
   */
  function appendToOutputTab_(tabName: string, chunk: string, inMemoryBuffer: string): string {
    const newBuffer = inMemoryBuffer + chunk;
    writeOutputTab_(tabName, newBuffer);
    return newBuffer;
  }

  /**
   * Builds the user prompt for a single agent turn.
   */
  function buildAgentPrompt_(
    agentDef: CustomAgentDefinition,
    inMemoryOutput: string,
    paragraph: string,
    priorTurns: Array<{ agentName: string; response: string }>
  ): string {
    const parts: string[] = [];

    if (inMemoryOutput.trim()) {
      parts.push('## Analysis so far\n\n' + inMemoryOutput.trim());
    }

    if (priorTurns.length > 0) {
      parts.push('## Prior agent responses to this paragraph\n\n' +
        priorTurns.map(t => `**${t.agentName}:**\n${t.response}`).join('\n\n'));
    }

    parts.push('## Paragraph to analyse\n\n' + paragraph);

    parts.push(
      '## Your task\n\n' +
      'Provide your analysis of the paragraph above. ' +
      'Be concise and specific. Write in GitHub-Flavoured Markdown. ' +
      'Do not repeat the paragraph text. ' +
      'Focus on what adds value to the analysis — avoid generic or redundant observations.'
    );

    return parts.join('\n\n');
  }

  function getAgentInstructions_(def: CustomAgentDefinition): string {
    if (!def.instructionTabName) return '';
    return MarkdownService.tabToMarkdown(def.instructionTabName);
  }

  function getAgentContext_(def: CustomAgentDefinition): string {
    if (!def.contextTabName) return '';
    return MarkdownService.tabToMarkdown(def.contextTabName);
  }

  // ── Main entry point ──────────────────────────────────────────────────────

  /**
   * Starts or continues an Agentic Team Analysis.
   *
   * The output tab MUST already exist in the document — create it manually
   * before running. The analysis never creates tabs; it only reads and writes
   * to existing ones. This avoids the DocumentApp sync issues that occur when
   * a tab is created via the REST API within the same execution context.
   *
   * Progress is keyed to (sourceTabName + outputTabName) in Document Properties.
   * To restart from the beginning, clear the output tab body and run again.
   *
   * @param teamId        ID of the AgentTeamDefinition
   * @param sourceTabName Name of the tab containing the manuscript to analyse
   * @param outputTabName Name of the existing tab to write results into
   */
  function startOrContinue(teamId: string, sourceTabName: string, outputTabName: string): TeamAnalysisResult {
    const jobId = Tracer.startJob(`Agentic Team Analysis — "${sourceTabName}" → "${outputTabName}"`);
    const startMs = Date.now();

    try {
      // ── Validate output tab exists ───────────────────────────────────────
      const outputDocTab = DocOps.getTabByName(outputTabName);
      if (!outputDocTab) {
        const msg = `Output tab "${outputTabName}" not found. Please create a tab with that name and try again.`;
        Tracer.error(`[AgentTeamAnalysis] ${msg}`, jobId);
        Tracer.finishJob();
        return { status: 'error', processedCount: 0, totalCount: 0, outputTabName, error: msg };
      }

      // ── Resolve team ─────────────────────────────────────────────────────
      const team = AgentTeamService.findById(teamId);
      if (!team) {
        Tracer.error(`[AgentTeamAnalysis] team id=${teamId} not found`, jobId);
        Tracer.finishJob();
        return { status: 'error', processedCount: 0, totalCount: 0, outputTabName, error: `Team id=${teamId} not found.` };
      }

      // ── Resolve agents ───────────────────────────────────────────────────
      const agentDefs: CustomAgentDefinition[] = [];
      for (const agentId of team.agentIds) {
        const def = CustomAgentService.findById(agentId);
        if (!def) {
          Tracer.warn(`[AgentTeamAnalysis] agent id=${agentId} not found — skipping`, jobId);
          continue;
        }
        agentDefs.push(def);
      }

      if (agentDefs.length === 0) {
        const msg = 'No valid agents found in team.';
        Tracer.error(`[AgentTeamAnalysis] ${msg}`, jobId);
        Tracer.finishJob();
        return { status: 'error', processedCount: 0, totalCount: 0, outputTabName, error: msg };
      }

      // ── Extract paragraphs ───────────────────────────────────────────────
      const paragraphs = extractParagraphs_(sourceTabName);
      const totalCount = paragraphs.length;

      if (totalCount === 0) {
        const msg = `No eligible paragraphs found in "${sourceTabName}".`;
        Tracer.warn(`[AgentTeamAnalysis] ${msg}`, jobId);
        Tracer.finishJob();
        return { status: 'error', processedCount: 0, totalCount: 0, outputTabName, error: msg };
      }

      // ── Load progress ────────────────────────────────────────────────────
      const docProps = PropertiesService.getDocumentProperties();
      const progressKey = progressKey_(sourceTabName, outputTabName);
      const progressRaw = docProps.getProperty(progressKey);
      let progress: TeamAnalysisProgress | null = null;

      if (progressRaw) {
        try { progress = JSON.parse(progressRaw) as TeamAnalysisProgress; } catch (_) {}
      }

      const startIndex = progress ? progress.lastProcessedIndex + 1 : 0;

      if (startIndex >= totalCount) {
        Tracer.info(`[AgentTeamAnalysis] already complete for "${sourceTabName}"`, jobId);
        Tracer.finishJob();
        return { status: 'complete', processedCount: totalCount, totalCount, outputTabName };
      }

      // ── Build in-memory output buffer ────────────────────────────────────
      // On continuation, read existing content from the output tab as-is.
      let inMemoryBuffer = startIndex === 0 ? '' : readOutputTab_(outputTabName);

      if (startIndex === 0) {
        // Fresh start — write a header to the output tab
        const d = new Date();
        const dateStr = String(d.getDate()).padStart(2, '0') + '/' +
                        String(d.getMonth() + 1).padStart(2, '0') + '/' +
                        String(d.getFullYear());
        const header =
          `# Agentic Analysis — ${sourceTabName}\n\n` +
          `**Team:** ${team.name}  \n` +
          `**Agents:** ${agentDefs.map(a => a.displayName).join(', ')}  \n` +
          `**Date:** ${dateStr}  \n` +
          `**Source tab:** ${sourceTabName}\n\n---\n\n`;
        inMemoryBuffer = appendToOutputTab_(outputTabName, header, '');
      }

      // ── Pre-load agent instruction / context content (once per agent) ────
      const agentContextCache = new Map<string, { instructions: string; context: string }>();
      for (const def of agentDefs) {
        agentContextCache.set(def.id, {
          instructions: getAgentInstructions_(def),
          context:      getAgentContext_(def),
        });
      }

      // ── Main loop ────────────────────────────────────────────────────────
      let lastProcessed = startIndex - 1;

      for (let pi = startIndex; pi < totalCount; pi++) {
        const item = paragraphs[pi];

        if (item.kind === 'heading') {
          const headingMd = `\n## ${item.text}\n\n`;
          inMemoryBuffer = appendToOutputTab_(outputTabName, headingMd, inMemoryBuffer);
          lastProcessed = pi;
          continue;
        }

        // Paragraph: round-robin through all agents
        const priorTurns: Array<{ agentName: string; response: string }> = [];

        const paraHeader = `\n### Paragraph ${pi + 1}\n\n> ${item.text.slice(0, 200)}${item.text.length > 200 ? '…' : ''}\n\n`;
        inMemoryBuffer = appendToOutputTab_(outputTabName, paraHeader, inMemoryBuffer);

        for (const def of agentDefs) {
          const cache = agentContextCache.get(def.id)!;

          const systemParts: string[] = [def.systemPrompt];
          if (cache.instructions) systemParts.push('\n\n## Agent Instructions\n\n' + cache.instructions);
          if (cache.context) systemParts.push('\n\n## Context\n\n' + cache.context);
          const systemPrompt = systemParts.join('');

          const userPrompt = buildAgentPrompt_(def, inMemoryBuffer, item.text, priorTurns);

          let response: string;
          try {
            response = String(GeminiService.generate(systemPrompt, userPrompt, Constants.MODEL.THINKING));
          } catch (e: any) {
            if (e.message && (e.message.includes('quota') || e.message.includes('429') || e.message.includes('RESOURCE_EXHAUSTED'))) {
              Tracer.error(`[AgentTeamAnalysis] quota error on agent "${def.displayName}": ${e.message}`, jobId);
              if (lastProcessed >= 0) {
                const prog: TeamAnalysisProgress = { lastProcessedIndex: lastProcessed, totalParagraphs: totalCount, outputTabName };
                docProps.setProperty(progressKey, JSON.stringify(prog));
              }
              Tracer.finishJob();
              throw e;
            }
            Tracer.error(`[AgentTeamAnalysis] agent "${def.displayName}" error at paragraph ${pi}: ${e.message}`, jobId);
            response = `*(Error: ${e.message})*`;
          }

          const preview = response.replace(/\s+/g, ' ').trim().slice(0, 120);
          Tracer.info(`[AgentTeamAnalysis] ${def.displayName} @ para ${pi + 1}: "${preview}…"`, jobId);

          priorTurns.push({ agentName: def.displayName, response });
          const agentBlock = `**${def.displayName}:** ${response}\n\n`;
          inMemoryBuffer = appendToOutputTab_(outputTabName, agentBlock, inMemoryBuffer);
        }

        lastProcessed = pi;

        // ── Time-check after each paragraph ──────────────────────────────
        if (Date.now() - startMs >= MAX_ELAPSED_MS) {
          Tracer.info(
            `[AgentTeamAnalysis] time limit reached after paragraph ${pi + 1}/${totalCount} — saving progress`,
            jobId
          );
          const prog: TeamAnalysisProgress = { lastProcessedIndex: lastProcessed, totalParagraphs: totalCount, outputTabName };
          docProps.setProperty(progressKey, JSON.stringify(prog));
          Tracer.finishJob();
          return { status: 'continuing', processedCount: lastProcessed + 1, totalCount, outputTabName };
        }
      }

      // ── Complete ──────────────────────────────────────────────────────────
      docProps.deleteProperty(progressKey);
      Tracer.info(`[AgentTeamAnalysis] complete — ${totalCount} paragraph(s) processed`, jobId);
      Tracer.finishJob();
      return { status: 'complete', processedCount: totalCount, totalCount, outputTabName };

    } catch (e: any) {
      Tracer.error(`[AgentTeamAnalysis] unexpected error: ${e}`, jobId);
      Tracer.finishJob();
      return { status: 'error', processedCount: 0, totalCount: 0, outputTabName, error: e.message || String(e) };
    }
  }

  return { startOrContinue };
})();
