// ============================================================
// CommentProcessor.ts — Orchestrates multi-agent comment routing.
// Owns all Drive API interaction, thread parsing, tag-based routing,
// pre-flight validation, and reply posting.
// Agents own their AI processing via handleCommentThreads().
// ============================================================

const CommentProcessor = (() => {
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
          Logger.log(`[CommentProcessor] init: duplicate tag "${normalised}" — last writer wins`);
        }
        tagRegistry_.set(normalised, agent);
      }
    }
    const tags = [...tagRegistry_.keys()].join(', ');
    Logger.log(
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
          fields: '*',
          maxResults: 100,
        };
        if (pageToken) opts.pageToken = pageToken;

        // GAS API not in @types — cast required
        const list: any = (Drive.Comments as any).list(docId, opts);

        const items: any[] = list.comments || list.items || [];
        all.push(...items);

        pageToken = list.nextPageToken;
        Logger.log(
          `[CommentProcessor] fetchComments_: page ${page} → ${items.length} comment(s) (cumulative: ${all.length})`
        );
      } while (pageToken);

      Logger.log(`[CommentProcessor] fetchComments_: total ${all.length} comment(s) fetched`);
      return all;
    } catch (e: any) {
      Logger.log(`[CommentProcessor] fetchComments_: Drive.Comments.list failed — ${e.message}`);
      throw new Error(`Could not fetch comments: ${e.message}`);
    }
  }

  /**
   * Posts a reply to a Drive comment thread.
   * Drive.Replies.create signature (Drive API v3):
   *   create(resource, fileId, commentId, optionalArgs)
   */
  /**
   * Posts a reply to a Drive comment thread.
   * Retries once after 2 s to handle transient Drive API rate-limit responses
   * that can occur after several rapid reply postings.
   * Returns true on success, false if both attempts fail.
   */
  function postReply_(docId: string, reply: ThreadReply): boolean {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        // GAS API not in @types — cast required
        (Drive.Replies as any).create(
          { content: reply.content },
          docId,
          reply.threadId,
          { fields: 'id,content' }
        );
        Logger.log(`[CommentProcessor] postReply_: posted reply to thread ${reply.threadId} (attempt ${attempt})`);
        return true;
      } catch (e: any) {
        Logger.log(
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
   * Searches all document tabs for one whose body contains the given probe string.
   * Uses DocumentApp's start-of-execution snapshot (fast, but misses tabs created
   * during this run). Returns the tab title, or null if not found.
   */
  function resolveAnchorTabName_(selectedText: string): string | null {
    if (!selectedText.trim()) return null;
    const probe = selectedText.slice(0, 80);

    function search_(tabs: GoogleAppsScript.Document.Tab[]): string | null {
      for (const tab of tabs) {
        if (tab.asDocumentTab().getBody().getText().includes(probe)) {
          return tab.getTitle();
        }
        const found = search_(tab.getChildTabs());
        if (found) return found;
      }
      return null;
    }

    const result = search_(DocumentApp.getActiveDocument().getTabs());
    if (!result) {
      Logger.log(
        `[CommentProcessor] resolveAnchorTabName_: no tab found for probe "${probe.slice(0, 40)}…"`
      );
    }
    return result;
  }

  /**
   * Strips trailing punctuation from a tag candidate so that "@AI:", "@AI,",
   * "@architect." etc. all resolve to the same registry key as "@AI" / "@architect".
   * Only trailing non-alphanumeric/non-tag characters are removed.
   */
  function normaliseTagWord_(w: string): string {
    return w.toLowerCase().replace(/[^a-z0-9@_-]+$/, '');
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
  function buildThread_(comment: any): CommentThread | null {
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
    const anchorTabName = agent.contextKeys.includes(COMMENT_ANCHOR_TAB)
      ? resolveAnchorTabName_(selectedText)
      : null;

    const threadId = comment.id || comment.commentId;
    Logger.log(
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
          Logger.log(
            `[CommentProcessor] validateRequiredTabs_: ${nullCount}/${threads.length} thread(s) for ` +
            `${agent.constructor.name} have no resolved anchor tab — agent will use selectedText as fallback`
          );
        }
      } else if (!DocOps.tabExists(key)) {
        Logger.log(
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
    Logger.log(`[CommentProcessor] processAll: ${comments.length} comment(s) to process`);

    // ── Phase 1: Parse all threads and group by agent instance ───────────────
    // Using Map<BaseAgent, CommentThread[]> keyed on object identity so
    // multi-tag agents (e.g. StylistAgent with @eartune and @stylist) receive
    // all their threads in a single batch.
    const agentGroups = new Map<BaseAgent, CommentThread[]>();

    for (const comment of comments) {
      const commentId = comment.id || comment.commentId || '(unknown)';

      const thread = buildThread_(comment);
      if (!thread) {
        Logger.log(`[CommentProcessor] processAll: skipping comment ${commentId} — no routable tag`);
        skipped++;
        continue;
      }

      const agent = tagRegistry_.get(thread.tag);
      if (!agent) {
        Logger.log(`[CommentProcessor] processAll: skipping thread ${thread.threadId} — tag "${thread.tag}" not in registry`);
        skipped++;
        continue;
      }

      if (!agentGroups.has(agent)) {
        agentGroups.set(agent, []);
      }
      agentGroups.get(agent)!.push(thread);
    }

    // ── Phase 2: Dispatch each agent group as a single batch ─────────────────
    for (const [agent, threads] of agentGroups) {
      const agentName = agent.constructor.name;
      Logger.log(
        `[CommentProcessor] processAll: dispatching ${threads.length} thread(s) to ${agentName}`
      );

      // Validate required tabs once per agent group (not per thread).
      validateRequiredTabs_(agent, threads);

      let replies: ThreadReply[];
      try {
        replies = agent.handleCommentThreads(threads);
      } catch (e: any) {
        Logger.log(
          `[CommentProcessor] processAll: ${agentName} threw on batch of ${threads.length} thread(s) — ${e.message}`
        );
        skipped += threads.length;
        continue;
      }

      Logger.log(
        `[CommentProcessor] processAll: ${agentName} returned ${replies.length} reply/replies ` +
        `for ${threads.length} thread(s)`
      );

      // Post each reply individually; Drive side-effects stay simple.
      for (const reply of replies) {
        const posted = postReply_(docId, reply);
        if (posted) {
          replied++;
          byAgent[agentName] = (byAgent[agentName] || 0) + 1;
        } else {
          skipped++;
        }
      }
    }

    Logger.log(
      `[CommentProcessor] processAll: done — replied=${replied}, skipped=${skipped}, byAgent=${JSON.stringify(byAgent)}`
    );
    return { replied, skipped, byAgent };
  }

  return { init, processAll };
})();
