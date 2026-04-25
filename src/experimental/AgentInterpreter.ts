// ============================================================
// src/experimental/AgentInterpreter.ts
//
// Executes any AgentDefinition without agent-specific subclass code.
// Uses dependency-injected services so it is fully testable in Node.js
// without a GAS runtime — the same service mocks used in Jest tests work.
//
// NOTE: This file is compiled by tsc into dist/experimental/AgentInterpreter.js.
// That compiled file is dead code in GAS (nothing calls it). It is harmless
// because fixgas.js patches the exports boilerplate. To exclude it from the
// GAS build, add "src/experimental" to tsconfig.json > exclude.
// ============================================================

import type { AgentDefinition, WorkflowDef, ContextSource, ModelTier } from './types';
import { Constants } from '../Constants';
import {
  assertStyleProfileValid,
  extractMarkdownFromJsonWrapper,
  buildStandardPrompt,
  validateOps,
  annotationOperationsSchema,
  threadRepliesSchema,
  runInstructionQualityEval_,
  instructionQualityDocumentPropKeysForAgentId_,
} from '../agentHelpers';

// ── Service interfaces ────────────────────────────────────────────────────────

/**
 * Minimal surface of GeminiService used by the interpreter.
 * Matches the signature of GeminiService.generate() in the main codebase.
 */
export interface GeminiServiceLike {
  generate(
    systemPrompt: string,
    userPrompt: string,
    tier: ModelTier,
    opts?: { schema?: object; modelOverride?: string }
  ): any;
}

/** Minimal surface of DocOps used by the interpreter. */
export interface DocOpsLike {
  getTabContent(tabName: string): string;
  ensureStandardTabs(): void;
}

/** Minimal surface of MarkdownService used by the interpreter. */
export interface MarkdownServiceLike {
  tabToMarkdown(tabName: string): string;
}

/** Minimal surface of CollaborationService used by the interpreter. */
export interface CollabServiceLike {
  processUpdate(update: object): void;
}

/** All services the interpreter depends on — inject via constructor. */
export interface AgentServices {
  gemini:   GeminiServiceLike;
  docOps:   DocOpsLike;
  markdown: MarkdownServiceLike;
  collab:   CollabServiceLike;
}

// ── Runtime context passed to buildPrompt_ for per-call dynamic values ────────

interface RuntimeCtx {
  passage?:        string;  // W2: text of the tab being annotated
  threads?:        string;  // W3: pre-formatted comment threads
  anchorContent?:  string;  // W3: content of the anchor tab
  tabName?:        string;  // W2: name of the tab being annotated (for section title)
}

// ── AgentInterpreter ──────────────────────────────────────────────────────────

export class AgentInterpreter {

  constructor(
    private readonly def: AgentDefinition,
    private readonly svc: AgentServices
  ) {}

  // ── Public workflow entry points ────────────────────────────────────────────

  /**
   * W1 — Generate / refresh the agent's instruction tab.
   * Mirrors the concrete agent's generateInstructions() method.
   */
  generateInstructions(): void {
    const wf = this.def.workflows.generateInstructions;
    if (!wf) {
      throw new Error(`[AgentInterpreter] Agent "${this.def.id}" does not declare generateInstructions.`);
    }

    this.svc.docOps.ensureStandardTabs();

    if (wf.requiresStyleProfile !== false) {
      assertStyleProfileValid(this.svc.markdown.tabToMarkdown(Constants.TAB_NAMES.STYLE_PROFILE));
    }

    const systemPrompt = this.resolveSystemPrompt_();
    const userPrompt   = this.buildPrompt_(wf, {});

    const raw = this.callGemini_(systemPrompt, userPrompt, wf);
    const update = this.buildInstructionUpdate_(raw, wf.responseFormat);
    this.svc.collab.processUpdate(update);

    // Post-steps
    for (const step of wf.postSteps ?? []) {
      if (step.kind === 'evaluate_instruction_quality') {
        const proposed = extractMarkdownFromJsonWrapper(
          typeof raw === 'string' ? raw : (raw as any)?.proposed_full_text ?? ''
        );
        runInstructionQualityEval_({
          gemini: (s, u, o) =>
            this.svc.gemini.generate(s, u, o.tier as ModelTier, { schema: o.schema, modelOverride: undefined }),
          logTag: `[AgentInterpreter:${this.def.id}]`,
          rubricMarkdown: this.def.instructionQualityRubric,
          propKeys: instructionQualityDocumentPropKeysForAgentId_(this.def.id),
          markdown: proposed,
        });
      }
    }
  }

