// ============================================================
// customAgentService.test.ts — Unit tests for CustomAgentService CRUD.
//
// Loads the compiled IIFE from dist/ via the standard vm-context pattern.
// Run `npm run build` before this test suite.
// ============================================================

import { loadCompiledGlobal } from './helpers/gasVmContext';

// ── Helpers ──────────────────────────────────────────────────────────────────

type PropStore = Record<string, string>;

function makePropsMock(initial: PropStore = {}) {
  const store: PropStore = { ...initial };
  return {
    getProperty:  jest.fn((k: string) => store[k] ?? null),
    getProperties: jest.fn(() => ({ ...store })),
    setProperty:  jest.fn((k: string, v: string) => { store[k] = v; }),
    deleteProperty: jest.fn((k: string) => { delete store[k]; }),
    _store: store,
  };
}

function setupGlobals(userStore: PropStore = {}, docStore: PropStore = {}, scriptStore: PropStore = {}) {
  const userProps   = makePropsMock(userStore);
  const docProps    = makePropsMock(docStore);
  const scriptProps = makePropsMock(scriptStore);

  (global as any).PropertiesService = {
    getUserProperties:      jest.fn(() => userProps),
    getDocumentProperties:  jest.fn(() => docProps),
    getScriptProperties:    jest.fn(() => scriptProps),
  };
  (global as any).Session = {
    getActiveUser: jest.fn(() => ({ getEmail: jest.fn(() => 'owner@example.com') })),
  };
  (global as any).Utilities = {
    getUuid: jest.fn(() => 'aaaa-bbbb-cccc-dddd-eeee'),
    sleep: jest.fn(),
  };
  (global as any).Tracer = {
    info:  jest.fn(),
    warn:  jest.fn(),
    error: jest.fn(),
  };
  // DocOps.getTabByName — returns a truthy value for "KnownTab", null for others.
  (global as any).DocOps = {
    getTabByName: jest.fn((name: string) => name === 'KnownTab' ? {} : null),
  };
  return { userProps, docProps, scriptProps };
}

