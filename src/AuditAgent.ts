// ============================================================
// AuditAgent.ts — Logical Auditor (Technical Audit)
// ============================================================

class AuditAgent extends BaseAgent {

  readonly tags = ['@audit', '@auditor'];
  readonly contextKeys = [TAB_NAMES.STYLE_PROFILE, TAB_NAMES.TECHNICAL_AUDIT, COMMENT_ANCHOR_TAB];

  private static readonly CHUNK_SIZE = 5;

  handleCommentThreads(threads: CommentThread[]): ThreadReply[] {
    const agentName = this.constructor.name;
    Logger.log(`[${agentName}] handleCommentThreads: received ${threads.length} thread(s)`);

    // Shared instruction context — same for every subgroup.
    const styleProfile     = this.getTabContent_(TAB_NAMES.STYLE_PROFILE);
    const auditInstructions = this.getTabContent_(TAB_NAMES.TECHNICAL_AUDIT);

    // Subgroup by anchorTabName so each chunk shares one passage context.
    const subgroups = new Map<string | null, CommentThread[]>();
    for (const thread of threads) {
      const key = thread.anchorTabName;
      if (!subgroups.has(key)) subgroups.set(key, []);
      subgroups.get(key)!.push(thread);
    }

    Logger.log(`[${agentName}] handleCommentThreads: ${subgroups.size} subgroup(s) by anchor tab`);

    const allReplies: ThreadReply[] = [];

    for (const [anchorTabName, subThreads] of subgroups) {
      // Null anchor → no shared passage; agent falls back to per-thread selectedText.
      const passageContext = anchorTabName
        ? this.getTabContent_(anchorTabName).slice(0, 4000)
        : '';

      for (let i = 0; i < subThreads.length; i += AuditAgent.CHUNK_SIZE) {
        const chunk = subThreads.slice(i, i + AuditAgent.CHUNK_SIZE);
        const chunkNum = Math.floor(i / AuditAgent.CHUNK_SIZE) + 1;
        Logger.log(
          `[${agentName}] handleCommentThreads: anchor=${anchorTabName ?? '(none)'} ` +
          `chunk ${chunkNum} size=${chunk.length}`
        );

        try {
          const passageSection = passageContext
            ? `PASSAGE CONTEXT:\n---\n${passageContext}\n---\n\n`
            : '';

          const userPrompt = (
            `STYLE PROFILE:\n` +
            `---\n` +
            `${styleProfile.slice(0, 2000)}\n` +
            `---\n\n` +
            `TECHNICAL AUDIT INSTRUCTIONS:\n` +
            `---\n` +
            `${auditInstructions.slice(0, 3000)}\n` +
            `---\n\n` +
            `${passageSection}` +
            `THREADS:\n` +
            `---\n` +
            `${this.formatThreadsForBatch_(chunk)}\n` +
            `---\n\n` +
            `For each thread, perform a targeted technical audit of the selected passage.\n` +
            `Identify any axiom violations, LaTeX caption issues, or constant errors.\n` +
            `End each reply with "— AI Editorial Assistant".\n` +
            `Return a JSON object with "responses": an array of {threadId, reply} entries, ` +
            `one per thread you are replying to.`
          ).trim();

          const raw = this.callGemini_(
            AUDITOR_SYSTEM_PROMPT,
            userPrompt,
            this.batchReplySchema_(),
            MODEL.THINKING
          );
          const replies = this.normaliseBatchReplies_(chunk, raw, agentName);
          allReplies.push(...replies);
        } catch (e: any) {
          Logger.log(
            `[${agentName}] handleCommentThreads: anchor=${anchorTabName ?? '(none)'} ` +
            `chunk ${chunkNum} failed — ${e.message}`
          );
        }
      }
    }

    Logger.log(`[${agentName}] handleCommentThreads: returning ${allReplies.length} reply/replies`);
    return allReplies;
  }

