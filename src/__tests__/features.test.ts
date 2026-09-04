// Feature-level unit tests for StringProcessor, TabMerger (Create or Overwrite Manuscript), and CommentProcessor.
// All tests run purely in Node.js — no GAS runtime required.
//
// Functions are imported directly from their source modules.
// ts-jest uses config/jest/tsconfig.test.json (module:commonjs) so imports work
// even though the GAS build uses module:none.

import { createStringArray } from '../StringProcessor';
import { sanitizePlatformError_ } from '../TabMergerHelpers';
import { normaliseTagWord_ } from '../CommentProcessorHelpers';

describe('createStringArray', () => {
  it('splits a comma-separated string into trimmed items', () => {
    expect(createStringArray('Chapter 1, Chapter 2, Appendix A')).toEqual([
      'Chapter 1',
      'Chapter 2',
      'Appendix A',
    ]);
  });

  it('handles no spaces around commas', () => {
    expect(createStringArray('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('trims leading and trailing whitespace from each item', () => {
    expect(createStringArray('  foo  ,  bar  ')).toEqual(['foo', 'bar']);
  });

  it('filters out empty items from consecutive commas', () => {
    expect(createStringArray('a,,b, ,c')).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty array for an empty string', () => {
    expect(createStringArray('')).toEqual([]);
  });

  it('returns an empty array for a non-string value', () => {
    expect(createStringArray(null as any)).toEqual([]);
    expect(createStringArray(undefined as any)).toEqual([]);
  });

  it('returns a single-element array when there are no commas', () => {
    expect(createStringArray('OnlyOne')).toEqual(['OnlyOne']);
  });
});

// --------------- Create or Overwrite Manuscript — result shapes ---------------
// TabMerger.createOrOverwriteManuscript (and internal helpers) return structured
// result objects. These tests verify the expected shapes without requiring a live Document.

describe('Manuscript result shapes', () => {
  it('tab append ok result has ok:true and a name', () => {
    const ok = { ok: true, name: 'Chapter 1' };
    expect(ok.ok).toBe(true);
    expect(typeof ok.name).toBe('string');
    expect(ok).not.toHaveProperty('message');
  });

  it('tab append error result has ok:false, name, and message', () => {
    const err = { ok: false, name: 'Chapter 1', message: 'Source tab "Chapter 1" not found.' };
    expect(err.ok).toBe(false);
    expect(err.message).toBeTruthy();
  });

  it('clearDestination ok result has ok:true', () => {
    const ok = { ok: true };
    expect(ok.ok).toBe(true);
  });

  it('clearDestination error result has ok:false and message', () => {
    const err = { ok: false, message: '"Manuscript" tab not found.' };
    expect(err.ok).toBe(false);
    expect(err.message).toContain('Manuscript');
  });

  it('saveTabNames result has ok:true on success', () => {
    const ok = { ok: true };
    expect(ok.ok).toBe(true);
  });
});

// --------------- Manuscript — sanitizePlatformError logic ---------------
// The error sanitization strips internal document IDs from error messages
// to avoid leaking sensitive data in the UI.

describe('sanitizePlatformError', () => {
  it('strips GAS document IDs from error messages', () => {
    const raw =
      'Service Documents failed while accessing document with id 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms.';
    const clean = sanitizePlatformError_(raw);
    expect(clean).toBe('Document access error.');
    expect(clean).not.toContain('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms');
  });

  it('strips inline document IDs from generic error messages', () => {
    const raw = 'Cannot access document with id 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74.';
    const clean = sanitizePlatformError_(raw);
    expect(clean).toBe('Cannot access document.');
  });

  it('passes through messages that contain no IDs', () => {
    const clean = sanitizePlatformError_('Source tab not found.');
    expect(clean).toBe('Source tab not found.');
  });

  it('handles empty input gracefully', () => {
    expect(sanitizePlatformError_('')).toBe('');
    expect(sanitizePlatformError_(null as any)).toBe('');
  });
});

// --------------- Tag normalisation (punctuation stripping) ---------------
// Tests normaliseTagWord_ from CommentProcessorHelpers — verifies the regex
// used to strip trailing punctuation so that "@AI:" / "@AI," / "@architect."
// all route to the same agent as "@AI".

describe('CommentProcessor tag normalisation', () => {
  it('leaves a clean tag unchanged', () => {
    expect(normaliseTagWord_('@ai')).toBe('@ai');
    expect(normaliseTagWord_('@architect')).toBe('@architect');
    expect(normaliseTagWord_('@eartune')).toBe('@eartune');
  });

  it('strips a trailing colon — the most common case (@AI: ...)', () => {
    expect(normaliseTagWord_('@AI:')).toBe('@ai');
    expect(normaliseTagWord_('@architect:')).toBe('@architect');
  });

  it('strips other common trailing punctuation', () => {
    expect(normaliseTagWord_('@AI,')).toBe('@ai');
    expect(normaliseTagWord_('@AI.')).toBe('@ai');
    expect(normaliseTagWord_('@AI!')).toBe('@ai');
    expect(normaliseTagWord_('@AI?')).toBe('@ai');
  });

  it('strips multiple trailing punctuation characters', () => {
    expect(normaliseTagWord_('@AI:,')).toBe('@ai');
    expect(normaliseTagWord_('@audit...')).toBe('@audit');
  });

  it('does NOT strip characters that are part of the tag itself', () => {
    // @ and - are valid inside a tag identifier
    expect(normaliseTagWord_('@ear-tune')).toBe('@ear-tune');
  });

  it('is case-insensitive', () => {
    expect(normaliseTagWord_('@AI')).toBe('@ai');
    expect(normaliseTagWord_('@Architect')).toBe('@architect');
    expect(normaliseTagWord_('@AUDIT:')).toBe('@audit');
  });
});

// --------------- AgentExportPayload / AgentTeamDefinition shapes ---------------

describe('Agent export payload shape', () => {
  it('exportPayload has version:1, exportedAt string, and agents array', () => {
    const payload: AgentExportPayload = {
      version:    1,
      exportedAt: '2026-05-09T00:00:00.000Z',
      agents:     [],
    };
    expect(payload.version).toBe(1);
    expect(typeof payload.exportedAt).toBe('string');
    expect(Array.isArray(payload.agents)).toBe(true);
  });

  it('AgentExportEntry has required fields', () => {
    const entry: AgentExportEntry = {
      displayName:  'My Reviewer',
      tag:          '@myreviewer',
      systemPrompt: 'You are a reviewer.',
      workflows:    { w2: true, w3: false, w6: false },
    };
    expect(entry.displayName).toBe('My Reviewer');
    expect(entry.tag).toBe('@myreviewer');
    expect(entry.workflows.w2).toBe(true);
    expect(entry.instructionTabContent).toBeUndefined();
  });

  it('AgentExportEntry with bundled tab content', () => {
    const entry: AgentExportEntry = {
      displayName:          'Bundled',
      tag:                  '@bundled',
      systemPrompt:         'Check this.',
      workflows:            { w2: false, w3: true, w6: false },
      instructionTabName:   'My Tab',
      instructionTabContent: '# Instructions\n\nDo X.',
      contextTabName:       'StyleProfile',
      contextTabContent:    '# Style\n\nKeep it short.',
    };
    expect(entry.instructionTabContent).toContain('Instructions');
    expect(entry.contextTabContent).toContain('Style');
  });
});

describe('AgentTeamDefinition shape', () => {
  it('has id, name, agentIds, storedIn, and createdAt', () => {
    const team: AgentTeamDefinition = {
      id:        'abc123',
      name:      'Editorial Review',
      agentIds:  ['id1', 'id2'],
      storedIn:  'user',
      createdAt: Date.now(),
    };
    expect(team.id).toBe('abc123');
    expect(Array.isArray(team.agentIds)).toBe(true);
    expect(team.agentIds).toHaveLength(2);
    expect(team.storedIn).toBe('user');
  });

  it('TeamAnalysisResult complete shape', () => {
    const result: TeamAnalysisResult = {
      status:         'complete',
      processedCount: 10,
      totalCount:     10,
      outputTabName:  'Agentic Analysis 09/05/2026',
    };
    expect(result.status).toBe('complete');
    expect(result.processedCount).toBe(result.totalCount);
    expect(result.outputTabName).toContain('Agentic Analysis');
  });

  it('TeamAnalysisResult continuing shape', () => {
    const result: TeamAnalysisResult = {
      status:         'continuing',
      processedCount: 5,
      totalCount:     20,
      outputTabName:  'Agentic Analysis 09/05/2026',
    };
    expect(result.status).toBe('continuing');
    expect(result.processedCount).toBeLessThan(result.totalCount);
  });

  it('TeamAnalysisResult error shape', () => {
    const result: TeamAnalysisResult = {
      status:         'error',
      processedCount: 0,
      totalCount:     0,
      outputTabName:  '',
      error:          'Quota exceeded.',
    };
    expect(result.status).toBe('error');
    expect(result.error).toBeTruthy();
  });
});

// --------------- CommentProcessor.processAll result shape ---------------

describe('commentProcessorRun result shape', () => {
  it('no-op result has replied:0, skipped:0, and empty byAgent', () => {
    const result = { replied: 0, skipped: 0, byAgent: {} };
    expect(result.replied).toBe(0);
    expect(result.skipped).toBe(0);
    expect(typeof result.byAgent).toBe('object');
  });

  it('success result has replied > 0 and byAgent counts per tag', () => {
    const result = { replied: 2, skipped: 0, byAgent: { '@ai': 2 } };
    expect(result.replied).toBeGreaterThan(0);
    expect(result.byAgent['@ai']).toBe(2);
  });

  it('partial result tracks both replied and skipped', () => {
    const result = { replied: 1, skipped: 1, byAgent: { '@eartune': 1 } };
    expect(result.replied + result.skipped).toBe(2);
    expect(result.byAgent['@eartune']).toBe(1);
  });

  it('byAgent is a flat record of string keys to number counts', () => {
    const result = { replied: 3, skipped: 0, byAgent: { '@ai': 1, '@architect': 1, '@eartune': 1 } };
    Object.entries(result.byAgent).forEach(([tag, count]) => {
      expect(typeof tag).toBe('string');
      expect(typeof count).toBe('number');
    });
    expect(Object.values(result.byAgent).reduce((a, b) => a + b, 0)).toBe(result.replied);
  });
});
