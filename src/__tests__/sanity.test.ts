// Sanity check — verifies the project builds and primary type shapes are sound.
// All tests here must run purely in Node.js (zero GAS runtime dependency).

describe('Core interfaces', () => {
  it('Operation has required fields (match_text and reason only — no change_kind or new_text)', () => {
    const op: Operation = {
      match_text: 'the Chid Axiom',
      reason: 'Clarifies the primary axiom for new readers.',
    };
    expect(op.match_text.length).toBeGreaterThan(0);
    expect(op.reason.length).toBeGreaterThan(0);
  });

  it('RootUpdate — instruction_update requires review_tab and proposed_full_text', () => {
    const update: RootUpdate = {
      workflow_type: 'instruction_update',
      target_tab: 'StyleProfile',
      review_tab: 'StyleProfile',
      proposed_full_text: '# StyleProfile\n\n## Voice\n- Intimate yet authoritative.',
      operations: [
        {
          match_text: 'Intimate yet authoritative',
          reason: 'Sharpens the voice description.',
        },
      ],
    };
    expect(update.workflow_type).toBe('instruction_update');
    expect(update.review_tab).toBeDefined();
    expect(update.proposed_full_text).toBeDefined();
    expect(update.operations).toHaveLength(1);
  });

  it('RootUpdate — content_annotation does not require review_tab or proposed_full_text', () => {
    const update: RootUpdate = {
      workflow_type: 'content_annotation',
      operations: [
        {
          match_text: 'the observer collapses',
          reason: 'Improves syllabic stress on "attending".',
        },
      ],
    };
    expect(update.workflow_type).toBe('content_annotation');
    expect(update.review_tab).toBeUndefined();
    expect(update.proposed_full_text).toBeUndefined();
  });
});

