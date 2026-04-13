// ============================================================
// tracer.test.ts — Unit tests for Tracer multi-job logging
//
// These tests load the REAL compiled Tracer.js (not the mock)
// against the CacheService in-memory mock from jest.setup.js.
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

// Load the real Tracer implementation (replaces the mock global)
const fs = require('fs');
const path = require('path');
const tracerSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'dist', 'Tracer.js'),
  'utf8'
);

function loadRealTracer(): void {
  // Reset the cache before loading — ensures clean state
  const freshCache = (global as any).CacheService._createMockCache();
  (global as any).CacheService.getUserCache.mockReturnValue(freshCache);
  (global as any).CacheService._mockUserCache = freshCache;

  // Reset Logger so Tracer's Logger.log calls hit our mock
  (global as any).Logger = { log: jest.fn() };

  // The compiled JS uses `const Tracer = (() => { ... })();`
  // In eval, `const` is block-scoped and won't assign to global.Tracer.
  // We replace it so the IIFE result goes to the existing global.
  const patchedSource = tracerSource.replace(
    /^const Tracer\b/m,
    'Tracer'
  );
  // eslint-disable-next-line no-eval
  const fn = new Function(patchedSource);
  fn();
}

describe('Tracer — multi-job logging', () => {

  beforeEach(() => {
    loadRealTracer();
  });

  describe('startJob + getJobList', () => {

    it('creates a job and returns it in getJobList', () => {
      (global as any).Tracer.startJob('EarTune → "Chapter 1"');
      const jobs = (global as any).Tracer.getJobList();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].label).toBe('EarTune → "Chapter 1"');
      expect(typeof jobs[0].id).toBe('string');
      expect(typeof jobs[0].startedAt).toBe('string');
    });

    it('newest job is first in the list', () => {
      (global as any).Tracer.startJob('Job A');
      (global as any).Tracer.startJob('Job B');
      (global as any).Tracer.startJob('Job C');
      const jobs = (global as any).Tracer.getJobList();
      expect(jobs).toHaveLength(3);
      expect(jobs[0].label).toBe('Job C');
      expect(jobs[1].label).toBe('Job B');
      expect(jobs[2].label).toBe('Job A');
    });

    it('caps at MAX_JOBS (10) and evicts oldest', () => {
      for (let i = 0; i < 12; i++) {
        (global as any).Tracer.startJob(`Job ${i}`);
      }
      const jobs = (global as any).Tracer.getJobList();
      expect(jobs).toHaveLength(10);
      expect(jobs[0].label).toBe('Job 11');  // newest
      expect(jobs[9].label).toBe('Job 2');   // oldest surviving
    });
  });

  describe('info/warn/error → getLogs', () => {

    it('logs entries to the active job', () => {
      (global as any).Tracer.startJob('Test Job');
      const jobs = (global as any).Tracer.getJobList();
      const jobId = jobs[0].id;

      (global as any).Tracer.info('step 1');
      (global as any).Tracer.warn('caution');
      (global as any).Tracer.error('boom');

      const entries = (global as any).Tracer.getLogs(jobId, 0);
      expect(entries).toHaveLength(3);
      expect(entries[0].level).toBe('INFO');
      expect(entries[0].msg).toBe('step 1');
      expect(entries[1].level).toBe('WARN');
      expect(entries[1].msg).toBe('caution');
      expect(entries[2].level).toBe('ERROR');
      expect(entries[2].msg).toBe('boom');
    });

    it('getLogs with sinceSeq returns only newer entries', () => {
      (global as any).Tracer.startJob('Test Job');
      const jobId = (global as any).Tracer.getJobList()[0].id;

      (global as any).Tracer.info('msg 1');
      (global as any).Tracer.info('msg 2');
      (global as any).Tracer.info('msg 3');

      const afterFirst = (global as any).Tracer.getLogs(jobId, 1);
      expect(afterFirst).toHaveLength(2);
      expect(afterFirst[0].msg).toBe('msg 2');
      expect(afterFirst[1].msg).toBe('msg 3');

      const afterAll = (global as any).Tracer.getLogs(jobId, 3);
      expect(afterAll).toHaveLength(0);
    });

    it('entries have seq, level, msg, and ts fields', () => {
      (global as any).Tracer.startJob('Test Job');
      const jobId = (global as any).Tracer.getJobList()[0].id;
      (global as any).Tracer.info('hello');
      const entries = (global as any).Tracer.getLogs(jobId, 0);
      expect(entries).toHaveLength(1);
      const entry = entries[0];
      expect(entry.seq).toBe(1);
      expect(entry.level).toBe('INFO');
      expect(entry.msg).toBe('hello');
      expect(entry.ts).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
    });
  });

  describe('multi-job isolation', () => {

    it('logs go to the active job only', () => {
      (global as any).Tracer.startJob('Job A');
      const jobA = (global as any).Tracer.getJobList()[0].id;
      (global as any).Tracer.info('A message');

      (global as any).Tracer.startJob('Job B');
      const jobB = (global as any).Tracer.getJobList()[0].id;
      (global as any).Tracer.info('B message');

      const aEntries = (global as any).Tracer.getLogs(jobA, 0);
      const bEntries = (global as any).Tracer.getLogs(jobB, 0);
      expect(aEntries).toHaveLength(1);
      expect(aEntries[0].msg).toBe('A message');
      expect(bEntries).toHaveLength(1);
      expect(bEntries[0].msg).toBe('B message');
    });

    it('status is independent per job', () => {
      (global as any).Tracer.startJob('Job A');
      const jobA = (global as any).Tracer.getJobList()[0].id;
      (global as any).Tracer.finishJob();

      (global as any).Tracer.startJob('Job B');
      const jobB = (global as any).Tracer.getJobList()[0].id;

      const statusA = (global as any).Tracer.getJobStatus(jobA);
      const statusB = (global as any).Tracer.getJobStatus(jobB);
      expect(statusA.done).toBe(true);
      expect(statusA.error).toBeNull();
      expect(statusB.done).toBe(false);
      expect(statusB.error).toBeNull();
    });
  });

  describe('finishJob / failJob / getJobStatus', () => {

    it('initially job status is running (done=false)', () => {
      (global as any).Tracer.startJob('Test Job');
      const jobId = (global as any).Tracer.getJobList()[0].id;
      const status = (global as any).Tracer.getJobStatus(jobId);
      expect(status.done).toBe(false);
      expect(status.error).toBeNull();
      expect(status.label).toBe('Test Job');
    });

    it('finishJob marks done=true, error=null', () => {
      (global as any).Tracer.startJob('Test Job');
      const jobId = (global as any).Tracer.getJobList()[0].id;
      (global as any).Tracer.finishJob();
      const status = (global as any).Tracer.getJobStatus(jobId);
      expect(status.done).toBe(true);
      expect(status.error).toBeNull();
    });

    it('failJob marks done=true with error message', () => {
      (global as any).Tracer.startJob('Test Job');
      const jobId = (global as any).Tracer.getJobList()[0].id;
      (global as any).Tracer.failJob('API key missing');
      const status = (global as any).Tracer.getJobStatus(jobId);
      expect(status.done).toBe(true);
      expect(status.error).toBe('API key missing');
    });

    it('getJobStatus for unknown job returns running', () => {
      const status = (global as any).Tracer.getJobStatus('nonexistent');
      expect(status.done).toBe(false);
      expect(status.error).toBeNull();
    });
  });

  describe('edge cases', () => {

    it('getLogs returns [] when no job exists', () => {
      const entries = (global as any).Tracer.getLogs('no-such-job', 0);
      expect(entries).toEqual([]);
    });

    it('getJobList returns [] when no jobs created', () => {
      const jobs = (global as any).Tracer.getJobList();
      expect(jobs).toEqual([]);
    });

    it('logging without an active job does not throw', () => {
      // No startJob called
      expect(() => {
        (global as any).Tracer.info('orphan message');
        (global as any).Tracer.warn('orphan warning');
        (global as any).Tracer.error('orphan error');
      }).not.toThrow();
    });

    it('finishJob/failJob without an active job does not throw', () => {
      expect(() => {
        (global as any).Tracer.finishJob();
        (global as any).Tracer.failJob('test');
      }).not.toThrow();
    });

    it('Logger.log is still called alongside cache writes', () => {
      (global as any).Logger.log.mockClear();
      (global as any).Tracer.startJob('Log Test');
      (global as any).Tracer.info('check logger');
      expect((global as any).Logger.log).toHaveBeenCalledWith(
        expect.stringContaining('[INFO')
      );
      expect((global as any).Logger.log).toHaveBeenCalledWith(
        expect.stringContaining('check logger')
      );
    });

    it('clearAll wipes all jobs and their logs', () => {
      (global as any).Tracer.startJob('Job A');
      (global as any).Tracer.info('log A');
      (global as any).Tracer.startJob('Job B');
      (global as any).Tracer.info('log B');
      expect((global as any).Tracer.getJobList()).toHaveLength(2);

      (global as any).Tracer.clearAll();

      expect((global as any).Tracer.getJobList()).toEqual([]);
      // No active job — logging should not throw
      expect(() => (global as any).Tracer.info('orphan')).not.toThrow();
    });
  });
});
