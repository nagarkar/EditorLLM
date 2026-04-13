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
//   TRACER_JOBS                  → JSON JobMeta[] (max 10, newest first)
//   TRACER_ACTIVE_JOB            → current jobId being logged to
//   TRACER_{jobId}_SEQ           → monotonic seq counter
//   TRACER_{jobId}_DONE          → "running" | "done" | "error:<msg>"
//   TRACER_{jobId}_LABEL         → human-readable label
//   TRACER_{jobId}_ENTRY_{seq}   → individual LogEntry JSON
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

  const JOBS_KEY       = 'TRACER_JOBS';
  const ACTIVE_KEY     = 'TRACER_ACTIVE_JOB';
  const CACHE_TTL      = 360;   // 6 minutes
  const MAX_ENTRIES    = 200;
  const MAX_JOBS       = 10;
  let jobCounter_      = 0;     // monotonic counter to disambiguate same-ms jobs

  // ── Key builders ───────────────────────────────────────────

  function seqKey_(id: string): string    { return `TRACER_${id}_SEQ`; }
  function doneKey_(id: string): string   { return `TRACER_${id}_DONE`; }
  function labelKey_(id: string): string  { return `TRACER_${id}_LABEL`; }
  function entryKey_(id: string, seq: number): string {
    return `TRACER_${id}_ENTRY_${seq}`;
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

  function getActiveJobId_(): string | null {
    try { return cache_().get(ACTIVE_KEY); }
    catch (_) { return null; }
  }

  function nextSeq_(jobId: string): number {
    const c = cache_();
    const raw = c.get(seqKey_(jobId));
    const next = raw ? parseInt(raw, 10) + 1 : 1;
    c.put(seqKey_(jobId), String(next), CACHE_TTL);
    return next;
  }

  function append_(level: 'INFO' | 'WARN' | 'ERROR', msg: string): void {
    try {
      const jobId = getActiveJobId_();
      if (!jobId) return; // no job running — skip cache write
      const ts  = timestamp_();
      const seq = nextSeq_(jobId);
      const entry: LogEntry = { seq, level, msg, ts };
      // Evict oldest if we exceed MAX_ENTRIES
      if (seq > MAX_ENTRIES) {
        cache_().remove(entryKey_(jobId, seq - MAX_ENTRIES));
      }
      cache_().put(entryKey_(jobId, seq), JSON.stringify(entry), CACHE_TTL);
    } catch (_) {
      // Never let cache errors surface
    }
  }

  /**
   * Best-effort cleanup of all cache keys for a given jobId.
   */
  function cleanupJob_(jobId: string): void {
    try {
      const c = cache_();
      const raw = c.get(seqKey_(jobId));
      const lastSeq = raw ? parseInt(raw, 10) : 0;
      const keys: string[] = [seqKey_(jobId), doneKey_(jobId), labelKey_(jobId)];
      const start = Math.max(1, lastSeq - MAX_ENTRIES + 1);
      for (let i = start; i <= lastSeq; i++) {
        keys.push(entryKey_(jobId, i));
      }
      c.removeAll(keys);
    } catch (_) { /* ignore */ }
  }

  // ── Public logging API ─────────────────────────────────────

  function info(msg: string): void {
    Logger.log(`[INFO  ${timestamp_()}] ${msg}`);
    append_('INFO', msg);
  }

  function warn(msg: string): void {
    Logger.log(`[WARN  ${timestamp_()}] ${msg}`);
    append_('WARN', msg);
  }

  function error(msg: string): void {
    Logger.log(`[ERROR ${timestamp_()}] ${msg}`);
    append_('ERROR', msg);
  }

  // ── Live-log control API ───────────────────────────────────

  /**
   * Creates a new job, adds it to the job registry, and makes it the active job.
   * Previous jobs are preserved (up to MAX_JOBS); oldest are evicted.
   */
  function startJob(label: string): void {
    try {
      const c = cache_();
      const jobId = `${Date.now()}_${++jobCounter_}`;

      // Read existing job list
      const rawJobs = c.get(JOBS_KEY);
      let jobs: JobMeta[] = rawJobs ? JSON.parse(rawJobs) : [];

      // Evict oldest jobs beyond MAX_JOBS - 1 (making room for new one)
      while (jobs.length >= MAX_JOBS) {
        const evicted = jobs.pop()!;
        cleanupJob_(evicted.id);
      }

      // Prepend new job
      const meta: JobMeta = {
        id: jobId,
        label,
        startedAt: timestamp_(),
      };
      jobs.unshift(meta);

      // Write registry + active job
      c.put(JOBS_KEY, JSON.stringify(jobs), CACHE_TTL);
      c.put(ACTIVE_KEY, jobId, CACHE_TTL);

      // Initialise per-job keys
      c.put(seqKey_(jobId), '0', CACHE_TTL);
      c.put(doneKey_(jobId), 'running', CACHE_TTL);
      c.put(labelKey_(jobId), label, CACHE_TTL);
    } catch (_) { /* ignore */ }
  }

  /**
   * Marks the active job as finished successfully.
   */
  function finishJob(): void {
    try {
      const jobId = getActiveJobId_();
      if (!jobId) return;
      cache_().put(doneKey_(jobId), 'done', CACHE_TTL);
    } catch (_) { /* ignore */ }
  }

  /**
   * Marks the active job as finished with an error.
   */
  function failJob(msg: string): void {
    try {
      const jobId = getActiveJobId_();
      if (!jobId) return;
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
      const c = cache_();
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
   */
  function getLogs(jobId: string, sinceSeq: number): LogEntry[] {
    try {
      const c = cache_();
      const raw = c.get(seqKey_(jobId));
      const currentSeq = raw ? parseInt(raw, 10) : 0;
      if (currentSeq <= sinceSeq) return [];

      const keys: string[] = [];
      for (let s = sinceSeq + 1; s <= currentSeq; s++) {
        keys.push(entryKey_(jobId, s));
      }
      const entries: LogEntry[] = [];
      // getAll limited to 100 keys
      for (let i = 0; i < keys.length; i += 100) {
        const batch = keys.slice(i, i + 100);
        const vals = c.getAll(batch);
        for (const key of batch) {
          if (vals[key]) {
            try { entries.push(JSON.parse(vals[key]) as LogEntry); } catch (_) { /* skip */ }
          }
        }
      }
      return entries.sort((a, b) => a.seq - b.seq);
    } catch (_) {
      return [];
    }
  }

  /**
   * Wipes the entire job registry and all per-job cache keys.
   * Called from onOpen() to prevent stale pills from prior sessions.
   */
  function clearAll(): void {
    try {
      const c = cache_();
      const rawJobs = c.get(JOBS_KEY);
      const jobs: JobMeta[] = rawJobs ? JSON.parse(rawJobs) : [];
      for (const job of jobs) {
        cleanupJob_(job.id);
      }
      c.removeAll([JOBS_KEY, ACTIVE_KEY]);
      jobCounter_ = 0;
    } catch (_) { /* ignore */ }
  }

  return { info, warn, error, startJob, finishJob, failJob, getJobList, getJobStatus, getLogs, clearAll };
})();
