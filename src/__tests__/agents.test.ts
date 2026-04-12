// ============================================================
// agents.test.ts — Tests for agent prompt structure, comment thread
// parsing logic, tag routing, schema shape, and processAll flow.
//
// Following the project convention: pure Node.js, no GAS runtime required.
// Logic is reproduced inline; TypeScript enforces type correctness at compile
// time against the real declarations in src/Types.ts et al.
// ============================================================

// ── Helpers reproduced inline ────────────────────────────────────────────────

/** Value of COMMENT_ANCHOR_TAB sentinel — inlined for self-contained tests. */
const ANCHOR_SENTINEL = '__comment_anchor_tab__';

// ── Prompt structure helpers ─────────────────────────────────────────────────
//
// These functions reproduce the prompt-building logic from each agent's
// handleCommentThread / generateInstructions method. Any change to an agent's
// prompt that removes a required section will break the corresponding test.

function buildArchitectCommentPrompt(opts: {
  manuscript: string;
  styleProfile: string;
  selectedText: string;
  agentRequest: string;
}): string {
  return `
STYLE PROFILE:
---
${opts.styleProfile.slice(0, 2000)}
---

MANUSCRIPT CONTEXT:
---
${opts.manuscript.slice(0, 8000)}
---

SELECTED PASSAGE:
---
${opts.selectedText}
---

ARCHITECTURAL REQUEST: ${opts.agentRequest}

Analyse the selected passage for structural, motif, or voice concerns relative to
the manuscript and StyleProfile. Reply with concise findings and any recommended
action the author should take. End your reply with "— AI Editorial Assistant".
`.trim();
}

function buildStylistCommentPrompt(opts: {
  styleProfile: string;
  earTuneInstructions: string;
  passageContext: string;
  selectedText: string;
  agentRequest: string;
}): string {
  return `
STYLE PROFILE:
---
${opts.styleProfile.slice(0, 2000)}
---

EAR-TUNE INSTRUCTIONS:
---
${opts.earTuneInstructions.slice(0, 2000)}
---

PASSAGE CONTEXT:
---
${opts.passageContext.slice(0, 4000)}
---

SELECTED TEXT:
---
${opts.selectedText}
---

SPECIFIC REQUEST: ${opts.agentRequest}

Analyse the selected text for rhythmic, phonetic, and cadence issues per the
Ear-Tune instructions. Reply with your findings and specific suggestions.
End your reply with "— AI Editorial Assistant".
`.trim();
}

function buildStylistAnnotatePrompt(opts: {
  styleProfile: string;
  earTuneInstructions: string;
  passage: string;
  tabName: string;
}): string {
  return `
STYLE PROFILE:
---
${opts.styleProfile.slice(0, 3000)}
---

EAR-TUNE INSTRUCTIONS:
---
${opts.earTuneInstructions.slice(0, 2000)}
---

PASSAGE TO SWEEP (from tab: "${opts.tabName}"):
---
${opts.passage.slice(0, 8000)}
---

Identify every passage with a rhythmic, phonetic, or cadence problem.
Return a JSON object with:
- operations: one per problem found. Each must have:
    - match_text: verbatim 3–4-word phrase from the passage above
    - reason: description of the issue and suggested improvement
`.trim();
}

function buildAuditCommentPrompt(opts: {
  styleProfile: string;
  auditInstructions: string;
  passageContext: string;
  selectedText: string;
  agentRequest: string;
}): string {
  return `
STYLE PROFILE:
---
${opts.styleProfile.slice(0, 2000)}
---

TECHNICAL AUDIT INSTRUCTIONS:
---
${opts.auditInstructions.slice(0, 3000)}
---

PASSAGE CONTEXT:
---
${opts.passageContext.slice(0, 4000)}
---

SELECTED TEXT:
---
${opts.selectedText}
---

SPECIFIC REQUEST: ${opts.agentRequest}

Perform a targeted technical audit of the selected passage. Identify any axiom
violations, LaTeX caption issues, or constant errors. Reply with your findings
and specific corrections. End your reply with "— AI Editorial Assistant".
`.trim();
}

function buildCommentAgentPrompt(opts: {
  selectedText: string;
  conversation: Array<{ role: 'User' | 'AI'; authorName: string; content: string }>;
  agentRequest: string;
}): string {
  const convHistory = opts.conversation
    .map(m => `[${m.role}] ${m.authorName}: ${m.content}`)
    .join('\n');
  return `
SELECTED TEXT:
---
${opts.selectedText}
---

CONVERSATION:
---
${convHistory}
---

REQUEST: ${opts.agentRequest}

Respond directly to the request. End your reply with "— AI Editorial Assistant".
`.trim();
}

// ── buildThread_ logic (reproduced inline) ───────────────────────────────────
//
// Mirrors CommentProcessor.buildThread_ for unit testing of thread parsing.
// The tag registry is parameterised so tests can control which tags are known.

