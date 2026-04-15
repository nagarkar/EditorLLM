// ============================================================
// CommentProcessor.ts — Orchestrates multi-agent comment routing.
// Owns all Drive API interaction, thread parsing, tag-based routing,
// pre-flight validation, and reply posting.
// Agents own their AI processing via handleCommentThreads().
// ============================================================
const CommentProcessor = (() => {
  // normaliseTagWord_ lives in CommentProcessorHelpers.ts (exported for tests,
  // ambient-declared in Types.ts for flat-scope type resolution).
  let roster_: BaseAgent[] = [];
  let tagRegistry_: Map<string, BaseAgent> = new Map();

  // ── Initialisation ──────────────────────────────────────────────────────────

  function init(roster: BaseAgent[]): void {
    roster_ = roster;
    tagRegistry_ = new Map();
    for (const agent of roster) {
      for (const tag of agent.tags) {
        const normalised = tag.toLowerCase();
        if (tagRegistry_.has(normalised)) {
          Tracer.warn(`[CommentProcessor] init: duplicate tag "${normalised}" — last writer wins`);
        }
        tagRegistry_.set(normalised, agent);
      }
    }
    
    // TODO: Log tags by agent instead of just a full list of tags
    const tags = [...tagRegistry_.keys()].join(', ');
    Tracer.info(
      `[CommentProcessor] init: ${tagRegistry_.size} tag(s) across ${roster_.length} agent(s): [${tags}]`
    );
  }

  // ── Drive API helpers ────────────────────────────────────────────────────────

  /**
   * Fetches all non-deleted comments for the given file, handling pagination.
   * Drive API v3 paginates at 20 by default; maxResults=100 reduces round-trips.
   *
   * NOTE: Drive.Comments.list uses Drive API v3. Fields are fetched with '*'
   * for forward-compatibility; tighten to a specific mask if payload size matters.
   */
  function fetchComments_(docId: string): any[] {
    const all: any[] = [];
    let pageToken: string | undefined;
    let page = 0;

    try {      
      do {
        page++;
        const opts: any = {
          includeDeleted: false,
          // GAS Drive Advanced Service rejects all field masks for comments.list
          // other than '*' — both parentheses and slash-path syntax produce
          // "Invalid field selection context". Fetch everything and filter in memory.
          fields: '*',
          maxResults: 100,
        };
        if (pageToken) opts.pageToken = pageToken;

        // GAS API not in @types — cast required
        const list: any = (Drive.Comments as any).list(docId, opts);

        const items: any[] = list.comments || list.items || [];
        all.push(...items);

        pageToken = list.nextPageToken;
        Tracer.info(
          `[CommentProcessor] fetchComments_: page ${page} → ${items.length} comment(s) (cumulative: ${all.length})`
        );
      } while (pageToken);

      Tracer.info(`[CommentProcessor] fetchComments_: total ${all.length} comment(s) fetched`);
      return all;
    } catch (e: any) {
      Tracer.error(`[CommentProcessor] fetchComments_: Drive.Comments.list failed — ${e.message}`);
      throw new Error(`Could not fetch comments: ${e.message}`);
    }
  }

  /** Drive API practical character limit per comment/reply. */
  const MAX_REPLY_CHARS = 4000;

  /**
   * Posts a reply to a Drive comment thread.
   * Retries once after 2 s to handle transient Drive API rate-limit responses
   * that can occur after several rapid reply postings.
   * Content is hard-clamped to MAX_REPLY_CHARS to avoid Drive API errors.
   * Returns true on success, false if both attempts fail.
   */
  function postReply_(docId: string, reply: ThreadReply): boolean {
    let content = AGENT_COMMENT_PREFIX + reply.content;
    if (content.length > MAX_REPLY_CHARS) {
      const suffix = '… [truncated]';
      content = content.slice(0, MAX_REPLY_CHARS - suffix.length) + suffix;
      Tracer.warn(
        `[CommentProcessor] postReply_: reply for thread ${reply.threadId} truncated ` +
        `from ${(AGENT_COMMENT_PREFIX + reply.content).length} to ${MAX_REPLY_CHARS} chars`
      );
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        // GAS API not in @types — cast required
        (Drive.Replies as any).create(
          { content },
          docId,
          reply.threadId,
          { fields: 'id,content' }
        );
        Tracer.info(`[CommentProcessor] postReply_: posted reply to thread ${reply.threadId} (attempt ${attempt})`);
        return true;
      } catch (e: any) {
        Tracer.error(
          `[CommentProcessor] postReply_: attempt ${attempt} FAILED for thread ${reply.threadId} — ${e.message}`
        );
        if (attempt < 2) {
          Utilities.sleep(2000);
        }
      }
    }
    return false;
  }

  // ── Thread parsing ───────────────────────────────────────────────────────────

  /**
   * Walks the tab tree once and maps each tab's unique ID to its title.
   * This enables true O(1) anchor resolution from Drive API payloads without
   * ever fetching tab body text over the Apps Script RPC bridge.
   */
  function buildTabDirectory_(): Map<string, string> {
    const directory = new Map<string, string>();

    function visit_(tabs: GoogleAppsScript.Document.Tab[]): void {
      for (const tab of tabs) {
        directory.set(tab.getId(), tab.getTitle());
        visit_(tab.getChildTabs());
      }
    }

    visit_(DocumentApp.getActiveDocument().getTabs());
    Tracer.info(`[CommentProcessor] buildTabDirectory_: ${directory.size} tab(s) indexed`);
    return directory;
  }

  function rosterNeedsAnchorTab_(): boolean {
    return roster_.some(a => a.contextKeys.includes(COMMENT_ANCHOR_TAB));
  }

  /**
   * Parses a raw Drive comment object into a CommentThread ready for dispatch.
   * Returns null if the last message has no recognised @tag.
   *
   * Tag extraction rule: the first @word in the last message (case-insensitive),
   * with trailing punctuation stripped (e.g. "@AI:" and "@AI" both match).
   * agentRequest: everything after the tag word (including any trailing punctuation)
   *   in the last message.
   * Role detection: messages starting with "Response from @AI" are AI turns.
   */
  function buildThread_(comment: any, tabDirectory: Map<string, string>): CommentThread | null {
    const replies: any[] = comment.replies || [];
    const allMessages = [comment, ...replies];
    const lastMessage = allMessages[allMessages.length - 1];

    if (!lastMessage?.content) return null;

    // Find the first @word that is a recognised agent tag (case-insensitive).
    // Trailing punctuation is stripped before lookup so "@AI:" routes to "@ai".
    // Scanning for known tags (not any @word) prevents user references like
    // "@Aristotle" from being mistakenly treated as routing instructions.
    const words: string[] = lastMessage.content.trim().split(/\s+/);
    const tagWord = words.find((w: string) => tagRegistry_.has(normaliseTagWord_(w)));
    if (!tagWord) return null;

    const tag = normaliseTagWord_(tagWord);

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

    const agent = tagRegistry_.get(tag)!;
    let anchorTabName: string | null = null;
    
    if (agent.contextKeys.includes(COMMENT_ANCHOR_TAB)) {
      try {
        const anchorObj = JSON.parse(comment.anchor || '{}');
        const tabId = anchorObj?.a?.[0]?.lt?.tb?.id;
        if (tabId && tabDirectory.has(tabId)) {
          anchorTabName = tabDirectory.get(tabId)!;
        }
      } catch (e) {
        // Fallback: unable to parse explicit tab ID, agent will fallback to selectedText
      }
    }

    const threadId = comment.id || comment.commentId;
    
    Tracer.info(
      `[CommentProcessor] buildThread_: parsed thread=${threadId} tag=${tag} ` +
      `anchor=${anchorTabName ?? '(none)'} msgs=${allMessages.length}`
    );

    return {
      threadId,
      tag,
      agentRequest,
      conversation,
      selectedText,
      anchorTabName,
    };
  }

  // ── Pre-flight validation ────────────────────────────────────────────────────

  /**
   * Advisory-only: logs warnings for missing tabs once per agent group.
   * Never throws — missing context is handled gracefully by agents returning
   * empty strings from getTabContent_().
   *
   * For named tabs: checked once (same for all threads in the group).
   * For COMMENT_ANCHOR_TAB: logs the count of threads with no resolved anchor.
   */
  function validateRequiredTabs_(agent: BaseAgent, threads: CommentThread[]): void {
    for (const key of agent.contextKeys) {
      if (key === COMMENT_ANCHOR_TAB) {
        const nullCount = threads.filter(t => t.anchorTabName === null).length;
        if (nullCount > 0) {
          Tracer.warn(
            `[CommentProcessor] validateRequiredTabs_: ${nullCount}/${threads.length} thread(s) for ` +
            `${agent.constructor.name} have no resolved anchor tab — agent will use selectedText as fallback`
          );
        }
      } else if (!DocOps.tabExists(key)) {
        Tracer.warn(
          `[CommentProcessor] validateRequiredTabs_: required tab "${key}" missing for ${agent.constructor.name}`
        );
      }
    }
  }

  // ── Main entry ───────────────────────────────────────────────────────────────

  function processAll(): { replied: number; skipped: number; byAgent: Record<string, number> } {
    if (roster_.length === 0) {
      throw new Error(
        '[CommentProcessor] processAll: no agents registered. ' +
        'Call CommentProcessor.init(agents) before processAll().'
      );
    }

    const docId = DocumentApp.getActiveDocument().getId();
    const byAgent: Record<string, number> = {};
    let replied = 0;
    let skipped = 0;

    const comments = fetchComments_(docId);
    Tracer.info(`[CommentProcessor] processAll: ${comments.length} comment(s) to process`);

    const tabDirectory: Map<string, string> =
      comments.length > 0 && rosterNeedsAnchorTab_() ? buildTabDirectory_() : new Map();

    // ── Phase 1: Parse all threads and group by agent instance ───────────────
    // Using Map<BaseAgent, CommentThread[]> keyed on object identity so
    // multi-tag agents (e.g. EarTuneAgent with @eartune and @eartune) receive
    // all their threads in a single batch.
    const agentGroups = new Map<BaseAgent, CommentThread[]>();
    // threadId → tag: used in phase 2 so byAgent is keyed by routing tag
    // (e.g. '@audit') rather than class name, matching the original behaviour
    // that predated the batch API refactor.
    const threadIdToTag = new Map<string, string>();

    for (const comment of comments) {
      const commentId = comment.id || comment.commentId || '(unknown)';

      const thread = buildThread_(comment, tabDirectory);
      if (!thread) {
        Tracer.warn(`[CommentProcessor] processAll: skipping comment ${commentId} — no routable tag`);
        skipped++;
        continue;
      }

      const agent = tagRegistry_.get(thread.tag);
      if (!agent) {
        Tracer.warn(`[CommentProcessor] processAll: skipping thread ${thread.threadId} — tag "${thread.tag}" not in registry`);
        skipped++;
        continue;
      }

      threadIdToTag.set(thread.threadId, thread.tag);

      if (!agentGroups.has(agent)) {
        agentGroups.set(agent, []);
      }
      agentGroups.get(agent)!.push(thread);
    }

    // ── Phase 2: Dispatch each agent group as a single batch ─────────────────
    for (const [agent, threads] of agentGroups) {
      const agentName = agent.constructor.name;
      Tracer.info(
        `[CommentProcessor] processAll: dispatching ${threads.length} thread(s) to ${agentName}`
      );

      // Validate required tabs once per agent group (not per thread).
      validateRequiredTabs_(agent, threads);

      let replies: ThreadReply[];
      try {
        replies = agent.handleCommentThreads(threads);
      } catch (e: any) {
        Tracer.error(
          `[CommentProcessor] processAll: ${agentName} threw on batch of ${threads.length} thread(s) — ${e.message}`
        );
        skipped += threads.length;
        continue;
      }

      Tracer.info(
        `[CommentProcessor] processAll: ${agentName} returned ${replies.length} reply/replies ` +
        `for ${threads.length} thread(s)`
      );

      // Post each reply individually; Drive side-effects stay simple.
      for (const reply of replies) {
        const posted = postReply_(docId, reply);
        if (posted) {
          replied++;
          const tag = threadIdToTag.get(reply.threadId) ?? agentName;
          byAgent[tag] = (byAgent[tag] || 0) + 1;
        } else {
          skipped++;
        }
      }
    }

    Tracer.info(
      `[CommentProcessor] processAll: done — replied=${replied}, skipped=${skipped}, byAgent=${JSON.stringify(byAgent)}`
    );
    return { replied, skipped, byAgent };
  }

  return { init, processAll };
})();