function loadService() {
  loadCompiledGlobal('Constants', 'Constants.js');
  loadCompiledGlobal('CustomAgentService', 'CustomAgentService.js');
  return (global as any).CustomAgentService;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CustomAgentService', () => {

  beforeEach(() => {
    setupGlobals();
    loadService();
  });

  const validDef = () => ({
    displayName:        'My Reviewer',
    tag:                '@myreviewer',
    instructionTabName: 'KnownTab',
    systemPrompt:       'You are a helpful reviewer.',
    workflows:          { w2: true, w3: false },
  });

  // ── listAll ────────────────────────────────────────────────────────────────

  describe('listAll', () => {
    it('returns empty array when no agents are stored', () => {
      const svc = (global as any).CustomAgentService;
      expect(svc.listAll()).toEqual([]);
    });

    it('returns agents from UserProperties', () => {
      const def: CustomAgentDefinition = {
        id: 'abc123', displayName: 'Test', tag: '@test',
        instructionTabName: 'Tab', systemPrompt: 'p',
        workflows: { w2: true, w3: false, w6: false },
        storedIn: 'user', createdAt: 1000,
      };
      setupGlobals({ 'custom_agent::abc123': JSON.stringify(def) });
      loadService();
      const svc = (global as any).CustomAgentService;
      const result = svc.listAll();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('abc123');
    });

    it('returns agents from DocumentProperties', () => {
      const def: CustomAgentDefinition = {
        id: 'doc1', displayName: 'Shared', tag: '@shared',
        instructionTabName: 'Tab', systemPrompt: 'p',
        workflows: { w2: false, w3: true, w6: false },
        storedIn: 'document', ownerEmail: 'owner@example.com', createdAt: 2000,
      };
      setupGlobals({}, { 'doc_custom_agent::doc1': JSON.stringify(def) });
      loadService();
      const svc = (global as any).CustomAgentService;
      const result = svc.listAll();
      expect(result).toHaveLength(1);
      expect(result[0].storedIn).toBe('document');
    });

    it('user agent overrides doc agent with same id (personal wins)', () => {
      const base = {
        id: 'same', instructionTabName: 'Tab', systemPrompt: 'p',
        workflows: { w2: true, w3: false, w6: false }, createdAt: 1000,
      };
      const user: CustomAgentDefinition = { ...base, displayName: 'User Version', tag: '@u', storedIn: 'user' };
      const doc:  CustomAgentDefinition = { ...base, displayName: 'Doc Version',  tag: '@u', storedIn: 'document', ownerEmail: 'o@x.com' };
      setupGlobals(
        { 'custom_agent::same': JSON.stringify(user) },
        { 'doc_custom_agent::same': JSON.stringify(doc) },
      );
      loadService();
      const svc = (global as any).CustomAgentService;
      const result = svc.listAll();
      expect(result).toHaveLength(1);
      expect(result[0].displayName).toBe('User Version');
    });
  });

  // ── save (validation) ──────────────────────────────────────────────────────

  describe('save — validation', () => {
    it('throws when displayName is missing', () => {
      const svc = (global as any).CustomAgentService;
      expect(() => svc.save({ ...validDef(), displayName: '' }))
        .toThrow('Agent name is required.');
    });

    it('throws when tag is missing', () => {
      const svc = (global as any).CustomAgentService;
      expect(() => svc.save({ ...validDef(), tag: '' }))
        .toThrow('Tag is required.');
    });

    it('throws when tag does not start with @', () => {
      const svc = (global as any).CustomAgentService;
      expect(() => svc.save({ ...validDef(), tag: 'myreviewer' }))
        .toThrow('Tag must start with @.');
    });

    it('throws when tag contains invalid characters', () => {
      const svc = (global as any).CustomAgentService;
      expect(() => svc.save({ ...validDef(), tag: '@my reviewer' }))
        .toThrow('only lowercase letters');
    });

    it('throws on reserved tag @eartune', () => {
      const svc = (global as any).CustomAgentService;
      expect(() => svc.save({ ...validDef(), tag: '@eartune' }))
        .toThrow('reserved');
    });

    it('throws on reserved tag @tts', () => {
      const svc = (global as any).CustomAgentService;
      expect(() => svc.save({ ...validDef(), tag: '@tts' }))
        .toThrow('reserved');
    });

    it('saves successfully when instructionTabName is omitted', () => {
      const svc = (global as any).CustomAgentService;
      expect(() => svc.save({ ...validDef(), instructionTabName: undefined })).not.toThrow();
    });

    it('saves successfully when instructionTabName is empty string', () => {
      const svc = (global as any).CustomAgentService;
      expect(() => svc.save({ ...validDef(), instructionTabName: '' })).not.toThrow();
    });

    it('stores undefined instructionTabName when omitted', () => {
      const { userProps } = setupGlobals();
      loadService();
      const svc = (global as any).CustomAgentService;
      const saved = svc.save({ ...validDef(), instructionTabName: undefined });
      expect(saved.instructionTabName).toBeUndefined();
      const stored = JSON.parse(userProps._store['custom_agent::' + saved.id]);
      expect(stored.instructionTabName).toBeUndefined();
    });

    it('throws when context tab does not exist', () => {
      const svc = (global as any).CustomAgentService;
      expect(() => svc.save({ ...validDef(), contextTabName: 'NonExistentTab' }))
        .toThrow('does not exist');
    });

    it('accepts a valid context tab that exists', () => {
      const svc = (global as any).CustomAgentService;
      // KnownTab returns truthy from mock DocOps
      expect(() => svc.save({ ...validDef(), contextTabName: 'KnownTab' }))
        .not.toThrow();
    });

    it('throws when tag collides with an existing custom agent', () => {
      const existing: CustomAgentDefinition = {
        id: 'existing1', displayName: 'Existing', tag: '@myreviewer',
        instructionTabName: 'Tab', systemPrompt: 'p',
        workflows: { w2: true, w3: false, w6: false }, storedIn: 'user', createdAt: 1000,
      };
      setupGlobals({ 'custom_agent::existing1': JSON.stringify(existing) });
      loadService();
      const svc = (global as any).CustomAgentService;
      expect(() => svc.save(validDef()))
        .toThrow('already used by agent');
    });
  });

  // ── save (persistence) ─────────────────────────────────────────────────────

  describe('save — persistence', () => {
    it('stores a new agent in UserProperties by default', () => {
      const { userProps } = setupGlobals();
      loadService();
      const svc = (global as any).CustomAgentService;
      const saved = svc.save(validDef());
      expect(saved.id).toBeTruthy();
      expect(saved.storedIn).toBe('user');
      expect(userProps.setProperty).toHaveBeenCalledWith(
        'custom_agent::' + saved.id,
        expect.stringContaining('"displayName":"My Reviewer"'),
      );
    });

    it('stores an agent in DocumentProperties when storedIn=document', () => {
      const { docProps } = setupGlobals();
      loadService();
      const svc = (global as any).CustomAgentService;
      const saved = svc.save({ ...validDef(), storedIn: 'document' });
      expect(saved.storedIn).toBe('document');
      expect(saved.ownerEmail).toBe('owner@example.com');
      expect(docProps.setProperty).toHaveBeenCalledWith(
        'doc_custom_agent::' + saved.id,
        expect.stringContaining('"storedIn":"document"'),
      );
    });

    it('preserves createdAt on update', () => {
      const original: CustomAgentDefinition = {
        id: 'upd1', displayName: 'Old Name', tag: '@updater',
        instructionTabName: 'KnownTab', systemPrompt: 'p',
        workflows: { w2: true, w3: false, w6: false }, storedIn: 'user', createdAt: 9999,
      };
      setupGlobals({ 'custom_agent::upd1': JSON.stringify(original) });
      loadService();
      const svc = (global as any).CustomAgentService;
      const updated = svc.save({ ...original, displayName: 'New Name' });
      expect(updated.createdAt).toBe(9999);
      expect(updated.displayName).toBe('New Name');
    });
  });

  // ── remove ─────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('deletes a user-stored agent', () => {
      const def: CustomAgentDefinition = {
        id: 'del1', displayName: 'D', tag: '@del',
        instructionTabName: 'Tab', systemPrompt: 'p',
        workflows: { w2: false, w3: false, w6: false }, storedIn: 'user', createdAt: 1,
      };
      const { userProps } = setupGlobals({ 'custom_agent::del1': JSON.stringify(def) });
      loadService();
      const svc = (global as any).CustomAgentService;
      svc.remove('del1');
      expect(userProps.deleteProperty).toHaveBeenCalledWith('custom_agent::del1');
    });

    it('throws when a non-owner tries to delete a document-shared agent', () => {
      const def: CustomAgentDefinition = {
        id: 'doc2', displayName: 'D', tag: '@doc',
        instructionTabName: 'Tab', systemPrompt: 'p',
        workflows: { w2: false, w3: false, w6: false },
        storedIn: 'document', ownerEmail: 'someone-else@example.com', createdAt: 1,
      };
      setupGlobals({}, { 'doc_custom_agent::doc2': JSON.stringify(def) });
      loadService();
      const svc = (global as any).CustomAgentService;
      expect(() => svc.remove('doc2')).toThrow('Only the owner');
    });
  });

  // ── promoteToDocument / demoteToUser ───────────────────────────────────────

  describe('promoteToDocument', () => {
    it('moves agent from UserProperties to DocumentProperties', () => {
      const def: CustomAgentDefinition = {
        id: 'promo1', displayName: 'P', tag: '@promo',
        instructionTabName: 'Tab', systemPrompt: 'p',
        workflows: { w2: true, w3: false, w6: false }, storedIn: 'user', createdAt: 1,
      };
      const { userProps, docProps } = setupGlobals({ 'custom_agent::promo1': JSON.stringify(def) });
      loadService();
      const svc = (global as any).CustomAgentService;
      const promoted = svc.promoteToDocument('promo1');
      expect(promoted.storedIn).toBe('document');
      expect(promoted.ownerEmail).toBe('owner@example.com');
      expect(docProps.setProperty).toHaveBeenCalledWith(
        'doc_custom_agent::promo1',
        expect.stringContaining('"storedIn":"document"'),
      );
      expect(userProps.deleteProperty).toHaveBeenCalledWith('custom_agent::promo1');
    });
  });

  // ── script scope ───────────────────────────────────────────────────────────

  describe('script scope (Share with everyone)', () => {
    it('returns script-stored agents from listAll', () => {
      const def: CustomAgentDefinition = {
        id: 'scr1', displayName: 'Global', tag: '@global',
        instructionTabName: 'Tab', systemPrompt: 'p',
        workflows: { w2: true, w3: false, w6: false },
        storedIn: 'script', ownerEmail: 'owner@example.com', createdAt: 3000,
      };
      setupGlobals({}, {}, { 'script_custom_agent::scr1': JSON.stringify(def) });
      loadService();
      const svc = (global as any).CustomAgentService;
      const result = svc.listAll();
      expect(result).toHaveLength(1);
      expect(result[0].storedIn).toBe('script');
    });

    it('user agent overrides script agent with same id', () => {
      const base = {
        id: 'same2', instructionTabName: 'Tab', systemPrompt: 'p',
        workflows: { w2: true, w3: false, w6: false }, createdAt: 1,
      };
      const script: CustomAgentDefinition = { ...base, displayName: 'Script Version', tag: '@u2', storedIn: 'script', ownerEmail: 'o@x.com' };
      const user: CustomAgentDefinition   = { ...base, displayName: 'User Version',   tag: '@u2', storedIn: 'user' };
      setupGlobals(
        { 'custom_agent::same2': JSON.stringify(user) },
        {},
        { 'script_custom_agent::same2': JSON.stringify(script) },
      );
      loadService();
      const svc = (global as any).CustomAgentService;
      const result = svc.listAll();
      expect(result).toHaveLength(1);
      expect(result[0].displayName).toBe('User Version');
    });

    it('stores a new agent in ScriptProperties when storedIn=script', () => {
      const { scriptProps } = setupGlobals();
      loadService();
      const svc = (global as any).CustomAgentService;
      const saved = svc.save({ ...validDef(), storedIn: 'script' });
      expect(saved.storedIn).toBe('script');
      expect(saved.ownerEmail).toBe('owner@example.com');
      expect(scriptProps.setProperty).toHaveBeenCalledWith(
        'script_custom_agent::' + saved.id,
        expect.stringContaining('"storedIn":"script"'),
      );
    });

    it('cleans up UserProperties and DocProperties when saving to script scope', () => {
      const { userProps, docProps, scriptProps } = setupGlobals();
      loadService();
      const svc = (global as any).CustomAgentService;
      const saved = svc.save({ ...validDef(), storedIn: 'script' });
      expect(userProps.deleteProperty).toHaveBeenCalledWith('custom_agent::' + saved.id);
      expect(docProps.deleteProperty).toHaveBeenCalledWith('doc_custom_agent::' + saved.id);
      expect(scriptProps.setProperty).toHaveBeenCalled();
    });

    it('throws when a non-owner tries to delete a script-shared agent', () => {
      const def: CustomAgentDefinition = {
        id: 'scr2', displayName: 'G', tag: '@g',
        instructionTabName: 'Tab', systemPrompt: 'p',
        workflows: { w2: false, w3: false, w6: false },
        storedIn: 'script', ownerEmail: 'someone-else@example.com', createdAt: 1,
      };
      setupGlobals({}, {}, { 'script_custom_agent::scr2': JSON.stringify(def) });
      loadService();
      const svc = (global as any).CustomAgentService;
      expect(() => svc.remove('scr2')).toThrow('Only the owner');
    });

    it('promoteToScript moves agent from UserProperties to ScriptProperties', () => {
      const def: CustomAgentDefinition = {
        id: 'promo2', displayName: 'P2', tag: '@promo2',
        instructionTabName: 'Tab', systemPrompt: 'p',
        workflows: { w2: true, w3: false, w6: false }, storedIn: 'user', createdAt: 1,
      };
      const { userProps, scriptProps } = setupGlobals({ 'custom_agent::promo2': JSON.stringify(def) });
      loadService();
      const svc = (global as any).CustomAgentService;
      const promoted = svc.promoteToScript('promo2');
      expect(promoted.storedIn).toBe('script');
      expect(promoted.ownerEmail).toBe('owner@example.com');
      expect(scriptProps.setProperty).toHaveBeenCalledWith(
        'script_custom_agent::promo2',
        expect.stringContaining('"storedIn":"script"'),
      );
      expect(userProps.deleteProperty).toHaveBeenCalledWith('custom_agent::promo2');
    });
  });

  // ── RESERVED_TAGS ──────────────────────────────────────────────────────────

  describe('RESERVED_TAGS', () => {
    it('exposes the reserved tag set', () => {
      const svc = (global as any).CustomAgentService;
      expect(svc.RESERVED_TAGS.has('@eartune')).toBe(true);
      expect(svc.RESERVED_TAGS.has('@tts')).toBe(true);
      expect(svc.RESERVED_TAGS.has('@ai')).toBe(true);
      expect(svc.RESERVED_TAGS.has('@myreviewer')).toBe(false);
    });
  });
});