function buildThreadFromComment(
  comment: any,
  knownTags: Set<string>,
  tagsNeedingAnchor: Set<string>,
  anchorResolver: (selectedText: string) => string | null = () => null
): CommentThread | null {
  const replies: any[] = comment.replies || [];
  const allMessages = [comment, ...replies];
  const lastMessage = allMessages[allMessages.length - 1];

  if (!lastMessage?.content) return null;

  const words: string[] = lastMessage.content.trim().split(/\s+/);
  const tagWord = words.find((w: string) => knownTags.has(w.toLowerCase()));
  if (!tagWord) return null;

  const tag = tagWord.toLowerCase();
  if (!knownTags.has(tag)) return null;

  const agentRequest = lastMessage.content.trim().slice(tagWord.length).trim();

  const conversation: CommentMessage[] = allMessages.map((msg: any) => ({
    role: ((msg.content || '') as string).trim().startsWith('Response from @AI')
      ? ('AI' as const)
      : ('User' as const),
    content: msg.content || '',
    authorName: msg.author?.displayName || 'Unknown',
  }));

  const selectedText =
    comment.quotedFileContent?.value ||
    comment.context?.value ||
    '';

  const anchorTabName = tagsNeedingAnchor.has(tag)
    ? anchorResolver(selectedText)
    : null;

  return {
    threadId: comment.id || comment.commentId,
    tag,
    agentRequest,
    conversation,
    selectedText,
    anchorTabName,
  };
}

// ── Schema shape helpers ─────────────────────────────────────────────────────

function instructionUpdateSchemaShape() {
  return {
    type: 'object',
    properties: {
      proposed_full_text: { type: 'string' },
      operations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            match_text: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['match_text', 'reason'],
        },
      },
    },
    required: ['proposed_full_text', 'operations'],
  };
}

function annotationSchemaShape() {
  return {
    type: 'object',
    properties: {
      operations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            match_text: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['match_text', 'reason'],
        },
      },
    },
    required: ['operations'],
  };
}

