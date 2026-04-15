// ============================================================
// Tracer.ts — Structured logging wrapper for EditorLLM
//
// Multi-job live-log sidebar support
// ──────────────────────────────────
// Each startJob() creates a unique jobId. Log entries and status
// are stored per-job in CacheService so the sidebar can show
// multiple job histories and let the user switch between them.
//
// Cache key layout:
//   TRACER_JOBS                   → JSON JobMeta[] (max 10, newest first)
//   TRACER_ACTIVE_JOB             → current jobId being logged to
//   TRACER_{jobId}_SEQ            → highest seq number flushed to cache
//   TRACER_{jobId}_DONE           → "running" | "done" | "error:<msg>"
//   TRACER_{jobId}_LABEL          → human-readable label
//   TRACER_{jobId}_PAGE_{n}       → JSON LogEntry[] (PAGE_SIZE entries per page)
//
// Write path (optimised — B + E):
//   - Log entries are buffered in memory (pageBuffers_) and flushed via a
//     single putAll() per PAGE_SIZE entries, cutting write round-trips from
//     3 per entry (~250 ms) to 1 putAll per PAGE_SIZE entries (~100 ms each).
//   - startJob() uses a single putAll() for its 5 initial keys instead of
//     5 sequential put() calls (~500 ms → ~100 ms).
//   - The active job ID is kept in memory (activeJobId_) so append_() never
//     needs a CacheService read on the hot path.
//
// Read path (getLogs):
//   - Reads whole pages via getAll() instead of one key per entry.
//     O(pages) cache fetches instead of O(entries).
//
// See docs/cache_design.md for full design rationale, diagrams, and performance.
//
// getAllLogs() uses an in-memory circular buffer (MAX_SESSION_TRACES slots).
// No extra cache keys — it reads existing per-job pages and streams them
// through a fixed-size JS array in a single O(N) pass with no sort.
// ============================================================

interface LogEntry {
  seq: number;
  level: 'INFO' | 'WARN' | 'ERROR';
  msg: string;
  ts: string;
}

interface JobMeta {
  id: string;
  label: string;
  startedAt: string;
}

