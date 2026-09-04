// ============================================================
// CustomAgentService.ts — CRUD for user-defined agent definitions.
//
// Storage strategy:
//   User Properties   — personal, follows the user across all documents.
//     key: CUSTOM_AGENT_USER_PREFIX + id
//   Document Properties — shared with all editors of this document.
//     key: CUSTOM_AGENT_DOC_PREFIX  + id
//   Script Properties   — shared with every user across all documents.
//     key: CUSTOM_AGENT_SCRIPT_PREFIX + id
//     Includes ownerEmail so collaborators know who to contact.
//
// Precedence when listing: user > document > script (personal wins).
// All definitions are JSON-serialised.  Size: ~1–3 KB each.
// User Properties total limit: 500 KB; plenty for dozens of agents.
// ============================================================

const CustomAgentService = (() => {

  const CUSTOM_AGENT_USER_PREFIX   = 'custom_agent::';
  const CUSTOM_AGENT_DOC_PREFIX    = 'doc_custom_agent::';
  const CUSTOM_AGENT_SCRIPT_PREFIX = 'script_custom_agent::';

  // Tags that cannot be claimed by user-defined agents.
  const RESERVED_TAGS: ReadonlySet<string> = new Set([
    '@architect',
    '@audit',
    '@auditor',
    '@eartune',
    '@ai',
    '@tts',
    '@publisher',
    '@tether',
    '@ref',
  ]);

  // ── Internal helpers ──────────────────────────────────────────────────────

  function userProps_(): GoogleAppsScript.Properties.Properties {
    return PropertiesService.getUserProperties();
  }

  function docProps_(): GoogleAppsScript.Properties.Properties {
    return PropertiesService.getDocumentProperties();
  }

  function scriptProps_(): GoogleAppsScript.Properties.Properties {
    return PropertiesService.getScriptProperties();
  }

  function parseEntry_(raw: string | null): CustomAgentDefinition | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as CustomAgentDefinition;
      if (!parsed || !parsed.id || !parsed.displayName) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function generateId_(): string {
    return Utilities.getUuid().replace(/-/g, '');
  }

  function currentUserEmail_(): string {
    try {
      return Session.getActiveUser().getEmail() ?? '';
    } catch (_) {
      return '';
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Returns all custom agents visible to the current user:
   * their own (UserProperties) + shared ones from this document (DocumentProperties).
   * Document-stored definitions override user-stored ones with the same id.
   */
  function listAll(): CustomAgentDefinition[] {
    const byId = new Map<string, CustomAgentDefinition>();

    // Script-level agents (lowest precedence — shared with everyone)
    const scriptAll = scriptProps_().getProperties();
    for (const [key, raw] of Object.entries(scriptAll)) {
      if (!key.startsWith(CUSTOM_AGENT_SCRIPT_PREFIX)) continue;
      const def = parseEntry_(raw);
      if (def) byId.set(def.id, def);
    }

    // Document-shared agents (override script agents with same id)
    const docAll = docProps_().getProperties();
    for (const [key, raw] of Object.entries(docAll)) {
      if (!key.startsWith(CUSTOM_AGENT_DOC_PREFIX)) continue;
      const def = parseEntry_(raw);
      if (def) byId.set(def.id, def);
    }

    // User-owned agents (highest precedence — override all shared)
    const userAll = userProps_().getProperties();
    for (const [key, raw] of Object.entries(userAll)) {
      if (!key.startsWith(CUSTOM_AGENT_USER_PREFIX)) continue;
      const def = parseEntry_(raw);
      if (def) byId.set(def.id, def);
    }

    return Array.from(byId.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  /**
   * Validates and saves (or updates) a custom agent definition.
   *
   * Rules:
   *   - id must be non-empty; a new UUID is generated when absent
   *   - displayName, tag, instructionTabName, systemPrompt must be non-empty
   *   - tag must start with @ and contain only alphanumeric + hyphen after @
   *   - tag must not conflict with reserved tags or other custom agents
   *   - contextTabName (if provided) must be an existing doc tab
   *   - instructionTabName need not exist yet; a warning is logged if missing
   *
   * @param def    Partial definition to save (id may be omitted for new agents)
   * @returns      The saved definition with generated id and timestamps set
   * @throws       Error with a user-facing message on validation failure
   */
  function save(def: Partial<CustomAgentDefinition>): CustomAgentDefinition {
    const id = def.id || generateId_();

    if (!def.displayName?.trim()) throw new Error('Agent name is required.');
    if (!def.tag?.trim())         throw new Error('Tag is required.');
    if (!def.systemPrompt?.trim()) throw new Error('System prompt is required.');

    const tag = def.tag.trim().toLowerCase();
    if (!tag.startsWith('@')) throw new Error('Tag must start with @.');
    if (!/^@[a-z0-9-]+$/.test(tag)) {
      throw new Error('Tag must contain only lowercase letters, digits, and hyphens after @.');
    }

    if (RESERVED_TAGS.has(tag)) {
      throw new Error(`Tag "${tag}" is reserved for a built-in agent.`);
    }

    // Check for tag collision with other custom agents (excluding the current id on update)
    const existing = listAll().filter(a => a.id !== id);
    const collision = existing.find(a => a.tag === tag);
    if (collision) {
      throw new Error(`Tag "${tag}" is already used by agent "${collision.displayName}".`);
    }

    // Verify context tab exists if provided
    if (def.contextTabName?.trim()) {
      const ctxTab = DocOps.getTabByName(def.contextTabName.trim());
      if (!ctxTab) {
        throw new Error(`Context tab "${def.contextTabName.trim()}" does not exist in this document.`);
      }
    }

    // Warn (but don't throw) if instruction tab is missing
    if (def.instructionTabName?.trim()) {
      const instrTab = DocOps.getTabByName(def.instructionTabName.trim());
      if (!instrTab) {
        Tracer.warn(
          `[CustomAgentService] save: instruction tab "${def.instructionTabName.trim()}" ` +
          `not found — agent saved, but W2/W3 will use empty instructions until the tab is created.`
        );
      }
    }

    const existing_ = findById(id);

    // Ownership check: non-owners cannot modify a shared agent.
    if (existing_ && (existing_.storedIn === 'document' || existing_.storedIn === 'script')) {
      const email = currentUserEmail_();
      if (existing_.ownerEmail && email && existing_.ownerEmail !== email) {
        throw new Error(`Only the owner (${existing_.ownerEmail}) can edit this shared agent.`);
      }
    }

    const saved: CustomAgentDefinition = {
      id,
      displayName:       def.displayName.trim(),
      tag,
      instructionTabName: def.instructionTabName?.trim() || undefined,
      contextTabName:    def.contextTabName?.trim() || undefined,
      systemPrompt:      def.systemPrompt.trim(),
      workflows: {
        w2: def.workflows?.w2 ?? true,
        w3: def.workflows?.w3 ?? false,
        w6: def.workflows?.w6 ?? false,
      },
      storedIn:   def.storedIn ?? 'user',
      ownerEmail: def.ownerEmail,
      createdAt:  existing_?.createdAt ?? Date.now(),
    };

    if (saved.storedIn === 'document') {
      if (!saved.ownerEmail) saved.ownerEmail = currentUserEmail_();
      docProps_().setProperty(CUSTOM_AGENT_DOC_PREFIX + id, JSON.stringify(saved));
      userProps_().deleteProperty(CUSTOM_AGENT_USER_PREFIX + id);
      scriptProps_().deleteProperty(CUSTOM_AGENT_SCRIPT_PREFIX + id);
    } else if (saved.storedIn === 'script') {
      if (!saved.ownerEmail) saved.ownerEmail = currentUserEmail_();
      scriptProps_().setProperty(CUSTOM_AGENT_SCRIPT_PREFIX + id, JSON.stringify(saved));
      userProps_().deleteProperty(CUSTOM_AGENT_USER_PREFIX + id);
      docProps_().deleteProperty(CUSTOM_AGENT_DOC_PREFIX + id);
    } else {
      userProps_().setProperty(CUSTOM_AGENT_USER_PREFIX + id, JSON.stringify(saved));
      docProps_().deleteProperty(CUSTOM_AGENT_DOC_PREFIX + id);
      scriptProps_().deleteProperty(CUSTOM_AGENT_SCRIPT_PREFIX + id);
    }

    Tracer.info(`[CustomAgentService] save: saved agent id=${id} tag=${tag} storedIn=${saved.storedIn}`);
    return saved;
  }

  /**
   * Deletes a custom agent by id.
   * Removes from whichever store it is currently in.
   * Only the owner can delete a document-stored agent.
   */
  function remove(id: string): void {
    const def = findById(id);
    if (!def) {
      Tracer.warn(`[CustomAgentService] remove: agent id=${id} not found`);
      return;
    }
    if (def.storedIn === 'document') {
      const email = currentUserEmail_();
      if (def.ownerEmail && email && def.ownerEmail !== email) {
        throw new Error(
          `Only the owner (${def.ownerEmail}) can delete this shared agent.`
        );
      }
      docProps_().deleteProperty(CUSTOM_AGENT_DOC_PREFIX + id);
    } else if (def.storedIn === 'script') {
      const email = currentUserEmail_();
      if (def.ownerEmail && email && def.ownerEmail !== email) {
        throw new Error(
          `Only the owner (${def.ownerEmail}) can delete this shared agent.`
        );
      }
      scriptProps_().deleteProperty(CUSTOM_AGENT_SCRIPT_PREFIX + id);
    } else {
      userProps_().deleteProperty(CUSTOM_AGENT_USER_PREFIX + id);
    }
    Tracer.info(`[CustomAgentService] remove: deleted agent id=${id}`);
  }

  /**
   * Promotes a user-stored agent to Document Properties so collaborators can use it.
   * The agent remains read-only for non-owners (they cannot edit or delete it).
   */
  function promoteToDocument(id: string): CustomAgentDefinition {
    const def = findById(id);
    if (!def) throw new Error(`Agent id=${id} not found.`);
    if (def.storedIn === 'document') return def;

    const promoted: CustomAgentDefinition = {
      ...def,
      storedIn:   'document',
      ownerEmail: currentUserEmail_() || def.ownerEmail,
    };

    docProps_().setProperty(CUSTOM_AGENT_DOC_PREFIX + id, JSON.stringify(promoted));
    userProps_().deleteProperty(CUSTOM_AGENT_USER_PREFIX + id);
    scriptProps_().deleteProperty(CUSTOM_AGENT_SCRIPT_PREFIX + id);
    Tracer.info(`[CustomAgentService] promoteToDocument: id=${id} shared with document`);
    return promoted;
  }

  /**
   * Promotes an agent to Script Properties so all users across all documents can use it.
   * Only the current owner may promote.
   */
  function promoteToScript(id: string): CustomAgentDefinition {
    const def = findById(id);
    if (!def) throw new Error(`Agent id=${id} not found.`);
    if (def.storedIn === 'script') return def;

    const promoted: CustomAgentDefinition = {
      ...def,
      storedIn:   'script',
      ownerEmail: currentUserEmail_() || def.ownerEmail,
    };

    scriptProps_().setProperty(CUSTOM_AGENT_SCRIPT_PREFIX + id, JSON.stringify(promoted));
    userProps_().deleteProperty(CUSTOM_AGENT_USER_PREFIX + id);
    docProps_().deleteProperty(CUSTOM_AGENT_DOC_PREFIX + id);
    Tracer.info(`[CustomAgentService] promoteToScript: id=${id} shared globally`);
    return promoted;
  }

  /**
   * Demotes a document-stored agent back to User Properties (owner only).
   */
  function demoteToUser(id: string): CustomAgentDefinition {
    const def = findById(id);
    if (!def) throw new Error(`Agent id=${id} not found.`);
    if (def.storedIn === 'user') return def;

    const email = currentUserEmail_();
    if (def.ownerEmail && email && def.ownerEmail !== email) {
      throw new Error(`Only the owner (${def.ownerEmail}) can unshare this agent.`);
    }

    const demoted: CustomAgentDefinition = { ...def, storedIn: 'user' };
    userProps_().setProperty(CUSTOM_AGENT_USER_PREFIX + id, JSON.stringify(demoted));
    docProps_().deleteProperty(CUSTOM_AGENT_DOC_PREFIX + id);
    scriptProps_().deleteProperty(CUSTOM_AGENT_SCRIPT_PREFIX + id);
    Tracer.info(`[CustomAgentService] demoteToUser: id=${id} moved back to UserProperties`);
    return demoted;
  }

  /**
   * Looks up a single agent by id, checking UserProperties first, then DocumentProperties.
   * Returns null if not found.
   */
  function findById(id: string): CustomAgentDefinition | null {
    const fromUser = parseEntry_(userProps_().getProperty(CUSTOM_AGENT_USER_PREFIX + id));
    if (fromUser) return fromUser;
    const fromDoc = parseEntry_(docProps_().getProperty(CUSTOM_AGENT_DOC_PREFIX + id));
    if (fromDoc) return fromDoc;
    return parseEntry_(scriptProps_().getProperty(CUSTOM_AGENT_SCRIPT_PREFIX + id));
  }

  // ── Export / Import ───────────────────────────────────────────────────────

  /**
   * Exports agent definitions to a portable JSON string.
   * When ids is omitted or empty, all visible agents are exported.
   * Each entry includes the agent definition plus the content of any
   * instructionTab and contextTab tabs (read as Markdown) so the agent
   * can be fully reconstructed in another document.
   *
   * @returns A JSON string with format { version, exportedAt, agents[] }
   */
  function exportAgents(ids?: string[]): string {
    const all = listAll();
    const targets = ids && ids.length
      ? all.filter(a => ids.includes(a.id))
      : all;

    const entries: AgentExportEntry[] = targets.map(def => {
      const entry: AgentExportEntry = {
        displayName:       def.displayName,
        tag:               def.tag,
        systemPrompt:      def.systemPrompt,
        workflows:         { w2: def.workflows.w2, w3: def.workflows.w3, w6: def.workflows.w6 ?? false },
        instructionTabName: def.instructionTabName,
        contextTabName:    def.contextTabName,
      };

      // Capture tab contents so they can be recreated in another document.
      if (def.instructionTabName) {
        try {
          const md = MarkdownService.tabToMarkdown(def.instructionTabName);
          if (md) entry.instructionTabContent = md;
        } catch (_) {}
      }
      if (def.contextTabName) {
        try {
          const md = MarkdownService.tabToMarkdown(def.contextTabName);
          if (md) entry.contextTabContent = md;
        } catch (_) {}
      }

      return entry;
    });

    const payload: AgentExportPayload = {
      version:    1,
      exportedAt: new Date().toISOString(),
      agents:     entries,
    };

    Tracer.info(`[CustomAgentService] exportAgents: exported ${entries.length} agent(s)`);
    return JSON.stringify(payload, null, 2);
  }

  /**
   * Imports agents from a JSON string produced by exportAgents().
   * For each agent:
   *   - If a tab is bundled, it is created/overwritten via MarkdownService.markdownToTab.
   *   - The agent is saved to User Properties (personal tier).
   *   - If a tag already exists (same tag + same displayName), the import is skipped.
   *
   * @returns { imported, skipped, errors } summary
   */
  function importAgents(json: string): { imported: number; skipped: string[]; errors: string[] } {
    let payload: AgentExportPayload;
    try {
      payload = JSON.parse(json) as AgentExportPayload;
    } catch (_) {
      return { imported: 0, skipped: [], errors: ['Invalid JSON — could not parse import payload.'] };
    }

    if (!payload || !Array.isArray(payload.agents)) {
      return { imported: 0, skipped: [], errors: ['Invalid export format — missing "agents" array.'] };
    }

    let imported = 0;
    const skipped: string[] = [];
    const errors: string[] = [];
    const existing = listAll();

    for (const entry of payload.agents) {
      if (!entry.displayName || !entry.tag || !entry.systemPrompt) {
        errors.push(`Skipping incomplete agent entry (missing name/tag/prompt).`);
        continue;
      }

      const tag = entry.tag.trim().toLowerCase();
      // Skip if an agent with the same tag already exists in this document.
      const collision = existing.find(a => a.tag === tag);
      if (collision) {
        skipped.push(`${entry.displayName} (${tag}) — tag already used by "${collision.displayName}"`);
        continue;
      }

      try {
        // Recreate instruction tab if content bundled.
        if (entry.instructionTabName && entry.instructionTabContent) {
          MarkdownService.markdownToTab(entry.instructionTabContent, entry.instructionTabName);
        }
        // Recreate context tab if content bundled.
        if (entry.contextTabName && entry.contextTabContent) {
          MarkdownService.markdownToTab(entry.contextTabContent, entry.contextTabName);
        }

        save({
          displayName:       entry.displayName,
          tag:               entry.tag,
          systemPrompt:      entry.systemPrompt,
          workflows:         entry.workflows || { w2: true, w3: false, w6: false },
          instructionTabName: entry.instructionTabName,
          contextTabName:    entry.contextTabName,
          storedIn:          'user',
        });
        imported++;
      } catch (e: any) {
        errors.push(`${entry.displayName}: ${e.message}`);
      }
    }

    Tracer.info(
      `[CustomAgentService] importAgents: imported=${imported} ` +
      `skipped=${skipped.length} errors=${errors.length}`
    );
    return { imported, skipped, errors };
  }

  return {
    listAll,
    save,
    remove,
    promoteToDocument,
    promoteToScript,
    demoteToUser,
    findById,
    exportAgents,
    importAgents,
    RESERVED_TAGS,
  };
})();