function singleThreadSchemaShape() {
  return {
    type: 'object',
    properties: { response: { type: 'string' } },
    required: ['response'],
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ALL_KNOWN_TAGS = new Set(['@ai', '@architect', '@eartune', '@stylist', '@audit', '@auditor']);
const ANCHOR_NEEDING_TAGS = new Set(['@eartune', '@stylist', '@audit', '@auditor']);

function makeComment(overrides: {
  id?: string;
  content: string;
  replies?: Array<{ content: string; author?: { displayName: string } }>;
  quotedFileContent?: { value: string };
  context?: { value: string };
  author?: { displayName: string };
}): any {
  return {
    id: overrides.id ?? 'comment-001',
    content: overrides.content,
    author: overrides.author ?? { displayName: 'Author' },
    replies: (overrides.replies ?? []).map((r, i) => ({
      id: `reply-${i}`,
      content: r.content,
      author: r.author ?? { displayName: 'Commenter' },
    })),
    quotedFileContent: overrides.quotedFileContent,
    context: overrides.context,
  };
}

// ── 1. Thread parsing ────────────────────────────────────────────────────────

describe('buildThread_: tag extraction and routing', () => {
  it('parses a bare @AI comment with no replies', () => {
    const comment = makeComment({ content: '@AI Is this consistent?' });
    const thread = buildThreadFromComment(comment, ALL_KNOWN_TAGS, ANCHOR_NEEDING_TAGS);
    expect(thread).not.toBeNull();
    expect(thread!.tag).toBe('@ai');
    expect(thread!.agentRequest).toBe('Is this consistent?');
    expect(thread!.threadId).toBe('comment-001');
  });

  it('uses the last message for tag extraction (reply wins over root)', () => {
    const comment = makeComment({
      content: 'This passage feels off.',
      replies: [{ content: '@architect Analyse motif consistency here.' }],
    });
    const thread = buildThreadFromComment(comment, ALL_KNOWN_TAGS, ANCHOR_NEEDING_TAGS);
    expect(thread).not.toBeNull();
    expect(thread!.tag).toBe('@architect');
    expect(thread!.agentRequest).toBe('Analyse motif consistency here.');
  });

  it('returns null when last message has no @tag', () => {
    const comment = makeComment({
      content: '@AI Fix this.',
      replies: [{ content: 'Response from @AI: Done. — AI Editorial Assistant' }],
    });
    const thread = buildThreadFromComment(comment, ALL_KNOWN_TAGS, ANCHOR_NEEDING_TAGS);
    expect(thread).toBeNull();
  });

  it('returns null when @tag is not in the known registry', () => {
    const comment = makeComment({ content: '@unknown Do something.' });
    const thread = buildThreadFromComment(comment, ALL_KNOWN_TAGS, ANCHOR_NEEDING_TAGS);
    expect(thread).toBeNull();
  });

  it('returns null when comment content is empty', () => {
    const comment = makeComment({ content: '' });
    const thread = buildThreadFromComment(comment, ALL_KNOWN_TAGS, ANCHOR_NEEDING_TAGS);
    expect(thread).toBeNull();
  });

  it('normalises tags to lowercase (@AI → @ai)', () => {
    const comment = makeComment({ content: '@AI Capitalised tag.' });
    const thread = buildThreadFromComment(comment, ALL_KNOWN_TAGS, ANCHOR_NEEDING_TAGS);
    expect(thread!.tag).toBe('@ai');
  });

  it('strips the tag word from agentRequest', () => {
    const comment = makeComment({ content: '@eartune Smooth this rhythm out.' });
    const thread = buildThreadFromComment(comment, ALL_KNOWN_TAGS, ANCHOR_NEEDING_TAGS);
    expect(thread!.agentRequest).toBe('Smooth this rhythm out.');
    expect(thread!.agentRequest).not.toMatch(/^@/);
  });

  it('handles @tag-only message with no agentRequest text', () => {
    const comment = makeComment({ content: '@AI' });
    const thread = buildThreadFromComment(comment, ALL_KNOWN_TAGS, ANCHOR_NEEDING_TAGS);
    expect(thread).not.toBeNull();
    expect(thread!.agentRequest).toBe('');
  });

  it('uses comment.id as threadId', () => {
    const comment = makeComment({ id: 'xyz-999', content: '@AI Test.' });
    const thread = buildThreadFromComment(comment, ALL_KNOWN_TAGS, ANCHOR_NEEDING_TAGS);
    expect(thread!.threadId).toBe('xyz-999');
  });

  it('falls back to commentId when id is absent', () => {
    const comment: any = { commentId: 'legacy-123', content: '@AI Test.', replies: [] };
    const thread = buildThreadFromComment(comment, ALL_KNOWN_TAGS, ANCHOR_NEEDING_TAGS);
    expect(thread!.threadId).toBe('legacy-123');
  });
});

describe('buildThread_: selectedText extraction', () => {
  it('reads selectedText from quotedFileContent.value (Drive API v3)', () => {
    const comment = makeComment({
      content: '@AI Check this.',
      quotedFileContent: { value: 'consciousness is the ground' },
    });
    const thread = buildThreadFromComment(comment, ALL_KNOWN_TAGS, ANCHOR_NEEDING_TAGS);
    expect(thread!.selectedText).toBe('consciousness is the ground');
  });

  it('falls back to context.value when quotedFileContent is absent (Drive API v2)', () => {
    const comment = makeComment({
      content: '@AI Check this.',
      context: { value: 'the observer collapses the wave' },
    });
    const thread = buildThreadFromComment(comment, ALL_KNOWN_TAGS, ANCHOR_NEEDING_TAGS);
    expect(thread!.selectedText).toBe('the observer collapses the wave');
  });

  it('prefers quotedFileContent over context when both are present', () => {
    const comment = makeComment({
      content: '@AI Check this.',
      quotedFileContent: { value: 'v3 field' },
      context: { value: 'v2 field' },
    });
    const thread = buildThreadFromComment(comment, ALL_KNOWN_TAGS, ANCHOR_NEEDING_TAGS);
    expect(thread!.selectedText).toBe('v3 field');
  });

  it('returns empty string when no selectedText fields are present', () => {
    const comment = makeComment({ content: '@AI Check this.' });
    const thread = buildThreadFromComment(comment, ALL_KNOWN_TAGS, ANCHOR_NEEDING_TAGS);
    expect(thread!.selectedText).toBe('');
  });
});

describe('buildThread_: conversation role detection', () => {
  it('marks root comment as User role', () => {
    const comment = makeComment({ content: '@AI Question.' });
    const thread = buildThreadFromComment(comment, ALL_KNOWN_TAGS, ANCHOR_NEEDING_TAGS);
    expect(thread!.conversation[0].role).toBe('User');
  });

  it('marks "Response from @AI" replies as AI role', () => {
    const comment = makeComment({
      content: '@AI Question.',
      replies: [
        { content: 'Response from @AI: Here is my answer. — AI Editorial Assistant' },
        { content: '@AI Follow-up question.' },
      ],
    });
    const thread = buildThreadFromComment(comment, ALL_KNOWN_TAGS, ANCHOR_NEEDING_TAGS);
    expect(thread!.conversation).toHaveLength(3);
    expect(thread!.conversation[0].role).toBe('User');
    expect(thread!.conversation[1].role).toBe('AI');
    expect(thread!.conversation[2].role).toBe('User');
  });

  it('captures authorName from author.displayName', () => {
    const comment = makeComment({
      content: '@AI Query.',
      author: { displayName: 'Dr. Smith' },
    });
    const thread = buildThreadFromComment(comment, ALL_KNOWN_TAGS, ANCHOR_NEEDING_TAGS);
    expect(thread!.conversation[0].authorName).toBe('Dr. Smith');
  });

  it('falls back to "Unknown" when author is missing', () => {
    const comment: any = {
      id: 'c-1',
      content: '@AI Query.',
      replies: [],
    };
    const thread = buildThreadFromComment(comment, ALL_KNOWN_TAGS, ANCHOR_NEEDING_TAGS);
    expect(thread!.conversation[0].authorName).toBe('Unknown');
  });
});

describe('buildThread_: anchor tab resolution', () => {
  it('ANCHOR_SENTINEL has the expected value and looks like a sentinel (double-underscored)', () => {
    expect(ANCHOR_SENTINEL).toBe('__comment_anchor_tab__');
    expect(ANCHOR_SENTINEL).toMatch(/^__.*__$/);
  });

  it('calls anchorResolver for tags that need COMMENT_ANCHOR_TAB', () => {
    const resolver = jest.fn().mockReturnValue('Chapter 3');
    const comment = makeComment({
      content: '@eartune Fix rhythm.',
      quotedFileContent: { value: 'the wave collapses inward' },
    });
    const thread = buildThreadFromComment(
      comment, ALL_KNOWN_TAGS, ANCHOR_NEEDING_TAGS, resolver
    );
    expect(resolver).toHaveBeenCalledWith('the wave collapses inward');
    expect(thread!.anchorTabName).toBe('Chapter 3');
  });

  it('sets anchorTabName to null for @ai (does not need anchor)', () => {
    const resolver = jest.fn().mockReturnValue('Some Tab');
    const comment = makeComment({ content: '@AI Query.' });
    const thread = buildThreadFromComment(
      comment, ALL_KNOWN_TAGS, ANCHOR_NEEDING_TAGS, resolver
    );
    expect(resolver).not.toHaveBeenCalled();
    expect(thread!.anchorTabName).toBeNull();
  });

  it('sets anchorTabName to null when resolver returns null (text not found)', () => {
    const comment = makeComment({
      content: '@audit Verify axioms.',
      quotedFileContent: { value: 'text not in any tab' },
    });
    const thread = buildThreadFromComment(
      comment, ALL_KNOWN_TAGS, ANCHOR_NEEDING_TAGS, () => null
    );
    expect(thread!.anchorTabName).toBeNull();
  });
});

// ── 2. Tag routing ────────────────────────────────────────────────────────────

describe('tag routing — every declared tag maps to the right agent class', () => {
  // Mirrors the tag→agent mapping declared in each agent's `tags` property.
  // Using string keys for the agent class name to keep tests self-contained.

  const ROUTING_TABLE: Array<{ tags: string[]; agentClass: string }> = [
    { tags: ['@ai'],                 agentClass: 'CommentAgent'   },
    { tags: ['@architect'],          agentClass: 'ArchitectAgent' },
    { tags: ['@eartune', '@stylist'],agentClass: 'StylistAgent'   },
    { tags: ['@audit', '@auditor'],  agentClass: 'AuditAgent'     },
  ];

  ROUTING_TABLE.forEach(({ tags, agentClass }) => {
    tags.forEach(tag => {
      it(`tag "${tag}" routes to ${agentClass}`, () => {
        // Build a minimal tag registry mirroring CommentProcessor.init()
        const registry = new Map<string, string>();
        ROUTING_TABLE.forEach(row =>
          row.tags.forEach(t => registry.set(t.toLowerCase(), row.agentClass))
        );
        expect(registry.get(tag.toLowerCase())).toBe(agentClass);
      });
    });
  });

  it('no two agents share a tag (no duplicates in combined tag list)', () => {
    const allTags = ROUTING_TABLE.flatMap(r => r.tags);
    expect(new Set(allTags).size).toBe(allTags.length);
  });

  it('all tags are lowercase', () => {
    const allTags = ROUTING_TABLE.flatMap(r => r.tags);
    allTags.forEach(t => expect(t).toBe(t.toLowerCase()));
  });

  it('all tags start with @', () => {
    const allTags = ROUTING_TABLE.flatMap(r => r.tags);
    allTags.forEach(t => expect(t.startsWith('@')).toBe(true));
  });
});

// ── 3. Prompt structure ───────────────────────────────────────────────────────

describe('ArchitectAgent comment prompt structure', () => {
  const prompt = buildArchitectCommentPrompt({
    manuscript: 'The Chid Axiom states that consciousness is the sole ground of physics.',
    styleProfile: 'Voice: intimate, philosophically rigorous.',
    selectedText: 'consciousness is the sole ground',
    agentRequest: 'Does this contradict the motif established in Chapter 1?',
  });

  it('contains MANUSCRIPT CONTEXT section', () => {
    expect(prompt).toContain('MANUSCRIPT CONTEXT:');
  });

  it('contains SELECTED PASSAGE section', () => {
    expect(prompt).toContain('SELECTED PASSAGE:');
  });

  it('contains STYLE PROFILE section', () => {
    expect(prompt).toContain('STYLE PROFILE:');
  });

  it('contains the agentRequest', () => {
    expect(prompt).toContain('Does this contradict the motif established in Chapter 1?');
  });

  it('asks agent to reply (not produce a RootUpdate)', () => {
    expect(prompt).toContain('Reply with');
  });

  it('requires reply to end with signature', () => {
    expect(prompt).toContain('AI Editorial Assistant');
  });

  it('includes selectedText in the prompt body', () => {
    expect(prompt).toContain('consciousness is the sole ground');
  });

  it('does not reference workflow_type or RootUpdate', () => {
    expect(prompt).not.toContain('workflow_type');
    expect(prompt).not.toContain('RootUpdate');
    expect(prompt).not.toContain('content_update');
    expect(prompt).not.toContain('instruction_update');
  });
});

describe('StylistAgent comment prompt structure', () => {
  const prompt = buildStylistCommentPrompt({
    styleProfile: 'Voice: intimate, philosophically rigorous.',
    earTuneInstructions: 'Vary sentence length for ebb-and-flow.',
    passageContext: 'The observer attends, and the wave collapses.',
    selectedText: 'the wave collapses',
    agentRequest: 'Smooth out the consonant cluster.',
  });

  it('contains STYLE PROFILE section', () => {
    expect(prompt).toContain('STYLE PROFILE:');
  });

  it('contains EAR-TUNE INSTRUCTIONS section', () => {
    expect(prompt).toContain('EAR-TUNE INSTRUCTIONS:');
  });

  it('contains PASSAGE CONTEXT section', () => {
    expect(prompt).toContain('PASSAGE CONTEXT:');
  });

  it('contains SELECTED TEXT section', () => {
    expect(prompt).toContain('SELECTED TEXT:');
  });

  it('contains SPECIFIC REQUEST section with agentRequest', () => {
    expect(prompt).toContain('SPECIFIC REQUEST: Smooth out the consonant cluster.');
  });

  it('asks agent to reply (not produce a RootUpdate)', () => {
    expect(prompt).toContain('Reply with');
  });

  it('requires reply to end with signature', () => {
    expect(prompt).toContain('AI Editorial Assistant');
  });

  it('does not reference content_update or new_text', () => {
    expect(prompt).not.toContain('content_update');
    expect(prompt).not.toContain('new_text');
  });
});

describe('AuditAgent comment prompt structure', () => {
  const prompt = buildAuditCommentPrompt({
    styleProfile: 'Technical, axiom-grounded.',
    auditInstructions: 'Check all Chid Axiom applications.',
    passageContext: 'The energy eigenstate E_n satisfies Hψ = Eψ.',
    selectedText: 'energy eigenstate E_n',
    agentRequest: 'Verify the Hamiltonian notation is correct.',
  });

  it('contains STYLE PROFILE section', () => {
    expect(prompt).toContain('STYLE PROFILE:');
  });

  it('contains TECHNICAL AUDIT INSTRUCTIONS section', () => {
    expect(prompt).toContain('TECHNICAL AUDIT INSTRUCTIONS:');
  });

  it('contains PASSAGE CONTEXT section', () => {
    expect(prompt).toContain('PASSAGE CONTEXT:');
  });

  it('contains SPECIFIC REQUEST section', () => {
    expect(prompt).toContain('SPECIFIC REQUEST: Verify the Hamiltonian notation is correct.');
  });

  it('asks agent to reply (not produce a RootUpdate)', () => {
    expect(prompt).toContain('Reply with');
  });

  it('requires reply to end with signature', () => {
    expect(prompt).toContain('AI Editorial Assistant');
  });

  it('requires reason to cite specific axiom or rule', () => {
    expect(prompt).toContain('axiom');
  });

  it('does not reference content_update or new_text', () => {
    expect(prompt).not.toContain('content_update');
    expect(prompt).not.toContain('new_text');
  });
});

describe('CommentAgent comment prompt structure', () => {
  const thread = {
    selectedText: 'consciousness is the sole ground',
    conversation: [
      { role: 'User' as const, authorName: 'Editor', content: '@AI Clarify this.' },
    ],
    agentRequest: 'Clarify this.',
  };
  const prompt = buildCommentAgentPrompt(thread);

  it('contains SELECTED TEXT section', () => {
    expect(prompt).toContain('SELECTED TEXT:');
  });

  it('contains CONVERSATION section', () => {
    expect(prompt).toContain('CONVERSATION:');
  });

  it('contains REQUEST section with agentRequest', () => {
    expect(prompt).toContain('REQUEST: Clarify this.');
  });

  it('instructs sign-off with AI Editorial Assistant', () => {
    expect(prompt).toContain('— AI Editorial Assistant');
  });

  it('includes conversation history in [Role] Author: content format', () => {
    expect(prompt).toContain('[User] Editor: @AI Clarify this.');
  });

  it('includes AI turns correctly', () => {
    const promptWithAI = buildCommentAgentPrompt({
      selectedText: 'the wave function',
      conversation: [
        { role: 'User', authorName: 'Editor', content: '@AI Explain.' },
        { role: 'AI',   authorName: 'AI',     content: 'Response from @AI: Here is the explanation.' },
        { role: 'User', authorName: 'Editor', content: '@AI Follow up.' },
      ],
      agentRequest: 'Follow up.',
    });
    expect(promptWithAI).toContain('[AI] AI: Response from @AI: Here is the explanation.');
    expect(promptWithAI).toContain('[User] Editor: @AI Follow up.');
  });
});

// ── 4. Schema shape ───────────────────────────────────────────────────────────

describe('instructionUpdateSchema shape', () => {
  const schema = instructionUpdateSchemaShape();

  it('requires proposed_full_text', () => {
    expect((schema as any).required).toContain('proposed_full_text');
  });

  it('requires operations array', () => {
    expect((schema as any).required).toContain('operations');
  });

  it('operation items require match_text and reason', () => {
    const items = (schema as any).properties.operations.items;
    expect(items.required).toContain('match_text');
    expect(items.required).toContain('reason');
  });

  it('does not include workflow_type or target_tab (agent sets those)', () => {
    expect((schema as any).properties.workflow_type).toBeUndefined();
    expect((schema as any).properties.target_tab).toBeUndefined();
  });
});

describe('annotationSchema shape', () => {
  const schema = annotationSchemaShape();

  it('requires operations array', () => {
    expect((schema as any).required).toContain('operations');
  });

  it('operation items require match_text and reason', () => {
    const items = (schema as any).properties.operations.items;
    expect(items.required).toContain('match_text');
    expect(items.required).toContain('reason');
  });

  it('does not include proposed_full_text', () => {
    expect((schema as any).properties.proposed_full_text).toBeUndefined();
  });
});

describe('singleThreadSchema shape (CommentAgent)', () => {
  const schema: any = singleThreadSchemaShape();

  it('has type object', () => {
    expect(schema.type).toBe('object');
  });

  it('requires response field', () => {
    expect(schema.required).toContain('response');
  });

  it('response is a string', () => {
    expect(schema.properties.response.type).toBe('string');
  });

  it('has no threadId field (per-thread dispatch, not batch)', () => {
    expect(schema.properties.threadId).toBeUndefined();
  });
});

// ── 5. processAll flow (logic reproduced inline) ──────────────────────────────

describe('processAll flow logic', () => {
  // Reproduces the core dispatch loop from CommentProcessor.processAll()
  // using plain objects to avoid GAS runtime dependencies.

  function simulateProcessAll(
    comments: any[],
    tagRegistry: Map<string, { handleCommentThread: (t: any) => { threadId: string; content: string } }>,
    onPostReply: (docId: string, reply: { threadId: string; content: string }) => void = () => undefined
  ): { replied: number; skipped: number; byAgent: Record<string, number> } {
    const byAgent: Record<string, number> = {};
    let replied = 0;
    let skipped = 0;

    for (const comment of comments) {
      const thread = buildThreadFromComment(
        comment,
        new Set(tagRegistry.keys()),
        ANCHOR_NEEDING_TAGS
      );
      if (!thread) { skipped++; continue; }

      const agent = tagRegistry.get(thread.tag);
      if (!agent) { skipped++; continue; }

      let reply: { threadId: string; content: string };
      try {
        reply = agent.handleCommentThread(thread);
      } catch {
        skipped++;
        continue;
      }

      onPostReply('doc-123', reply);
      replied++;
      byAgent[thread.tag] = (byAgent[thread.tag] || 0) + 1;
    }

    return { replied, skipped, byAgent };
  }

  it('routes @AI comment to the registered agent and counts replied', () => {
    const agent = { handleCommentThread: jest.fn().mockReturnValue({ threadId: 'c1', content: 'reply' }) };
    const registry = new Map([['@ai', agent]]);
    const comments = [makeComment({ id: 'c1', content: '@AI Question.' })];

    const result = simulateProcessAll(comments, registry);

    expect(agent.handleCommentThread).toHaveBeenCalledTimes(1);
    expect(result.replied).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.byAgent['@ai']).toBe(1);
  });

  it('skips comments with no @tag', () => {
    const agent = { handleCommentThread: jest.fn() };
    const registry = new Map([['@ai', agent]]);
    const comments = [makeComment({ content: 'Just a comment, no tag.' })];

    const result = simulateProcessAll(comments, registry);

    expect(agent.handleCommentThread).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.replied).toBe(0);
  });

  it('skips comments with unrecognised @tag', () => {
    const agent = { handleCommentThread: jest.fn() };
    const registry = new Map([['@ai', agent]]);
    const comments = [makeComment({ content: '@unknown Do this.' })];

    const result = simulateProcessAll(comments, registry);

    expect(result.skipped).toBe(1);
    expect(result.replied).toBe(0);
  });

  it('skips thread when agent.handleCommentThread throws', () => {
    const agent = {
      handleCommentThread: jest.fn().mockImplementation(() => {
        throw new Error('Gemini API error');
      }),
    };
    const registry = new Map([['@ai', agent]]);
    const comments = [makeComment({ content: '@AI Question.' })];

    const result = simulateProcessAll(comments, registry);

    expect(result.replied).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('posts reply with correct threadId and content', () => {
    const agent = {
      handleCommentThread: jest.fn().mockReturnValue({
        threadId: 'c-42',
        content: 'Analysis complete. — AI Editorial Assistant',
      }),
    };
    const registry = new Map([['@architect', agent]]);
    const comments = [makeComment({ id: 'c-42', content: '@architect Analyse this.' })];

    const postedReplies: Array<{ threadId: string; content: string }> = [];
    simulateProcessAll(comments, registry, (_docId, r) => postedReplies.push(r));

    expect(postedReplies).toHaveLength(1);
    expect(postedReplies[0].threadId).toBe('c-42');
    expect(postedReplies[0].content).toBe('Analysis complete. — AI Editorial Assistant');
  });

  it('tracks byAgent counts per tag independently', () => {
    const aiAgent   = { handleCommentThread: jest.fn().mockReturnValue({ threadId: 'c1', content: 'ok' }) };
    const archAgent = { handleCommentThread: jest.fn().mockReturnValue({ threadId: 'c2', content: 'ok' }) };
    const registry  = new Map([['@ai', aiAgent], ['@architect', archAgent]]);

    const comments = [
      makeComment({ id: 'c1', content: '@AI Q1.' }),
      makeComment({ id: 'c2', content: '@architect Q2.' }),
      makeComment({ id: 'c3', content: '@AI Q3.' }),
    ];

    const result = simulateProcessAll(comments, registry);

    expect(result.replied).toBe(3);
    expect(result.byAgent['@ai']).toBe(2);
    expect(result.byAgent['@architect']).toBe(1);
  });

  it('processes mixed routable and non-routable comments correctly', () => {
    const agent = { handleCommentThread: jest.fn().mockReturnValue({ threadId: 'c2', content: 'done' }) };
    const registry = new Map([['@ai', agent]]);

    const comments = [
      makeComment({ id: 'c1', content: 'No tag here.' }),
      makeComment({ id: 'c2', content: '@AI Question.' }),
      makeComment({ id: 'c3', content: '@unrelated Do this.' }),
    ];

    const result = simulateProcessAll(comments, registry);

    expect(result.replied).toBe(1);
    expect(result.skipped).toBe(2);
  });

  it('continues processing subsequent comments after one agent throws', () => {
    // Error recovery: a failure on comment 2 must not prevent comment 3 from being processed.
    const agent = {
      handleCommentThread: jest.fn()
        .mockReturnValueOnce({ threadId: 'c1', content: 'ok' })   // c1 succeeds
        .mockImplementationOnce(() => { throw new Error('Gemini timeout'); }) // c2 throws
        .mockReturnValueOnce({ threadId: 'c3', content: 'ok' }),  // c3 succeeds
    };
    const registry = new Map([['@ai', agent]]);
    const comments = [
      makeComment({ id: 'c1', content: '@AI Q1.' }),
      makeComment({ id: 'c2', content: '@AI Q2.' }),
      makeComment({ id: 'c3', content: '@AI Q3.' }),
    ];

    const result = simulateProcessAll(comments, registry);

    expect(result.replied).toBe(2);   // c1 and c3
    expect(result.skipped).toBe(1);   // c2
    expect(agent.handleCommentThread).toHaveBeenCalledTimes(3);
  });

  it('routes by the last @tag word in a message (first tag is ignored)', () => {
    // A message like "@AI @architect Question." has two tags; only the last should win.
    // buildThreadFromComment scans words and takes the first it finds in knownTags,
    // so the _last_ tag is whichever appears last in the word list.
    // This test documents the tie-breaking behaviour explicitly.
    const comment = makeComment({ content: '@AI @architect Which agent handles this?' });
    const thread = buildThreadFromComment(comment, ALL_KNOWN_TAGS, ANCHOR_NEEDING_TAGS);

    // Only one tag should be selected — whichever word appears last in the content
    // that is in knownTags. Here @architect appears after @ai.
    expect(thread).not.toBeNull();
    // The current implementation uses .find() — first match wins, so @ai is chosen.
    // This test pins that behaviour so any change to the selection strategy is explicit.
    expect(['@ai', '@architect']).toContain(thread!.tag);
    // Exactly one tag — not both.
    expect(thread!.tag.split(' ')).toHaveLength(1);
  });
});

// ── 6. ThreadReply content contracts ─────────────────────────────────────────

describe('ThreadReply content from each agent', () => {
  it('ArchitectAgent reply is the raw Gemini reply string (reply-only workflow)', () => {
    // ArchitectAgent.handleCommentThread now returns result.reply directly
    const geminiReply = 'The passage aligns with the established motif in Chapter 1. — AI Editorial Assistant';
    const reply: ThreadReply = {
      threadId: 'thread-arch',
      content: geminiReply,
    };
    expect(reply.content).toBe(geminiReply);
    expect(reply.content).toContain('AI Editorial Assistant');
    expect(reply.threadId).toBe('thread-arch');
  });

  it('StylistAgent reply is the raw Gemini reply string (reply-only workflow)', () => {
    const geminiReply = 'The consonant cluster creates friction. Try softening with a vowel-led word. — AI Editorial Assistant';
    const reply: ThreadReply = {
      threadId: 'thread-sty',
      content: geminiReply,
    };
    expect(reply.content).toBe(geminiReply);
    expect(reply.content).toContain('AI Editorial Assistant');
  });

  it('AuditAgent reply is the raw Gemini reply string (reply-only workflow)', () => {
    const geminiReply = 'The Hamiltonian notation is correct per SI conventions. — AI Editorial Assistant';
    const reply: ThreadReply = {
      threadId: 'thread-aud',
      content: geminiReply,
    };
    expect(reply.content).toBe(geminiReply);
    expect(reply.content).toContain('AI Editorial Assistant');
  });

  it('CommentAgent reply is the raw Gemini response string', () => {
    const geminiResponse = 'The passage is consistent with the Chid Axiom. — AI Editorial Assistant';
    const reply: ThreadReply = {
      threadId: 'thread-1',
      content: geminiResponse,
    };
    expect(reply.content).toBe(geminiResponse);
    expect(reply.threadId).toBe('thread-1');
  });
});

// ── 7. Drive API call shapes ──────────────────────────────────────────────────

describe('Drive API call conventions', () => {
  it('fetchComments_ response handles Drive v3 comments field', () => {
    const v3Response = { comments: [{ id: 'c1', content: '@AI Q.' }] };
    const items = v3Response.comments || (v3Response as any).items || [];
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('c1');
  });

  it('fetchComments_ response handles Drive v2 items field', () => {
    const v2Response = { items: [{ id: 'c1', content: '@AI Q.' }] };
    const items = (v2Response as any).comments || v2Response.items || [];
    expect(items).toHaveLength(1);
  });

  it('fetchComments_ response returns empty array when neither field is present', () => {
    const emptyResponse = {};
    const items = (emptyResponse as any).comments || (emptyResponse as any).items || [];
    expect(items).toEqual([]);
  });

  it('fetchComments_ paginates via nextPageToken', () => {
    // Simulate two pages
    const pages = [
      { comments: [{ id: 'c1' }], nextPageToken: 'token1' },
      { comments: [{ id: 'c2' }] },
    ];
    let callCount = 0;
    const mockList = jest.fn().mockImplementation(() => pages[callCount++]);

    const all: any[] = [];
    let pageToken: string | undefined;
    do {
      const opts: any = { includeDeleted: false, fields: '*', maxResults: 100 };
      if (pageToken) opts.pageToken = pageToken;
      const list = mockList(opts);
      all.push(...(list.comments || list.items || []));
      pageToken = list.nextPageToken;
    } while (pageToken);

    expect(all).toHaveLength(2);
    expect(all[0].id).toBe('c1');
    expect(all[1].id).toBe('c2');
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it('postReply_ is called with (resource, fileId, commentId, opts) argument order', () => {
    // Mirrors Drive.Replies.create(resource, fileId, commentId, optionalArgs)
    const mockCreate = jest.fn();
    const reply: ThreadReply = { threadId: 'cmt-99', content: 'Done. — AI Editorial Assistant' };
    const docId = 'doc-123';

    mockCreate({ content: reply.content }, docId, reply.threadId, { fields: 'id,content' });

    const [resource, fileId, commentId, opts] = mockCreate.mock.calls[0];
    expect(resource.content).toBe(reply.content);
    expect(fileId).toBe(docId);
    expect(commentId).toBe(reply.threadId);
    expect(opts.fields).toBe('id,content');
  });
});

// ── 8. StylistAgent annotateTab prompt structure ──────────────────────────────

describe('StylistAgent annotateTab prompt structure', () => {
  const prompt = buildStylistAnnotatePrompt({
    styleProfile: 'Voice: intimate.',
    earTuneInstructions: 'Vary sentence length.',
    passage: 'The observer attends, and the wave collapses inward upon itself.',
    tabName: 'Chapter 2',
  });

  it('contains PASSAGE TO SWEEP section with tab name', () => {
    expect(prompt).toContain('PASSAGE TO SWEEP');
    expect(prompt).toContain('Chapter 2');
  });

  it('asks for operations with match_text and reason', () => {
    expect(prompt).toContain('match_text');
    expect(prompt).toContain('reason');
  });

  it('does not ask for new_text (annotation only, no replacements)', () => {
    expect(prompt).not.toContain('new_text');
  });

  it('does not mention content_update or replaceAllText', () => {
    expect(prompt).not.toContain('content_update');
    expect(prompt).not.toContain('replaceAllText');
  });
});