  /**
   * Refreshes the TechnicalAudit system prompt via instruction_update.
   * Uses extended thinking (High) to reason carefully about axiom constraints.
   */
  generateInstructions(): void {
    // W1: read instruction tabs as markdown; manuscript stays plain text
    const styleProfile = this.getTabMarkdown_(TAB_NAMES.STYLE_PROFILE);
    const existing = this.getTabMarkdown_(TAB_NAMES.TECHNICAL_AUDIT);
    const manuscript = this.getTabContent_(TAB_NAMES.MERGED_CONTENT);

    const userPrompt = `
STYLE PROFILE:
---
${styleProfile.slice(0, 3000)}
---

CURRENT TECHNICAL AUDIT INSTRUCTIONS (if any):
---
${existing.slice(0, 2000)}
---

MANUSCRIPT SAMPLE (for axiom extraction):
---
${manuscript.slice(0, 6000)}
---

Generate a comprehensive TechnicalAudit system prompt that:
1. Lists all Chid Axioms and physical principles as stated in the manuscript.
2. Defines LaTeX caption requirements for this document.
3. Specifies the unit system and physical constants in use.
4. Provides specific audit checklist items derived from the manuscript.

Return a JSON object with:
- proposed_full_text: the complete new TechnicalAudit instructions
- operations: one per major section being added or revised, each with a verbatim
  match_text from proposed_full_text and a reason.
`.trim();

    const geminiResult = this.callGemini_(
      AUDITOR_SYSTEM_PROMPT,
      userPrompt,
      this.instructionUpdateSchema_(),
      MODEL.THINKING  // Technical reasoning — use thinking model
    ) as { proposed_full_text: string; operations: Operation[] };

    const update: RootUpdate = {
      workflow_type: 'instruction_update',
      review_tab: TAB_NAMES.TECHNICAL_AUDIT,
      proposed_full_text: geminiResult.proposed_full_text,
      operations: geminiResult.operations,
    };

    CollaborationService.processUpdate(update);
  }

  /**
   * Writes example TechnicalAudit instructions to the TechnicalAudit tab.
   */
  generateExample(): void {
    DocOps.ensureStandardTabs();
    const auditTab = DocOps.getOrCreateTab(
      TAB_NAMES.TECHNICAL_AUDIT,
      TAB_NAMES.AGENTIC_INSTRUCTIONS
    );
    DocOps.overwriteTabContent(auditTab, AUDITOR_EXAMPLE_CONTENT);
  }

  /**
   * Workflow 2: full-tab technical audit sweep.
   * Highlights and comments every passage with an axiom, LaTeX, or constant issue.
   * Clears previous agent annotations on the tab before adding new ones.
   */
  annotateTab(tabName: string): void {
    const passage = this.getTabContent_(tabName);
    if (!passage.trim()) {
      throw new Error(`Tab "${tabName}" is empty. Nothing to audit.`);
    }

    const styleProfile = this.getTabContent_(TAB_NAMES.STYLE_PROFILE);
    const auditInstructions = this.getTabContent_(TAB_NAMES.TECHNICAL_AUDIT);

    const userPrompt = `
STYLE PROFILE:
---
${styleProfile.slice(0, 2000)}
---

TECHNICAL AUDIT INSTRUCTIONS:
---
${auditInstructions.slice(0, 3000)}
---

PASSAGE TO AUDIT (from tab: "${tabName}"):
---
${passage.slice(0, 8000)}
---

Perform a full technical audit. Check every claim against the Chid Axiom,
all equations for valid LaTeX captions, and all physical constants for
correct SI values and units.

Return a JSON object with:
- operations: one per issue found. Each must have:
    - match_text: verbatim 3–4-word phrase from the passage above
    - reason: specific axiom, constant, or caption rule violated, plus suggested correction
`.trim();

    const geminiResult = this.callGemini_(
      AUDITOR_SYSTEM_PROMPT,
      userPrompt,
      this.annotationSchema_(),
      MODEL.THINKING  // Technical task — thinking model
    ) as { operations: Operation[] };

    const update: RootUpdate = {
      workflow_type: 'content_annotation',
      target_tab: tabName,
      operations: geminiResult.operations,
    };

    CollaborationService.processUpdate(update);
  }
}
