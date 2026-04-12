// ============================================================
// AuditAgent.ts — Logical Auditor (Technical Audit)
// ============================================================

class AuditAgent extends BaseAgent {

  readonly tags = ['@audit', '@auditor'];
  readonly contextKeys = [TAB_NAMES.STYLE_PROFILE, TAB_NAMES.TECHNICAL_AUDIT, COMMENT_ANCHOR_TAB];

  handleCommentThread(thread: CommentThread): ThreadReply {
    this.logCommentThread_(thread, 'handleCommentThread');
    const styleProfile = this.getTabContent_(TAB_NAMES.STYLE_PROFILE);
    const auditInstructions = this.getTabContent_(TAB_NAMES.TECHNICAL_AUDIT);
    const passageContext = thread.anchorTabName
      ? this.getTabContent_(thread.anchorTabName)
      : thread.selectedText;

    const userPrompt = `
STYLE PROFILE:
---
${styleProfile.slice(0, 2000)}
---

TECHNICAL AUDIT INSTRUCTIONS:
---
${auditInstructions.slice(0, 3000)}
---

PASSAGE CONTEXT:
---
${passageContext.slice(0, 4000)}
---

SELECTED TEXT:
---
${thread.selectedText}
---

SPECIFIC REQUEST: ${thread.agentRequest}

Perform a targeted technical audit of the selected passage. Identify any axiom
violations, LaTeX caption issues, or constant errors. Reply with your findings
and specific corrections. End your reply with "— AI Editorial Assistant".
`.trim();

    const result = this.callGemini_(
      AUDITOR_SYSTEM_PROMPT,
      userPrompt,
      { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'] },
      MODEL.THINKING
    ) as { reply: string };

    return { threadId: thread.threadId, content: result.reply };
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