  /**
   * W2 — Annotate a manuscript tab with highlights and Drive comments.
   * Mirrors the concrete agent's annotateTab(tabName) method.
   */
  annotateTab(tabName: string): void {
    const wf = this.def.workflows.annotateTab;
    if (!wf) {
      throw new Error(`[AgentInterpreter] Agent "${this.def.id}" does not declare annotateTab.`);
    }

    const passage = this.svc.docOps.getTabContent(tabName);
    if (!passage.trim()) {
      throw new Error(`Tab "${tabName}" is empty. Nothing to process.`);
    }

    if (wf.requiresStyleProfile !== false) {
      assertStyleProfileValid(this.svc.markdown.tabToMarkdown(Constants.TAB_NAMES.STYLE_PROFILE));
    }

    const systemPrompt = this.resolveSystemPrompt_();
    const userPrompt   = this.buildPrompt_(wf, { passage, tabName });
    const raw          = this.callGemini_(systemPrompt, userPrompt, wf);

    if (wf.responseFormat === 'bookmark_directives') {
      const operations: any[] = (raw as any)?.operations ?? [];
      const directives: DirectiveCreate[] = operations.map(op => {
        const built = wf.directiveBuilder
          ? wf.directiveBuilder(op)
          : { type: 'custom', payload: op as Record<string, unknown> };
        return {
          match_text: op.match_text,
          type: built.type,
          payload: built.payload,
        };
      });
      this.svc.collab.processUpdate({
        workflow_type: 'bookmark_directives',
        target_tab:    tabName,
        directives:    directives,
        agent_name:    this.def.commentPrefix,
      });
    } else {
      const operations: Array<{ match_text: string; reason: string }> = (raw as any)?.operations ?? [];
      // validate_operations post-step: drop ops where match_text is not in passage
      const validOps = wf.postSteps?.some(s => s.kind === 'validate_operations')
        ? validateOps(operations, passage)
        : operations;

      this.svc.collab.processUpdate({
        workflow_type: 'content_annotation',
        target_tab:   tabName,
        operations:   validOps,
        agent_name:   this.def.commentPrefix,
      });
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private resolveSystemPrompt_(): string {
    const sp = this.def.systemPrompt;
    if (sp.kind === 'static') return sp.text;
    const text = this.svc.docOps.getTabContent(sp.tabName).trim();
    return text || sp.fallback || '';
  }

  private buildPrompt_(wf: WorkflowDef, rt: RuntimeCtx): string {
    const sections: Record<string, string | undefined | null> = {};
    for (const sec of wf.contextSections) {
      sections[sec.title] = this.resolveSource_(sec.source, rt);
    }
    return buildStandardPrompt(sections, wf.instructions);
  }

  private resolveSource_(source: ContextSource, rt: RuntimeCtx): string {
    switch (source.kind) {
      case 'literal':
        return source.text;

      case 'style_profile':
        return source.format === 'markdown'
          ? this.svc.markdown.tabToMarkdown(Constants.TAB_NAMES.STYLE_PROFILE)
          : this.svc.docOps.getTabContent(Constants.TAB_NAMES.STYLE_PROFILE);

      case 'self_instructions':
        return source.format === 'markdown'
          ? this.svc.markdown.tabToMarkdown(this.def.instructionTabName)
          : this.svc.docOps.getTabContent(this.def.instructionTabName);

      case 'manuscript': {
        const raw = this.svc.docOps.getTabContent(Constants.TAB_NAMES.MANUSCRIPT);
        return source.charLimit ? raw.slice(0, source.charLimit) : raw;
      }

      case 'tab': {
        const resolvedTabName = source.tabName
          .replace('${instructionTabName}', this.def.instructionTabName);
        const raw = source.format === 'markdown'
          ? this.svc.markdown.tabToMarkdown(resolvedTabName)
          : this.svc.docOps.getTabContent(resolvedTabName);
        const content = source.charLimit ? raw.slice(0, source.charLimit) : raw;
        return content.trim() ? content : (source.fallback ?? '');
      }

      case 'passage':
        return rt.passage ?? '';

      case 'threads':
        return rt.threads ?? '';

      case 'anchor_tab':
        return rt.anchorContent ?? '';
    }
  }

  private schemaFor_(wf: WorkflowDef): object | undefined {
    switch (wf.responseFormat) {
      case 'instruction_update':    return undefined;  // plain text — no buffering timeout
      case 'annotation_operations': return annotationOperationsSchema();
      case 'bookmark_directives':   return wf.schemaProvider ? wf.schemaProvider() : undefined;
      case 'thread_replies':        return threadRepliesSchema();
      case 'plain_markdown':        return undefined;
    }
  }

  /**
   * Mirrors BaseAgent.callGemini_: passes systemPrompt, userPrompt, tier,
   * and { schema, modelOverride: undefined } (no per-instance model override).
   */
  private callGemini_(systemPrompt: string, userPrompt: string, wf: WorkflowDef): any {
    const schema = this.schemaFor_(wf);
    return this.svc.gemini.generate(
      systemPrompt,
      userPrompt,
      wf.modelTier,
      { schema, modelOverride: undefined }
    );
  }

  private buildInstructionUpdate_(raw: any, _responseFormat: string): object {
    // Both instruction_update and plain_markdown now return plain text from Gemini.
    // Always apply the JSON-wrapper guard in case the model ignores the instruction.
    const text = extractMarkdownFromJsonWrapper(
      typeof raw === 'string' ? raw : (raw as any)?.proposed_full_text ?? ''
    );
    return {
      workflow_type:       'instruction_update' as const,
      review_tab:          this.def.instructionTabName,
      proposed_full_text:  text,
    };
  }

}
