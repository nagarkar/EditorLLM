// ============================================================
// StylistAgent.ts — Audio Stylist (Ear-Tune)
// ============================================================

class StylistAgent extends BaseAgent {

  readonly tags = ['@eartune', '@stylist'];
  readonly contextKeys = [TAB_NAMES.STYLE_PROFILE, TAB_NAMES.EAR_TUNE, COMMENT_ANCHOR_TAB];

  handleCommentThread(thread: CommentThread): ThreadReply {
    this.logCommentThread_(thread, 'handleCommentThread');

    const styleProfile = this.getTabContent_(TAB_NAMES.STYLE_PROFILE);
    const earTuneInstructions = this.getTabContent_(TAB_NAMES.EAR_TUNE);
    const passageContext = thread.anchorTabName
      ? this.getTabContent_(thread.anchorTabName)
      : thread.selectedText;

    const userPrompt = `
STYLE PROFILE:
---
${styleProfile.slice(0, 2000)}
---

EAR-TUNE INSTRUCTIONS:
---
${earTuneInstructions.slice(0, 2000)}
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

Analyse the selected text for rhythmic, phonetic, and cadence issues per the
Ear-Tune instructions. Reply with your findings and specific suggestions.
End your reply with "— AI Editorial Assistant".
`.trim();

    const result = this.callGemini_(
      STYLIST_SYSTEM_PROMPT,
      userPrompt,
      { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'] },
      MODEL.FAST
    ) as { reply: string };

    return { threadId: thread.threadId, content: result.reply };
  }

  /**
   * Refreshes the EarTune system prompt via instruction_update.
   * Bases the new prompt on the current StyleProfile.
   */
  generateInstructions(): void {
    // W1: read instruction tabs as markdown for clean structured context
    const styleProfile = this.getTabMarkdown_(TAB_NAMES.STYLE_PROFILE);
    const existing = this.getTabMarkdown_(TAB_NAMES.EAR_TUNE);

    const userPrompt = `
STYLE PROFILE:
---
${styleProfile.slice(0, 4000)}
---

CURRENT EAR-TUNE INSTRUCTIONS (if any):
---
${existing.slice(0, 2000)}
---

Generate an updated EarTune system prompt that:
1. Incorporates the rhythm and cadence patterns from the StyleProfile.
2. Provides specific rules for consonant flow, syllabic stress, and sentence-length
   variation suitable for this manuscript.

Return a JSON object with:
- proposed_full_text: the complete new EarTune instructions
- operations: one per section being changed or added, each with a verbatim
  match_text from proposed_full_text and a reason.
`.trim();

    const geminiResult = this.callGemini_(
      STYLIST_SYSTEM_PROMPT,
      userPrompt,
      this.instructionUpdateSchema_(),
      MODEL.FAST
    ) as { proposed_full_text: string; operations: Operation[] };

    const update: RootUpdate = {
      workflow_type: 'instruction_update',
      review_tab: TAB_NAMES.EAR_TUNE,
      proposed_full_text: geminiResult.proposed_full_text,
      operations: geminiResult.operations,
    };

    CollaborationService.processUpdate(update);
  }

  /**
   * Writes example EarTune instructions to the EarTune tab.
   */
  generateExample(): void {
    DocOps.ensureStandardTabs();
    const earTab = DocOps.getOrCreateTab(TAB_NAMES.EAR_TUNE, TAB_NAMES.AGENTIC_INSTRUCTIONS);
    DocOps.overwriteTabContent(earTab, STYLIST_EXAMPLE_CONTENT);
  }

  /**
   * Workflow 2: full-tab Ear-Tune sweep.
   * Highlights and comments every passage with rhythmic issues.
   * Clears previous agent annotations on the tab before adding new ones.
   */
  annotateTab(tabName: string): void {
    const passage = this.getTabContent_(tabName);
    if (!passage.trim()) {
      throw new Error(`Tab "${tabName}" is empty. Nothing to Ear-Tune.`);
    }

    const styleProfile = this.getTabContent_(TAB_NAMES.STYLE_PROFILE);
    const earTuneInstructions = this.getTabContent_(TAB_NAMES.EAR_TUNE);

    const userPrompt = `
STYLE PROFILE:
---
${styleProfile.slice(0, 3000)}
---

EAR-TUNE INSTRUCTIONS:
---
${earTuneInstructions.slice(0, 2000)}
---

PASSAGE TO SWEEP (from tab: "${tabName}"):
---
${passage.slice(0, 8000)}
---

Identify every passage with a rhythmic, phonetic, or cadence problem.
Return a JSON object with:
- operations: one per problem found. Each must have:
    - match_text: verbatim 3–4-word phrase from the passage above
    - reason: description of the issue and suggested improvement
`.trim();

    const geminiResult = this.callGemini_(
      STYLIST_SYSTEM_PROMPT,
      userPrompt,
      this.annotationSchema_(),
      MODEL.FAST
    ) as { operations: Operation[] };

    const update: RootUpdate = {
      workflow_type: 'content_annotation',
      target_tab: tabName,
      operations: geminiResult.operations,
    };

    CollaborationService.processUpdate(update);
  }
}