const Tracer = (() => {

  const JOBS_KEY            = 'TRACER_JOBS';
  const ACTIVE_KEY          = 'TRACER_ACTIVE_JOB';
  const CACHE_TTL           = 360;    // 6 minutes
  const MAX_JOBS            = 10;     // number of recent jobs kept in registry
  const PAGE_SIZE           = 20;     // log entries buffered per cache write
  const MAX_PAGES           = 10;     // max pages retained per job (= 200 entries)
  // Session-level cap for getAllLogs(). Must be ≤ PAGE_SIZE × MAX_PAGES × MAX_JOBS.
  const MAX_SESSION_TRACES  = 2000;

  // ── Per-execution in-memory state ──────────────────────────
  // These are reset on every new GAS execution context. They eliminate
  // CacheService round-trips on the hot write path (append_).

  let jobCounter_                 = 0;    // monotonic counter, disambiguates same-ms jobs
  let activeJobId_: string | null = null; // in-memory copy of ACTIVE_KEY

  // Per-job accumulators (keyed by jobId). Populated by startJob(); valid only
  // within the same GAS execution that called startJob().
  const seqCounters_ = new Map<string, number>();    // last seq assigned (in-memory)
  const pageNums_    = new Map<string, number>();    // last page number flushed to cache
  const pageBuffers_ = new Map<string, LogEntry[]>(); // current unflushed page

  // ── Key builders ───────────────────────────────────────────

  function seqKey_(id: string): string              { return `TRACER_${id}_SEQ`; }
  function doneKey_(id: string): string             { return `TRACER_${id}_DONE`; }
  function labelKey_(id: string): string            { return `TRACER_${id}_LABEL`; }
  function pageKey_(id: string, page: number): string {
    return `TRACER_${id}_PAGE_${page}`;
  }

  // ── Private helpers ────────────────────────────────────────

  function timestamp_(): string {
    const d = new Date();
    const z2 = (n: number) => String(n).padStart(2, '0');
    const z3 = (n: number) => String(n).padStart(3, '0');
    return `${z2(d.getHours())}:${z2(d.getMinutes())}:${z2(d.getSeconds())}.${z3(d.getMilliseconds())}`;
  }

  function cache_(): GoogleAppsScript.Cache.Cache {
    return CacheService.getUserCache();
  }

  /**
   * Returns the active job ID.
   * Fast path: reads in-memory copy set by startJob() — zero cache I/O.
   * Slow path: falls back to a cache read for callers in a different GAS
   * execution (e.g. a sidebar poll that also calls finishJob, which is rare).
   */
  function getActiveJobId_(): string | null {
    if (activeJobId_) return activeJobId_;
    try { return cache_().get(ACTIVE_KEY); }
    catch (_) { return null; }
  }

  /**
   * Returns the next sequence number for the given job. Purely in-memory —
   * zero CacheService I/O. The counter is written to cache only on page flushes.
   */
  function nextSeq_(jobId: string): number {
    const next = (seqCounters_.get(jobId) ?? 0) + 1;
    seqCounters_.set(jobId, next);
    return next;
  }

  /**
   * Flushes the current in-memory page buffer to CacheService via a single
   * putAll() call, updating TRACER_{id}_SEQ at the same time.
   * If the job has exceeded MAX_PAGES, the oldest surviving page is evicted.
   * No-op when the buffer is empty.
   */
  function flushPage_(jobId: string): void {
    const buffer = pageBuffers_.get(jobId);
    if (!buffer || buffer.length === 0) return;

    const pageNum    = (pageNums_.get(jobId) ?? 0) + 1;
    const currentSeq = seqCounters_.get(jobId) ?? 0;
    pageNums_.set(jobId, pageNum);

    try {
      // Evict the oldest surviving page when we exceed MAX_PAGES.
      if (pageNum > MAX_PAGES) {
        cache_().remove(pageKey_(jobId, pageNum - MAX_PAGES));
      }
      // One putAll = one round-trip to write the page + update the seq counter.
      cache_().putAll({
        [pageKey_(jobId, pageNum)]: JSON.stringify(buffer),
        [seqKey_(jobId)]:           String(currentSeq),
      }, CACHE_TTL);
    } catch (_) { /* never surface logging errors */ }

    pageBuffers_.set(jobId, []);
  }

  /**
   * Appends a log entry to the in-memory page buffer.
   * No CacheService I/O except when the buffer reaches PAGE_SIZE, at which
   * point a single putAll() flush is issued.
   *
   * Write cost per entry (amortised):
   *   Old: 3 sequential cache calls × ~83 ms = ~250 ms/entry
   *   New: 1 putAll per PAGE_SIZE entries ÷ PAGE_SIZE ≈ 5 ms/entry (amortised)
   */
  function append_(level: 'INFO' | 'WARN' | 'ERROR', msg: string, explicitJobId?: string): void {
    try {
      const jobId = explicitJobId ?? activeJobId_ ?? getActiveJobId_();
      if (!jobId) return;

      const entry: LogEntry = { seq: nextSeq_(jobId), level, msg, ts: timestamp_() };

      const buffer = pageBuffers_.get(jobId) ?? [];
      buffer.push(entry);
      pageBuffers_.set(jobId, buffer);

      if (buffer.length >= PAGE_SIZE) {
        flushPage_(jobId);
      }
    } catch (_) {
      // Never let cache errors surface to callers
    }
  }

  /**
   * Best-effort cleanup of all cache keys for a given jobId.
   * Works even when called on a job from a previous GAS execution (no in-memory
   * state): derives the page count from the cached SEQ key.
   */
  function cleanupJob_(jobId: string): void {
    try {
      const c       = cache_();
      const raw     = c.get(seqKey_(jobId));
      const lastSeq = raw ? parseInt(raw, 10) : 0;
      const lastPage = lastSeq > 0 ? Math.ceil(lastSeq / PAGE_SIZE) : 0;

      const keys: string[] = [seqKey_(jobId), doneKey_(jobId), labelKey_(jobId)];
      // Older pages beyond MAX_PAGES were already evicted by flushPage_; only
      // remove the surviving window.
      const fromPage = Math.max(1, lastPage - MAX_PAGES + 1);
      for (let p = fromPage; p <= lastPage; p++) {
        keys.push(pageKey_(jobId, p));
      }
      c.removeAll(keys);
    } catch (_) { /* ignore */ }

    // Clear in-memory state — no-op if job is from a prior execution
    seqCounters_.delete(jobId);
    pageNums_.delete(jobId);
    pageBuffers_.delete(jobId);
  }

  // ── Public logging API ─────────────────────────────────────

  function info(msg: string, jobId?: string): void {
    Logger.log(`[INFO  ${timestamp_()}] ${msg}`);
    append_('INFO', msg, jobId);
  }

  function warn(msg: string, jobId?: string): void {
    Logger.log(`[WARN  ${timestamp_()}] ${msg}`);
    append_('WARN', msg, jobId);
  }

  function error(msg: string, jobId?: string): void {
    Logger.log(`[ERROR ${timestamp_()}] ${msg}`);
    append_('ERROR', msg, jobId);
  }

  // ── Live-log control API ───────────────────────────────────

  /**
   * Creates a new job, adds it to the job registry, and makes it the active job.
   * Uses a single putAll() for all 5 initial key writes — one round-trip instead
   * of 5 sequential put() calls (~500 ms → ~100 ms).
   */
  function startJob(label: string): string {
    try {
      const c     = cache_();
      const jobId = `${Date.now()}_${++jobCounter_}`;

      const rawJobs = c.get(JOBS_KEY);
      let jobs: JobMeta[] = rawJobs ? JSON.parse(rawJobs) : [];

      while (jobs.length >= MAX_JOBS) {
        const evicted = jobs.pop()!;
        cleanupJob_(evicted.id);
      }

      const meta: JobMeta = { id: jobId, label, startedAt: timestamp_() };
      jobs.unshift(meta);

      // Single putAll — one round-trip replaces 5 sequential puts
      c.putAll({
        [JOBS_KEY]:          JSON.stringify(jobs),
        [ACTIVE_KEY]:        jobId,
        [seqKey_(jobId)]:    '0',
        [doneKey_(jobId)]:   'running',
        [labelKey_(jobId)]:  label,
      }, CACHE_TTL);

      // Initialise in-memory accumulators for this job
      activeJobId_ = jobId;
      seqCounters_.set(jobId, 0);
      pageNums_.set(jobId, 0);
      pageBuffers_.set(jobId, []);

      return jobId;
    } catch (_) {
      return '';
    }
  }

  /**
   * Marks the active job as finished successfully.
   * Flushes any buffered entries before writing the done status so the sidebar
   * sees all log lines even if the last page was not yet full.
   */
  function finishJob(): void {
    try {
      const jobId = getActiveJobId_();
      if (!jobId) return;
      flushPage_(jobId);
      cache_().put(doneKey_(jobId), 'done', CACHE_TTL);
    } catch (_) { /* ignore */ }
  }

  /**
   * Marks the active job as finished with an error.
   * Flushes any buffered entries before writing the error status.
   */
  function failJob(msg: string): void {
    try {
      const jobId = getActiveJobId_();
      if (!jobId) return;
      flushPage_(jobId);
      cache_().put(doneKey_(jobId), `error:${msg}`, CACHE_TTL);
    } catch (_) { /* ignore */ }
  }

  // ── Sidebar query API ──────────────────────────────────────

  /**
   * Returns the list of all tracked jobs (newest first).
   */
  function getJobList(): JobMeta[] {
    try {
      const raw = cache_().get(JOBS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  /**
   * Returns the status of a specific job.
   */
  function getJobStatus(jobId: string): { label: string; done: boolean; error: string | null } {
    try {
      const c       = cache_();
      const doneVal = c.get(doneKey_(jobId)) ?? 'running';
      const label   = c.get(labelKey_(jobId)) ?? 'Agent';
      if (doneVal === 'done') {
        return { label, done: true, error: null };
      } else if (doneVal.startsWith('error:')) {
        return { label, done: true, error: doneVal.slice(6) };
      }
      return { label, done: false, error: null };
    } catch (_) {
      return { label: 'Agent', done: false, error: null };
    }
  }

  /**
   * Returns log entries for a specific job with seq > sinceSeq.
   *
   * Reads whole cache pages rather than individual entry keys. For a job with
   * 200 entries this drops from 200 individual gets to ≤10 page reads via
   * getAll() — one round-trip when MAX_PAGES ≤ 100.
   *
   * Live visibility: entries buffered in memory but not yet flushed (i.e. the
   * current partial page) are merged in from the in-memory pageBuffers_ map so
   * callers always see all written entries regardless of page-fill state.
   */
  function getLogs(jobId: string, sinceSeq: number): LogEntry[] {
    try {
      const c          = cache_();
      const raw        = c.get(seqKey_(jobId));
      const flushedSeq = raw ? parseInt(raw, 10) : 0;

      const entries: LogEntry[] = [];

      if (flushedSeq > sinceSeq) {
        // Fetch only the pages that contain entries the caller hasn't seen yet.
        const fromPage  = Math.max(1, Math.ceil((sinceSeq + 1) / PAGE_SIZE));
        const toPage    = Math.ceil(flushedSeq / PAGE_SIZE);

        const pageKeys: string[] = [];
        for (let p = fromPage; p <= toPage; p++) {
          pageKeys.push(pageKey_(jobId, p));
        }

        // getAll supports up to 100 keys; MAX_PAGES (10) is always within that.
        for (let i = 0; i < pageKeys.length; i += 100) {
          const batch = pageKeys.slice(i, i + 100);
          const vals  = c.getAll(batch);
          for (const key of batch) {
            if (vals[key]) {
              try {
                const page = JSON.parse(vals[key]) as LogEntry[];
                entries.push(...page);
              } catch (_) { /* skip corrupt page */ }
            }
          }
        }
      }

      // Also include any entries still buffered in memory (current partial page).
      const buffered = pageBuffers_.get(jobId);
      if (buffered && buffered.length > 0) {
        entries.push(...buffered);
      }

      return entries
        .filter(e => e.seq > sinceSeq)
        .sort((a, b) => a.seq - b.seq);
    } catch (_) {
      return [];
    }
  }

  /**
   * Returns a unified view of all jobs and their current status metadata.
   * Replaces N+1 polling with a single call.
   */
  function getJobDashboard(): Array<JobMeta & { done: boolean, error: string | null }> {
    try {
      const c    = cache_();
      const raw  = c.get(JOBS_KEY);
      const jobs: JobMeta[] = raw ? JSON.parse(raw) : [];
      if (!jobs.length) return [];

      const statusKeys = jobs.map(j => doneKey_(j.id));
      const statusVals = c.getAll(statusKeys);

      return jobs.map(j => {
        const doneVal = statusVals[doneKey_(j.id)] ?? 'running';
        let done  = false;
        let error: string | null = null;
        if (doneVal === 'done') {
          done = true;
        } else if (doneVal.startsWith('error:')) {
          done  = true;
          error = doneVal.slice(6);
        }
        return { ...j, done, error };
      });
    } catch (_) {
      return [];
    }
  }

  /**
   * Returns the latest MAX_SESSION_TRACES log entries across all tracked jobs,
   * newest-first, each entry prefixed with "[jobLabel] ".
   *
   * Implementation: single-pass in-memory circular buffer.
   *
   * Why a circular buffer and not sort+slice?
   * - getLogs() already returns entries in ascending seq order per job.
   * - getJobList() returns jobs newest-first; we process oldest-first.
   * - So we stream every entry through the ring in strict chronological order.
   * - The ring automatically evicts the oldest entry when full (write pointer
   *   wraps), giving O(N) time and O(MAX_SESSION_TRACES) fixed space with no
   *   sort pass and no intermediate arrays that grow with N.
   *
   * To change the cap: edit MAX_SESSION_TRACES — no other code changes needed.
   */
  function getAllLogs(): LogEntry[] {
    // Process jobs oldest-first so the ring fills chronologically.
    const jobs = getJobList().slice().reverse();

    const ring: LogEntry[] = new Array(MAX_SESSION_TRACES);
    let writePtr           = 0;
    let totalWritten       = 0;

    for (const job of jobs) {
      const entries = getLogs(job.id, 0);
      for (const entry of entries) {
        ring[writePtr % MAX_SESSION_TRACES] = { ...entry, msg: `[${job.label}] ${entry.msg}` };
        writePtr++;
        totalWritten++;
      }
    }

    const count     = Math.min(totalWritten, MAX_SESSION_TRACES);
    const readStart = totalWritten > MAX_SESSION_TRACES ? writePtr % MAX_SESSION_TRACES : 0;
    const result: LogEntry[] = new Array(count);
    for (let i = 0; i < count; i++) {
      result[i] = ring[(readStart + i) % MAX_SESSION_TRACES];
    }

    result.reverse();
    return result;
  }

  /**
   * Wipes the entire job registry and all per-job cache keys.
   * Called from onOpen() to prevent stale pills from prior sessions.
   */
  function clearAll(): void {
    try {
      const c       = cache_();
      const rawJobs = c.get(JOBS_KEY);
      const jobs: JobMeta[] = rawJobs ? JSON.parse(rawJobs) : [];
      for (const job of jobs) {
        cleanupJob_(job.id);
      }
      c.removeAll([JOBS_KEY, ACTIVE_KEY]);
      jobCounter_ = 0;
      activeJobId_ = null;
    } catch (_) { /* ignore */ }
  }

  /**
   * Removes the specified job IDs from the registry and cleans up their cache keys.
   * Returns the remaining job list.
   */
  function removeJobs(idsToRemove: string[]): JobMeta[] {
    try {
      const c       = cache_();
      const rawJobs = c.get(JOBS_KEY);
      let jobs: JobMeta[] = rawJobs ? JSON.parse(rawJobs) : [];
      const removeSet = new Set(idsToRemove);
      for (const id of idsToRemove) {
        cleanupJob_(id);
      }
      jobs = jobs.filter(j => !removeSet.has(j.id));
      c.put(JOBS_KEY, JSON.stringify(jobs), CACHE_TTL);

      const active = getActiveJobId_();
      if (active && removeSet.has(active)) {
        c.remove(ACTIVE_KEY);
        activeJobId_ = null;
      }
      return jobs;
    } catch (_) {
      return [];
    }
  }

  return { info, warn, error, startJob, finishJob, failJob, getJobList, getJobStatus, getLogs, getAllLogs, getJobDashboard, clearAll, removeJobs };
})();