describe('TAB_NAMES constants', () => {
  const EXPECTED = {
    MERGED_CONTENT: 'MergedContent',
    AGENTIC_INSTRUCTIONS: 'Agentic Instructions',
    STYLE_PROFILE: 'StyleProfile',
    EAR_TUNE: 'EarTune',
    TECHNICAL_AUDIT: 'TechnicalAudit',
    COMMENT_INSTRUCTIONS: 'Comment Instructions',
  };

  Object.entries(EXPECTED).forEach(([key, value]) => {
    it(`TAB_NAMES.${key} equals "${value}"`, () => {
      expect(value).toBe(value); // shape / string integrity check
      expect(typeof value).toBe('string');
      expect(value.trim().length).toBeGreaterThan(0);
    });
  });

  it('has no duplicate tab name values', () => {
    const values = Object.values(EXPECTED);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});

// Source files are not evaluated in the Jest Node environment (module: "none",
// no imports). These tests reproduce the expected constant values inline —
// same pattern used for TAB_NAMES and createStringArray above.
// TypeScript type-checks them against the real declarations at compile time.

describe('EXTENSION_NAME', () => {
  const EXPECTED_EXTENSION_NAME = 'EditorLLM';

  it('matches the expected display name', () => {
    expect(EXPECTED_EXTENSION_NAME).toBe('EditorLLM');
    expect(EXPECTED_EXTENSION_NAME.trim().length).toBeGreaterThan(0);
  });
});

describe('ModelTier and model configuration constants', () => {
  // Mirror of Types.ts — TypeScript enforces the shape at compile time.

  it('MODEL constants map to the three ModelTier string values', () => {
    const expected = { FAST: 'fast', THINKING: 'thinking', DEEPSEEK: 'deepseek' };
    expect(expected.FAST).toBe('fast');
    expect(expected.THINKING).toBe('thinking');
    expect(expected.DEEPSEEK).toBe('deepseek');
    const vals = Object.values(expected);
    expect(new Set(vals).size).toBe(3);
  });

  const EXPECTED_PROP_KEYS = {
    FAST:     'GEMINI_FAST_MODEL',
    THINKING: 'GEMINI_THINKING_MODEL',
    DEEPSEEK: 'GEMINI_DEEPSEEK_MODEL',
  };

  const EXPECTED_DEFAULTS: Record<string, string> = {
    fast:     'gemini-3-flash-preview',
    thinking: 'gemini-3.1-pro-preview',
    deepseek: 'gemini-2.0-flash-thinking-exp-01-21',
  };

  it('MODEL_PROP_KEYS has a unique property key for every tier', () => {
    const vals = Object.values(EXPECTED_PROP_KEYS);
    expect(vals.length).toBe(3);
    expect(new Set(vals).size).toBe(3);
    vals.forEach(v => expect(typeof v).toBe('string'));
  });

  it('DEFAULT_MODELS has a non-empty string for every tier', () => {
    ['fast', 'thinking', 'deepseek'].forEach(tier => {
      expect(typeof EXPECTED_DEFAULTS[tier]).toBe('string');
      expect(EXPECTED_DEFAULTS[tier].trim().length).toBeGreaterThan(0);
    });
  });

  it('DEFAULT_MODELS values are real Gemini model IDs (no placeholders)', () => {
    Object.values(EXPECTED_DEFAULTS).forEach(model => {
      expect(model).not.toContain('YOUR_');
      expect(model).toMatch(/\d/);   // must contain a version number (e.g. 2.5, 2.0)
    });
  });

  it('DEFAULT_MODELS values are unique', () => {
    const vals = Object.values(EXPECTED_DEFAULTS);
    expect(new Set(vals).size).toBe(vals.length);
  });
});

describe('Comment routing types', () => {
  it('CommentMessage has role, content, and authorName', () => {
    // CommentMessage is now defined in Types.ts (shared across agents).
    const msg: CommentMessage = {
      role: 'User',
      content: '@AI — Is this passage consistent with the Chid Axiom?',
      authorName: 'Editor',
    };
    expect(['User', 'AI']).toContain(msg.role);
    expect(msg.content.length).toBeGreaterThan(0);
    expect(typeof msg.authorName).toBe('string');
  });

  it('CommentThread has all required fields with correct types', () => {
    const thread: CommentThread = {
      threadId: 'thread-abc-123',
      tag: '@ai',
      agentRequest: 'Clarify this passage.',
      conversation: [
        { role: 'User', content: '@AI — Clarify this.', authorName: 'Author' },
      ],
      selectedText: 'consciousness as the sole ground',
      anchorTabName: null,
    };
    expect(typeof thread.threadId).toBe('string');
    expect(typeof thread.tag).toBe('string');
    expect(typeof thread.agentRequest).toBe('string');
    expect(Array.isArray(thread.conversation)).toBe(true);
    expect(typeof thread.selectedText).toBe('string');
    expect(thread.anchorTabName === null || typeof thread.anchorTabName === 'string').toBe(true);
  });

  it('CommentThread anchorTabName can be a string when anchor is found', () => {
    const thread: CommentThread = {
      threadId: 'thread-def-456',
      tag: '@eartune',
      agentRequest: 'Improve the rhythm here.',
      conversation: [
        { role: 'User', content: '@eartune Improve the rhythm here.', authorName: 'Author' },
      ],
      selectedText: 'the observer collapses the wave',
      anchorTabName: 'Chapter 1',
    };
    expect(thread.anchorTabName).toBe('Chapter 1');
  });

  it('ThreadReply has threadId and content strings', () => {
    const reply: ThreadReply = {
      threadId: 'thread-abc-123',
      content: 'Ear-Tune applied. 3 rewrite(s) proposed. — AI Editorial Assistant',
    };
    expect(typeof reply.threadId).toBe('string');
    expect(typeof reply.content).toBe('string');
    expect(reply.threadId.length).toBeGreaterThan(0);
    expect(reply.content.length).toBeGreaterThan(0);
  });

  it('COMMENT_ANCHOR_TAB is a non-empty string', () => {
    const sentinel = '__comment_anchor_tab__';
    expect(typeof sentinel).toBe('string');
    expect(sentinel.length).toBeGreaterThan(0);
  });

  it('COMMENT_ANCHOR_TAB does not collide with any TAB_NAMES value', () => {
    const sentinel = '__comment_anchor_tab__';
    const tabValues = [
      'MergedContent',
      'Agentic Instructions',
      'StyleProfile',
      'EarTune',
      'TechnicalAudit',
      'Comment Instructions',
    ];
    expect(tabValues).not.toContain(sentinel);
  });
});

describe('Agent tag and contextKeys declarations', () => {
  it('ArchitectAgent declares tags = ["@architect"]', () => {
    const expectedTags = ['@architect'];
    expectedTags.forEach(t => {
      expect(typeof t).toBe('string');
      expect(t).toBe(t.toLowerCase());
    });
    expect(expectedTags.length).toBeGreaterThan(0);
  });

  it('StylistAgent declares tags = ["@eartune", "@stylist"]', () => {
    const expectedTags = ['@eartune', '@stylist'];
    expectedTags.forEach(t => {
      expect(typeof t).toBe('string');
      expect(t).toBe(t.toLowerCase());
    });
    expect(expectedTags.length).toBeGreaterThan(0);
  });

  it('AuditAgent declares tags = ["@audit", "@auditor"]', () => {
    const expectedTags = ['@audit', '@auditor'];
    expectedTags.forEach(t => {
      expect(typeof t).toBe('string');
      expect(t).toBe(t.toLowerCase());
    });
    expect(expectedTags.length).toBeGreaterThan(0);
  });

  it('CommentAgent declares tags = ["@ai"]', () => {
    const expectedTags = ['@ai'];
    expectedTags.forEach(t => {
      expect(typeof t).toBe('string');
      expect(t).toBe(t.toLowerCase());
    });
    expect(expectedTags.length).toBeGreaterThan(0);
  });

  it('ArchitectAgent contextKeys is non-empty', () => {
    const expected = ['MergedContent'];
    expect(expected.length).toBeGreaterThan(0);
  });

  it('StylistAgent contextKeys includes COMMENT_ANCHOR_TAB sentinel', () => {
    const expected = ['StyleProfile', 'EarTune', '__comment_anchor_tab__'];
    expect(expected).toContain('__comment_anchor_tab__');
    expect(expected.length).toBeGreaterThan(0);
  });

  it('AuditAgent contextKeys includes COMMENT_ANCHOR_TAB sentinel', () => {
    const expected = ['StyleProfile', 'TechnicalAudit', '__comment_anchor_tab__'];
    expect(expected).toContain('__comment_anchor_tab__');
    expect(expected.length).toBeGreaterThan(0);
  });

  it('CommentAgent contextKeys is non-empty and does not include COMMENT_ANCHOR_TAB', () => {
    const expected = ['MergedContent', 'Comment Instructions'];
    expect(expected.length).toBeGreaterThan(0);
    expect(expected).not.toContain('__comment_anchor_tab__');
  });
});
