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

// ── Gemini schemas (mirrors BaseAgent schema methods) ────────────────────────

function instructionUpdateSchema(): object {
  return {
    type: 'object',
    properties: { proposed_full_text: { type: 'string' } },
    required: ['proposed_full_text'],
  };
}

function annotationOperationsSchema(): object {
  return {
    type: 'object',
    properties: {
      operations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            match_text: { type: 'string' },
            reason:     { type: 'string' },
          },
          required: ['match_text', 'reason'],
        },
      },
    },
    required: ['operations'],
  };
}

function threadRepliesSchema(): object {
  return {
    type: 'object',
    properties: {
      responses: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            threadId: { type: 'string' },
            reply:    { type: 'string' },
          },
          required: ['threadId', 'reply'],
        },
      },
    },
    required: ['responses'],
  };
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
      const sp = this.svc.markdown.tabToMarkdown(Constants.TAB_NAMES.STYLE_PROFILE);
      if (!sp.trim() || sp.trim().length < 200) {
        throw new Error(
          '[EditorLLM] StyleProfile is empty or incomplete (< 200 chars). ' +
          'Run "Architect → Generate Instructions" before this workflow.'
        );
      }
    }

    const systemPrompt = this.resolveSystemPrompt_();
    const userPrompt   = this.buildPrompt_(wf, {});

    const raw = this.callGemini_(systemPrompt, userPrompt, wf);
    const update = this.buildInstructionUpdate_(raw);
    this.svc.collab.processUpdate(update);

    // Post-steps
    for (const step of wf.postSteps ?? []) {
      if (step.kind === 'evaluate_style_profile') {
        const proposed = typeof raw === 'string' ? raw : (raw as any)?.proposed_full_text ?? '';
        this.evaluateStyleProfile_(proposed);
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
      const sp = this.svc.markdown.tabToMarkdown(Constants.TAB_NAMES.STYLE_PROFILE);
      if (!sp.trim() || sp.trim().length < 200) {
        throw new Error(
          '[EditorLLM] StyleProfile is empty or incomplete (< 200 chars). ' +
          'Run "Architect → Generate Instructions" before this workflow.'
        );
      }
    }

    const systemPrompt = this.resolveSystemPrompt_();
    const userPrompt   = this.buildPrompt_(wf, { passage, tabName });
    const raw          = this.callGemini_(systemPrompt, userPrompt, wf);

    const operations: Array<{ match_text: string; reason: string }> =
      (raw as any)?.operations ?? [];

    // validate_operations post-step: drop ops where match_text is not in passage
    const validOps = wf.postSteps?.some(s => s.kind === 'validate_operations')
      ? this.validateOps_(operations, passage)
      : operations;

    const update = {
      workflow_type: 'content_annotation' as const,
      target_tab:   tabName,
      operations:   validOps,
      agent_name:   this.def.commentPrefix,
    };
    this.svc.collab.processUpdate(update);
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
      const title = sec.source.kind === 'passage' && rt.tabName
        ? `Passage To Sweep (from tab: "${rt.tabName}")`
        : sec.title;
      sections[title] = this.resolveSource_(sec.source, rt);
    }
    return this.buildStandardPrompt_(sections, wf.instructions);
  }

  private resolveSource_(source: ContextSource, rt: RuntimeCtx): string {
    switch (source.kind) {
      case 'style_profile':
        return source.format === 'markdown'
          ? this.svc.markdown.tabToMarkdown(Constants.TAB_NAMES.STYLE_PROFILE)
          : this.svc.docOps.getTabContent(Constants.TAB_NAMES.STYLE_PROFILE);

      case 'self_instructions':
        return source.format === 'markdown'
          ? this.svc.markdown.tabToMarkdown(this.def.instructionTabName)
          : this.svc.docOps.getTabContent(this.def.instructionTabName);

      case 'merged_content': {
        const raw = this.svc.docOps.getTabContent(Constants.TAB_NAMES.MERGED_CONTENT);
        return source.charLimit ? raw.slice(0, source.charLimit) : raw;
      }

      case 'tab': {
        const raw = source.format === 'markdown'
          ? this.svc.markdown.tabToMarkdown(source.tabName)
          : this.svc.docOps.getTabContent(source.tabName);
        return source.charLimit ? raw.slice(0, source.charLimit) : raw;
      }

      case 'passage':
        return rt.passage ?? '';

      case 'threads':
        return rt.threads ?? '';

      case 'anchor_tab':
        return rt.anchorContent ?? '';
    }
  }

  /**
   * Mirrors BaseAgent.buildStandardPrompt exactly — same template-literal
   * escaping, same join separator, same trim().
   */
  private buildStandardPrompt_(
    sections: Record<string, string | undefined | null>,
    instructions: string
  ): string {
    const formattedParts = Object.entries(sections)
      .map(([title, content]) => `## ${title}\\n\\n${content || '(not provided)'}\\n`);
    return [...formattedParts, `\\n## Instructions\\n\\n${instructions || '(not provided)'}`].join('\\n').trim();
  }

  private schemaFor_(wf: WorkflowDef): object | undefined {
    switch (wf.responseFormat) {
      case 'instruction_update':    return instructionUpdateSchema();
      case 'annotation_operations': return annotationOperationsSchema();
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

  private buildInstructionUpdate_(raw: any): object {
    const text = typeof raw === 'string' ? raw : (raw as any)?.proposed_full_text ?? '';
    return {
      workflow_type:       'instruction_update' as const,
      review_tab:          this.def.instructionTabName,
      proposed_full_text:  text,
    };
  }

  private validateOps_(
    ops: Array<{ match_text: string; reason: string }>,
    passage: string
  ): Array<{ match_text: string; reason: string }> {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const normPassage = norm(passage);
    return ops.filter(op =>
      op.match_text?.trim() &&
      op.reason?.trim() &&
      normPassage.includes(norm(op.match_text))
    );
  }

  /**
   * Mirrors BaseAgent.evaluateStyleProfile_: calls a fast-tier Gemini instance
   * with a 0–5 quality rubric.
   * Returns the score/rationale but does NOT write to PropertiesService
   * (that is a GAS side-effect; this is a pure interpreter concern).
   */
  private evaluateStyleProfile_(styleProfile: string): { score: number; rationale: string } {
    const EVAL_SYSTEM = 'You are a style-guide quality evaluator. Respond ONLY with the JSON schema provided.';
    const EVAL_USER = `Rate the following StyleProfile on a scale of 0–5.

Rubric:
  5 = All 5 required sections (Voice, Sentence Rhythm, Vocabulary Register,
      Structural Patterns, Thematic Motifs) present with ≥ 2 detailed bullets each.
  4 = All 5 sections present, some have fewer than 2 bullets.
  3 = At least 4 sections present; downstream agents can use it productively.
  2 = 3 sections present; noticeably incomplete.
  1 = 1–2 sections; barely structured.
  0 = Empty, incoherent, or clearly not a StyleProfile.

Required sections: Voice, Sentence Rhythm, Vocabulary Register, Structural Patterns, Thematic Motifs.
Return {"score": <integer 0-5>, "rationale": "<one sentence>"}

StyleProfile to evaluate:
---
${styleProfile.slice(0, 4000)}
---`;

    const evalSchema = {
      type: 'object',
      properties: {
        score:     { type: 'integer' },
        rationale: { type: 'string' },
      },
      required: ['score', 'rationale'],
    };

    const result = this.svc.gemini.generate(EVAL_SYSTEM, EVAL_USER, 'fast', { schema: evalSchema });
    const score     = Math.max(0, Math.min(5, Math.round((result as any)?.score ?? 0)));
    const rationale = ((result as any)?.rationale ?? '').slice(0, 300) as string;
    return { score, rationale };
  }
}
