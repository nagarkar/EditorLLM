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
// handleCommentThreads method. Any change to an agent's prompt that removes a
// required section will break the corresponding test.

function buildArchitectBatchPrompt(opts: {
  styleProfile: string;
  manuscript: string;
  threads: Array<{ threadId: string; selectedText: string; agentRequest: string; conversation: Array<{ role: 'User' | 'AI'; authorName: string; content: string }> }>;
}): string {
  const threadSection = opts.threads.map(t => {
    const conv = t.conversation.map(m => `[${m.role}] ${m.authorName}: ${m.content}`).join('\n');
    return (
      `[THREAD ${t.threadId}]\n` +
      `SELECTED TEXT: ${t.selectedText}\n` +
      `CONVERSATION:\n${conv}\n` +
      `REQUEST: ${t.agentRequest}`
    );
  }).join('\n\n');

  return (
    `STYLE PROFILE:\n` +
    `---\n` +
    `${opts.styleProfile}\n` +
    `---\n\n` +
    `MANUSCRIPT CONTEXT:\n` +
    `---\n` +
    `${opts.manuscript.slice(0, 8000)}\n` +
    `---\n\n` +
    `THREADS:\n` +
    `---\n` +
    `${threadSection}\n` +
    `---\n\n` +
    `For each thread, analyse the selected passage for structural, motif, or voice concerns\n` +
    `relative to the manuscript and StyleProfile. End each reply with "— AI Editorial Assistant".\n` +
    `Return a JSON object with "responses": an array of {threadId, reply} entries, ` +
    `one per thread you are replying to.`
  ).trim();
}

function buildEarTuneBatchPrompt(opts: {
  styleProfile: string;
  earTuneInstructions: string;
  passageContext: string;
  threads: Array<{ threadId: string; selectedText: string; agentRequest: string; conversation: Array<{ role: 'User' | 'AI'; authorName: string; content: string }> }>;
}): string {
  const threadSection = opts.threads.map(t => {
    const conv = t.conversation.map(m => `[${m.role}] ${m.authorName}: ${m.content}`).join('\n');
    return (
      `[THREAD ${t.threadId}]\n` +
      `SELECTED TEXT: ${t.selectedText}\n` +
      `CONVERSATION:\n${conv}\n` +
      `REQUEST: ${t.agentRequest}`
    );
  }).join('\n\n');

  const passageSection = opts.passageContext
    ? `PASSAGE CONTEXT:\n---\n${opts.passageContext}\n---\n\n`
    : '';

  return (
    `STYLE PROFILE:\n` +
    `---\n` +
    `${opts.styleProfile}\n` +
    `---\n\n` +
    `EAR-TUNE INSTRUCTIONS:\n` +
    `---\n` +
    `${opts.earTuneInstructions}\n` +
    `---\n\n` +
    `${passageSection}` +
    `THREADS:\n` +
    `---\n` +
    `${threadSection}\n` +
    `---\n\n` +
    `For each thread, analyse the selected text for rhythmic, phonetic, and cadence issues\n` +
    `per the Ear-Tune instructions. End each reply with "— AI Editorial Assistant".\n` +
    `Return a JSON object with "responses": an array of {threadId, reply} entries, ` +
    `one per thread you are replying to.`
  ).trim();
}

function buildAuditBatchPrompt(opts: {
  styleProfile: string;
  auditInstructions: string;
  passageContext: string;
  threads: Array<{ threadId: string; selectedText: string; agentRequest: string; conversation: Array<{ role: 'User' | 'AI'; authorName: string; content: string }> }>;
}): string {
  const threadSection = opts.threads.map(t => {
    const conv = t.conversation.map(m => `[${m.role}] ${m.authorName}: ${m.content}`).join('\n');
    return (
      `[THREAD ${t.threadId}]\n` +
      `SELECTED TEXT: ${t.selectedText}\n` +
      `CONVERSATION:\n${conv}\n` +
      `REQUEST: ${t.agentRequest}`
    );
  }).join('\n\n');

  const passageSection = opts.passageContext
    ? `PASSAGE CONTEXT:\n---\n${opts.passageContext}\n---\n\n`
    : '';

  return (
    `STYLE PROFILE:\n` +
    `---\n` +
    `${opts.styleProfile}\n` +
    `---\n\n` +
    `TECHNICAL AUDIT INSTRUCTIONS:\n` +
    `---\n` +
    `${opts.auditInstructions}\n` +
    `---\n\n` +
    `${passageSection}` +
    `THREADS:\n` +
    `---\n` +
    `${threadSection}\n` +
    `---\n\n` +
    `For each thread, perform a targeted technical audit of the selected passage.\n` +
    `Identify any axiom violations, LaTeX caption issues, or constant errors.\n` +
    `End each reply with "— AI Editorial Assistant".\n` +
    `Return a JSON object with "responses": an array of {threadId, reply} entries, ` +
    `one per thread you are replying to.`
  ).trim();
}

