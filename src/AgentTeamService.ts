// ============================================================
// AgentTeamService.ts — CRUD for named, ordered agent teams
// used by the Agentic Team Analysis feature.
//
// Storage mirrors CustomAgentService:
//   User Properties   — key: agent_team::
//   Document Properties — key: doc_agent_team::
//
// Teams are ordered lists of custom agent IDs. The analysis
// runner (AgentTeamAnalysis) resolves agent definitions at
// run time so changes to agents propagate without re-saving teams.
// ============================================================

const AgentTeamService = (() => {

  const USER_PREFIX = 'agent_team::';
  const DOC_PREFIX  = 'doc_agent_team::';

  // ── Helpers ───────────────────────────────────────────────────────────────

  function userProps_(): GoogleAppsScript.Properties.Properties {
    return PropertiesService.getUserProperties();
  }

  function docProps_(): GoogleAppsScript.Properties.Properties {
    return PropertiesService.getDocumentProperties();
  }

  function parse_(raw: string | null): AgentTeamDefinition | null {
    if (!raw) return null;
    try {
      const obj = JSON.parse(raw) as AgentTeamDefinition;
      if (!obj || !obj.id || !obj.name) return null;
      return obj;
    } catch (_) {
      return null;
    }
  }

  function generateId_(): string {
    return Utilities.getUuid().replace(/-/g, '');
  }

  function currentUserEmail_(): string {
    try { return Session.getActiveUser().getEmail() ?? ''; } catch (_) { return ''; }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Returns all teams visible to the current user:
   * user-owned (UserProperties) + document-shared (DocumentProperties).
   * Document-level definitions take precedence over user-level ones
   * with the same id.
   */
  function listAll(): AgentTeamDefinition[] {
    const byId = new Map<string, AgentTeamDefinition>();

    // Document-shared (lower precedence than user-owned)
    for (const [key, raw] of Object.entries(docProps_().getProperties())) {
      if (!key.startsWith(DOC_PREFIX)) continue;
      const t = parse_(raw);
      if (t) byId.set(t.id, t);
    }

    // User-owned (highest precedence)
    for (const [key, raw] of Object.entries(userProps_().getProperties())) {
      if (!key.startsWith(USER_PREFIX)) continue;
      const t = parse_(raw);
      if (t) byId.set(t.id, t);
    }

    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Saves (creates or updates) a team definition.
   * @throws Error on validation failure.
   */
  function save(def: Partial<AgentTeamDefinition>): AgentTeamDefinition {
    if (!def.name?.trim()) throw new Error('Team name is required.');
    if (!Array.isArray(def.agentIds) || def.agentIds.length === 0) {
      throw new Error('A team must contain at least one agent.');
    }

    const id = def.id || generateId_();
    const existing = findById_(id);

    const saved: AgentTeamDefinition = {
      id,
      name:      def.name.trim(),
      agentIds:  def.agentIds,
      storedIn:  def.storedIn ?? 'user',
      ownerEmail: def.ownerEmail,
      createdAt: existing?.createdAt ?? Date.now(),
    };

    if (saved.storedIn === 'document') {
      if (!saved.ownerEmail) saved.ownerEmail = currentUserEmail_();
      docProps_().setProperty(DOC_PREFIX + id, JSON.stringify(saved));
      userProps_().deleteProperty(USER_PREFIX + id);
    } else {
      userProps_().setProperty(USER_PREFIX + id, JSON.stringify(saved));
      docProps_().deleteProperty(DOC_PREFIX + id);
    }

    Tracer.info(`[AgentTeamService] save: id=${id} name="${saved.name}" storedIn=${saved.storedIn}`);
    return saved;
  }

  /**
   * Deletes a team by id. Only the owner can delete a document-shared team.
   */
  function remove(id: string): void {
    const def = findById_(id);
    if (!def) { Tracer.warn(`[AgentTeamService] remove: id=${id} not found`); return; }

    if (def.storedIn === 'document') {
      const email = currentUserEmail_();
      if (def.ownerEmail && email && def.ownerEmail !== email) {
        throw new Error(`Only the owner (${def.ownerEmail}) can delete this shared team.`);
      }
      docProps_().deleteProperty(DOC_PREFIX + id);
    } else {
      userProps_().deleteProperty(USER_PREFIX + id);
    }
    Tracer.info(`[AgentTeamService] remove: deleted id=${id}`);
  }

  /**
   * Promotes a user-owned team to Document Properties so collaborators can use it.
   */
  function promoteToDocument(id: string): AgentTeamDefinition {
    const def = findById_(id);
    if (!def) throw new Error(`Team id=${id} not found.`);
    const promoted: AgentTeamDefinition = {
      ...def,
      storedIn:   'document',
      ownerEmail: currentUserEmail_() || def.ownerEmail,
    };
    docProps_().setProperty(DOC_PREFIX + id, JSON.stringify(promoted));
    userProps_().deleteProperty(USER_PREFIX + id);
    return promoted;
  }

  /**
   * Moves a document-shared team back to User Properties (owner only).
   */
  function demoteToUser(id: string): AgentTeamDefinition {
    const def = findById_(id);
    if (!def) throw new Error(`Team id=${id} not found.`);
    const email = currentUserEmail_();
    if (def.ownerEmail && email && def.ownerEmail !== email) {
      throw new Error(`Only the owner (${def.ownerEmail}) can unshare this team.`);
    }
    const demoted: AgentTeamDefinition = { ...def, storedIn: 'user' };
    userProps_().setProperty(USER_PREFIX + id, JSON.stringify(demoted));
    docProps_().deleteProperty(DOC_PREFIX + id);
    return demoted;
  }

  /**
   * Exports teams to a portable JSON string.
   * When ids is omitted all visible teams are exported.
   */
  function exportTeams(ids?: string[]): string {
    const all = listAll();
    const targets = ids && ids.length ? all.filter(t => ids.includes(t.id)) : all;
    const payload: AgentTeamExportPayload = {
      version:    1,
      exportedAt: new Date().toISOString(),
      teams:      targets,
    };
    Tracer.info(`[AgentTeamService] exportTeams: exported ${targets.length} team(s)`);
    return JSON.stringify(payload, null, 2);
  }

  /**
   * Imports teams from a JSON string produced by exportTeams().
   * Teams with name collisions are skipped.
   */
  function importTeams(json: string): { imported: number; skipped: string[]; errors: string[] } {
    let payload: AgentTeamExportPayload;
    try {
      payload = JSON.parse(json) as AgentTeamExportPayload;
    } catch (_) {
      return { imported: 0, skipped: [], errors: ['Invalid JSON.'] };
    }
    if (!payload || !Array.isArray(payload.teams)) {
      return { imported: 0, skipped: [], errors: ['Missing "teams" array.'] };
    }

    let imported = 0;
    const skipped: string[] = [];
    const errors: string[] = [];
    const existing = listAll();

    for (const team of payload.teams) {
      if (!team.name || !Array.isArray(team.agentIds)) {
        errors.push('Skipping incomplete team entry.'); continue;
      }
      if (existing.find(t => t.name === team.name)) {
        skipped.push(`${team.name} — name already exists`); continue;
      }
      try {
        // Assign a fresh id so there's no collision with existing definitions.
        save({ ...team, id: undefined, storedIn: 'user' });
        imported++;
      } catch (e: any) {
        errors.push(`${team.name}: ${e.message}`);
      }
    }

    Tracer.info(`[AgentTeamService] importTeams: imported=${imported} skipped=${skipped.length}`);
    return { imported, skipped, errors };
  }

  /** Looks up a team by id across both property stores. */
  function findById_(id: string): AgentTeamDefinition | null {
    return parse_(userProps_().getProperty(USER_PREFIX + id)) ||
           parse_(docProps_().getProperty(DOC_PREFIX + id));
  }

  return { listAll, save, remove, promoteToDocument, demoteToUser, exportTeams, importTeams, findById: findById_ };
})();