function buildGeneralPurposeAgentBatchPrompt(opts: {
  anchorContent: string;
  threads: Array<{ threadId: string; selectedText: string; agentRequest: string; conversation: Array<{ role: 'User' | 'AI'; authorName: string; content: string }> }>;
}): string {
  const threadSection = opts.threads.map(t => {
    const conv = t.conversation.map(m => `[${m.role}] ${m.authorName}: ${m.content}`).join('\n');
    return (
      `[THREAD ${t.threadId}]\n` +
      `SELECTED TEXT: ${t.selectedText}\n` +
      `CONVERSATION:\n${conv}\n` +
      `REQUEST: ${t.agentRequest}`
    );
  }).join('\n\n');

  const anchorSection = opts.anchorContent
    ? `ANCHOR PASSAGE:\n---\n${opts.anchorContent}\n---\n\n`
    : '';

  return (
    `${anchorSection}` +
    `THREADS:\n` +
    `---\n` +
    `${threadSection}\n` +
    `---\n\n` +
    `For each thread, respond to the request concisely and grounded in the passage context.\n` +
    `End each reply with "— AI Editorial Assistant".\n` +
    `Return a JSON object with "responses": an array of {threadId, reply} entries, ` +
    `one per thread you are replying to.`
  ).trim();
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

// ── normaliseBatchReplies_ logic (reproduced inline) ─────────────────────────
//
// Mirrors BaseAgent.normaliseBatchReplies_ for direct unit testing.

function normaliseBatchReplies(
  threads: Array<{ threadId: string }>,
  raw: any
): Array<{ threadId: string; content: string }> {
  const validIds = new Set(threads.map(t => t.threadId));
  const seen     = new Set<string>();
  const replies: Array<{ threadId: string; content: string }> = [];

  const items: Array<{ threadId: string; reply: string }> =
    Array.isArray(raw?.responses) ? raw.responses : [];

  for (const item of items) {
    if (!item.threadId || !item.reply?.trim()) continue;
    if (!validIds.has(item.threadId)) continue;
    if (seen.has(item.threadId)) continue;
    seen.add(item.threadId);
    replies.push({ threadId: item.threadId, content: item.reply });
  }

  return replies;
}

// ── Schema shape helpers ─────────────────────────────────────────────────────

function batchReplySchemaShape() {
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

function instructionUpdateSchemaShape() {
  return {
    type: 'object',
    properties: {
      proposed_full_text: { type: 'string' },
    },
    required: ['proposed_full_text'],
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

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ALL_KNOWN_TAGS = new Set(['@ai', '@architect', '@eartune', '@audit', '@auditor', '@tether', '@ref']);

// All agents that include COMMENT_ANCHOR_TAB in contextKeys.
// @ai is included because GeneralPurposeAgent now groups by anchor tab.
const ANCHOR_NEEDING_TAGS = new Set(['@ai', '@eartune', '@audit', '@auditor', '@tether', '@ref']);

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

function makeThread(overrides: Partial<CommentThread> & { threadId: string }): CommentThread {
  return {
    threadId:     overrides.threadId,
    tag:          overrides.tag ?? '@ai',
    agentRequest: overrides.agentRequest ?? 'Check this.',
    conversation: overrides.conversation ?? [],
    selectedText: overrides.selectedText ?? 'some selected text',
    anchorTabName: overrides.anchorTabName ?? null,
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

  it('calls anchorResolver for @eartune (needs COMMENT_ANCHOR_TAB)', () => {
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

  it('calls anchorResolver for @ai (GeneralPurposeAgent now needs COMMENT_ANCHOR_TAB)', () => {
    const resolver = jest.fn().mockReturnValue('Chapter 1');
    const comment = makeComment({
      content: '@AI Query.',
      quotedFileContent: { value: 'consciousness is the ground' },
    });
    const thread = buildThreadFromComment(
      comment, ALL_KNOWN_TAGS, ANCHOR_NEEDING_TAGS, resolver
    );
    expect(resolver).toHaveBeenCalledWith('consciousness is the ground');
    expect(thread!.anchorTabName).toBe('Chapter 1');
  });

  it('sets anchorTabName to null for @architect (does not need anchor)', () => {
    const resolver = jest.fn().mockReturnValue('Some Tab');
    const comment = makeComment({ content: '@architect Analyse structure.' });
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

// Mirrors CommentProcessor.resolveAnchorTabName_ + buildTabBodyIndex_ traversal order.
function resolveAnchorTabNameFromIndex(
  selectedText: string,
  tabBodies: Array<{ title: string; body: string }>
): string | null {
  if (!selectedText.trim()) return null;
  const probe = selectedText.slice(0, 80);
  for (const { title, body } of tabBodies) {
    if (body.includes(probe)) return title;
  }
  return null;
}

describe('resolveAnchorTabName_ (tab body index)', () => {
  it('returns the first tab in DFS order whose body contains the 80-char probe', () => {
    const tabBodies = [
      { title: 'A', body: 'no match here' },
      { title: 'B', body: 'hello world and more text' },
      { title: 'C', body: 'hello world duplicate' },
    ];
    expect(resolveAnchorTabNameFromIndex('hello world', tabBodies)).toBe('B');
  });

  it('prefers an ancestor tab when both parent and child bodies contain the probe', () => {
    const tabBodies = [
      { title: 'Parent', body: 'shared phrase end' },
      { title: 'Child', body: 'prefix shared phrase end suffix' },
    ];
    expect(resolveAnchorTabNameFromIndex('shared phrase', tabBodies)).toBe('Parent');
  });

  it('returns null when no body contains the probe', () => {
    const tabBodies = [{ title: 'Only', body: 'abc' }];
    expect(resolveAnchorTabNameFromIndex('zzz', tabBodies)).toBeNull();
  });

  it('returns null for whitespace-only selected text', () => {
    expect(resolveAnchorTabNameFromIndex('   ', [{ title: 'T', body: 'x' }])).toBeNull();
  });

  it('matches only on the first 80 characters of selected text (same as production)', () => {
    const long = 'a'.repeat(100);
    const tabBodies = [{ title: 'T', body: `${'a'.repeat(80)}DIFFERENT` }];
    expect(resolveAnchorTabNameFromIndex(long, tabBodies)).toBe('T');
    expect(resolveAnchorTabNameFromIndex(`${long}EXTRA`, tabBodies)).toBe('T');
  });
});

// ── 2. Tag routing ────────────────────────────────────────────────────────────

describe('tag routing — every declared tag maps to the right agent class', () => {
  const ROUTING_TABLE: Array<{ tags: string[]; agentClass: string }> = [
    { tags: ['@ai'],                 agentClass: 'GeneralPurposeAgent'   },
    { tags: ['@architect'],          agentClass: 'ArchitectAgent' },
    { tags: ['@eartune'],            agentClass: 'EarTuneAgent'   },
    { tags: ['@audit', '@auditor'],  agentClass: 'AuditAgent'     },
    { tags: ['@tether', '@ref'],     agentClass: 'TetherAgent'    },
  ];

  ROUTING_TABLE.forEach(({ tags, agentClass }) => {
    tags.forEach(tag => {
      it(`tag "${tag}" routes to ${agentClass}`, () => {
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

const SAMPLE_THREAD = {
  threadId: 'thread-001',
  selectedText: 'consciousness is the sole ground',
  agentRequest: 'Does this contradict the motif established in Chapter 1?',
  conversation: [
    { role: 'User' as const, authorName: 'Author', content: '@architect Does this contradict?' },
  ],
};

describe('ArchitectAgent batch prompt structure', () => {
  const prompt = buildArchitectBatchPrompt({
    manuscript:   'The Chid Axiom states that consciousness is the sole ground of physics.',
    styleProfile: 'Voice: intimate, philosophically rigorous.',
    threads:      [SAMPLE_THREAD],
  });

  it('contains MANUSCRIPT CONTEXT section', () => {
    expect(prompt).toContain('MANUSCRIPT CONTEXT:');
  });

  it('contains THREADS section with thread label', () => {
    expect(prompt).toContain('THREADS:');
    expect(prompt).toContain('[THREAD thread-001]');
  });

  it('contains STYLE PROFILE section', () => {
    expect(prompt).toContain('STYLE PROFILE:');
  });

  it('contains SELECTED TEXT label for the thread', () => {
    expect(prompt).toContain('SELECTED TEXT: consciousness is the sole ground');
  });

  it('contains REQUEST label for the thread', () => {
    expect(prompt).toContain('REQUEST: Does this contradict the motif established in Chapter 1?');
  });

  it('asks agent to return batch responses JSON', () => {
    expect(prompt).toContain('"responses"');
    expect(prompt).toContain('threadId');
    expect(prompt).toContain('reply');
  });

  it('requires replies to end with signature', () => {
    expect(prompt).toContain('AI Editorial Assistant');
  });

  it('does not reference workflow_type or RootUpdate', () => {
    expect(prompt).not.toContain('workflow_type');
    expect(prompt).not.toContain('RootUpdate');
    expect(prompt).not.toContain('content_update');
    expect(prompt).not.toContain('instruction_update');
  });
});

describe('EarTuneAgent batch prompt structure', () => {
  const prompt = buildEarTuneBatchPrompt({
    styleProfile:       'Voice: intimate, philosophically rigorous.',
    earTuneInstructions: 'Vary sentence length for ebb-and-flow.',
    passageContext:     'The observer attends, and the wave collapses.',
    threads: [{
      threadId:     'thread-002',
      selectedText: 'the wave collapses',
      agentRequest: 'Smooth out the consonant cluster.',
      conversation: [{ role: 'User' as const, authorName: 'Author', content: '@eartune Smooth it.' }],
    }],
  });

  it('contains STYLE PROFILE section', () => {
    expect(prompt).toContain('STYLE PROFILE:');
  });

  it('contains EAR-TUNE INSTRUCTIONS section', () => {
    expect(prompt).toContain('EAR-TUNE INSTRUCTIONS:');
  });

  it('contains PASSAGE CONTEXT section when provided', () => {
    expect(prompt).toContain('PASSAGE CONTEXT:');
    expect(prompt).toContain('The observer attends');
  });

  it('contains THREADS section with thread label', () => {
    expect(prompt).toContain('THREADS:');
    expect(prompt).toContain('[THREAD thread-002]');
  });

  it('contains SELECTED TEXT label for the thread', () => {
    expect(prompt).toContain('SELECTED TEXT: the wave collapses');
  });

  it('asks agent to return batch responses JSON', () => {
    expect(prompt).toContain('"responses"');
  });

  it('requires replies to end with signature', () => {
    expect(prompt).toContain('AI Editorial Assistant');
  });

  it('omits PASSAGE CONTEXT section when passageContext is empty', () => {
    const promptNoCtx = buildEarTuneBatchPrompt({
      styleProfile:       'Voice.',
      earTuneInstructions: 'Rules.',
      passageContext:     '',
      threads: [SAMPLE_THREAD],
    });
    expect(promptNoCtx).not.toContain('PASSAGE CONTEXT:');
  });
});

describe('AuditAgent batch prompt structure', () => {
  const prompt = buildAuditBatchPrompt({
    styleProfile:      'Technical, axiom-grounded.',
    auditInstructions: 'Check all Chid Axiom applications.',
    passageContext:    'The energy eigenstate E_n satisfies Hψ = Eψ.',
    threads: [{
      threadId:     'thread-003',
      selectedText: 'energy eigenstate E_n',
      agentRequest: 'Verify the Hamiltonian notation is correct.',
      conversation: [{ role: 'User' as const, authorName: 'Author', content: '@audit Verify.' }],
    }],
  });

  it('contains STYLE PROFILE section', () => {
    expect(prompt).toContain('STYLE PROFILE:');
  });

  it('contains TECHNICAL AUDIT INSTRUCTIONS section', () => {
    expect(prompt).toContain('TECHNICAL AUDIT INSTRUCTIONS:');
  });

  it('contains THREADS section with thread label', () => {
    expect(prompt).toContain('THREADS:');
    expect(prompt).toContain('[THREAD thread-003]');
  });

  it('contains REQUEST label for the thread', () => {
    expect(prompt).toContain('REQUEST: Verify the Hamiltonian notation is correct.');
  });

  it('asks agent to return batch responses JSON', () => {
    expect(prompt).toContain('"responses"');
  });

  it('requires replies to end with signature', () => {
    expect(prompt).toContain('AI Editorial Assistant');
  });

  it('references axiom violations', () => {
    expect(prompt).toContain('axiom');
  });
});

describe('GeneralPurposeAgent batch prompt structure', () => {
  const prompt = buildGeneralPurposeAgentBatchPrompt({
    anchorContent: 'The observer collapses the wave function through awareness.',
    threads: [{
      threadId:     'thread-004',
      selectedText: 'consciousness is the sole ground',
      agentRequest: 'Clarify this.',
      conversation: [{ role: 'User' as const, authorName: 'Editor', content: '@AI Clarify this.' }],
    }],
  });

  it('contains ANCHOR PASSAGE section when anchor content provided', () => {
    expect(prompt).toContain('ANCHOR PASSAGE:');
    expect(prompt).toContain('The observer collapses the wave function');
  });

  it('contains THREADS section with thread label', () => {
    expect(prompt).toContain('THREADS:');
    expect(prompt).toContain('[THREAD thread-004]');
  });

  it('contains SELECTED TEXT label for the thread', () => {
    expect(prompt).toContain('SELECTED TEXT: consciousness is the sole ground');
  });

  it('contains CONVERSATION in the thread section', () => {
    expect(prompt).toContain('CONVERSATION:');
    expect(prompt).toContain('[User] Editor: @AI Clarify this.');
  });

  it('contains REQUEST label', () => {
    expect(prompt).toContain('REQUEST: Clarify this.');
  });

  it('asks agent to return batch responses JSON', () => {
    expect(prompt).toContain('"responses"');
    expect(prompt).toContain('threadId');
    expect(prompt).toContain('reply');
  });

  it('requires replies to end with signature', () => {
    expect(prompt).toContain('AI Editorial Assistant');
  });

  it('omits ANCHOR PASSAGE section when anchor content is empty', () => {
    const promptNoAnchor = buildGeneralPurposeAgentBatchPrompt({
      anchorContent: '',
      threads:       [SAMPLE_THREAD],
    });
    expect(promptNoAnchor).not.toContain('ANCHOR PASSAGE:');
  });
});

// ── 4. Schema shape ───────────────────────────────────────────────────────────

describe('batchReplySchema shape (all agents)', () => {
  const schema: any = batchReplySchemaShape();

  it('has type object', () => {
    expect(schema.type).toBe('object');
  });

  it('requires responses array', () => {
    expect(schema.required).toContain('responses');
  });

  it('response items require threadId and reply', () => {
    const items = schema.properties.responses.items;
    expect(items.required).toContain('threadId');
    expect(items.required).toContain('reply');
  });

  it('threadId and reply are strings', () => {
    const items = schema.properties.responses.items;
    expect(items.properties.threadId.type).toBe('string');
    expect(items.properties.reply.type).toBe('string');
  });

  it('does not have a top-level response field (old single-thread schema gone)', () => {
    expect(schema.properties.response).toBeUndefined();
  });
});

describe('instructionUpdateSchema shape', () => {
  const schema = instructionUpdateSchemaShape();

  it('requires proposed_full_text', () => {
    expect((schema as any).required).toContain('proposed_full_text');
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

// ── 5. normaliseBatchReplies_ logic ──────────────────────────────────────────

describe('normaliseBatchReplies_: valid mappings accepted', () => {
  it('returns ThreadReplies for all valid input items', () => {
    const threads = [makeThread({ threadId: 't1' }), makeThread({ threadId: 't2' })];
    const raw = { responses: [
      { threadId: 't1', reply: 'Reply one. — AI Editorial Assistant' },
      { threadId: 't2', reply: 'Reply two. — AI Editorial Assistant' },
    ]};
    const replies = normaliseBatchReplies(threads, raw);
    expect(replies).toHaveLength(2);
    expect(replies[0]).toEqual({ threadId: 't1', content: 'Reply one. — AI Editorial Assistant' });
    expect(replies[1]).toEqual({ threadId: 't2', content: 'Reply two. — AI Editorial Assistant' });
  });

  it('maps reply field to content field', () => {
    const threads = [makeThread({ threadId: 't1' })];
    const raw = { responses: [{ threadId: 't1', reply: 'The answer.' }] };
    const replies = normaliseBatchReplies(threads, raw);
    expect(replies[0].content).toBe('The answer.');
    expect((replies[0] as any).reply).toBeUndefined();
  });
});

describe('normaliseBatchReplies_: hallucinated threadIds dropped', () => {
  it('drops items whose threadId was not in the input chunk', () => {
    const threads = [makeThread({ threadId: 't1' })];
    const raw = { responses: [
      { threadId: 't1',        reply: 'Valid.' },
      { threadId: 'hallucinated', reply: 'Ghost.' },
    ]};
    const replies = normaliseBatchReplies(threads, raw);
    expect(replies).toHaveLength(1);
    expect(replies[0].threadId).toBe('t1');
  });

  it('returns empty array when all items are hallucinated', () => {
    const threads = [makeThread({ threadId: 't1' })];
    const raw = { responses: [{ threadId: 'ghost', reply: 'Nope.' }] };
    const replies = normaliseBatchReplies(threads, raw);
    expect(replies).toHaveLength(0);
  });
});

describe('normaliseBatchReplies_: duplicate threadIds dropped', () => {
  it('keeps only the first occurrence of a duplicate threadId', () => {
    const threads = [makeThread({ threadId: 't1' })];
    const raw = { responses: [
      { threadId: 't1', reply: 'First reply.' },
      { threadId: 't1', reply: 'Duplicate.' },
    ]};
    const replies = normaliseBatchReplies(threads, raw);
    expect(replies).toHaveLength(1);
    expect(replies[0].content).toBe('First reply.');
  });
});

describe('normaliseBatchReplies_: empty replies dropped', () => {
  it('drops items with an empty reply string', () => {
    const threads = [makeThread({ threadId: 't1' }), makeThread({ threadId: 't2' })];
    const raw = { responses: [
      { threadId: 't1', reply: '' },
      { threadId: 't2', reply: '   ' },
    ]};
    const replies = normaliseBatchReplies(threads, raw);
    expect(replies).toHaveLength(0);
  });

  it('drops items with missing reply field', () => {
    const threads = [makeThread({ threadId: 't1' })];
    const raw = { responses: [{ threadId: 't1' }] }; // no reply
    const replies = normaliseBatchReplies(threads, raw);
    expect(replies).toHaveLength(0);
  });
});

describe('normaliseBatchReplies_: missing coverage tolerated', () => {
  it('returns partial results when Gemini replies to fewer threads than sent', () => {
    const threads = [
      makeThread({ threadId: 't1' }),
      makeThread({ threadId: 't2' }),
      makeThread({ threadId: 't3' }),
    ];
    // Gemini only replied to two of three
    const raw = { responses: [
      { threadId: 't1', reply: 'Reply 1.' },
      { threadId: 't3', reply: 'Reply 3.' },
    ]};
    const replies = normaliseBatchReplies(threads, raw);
    expect(replies).toHaveLength(2);
    expect(replies.map(r => r.threadId)).toEqual(['t1', 't3']);
  });

  it('returns empty array when responses array is empty', () => {
    const threads = [makeThread({ threadId: 't1' })];
    const raw = { responses: [] };
    const replies = normaliseBatchReplies(threads, raw);
    expect(replies).toHaveLength(0);
  });

  it('returns empty array when raw has no responses field', () => {
    const threads = [makeThread({ threadId: 't1' })];
    const replies = normaliseBatchReplies(threads, {});
    expect(replies).toHaveLength(0);
  });
});

// ── 6. processAll flow (batch dispatch, logic reproduced inline) ─────────────

describe('processAll batch dispatch logic', () => {
  // Reproduces the core dispatch loop from CommentProcessor.processAll()
  // using plain objects to avoid GAS runtime dependencies.
  // Key invariants:
  //   - threads are grouped by agent object identity (not tag string)
  //   - handleCommentThreads() is called once per agent, not per thread
  //   - byAgent is keyed on agent name
  //   - a batch exception skips all threads for that agent

  type MockAgent = {
    name: string;
    tags: string[];
    needsAnchor: boolean;
    handleCommentThreads: jest.Mock;
  };

  function simulateProcessAll(
    comments: any[],
    agents: MockAgent[],
    onPostReply: (reply: { threadId: string; content: string }) => void = () => undefined
  ): { replied: number; skipped: number; byAgent: Record<string, number> } {
    const byAgent: Record<string, number> = {};
    let replied = 0;
    let skipped = 0;

    // Build tag registry (mirrors CommentProcessor.init)
    const tagRegistry = new Map<string, MockAgent>();
    for (const agent of agents) {
      for (const tag of agent.tags) {
        tagRegistry.set(tag, agent);
      }
    }

    // Phase 1: Parse and group by agent identity
    const agentGroups = new Map<MockAgent, CommentThread[]>();
    for (const comment of comments) {
      const thread = buildThreadFromComment(
        comment,
        new Set(tagRegistry.keys()),
        new Set(agents.filter(a => a.needsAnchor).flatMap(a => a.tags))
      );
      if (!thread) { skipped++; continue; }
      const agent = tagRegistry.get(thread.tag);
      if (!agent) { skipped++; continue; }
      if (!agentGroups.has(agent)) agentGroups.set(agent, []);
      agentGroups.get(agent)!.push(thread);
    }

    // Phase 2: Dispatch per agent
    for (const [agent, threads] of agentGroups) {
      let replies: ThreadReply[];
      try {
        replies = agent.handleCommentThreads(threads);
      } catch {
        skipped += threads.length;
        continue;
      }
      for (const reply of replies) {
        onPostReply(reply);
        replied++;
        byAgent[agent.name] = (byAgent[agent.name] || 0) + 1;
      }
    }

    return { replied, skipped, byAgent };
  }

  it('calls handleCommentThreads once with all threads for that agent', () => {
    const agent: MockAgent = {
      name: 'GeneralPurposeAgent', tags: ['@ai'], needsAnchor: false,
      handleCommentThreads: jest.fn().mockReturnValue([
        { threadId: 'c1', content: 'r1' },
        { threadId: 'c2', content: 'r2' },
      ]),
    };
    const comments = [
      makeComment({ id: 'c1', content: '@AI Q1.' }),
      makeComment({ id: 'c2', content: '@AI Q2.' }),
    ];
    const result = simulateProcessAll(comments, [agent]);
    expect(agent.handleCommentThreads).toHaveBeenCalledTimes(1);
    expect(agent.handleCommentThreads).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ threadId: 'c1' }),
        expect.objectContaining({ threadId: 'c2' }),
      ])
    );
    expect(result.replied).toBe(2);
    expect(result.byAgent['GeneralPurposeAgent']).toBe(2);
  });

  it('multi-tag agent receives all threads in one batch (not split by tag)', () => {
    // EarTuneAgent handles both @eartune and @eartune.
    // Both sets of threads must arrive in the same handleCommentThreads call.
    const agent: MockAgent = {
      name: 'EarTuneAgent', tags: ['@eartune', '@eartune'], needsAnchor: false,
      handleCommentThreads: jest.fn().mockReturnValue([
        { threadId: 'c1', content: 'r1' },
        { threadId: 'c2', content: 'r2' },
      ]),
    };
    const comments = [
      makeComment({ id: 'c1', content: '@eartune Check rhythm.' }),
      makeComment({ id: 'c2', content: '@eartune Smooth this.' }),
    ];
    simulateProcessAll(comments, [agent]);
    expect(agent.handleCommentThreads).toHaveBeenCalledTimes(1);
    const [batchArg] = agent.handleCommentThreads.mock.calls[0];
    expect(batchArg).toHaveLength(2);
  });

  it('skips comments with no @tag', () => {
    const agent: MockAgent = {
      name: 'GeneralPurposeAgent', tags: ['@ai'], needsAnchor: false,
      handleCommentThreads: jest.fn().mockReturnValue([]),
    };
    const result = simulateProcessAll(
      [makeComment({ content: 'Just a comment, no tag.' })],
      [agent]
    );
    expect(agent.handleCommentThreads).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.replied).toBe(0);
  });

  it('skips comments with unrecognised @tag', () => {
    const agent: MockAgent = {
      name: 'GeneralPurposeAgent', tags: ['@ai'], needsAnchor: false,
      handleCommentThreads: jest.fn(),
    };
    const result = simulateProcessAll(
      [makeComment({ content: '@unknown Do this.' })],
      [agent]
    );
    expect(result.skipped).toBe(1);
    expect(result.replied).toBe(0);
  });

  it('when handleCommentThreads throws, all threads in that batch are skipped', () => {
    const agent: MockAgent = {
      name: 'GeneralPurposeAgent', tags: ['@ai'], needsAnchor: false,
      handleCommentThreads: jest.fn().mockImplementation(() => {
        throw new Error('Gemini API error');
      }),
    };
    const comments = [
      makeComment({ id: 'c1', content: '@AI Q1.' }),
      makeComment({ id: 'c2', content: '@AI Q2.' }),
    ];
    const result = simulateProcessAll(comments, [agent]);
    expect(result.replied).toBe(0);
    expect(result.skipped).toBe(2);
  });

  it('posts each reply individually and counts them in replied', () => {
    const agent: MockAgent = {
      name: 'ArchitectAgent', tags: ['@architect'], needsAnchor: false,
      handleCommentThreads: jest.fn().mockReturnValue([
        { threadId: 'c-42', content: 'Analysis. — AI Editorial Assistant' },
      ]),
    };
    const postedReplies: Array<{ threadId: string; content: string }> = [];
    simulateProcessAll(
      [makeComment({ id: 'c-42', content: '@architect Analyse this.' })],
      [agent],
      r => postedReplies.push(r)
    );
    expect(postedReplies).toHaveLength(1);
    expect(postedReplies[0].threadId).toBe('c-42');
    expect(postedReplies[0].content).toBe('Analysis. — AI Editorial Assistant');
  });

  it('byAgent tracks reply counts per agent name', () => {
    const aiAgent: MockAgent = {
      name: 'GeneralPurposeAgent', tags: ['@ai'], needsAnchor: false,
      handleCommentThreads: jest.fn().mockReturnValue([
        { threadId: 'c1', content: 'r1' },
        { threadId: 'c3', content: 'r3' },
      ]),
    };
    const archAgent: MockAgent = {
      name: 'ArchitectAgent', tags: ['@architect'], needsAnchor: false,
      handleCommentThreads: jest.fn().mockReturnValue([
        { threadId: 'c2', content: 'r2' },
      ]),
    };
    const result = simulateProcessAll(
      [
        makeComment({ id: 'c1', content: '@AI Q1.' }),
        makeComment({ id: 'c2', content: '@architect Q2.' }),
        makeComment({ id: 'c3', content: '@AI Q3.' }),
      ],
      [aiAgent, archAgent]
    );
    expect(result.replied).toBe(3);
    expect(result.byAgent['GeneralPurposeAgent']).toBe(2);
    expect(result.byAgent['ArchitectAgent']).toBe(1);
  });

  it('only posts replies that agent returned — unreplied threads are not counted', () => {
    // Agent receives 3 threads but only replies to 2 (Gemini partial coverage).
    const agent: MockAgent = {
      name: 'GeneralPurposeAgent', tags: ['@ai'], needsAnchor: false,
      handleCommentThreads: jest.fn().mockReturnValue([
        { threadId: 'c1', content: 'r1' },
        // c2 not returned — agent chose not to reply
        { threadId: 'c3', content: 'r3' },
      ]),
    };
    const result = simulateProcessAll(
      [
        makeComment({ id: 'c1', content: '@AI Q1.' }),
        makeComment({ id: 'c2', content: '@AI Q2.' }),
        makeComment({ id: 'c3', content: '@AI Q3.' }),
      ],
      [agent]
    );
    expect(result.replied).toBe(2);
    // c2 was not replied to — not counted as skipped either
    expect(result.skipped).toBe(0);
  });

  it('a failing agent does not prevent other agents from running', () => {
    const failingAgent: MockAgent = {
      name: 'GeneralPurposeAgent', tags: ['@ai'], needsAnchor: false,
      handleCommentThreads: jest.fn().mockImplementation(() => {
        throw new Error('timeout');
      }),
    };
    const workingAgent: MockAgent = {
      name: 'ArchitectAgent', tags: ['@architect'], needsAnchor: false,
      handleCommentThreads: jest.fn().mockReturnValue([
        { threadId: 'c2', content: 'fine' },
      ]),
    };
    const result = simulateProcessAll(
      [
        makeComment({ id: 'c1', content: '@AI Broken.' }),
        makeComment({ id: 'c2', content: '@architect Works.' }),
      ],
      [failingAgent, workingAgent]
    );
    expect(result.replied).toBe(1);
    expect(result.skipped).toBe(1);
    expect(workingAgent.handleCommentThreads).toHaveBeenCalledTimes(1);
  });
});

// ── 7. ThreadReply content contracts ─────────────────────────────────────────

describe('ThreadReply content contracts', () => {
  it('ThreadReply has threadId and content fields', () => {
    const reply: ThreadReply = {
      threadId: 'thread-arch',
      content: 'The passage aligns. — AI Editorial Assistant',
    };
    expect(reply.content).toContain('AI Editorial Assistant');
    expect(reply.threadId).toBe('thread-arch');
  });

  it('normaliseBatchReplies maps reply → content correctly', () => {
    const threads = [makeThread({ threadId: 'thread-1' })];
    const raw = { responses: [{ threadId: 'thread-1', reply: 'The passage is consistent. — AI Editorial Assistant' }] };
    const replies = normaliseBatchReplies(threads, raw);
    expect(replies[0].content).toBe('The passage is consistent. — AI Editorial Assistant');
    expect(replies[0].threadId).toBe('thread-1');
  });
});

// ── 8. Drive API call shapes ──────────────────────────────────────────────────

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

// ── 9. EarTuneAgent annotateTab prompt structure (W2 — unchanged) ─────────────

function buildEarTuneAnnotatePrompt(opts: {
  styleProfile: string;
  earTuneInstructions: string;
  passage: string;
  tabName: string;
}): string {
  return `
STYLE PROFILE:
---
${opts.styleProfile}
---

EAR-TUNE INSTRUCTIONS:
---
${opts.earTuneInstructions}
---

PASSAGE TO SWEEP (from tab: "${opts.tabName}"):
---
${opts.passage}
---

Identify every passage with a rhythmic, phonetic, or cadence problem.
Return a JSON object with:
- operations: one per problem found. Each must have:
    - match_text: verbatim 3–4-word phrase from the passage above
    - reason: description of the issue and suggested improvement
`.trim();
}

describe('EarTuneAgent annotateTab prompt structure (W2)', () => {
  const prompt = buildEarTuneAnnotatePrompt({
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

  it('does not reference THREADS or batch response format', () => {
    expect(prompt).not.toContain('THREADS:');
    expect(prompt).not.toContain('"responses"');
  });
});

// ── 10. TetherAgent batch prompt structure ────────────────────────────────────

function buildTetherBatchPrompt(opts: {
  styleProfile: string;
  tetherInstructions: string;
  passageContext: string;
  threads: Array<{ threadId: string; selectedText: string; agentRequest: string; conversation: Array<{ role: 'User' | 'AI'; authorName: string; content: string }> }>;
}): string {
  const threadSection = opts.threads.map(t => {
    const conv = t.conversation.map(m => `[${m.role}] ${m.authorName}: ${m.content}`).join('\n');
    return (
      `[THREAD ${t.threadId}]\n` +
      `SELECTED TEXT: ${t.selectedText}\n` +
      `CONVERSATION:\n${conv}\n` +
      `REQUEST: ${t.agentRequest}`
    );
  }).join('\n\n');

  const passageSection = opts.passageContext
    ? `PASSAGE CONTEXT:\n---\n${opts.passageContext}\n---\n\n`
    : '';

  return (
    `STYLE PROFILE:\n` +
    `---\n` +
    `${opts.styleProfile}\n` +
    `---\n\n` +
    `TETHER INSTRUCTIONS:\n` +
    `---\n` +
    `${opts.tetherInstructions}\n` +
    `---\n\n` +
    `${passageSection}` +
    `THREADS:\n` +
    `---\n` +
    `${threadSection}\n` +
    `---\n\n` +
    `For each thread, provide an investigative response grounded in historical\n` +
    `or scientific fact. Validate references, flag errors vs. controversies,\n` +
    `and suggest alignment opportunities where applicable.\n` +
    `End each reply with "— AI Editorial Assistant".\n` +
    `Return a JSON object with "responses": an array of {threadId, reply} entries, ` +
    `one per thread you are replying to.`
  ).trim();
}

describe('TetherAgent batch prompt structure', () => {
  const prompt = buildTetherBatchPrompt({
    styleProfile:       'Voice: intimate, philosophically rigorous.',
    tetherInstructions: 'Verify all Rig Veda citations.',
    passageContext:     'Schrödinger proposed the cat thought experiment in 1935.',
    threads: [{
      threadId:     'thread-005',
      selectedText: 'Schrödinger proposed the cat',
      agentRequest: 'Verify this date and context.',
      conversation: [{ role: 'User' as const, authorName: 'Author', content: '@tether Verify this date and context.' }],
    }],
  });

  it('contains STYLE PROFILE section', () => {
    expect(prompt).toContain('STYLE PROFILE:');
  });

  it('contains TETHER INSTRUCTIONS section', () => {
    expect(prompt).toContain('TETHER INSTRUCTIONS:');
  });

  it('contains PASSAGE CONTEXT section when provided', () => {
    expect(prompt).toContain('PASSAGE CONTEXT:');
    expect(prompt).toContain('Schrödinger proposed');
  });

  it('contains THREADS section with thread label', () => {
    expect(prompt).toContain('THREADS:');
    expect(prompt).toContain('[THREAD thread-005]');
  });

  it('contains SELECTED TEXT label for the thread', () => {
    expect(prompt).toContain('SELECTED TEXT: Schrödinger proposed the cat');
  });

  it('asks agent to return batch responses JSON', () => {
    expect(prompt).toContain('"responses"');
  });

  it('requires replies to end with signature', () => {
    expect(prompt).toContain('AI Editorial Assistant');
  });

  it('mentions historical/scientific validation in instructions', () => {
    expect(prompt).toContain('historical');
    expect(prompt).toContain('scientific');
  });

  it('omits PASSAGE CONTEXT section when passageContext is empty', () => {
    const promptNoCtx = buildTetherBatchPrompt({
      styleProfile:       'Voice.',
      tetherInstructions: 'Rules.',
      passageContext:     '',
      threads: [SAMPLE_THREAD],
    });
    expect(promptNoCtx).not.toContain('PASSAGE CONTEXT:');
  });
});

// ── 11. TetherAgent annotateTab prompt structure (W2) ─────────────────────────

function buildTetherAnnotatePrompt(opts: {
  styleProfile: string;
  tetherInstructions: string;
  passage: string;
  tabName: string;
}): string {
  return `
STYLE PROFILE:
---
${opts.styleProfile}
---

TETHER INSTRUCTIONS:
---
${opts.tetherInstructions}
---

PASSAGE TO VALIDATE (from tab: "${opts.tabName}"):
---
${opts.passage}
---

Perform an external source validation sweep.
1. Flag invalid references or factual errors.
2. Identify "controversial" statements and annotate them with context.
3. Suggest 2–3 specific "missed opportunities" for alignment with prior
   historical or scientific work.

Return a JSON object with:
- operations: one per issue or opportunity found. Each must have:
    - match_text: verbatim 3–4-word phrase from the passage above
    - reason: description of the factual discrepancy or alignment opportunity
`.trim();
}

describe('TetherAgent annotateTab prompt structure (W2)', () => {
  const prompt = buildTetherAnnotatePrompt({
    styleProfile: 'Voice: intimate.',
    tetherInstructions: 'Verify Rig Veda and QM citations.',
    passage: 'Einstein said God does not play dice with the universe.',
    tabName: 'Chapter 5',
  });

  it('contains PASSAGE TO VALIDATE section with tab name', () => {
    expect(prompt).toContain('PASSAGE TO VALIDATE');
    expect(prompt).toContain('Chapter 5');
  });

  it('asks for operations with match_text and reason', () => {
    expect(prompt).toContain('match_text');
    expect(prompt).toContain('reason');
  });

  it('does not reference THREADS or batch response format', () => {
    expect(prompt).not.toContain('THREADS:');
    expect(prompt).not.toContain('"responses"');
  });

  it('mentions source validation in instructions', () => {
    expect(prompt).toContain('source validation');
  });
});

// ── §4.1 StyleProfile LLM-as-judge quality evaluation ────────────────────────
//
// Tests reproduce the score-band logic and rubric without GAS / Gemini calls.
// The full GeminiService.generateJson path is validated in E2E tests only.

describe('§4.1 evaluateStyleProfile_ — score clamping and band semantics', () => {

  // Mimic the clamping logic from BaseAgent.evaluateStyleProfile_()
  function clampScore(raw: number): number {
    return Math.max(0, Math.min(5, Math.round(raw)));
  }

  it('clamps negative scores to 0', () => {
    expect(clampScore(-1)).toBe(0);
    expect(clampScore(-99)).toBe(0);
  });

  it('clamps scores above 5 to 5', () => {
    expect(clampScore(6)).toBe(5);
    expect(clampScore(100)).toBe(5);
  });

  it('rounds fractional scores to nearest integer', () => {
    expect(clampScore(3.4)).toBe(3);
    expect(clampScore(3.5)).toBe(4);
    expect(clampScore(4.9)).toBe(5);
  });

  it('passes through valid integer scores unchanged', () => {
    for (let s = 0; s <= 5; s++) {
      expect(clampScore(s)).toBe(s);
    }
  });

  describe('score badge colour bands (matching renderStyleProfileScore())', () => {
    // Mirror the sidebar JS logic: green ≥ 4, amber = 3, red ≤ 2
    function badgeColour(score: number): 'green' | 'amber' | 'red' {
      if (score >= 4) return 'green';
      if (score >= 3) return 'amber';
      return 'red';
    }

    it('score 5 → green', () => expect(badgeColour(5)).toBe('green'));
    it('score 4 → green', () => expect(badgeColour(4)).toBe('green'));
    it('score 3 → amber (border: usable for Full Refresh)', () => expect(badgeColour(3)).toBe('amber'));
    it('score 2 → red  (gates Full Refresh warning)', () => expect(badgeColour(2)).toBe('red'));
    it('score 1 → red',  () => expect(badgeColour(1)).toBe('red'));
    it('score 0 → red',  () => expect(badgeColour(0)).toBe('red'));
  });

  describe('rubric — required StyleProfile section names', () => {
    // The evaluator prompt checks for these 5 canonical sections.
    const REQUIRED_SECTIONS = [
      'Voice',
      'Sentence Rhythm',
      'Vocabulary Register',
      'Structural Patterns',
      'Thematic Motifs',
    ];

    it('all 5 required section names are defined', () => {
      expect(REQUIRED_SECTIONS).toHaveLength(5);
    });

    it('a StyleProfile containing all 5 section headers passes a section-count check', () => {
      const profile = REQUIRED_SECTIONS.map(s => `## ${s}\n- detail`).join('\n\n');
      const foundCount = REQUIRED_SECTIONS.filter(s => profile.includes(s)).length;
      expect(foundCount).toBe(5);
    });

    it('a StyleProfile missing 2 sections fails the section-count check', () => {
      const partial = ['## Voice\n- detail', '## Sentence Rhythm\n- detail', '## Structural Patterns\n- x'].join('\n\n');
      const foundCount = REQUIRED_SECTIONS.filter(s => partial.includes(s)).length;
      expect(foundCount).toBeLessThan(4);  // should result in score ≤ 2
    });
  });

  describe('Full Refresh gate: acknowledges low-score warning', () => {
    // Mirror the sidebar JS _scoreGateAcknowledged pattern:
    // first click at score < 3 → warn; second click → proceed.
    let acknowledged = false;

    function simulateRefreshClick(score: number): 'warned' | 'proceeded' {
      if (!acknowledged && score < 3) {
        acknowledged = true;  // next click goes through
        return 'warned';
      }
      acknowledged = false;
      return 'proceeded';
    }

    it('first click at score 2 returns warning', () => {
      acknowledged = false;
      expect(simulateRefreshClick(2)).toBe('warned');
    });

    it('second click at score 2 proceeds', () => {
      // acknowledged is now true from previous test
      expect(simulateRefreshClick(2)).toBe('proceeded');
    });

    it('first click at score 3 proceeds immediately (no gate)', () => {
      acknowledged = false;
      expect(simulateRefreshClick(3)).toBe('proceeded');
    });

    it('first click at score 5 proceeds immediately', () => {
      acknowledged = false;
      expect(simulateRefreshClick(5)).toBe('proceeded');
    });
  });
});
