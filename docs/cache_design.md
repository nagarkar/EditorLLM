# Tracer CacheService Design

> **Scope:** This document covers the design of `Tracer.ts` — the structured
> logging system that stores live job logs in Google Apps Script's `CacheService`
> so the sidebar can show real-time progress. It does **not** cover annotation
> storage (Drive comments, bookmarks, highlights), which use no cache.

---

## 1. Why CacheService?

GAS script executions are stateless: each `google.script.run` call from the sidebar
spawns a fresh V8 isolate. There is no shared memory between the agent execution
(which writes logs) and the sidebar polls (which read logs). The available
persistence options in GAS are:

| Store | TTL | Max size | Speed | Notes |
|---|---|---|---|---|
| `CacheService` | Configurable | 100 KB/value, 1 MB total | ~80 ms/call | Designed for ephemeral data |
| `PropertiesService` | Permanent | 9 KB/value, 500 KB total | ~80 ms/call | Too small for log volumes |
| `DocumentApp` (body text) | Permanent | Very large | ~200+ ms/write | Pollutes revision history |
| Spreadsheet row | Permanent | Very large | ~300 ms/write | Requires Sheets, no TTL |

`CacheService` is the right fit: logs are ephemeral (6-minute TTL is sufficient
for a single agent run), sized appropriately, and read-accessible from any GAS
execution that shares the same user context.

---

## 2. Cache Key Layout

```
TRACER_JOBS                    →  JSON: JobMeta[]          (job registry, max 10 jobs)
TRACER_ACTIVE_JOB              →  string: jobId            (current job being written)
TRACER_{jobId}_SEQ             →  string: number           (highest seq flushed to cache)
TRACER_{jobId}_DONE            →  string: "running"
                                          "done"
                                          "error:<message>"
TRACER_{jobId}_LABEL           →  string: human label
TRACER_{jobId}_PAGE_{n}        →  JSON: LogEntry[]         (up to PAGE_SIZE entries)
```

Each `LogEntry` is `{ seq, level, msg, ts }`. Pages are 1-based integers starting
at `PAGE_1`.

### Key count per job

```
3 fixed keys  (SEQ, DONE, LABEL)
+
ceil(entries / PAGE_SIZE) page keys     ← capped at MAX_PAGES = 10
```

With default constants (`PAGE_SIZE=20`, `MAX_PAGES=10`), a fully-loaded job uses
at most **13 cache keys** (3 fixed + 10 page keys).

---

## 3. Write Path

### 3.1 Old design (one key per entry)

```
Tracer.info("msg")
│
├─ Logger.log(...)                         [sync, no I/O]
│
└─ append_()
   ├─ getActiveJobId_()
   │   └─ cache.get(ACTIVE_KEY)            [~80 ms]  ← 1st round-trip
   │
   ├─ nextSeq_()
   │   ├─ cache.get(SEQ_KEY)               [~80 ms]  ← 2nd round-trip
   │   └─ cache.put(SEQ_KEY, next)         [~80 ms]  ← 3rd round-trip
   │
   └─ cache.put(ENTRY_{seq}, entryJSON)    [~80 ms]  ← 4th round-trip
                                                        (plus remove on eviction)

Total per log line: ~250–330 ms
```

For 50 log entries in a typical agent run: **~12–16 seconds** of cache I/O.

### 3.2 New design (paged, in-memory buffer)

```
Tracer.info("msg")
│
├─ Logger.log(...)                         [sync, no I/O]
│
└─ append_()
   ├─ activeJobId_  (module var)           [0 ms — no cache read]
   ├─ nextSeq_()    (in-memory counter)    [0 ms — no cache read]
   └─ push entry into pageBuffers_[jobId]  [0 ms — array push]
       │
       └─ IF buffer.length >= PAGE_SIZE (20):
           flushPage_()
           ├─ [optional] cache.remove(oldPage)  [~80 ms — only once per 20 entries]
           └─ cache.putAll({PAGE_n, SEQ})        [~100 ms — one round-trip for 2 keys]

Cost per log line (amortised): ~100 ms ÷ 20 = ~5 ms
```

```
startJob("label")
│
│  OLD: 5 sequential cache.put() calls = ~400 ms
│
└─ NEW: 1 cache.putAll({JOBS, ACTIVE, SEQ, DONE, LABEL}) = ~100 ms
```

### 3.3 Flush triggers

| Event | What happens |
|---|---|
| Buffer reaches PAGE_SIZE | `flushPage_()` — `putAll({page, seq})` |
| `finishJob()` called | `flushPage_()` then `put(done, "done")` |
| `failJob(msg)` called | `flushPage_()` then `put(done, "error:…")` |
| `startJob()` evicts old job | `cleanupJob_()` — `removeAll(all keys)` |

---

## 4. Read Path (Sidebar Polling)

The sidebar calls `getLogs(jobId, sinceSeq)` via `google.script.run`. This runs
in a separate GAS execution with no access to the writing execution's in-memory
state; it reads from cache only.

### 4.1 Old design

```
getLogs(jobId, sinceSeq=40)
│
├─ cache.get(SEQ_KEY)                      → currentSeq = 57
├─ build keys: ENTRY_41, ENTRY_42, …, ENTRY_57   (17 keys)
└─ cache.getAll([ENTRY_41..57])            → one batch read (within 100-key limit)
```

The per-entry *write* cost (3 puts/entry) was the bottleneck, not the read.

### 4.2 New design

```
getLogs(jobId, sinceSeq=40)
│
├─ cache.get(SEQ_KEY)                      → currentSeq = 57 (flushed seq)
│
│  fromPage = ceil((40+1)/20) = ceil(2.05) = 3
│  toPage   = ceil(57/20)     = ceil(2.85) = 3
│
├─ pageKeys = [PAGE_3]
└─ cache.getAll([PAGE_3])                  → one read, returns entries 41–57
   └─ filter: seq > 40, sort by seq

For 200 entries (10 full pages):
  OLD: cache.getAll up to 200 individual keys  → ≤2 getAll calls (100 key limit)
  NEW: cache.getAll([PAGE_1..10])              → 1 getAll call (10 keys)
```

The read path improvement is modest for small logs. The dominant gain is
on the write path.

---

## 5. Live Visibility Window

Because entries are buffered in memory before being flushed, the sidebar sees
log entries in PAGE_SIZE-sized batches rather than one-by-one.

```
Agent execution timeline:

  entry 1   entry 2  … entry 20  │  entry 21 … entry 40  │ finishJob()
  (push)    (push)      (push)   │  (push)      (push)   │ flushPage_()
                                 │                        │
                        flush ───┘               flush ──┘
                        PAGE_1                   PAGE_2 + done key

Sidebar poll at t=A (between entry 10 and 20):
  ─ cache SEQ = 0 (first page not yet flushed)
  ─ sidebar sees: 0 entries   ← up to PAGE_SIZE lag

Sidebar poll at t=B (after first flush, before entry 40):
  ─ cache SEQ = 20
  ─ sidebar sees: entries 1–20

Sidebar poll at t=C (after finishJob):
  ─ cache SEQ = 40, done = "done"
  ─ sidebar sees: entries 1–40 + done status
```

**Maximum lag:** up to `PAGE_SIZE` entries (20 by default) between when an entry
is logged and when the sidebar can see it. For a typical agent run producing
1–3 entries per second, this is a 7–20 second visibility window — acceptable for
a progress log, not for real-time debugging.

To reduce the lag: lower `PAGE_SIZE`. To increase write efficiency: raise it.

---

## 6. Page Eviction

Each job retains at most `MAX_PAGES` pages in cache. When `flushPage_` writes
page `n > MAX_PAGES`, it evicts page `n - MAX_PAGES`:

```
MAX_PAGES = 10  →  200 entries maximum per job retained in cache

Flush PAGE_11  →  evict PAGE_1
Flush PAGE_12  →  evict PAGE_2
...
```

`getLogs` accounts for this by computing `fromPage` from `sinceSeq` rather than
always starting at page 1, so it never requests evicted pages.

`cleanupJob_` reconstructs the surviving page range from the cached `SEQ` key:

```
lastPage  = ceil(lastSeq / PAGE_SIZE)
fromPage  = max(1, lastPage - MAX_PAGES + 1)
remove keys: SEQ, DONE, LABEL, PAGE_{fromPage}…PAGE_{lastPage}
```

---

## 7. In-Memory State Lifetime

The module-level Maps (`seqCounters_`, `pageNums_`, `pageBuffers_`) and
`activeJobId_` live in the GAS V8 isolate created for the agent execution. They
are **not** shared with sidebar poll executions.

```
GAS execution A (agent run):
  startJob()  → seqCounters_["j1"] = 0, pageBuffers_["j1"] = []
  info("...")  → seqCounters_["j1"] = 1, pageBuffers_["j1"] = [entry1]
  …
  finishJob() → flushPage_() writes PAGE_n to cache; execution ends
                ↓
               V8 isolate destroyed — all Maps cleared

GAS execution B (sidebar poll):
  getLogs("j1", 0) → reads PAGE_1..n from cache (no in-memory state needed)
```

If an agent execution is killed mid-run (quota error, timeout, unhandled
exception) **before** `finishJob()`/`failJob()` is called, entries in the
in-memory buffer that haven't been flushed yet are lost. Entries in pages
already written to cache survive and are visible to the sidebar.

---

## 8. Constants Reference

| Constant | Default | Effect of increasing | Effect of decreasing |
|---|---|---|---|
| `PAGE_SIZE` | 20 | Fewer cache writes, larger visibility gap | More cache writes, smaller gap |
| `MAX_PAGES` | 10 | More entries retained per job | Fewer entries, older ones evicted sooner |
| `MAX_JOBS` | 10 | More jobs in registry | Fewer jobs visible in sidebar |
| `CACHE_TTL` | 360 s | Logs survive longer | Logs expire sooner |
| `MAX_SESSION_TRACES` | 2000 | getAllLogs returns more | Returns fewer |

**Invariant:** `MAX_SESSION_TRACES ≤ PAGE_SIZE × MAX_PAGES × MAX_JOBS`
(currently 20 × 10 × 10 = 2000 — exact match).

---

## 9. Performance Summary

### Write path

| Scenario | Old (per-entry puts) | New (paged putAll) | Improvement |
|---|---|---|---|
| `startJob()` | 5 × ~80 ms = **~400 ms** | 1 putAll = **~100 ms** | 4× faster |
| Single log entry (amortised) | 3 × ~83 ms = **~250 ms** | ~100 ms ÷ 20 = **~5 ms** | 50× faster |
| 50-entry agent run | ~12,500 ms | ~300 ms (3 flushes) | **~40× faster** |
| 200-entry agent run | ~50,000 ms | ~1,000 ms (10 flushes) | **~50× faster** |
| Eviction (per page) | 1 remove/entry | 1 remove/page | 20× fewer removes |

### Read path (`getLogs`, 200 entries)

| | Old | New |
|---|---|---|
| Keys requested | 200 individual entry keys | 10 page keys |
| Cache round-trips | 2 (getAll batches of 100) | 1 (all 10 keys fit in one getAll) |
| Data parsed | 200 JSON strings | 10 JSON arrays |

---

## 10. Pros and Cons

### Pros

- **Dramatic write speedup.** A 50-entry job goes from ~12.5 s of cache I/O to
  ~300 ms — the user waits for the agent's work, not for logging overhead.
- **Simpler read key arithmetic.** `fromPage / toPage` replaces a 200-element
  key list; the getAll call is always within CacheService's 100-key limit.
- **startJob is 4× faster.** One `putAll` instead of 5 sequential puts means
  the sidebar sees the new job pill roughly 300 ms sooner.
- **`Logger.log` unaffected.** The native Apps Script execution log still
  receives every entry immediately (synchronously before the buffer push), so
  debugging via the script editor is unchanged.
- **Zero API surface change.** `Tracer.info/warn/error/startJob/finishJob/…`
  are identical to callers; no agent code required changes.
- **Crash-partial visibility.** Entries in already-flushed pages are visible to
  the sidebar even if the agent execution is killed mid-run. Only the last
  unflushed partial page (at most PAGE_SIZE entries) is lost.

### Cons

- **Sidebar visibility lag.** The sidebar sees entries in PAGE_SIZE-sized batches
  (up to 20 entries behind). For a long-running agent producing 1 entry/second,
  this means the sidebar can be up to ~20 seconds behind the actual execution
  position. In practice, most agents emit bursts separated by Gemini API latency
  (1–5 s), so a full-page flush often arrives within one polling cycle.
- **Last partial page lost on hard crash.** If the GAS execution is killed before
  `finishJob()`/`failJob()` (e.g. 6-minute quota timeout, unhandled exception
  that bypasses `runTrackedJob_`'s catch), up to PAGE_SIZE buffered entries are
  lost. The `done` key is never written, so the sidebar shows "running" forever
  until the TTL expires — the same behaviour as before this change.
- **Extra `remove` call on page eviction.** When a job exceeds MAX_PAGES entries,
  each page flush costs one additional `cache.remove()` (~80 ms). This is rare
  (only jobs with >200 entries), and the old design had the same eviction cost
  per individual entry.
- **In-memory state is execution-scoped.** If a caller in a *different* GAS
  execution calls `finishJob()` or `failJob()` for a job started in another
  execution (unusual but theoretically possible for sidebar-triggered calls),
  `flushPage_` will find an empty `pageBuffers_` entry and do nothing — which
  is correct, since that other execution has its own buffer. The done key is
  still written correctly.

---

## 11. Not Chosen: Alternatives Considered

| Alternative | Why not chosen |
|---|---|
| **Full in-memory flush only at job end** | No live visibility during execution. Sidebar shows blank for the full agent run (1–3 min). |
| **PropertiesService** | 9 KB/value limit is too small; no `getAll`/`removeAll`; same latency as CacheService. |
| **Document body tab** | Higher latency, pollutes revision history, complex to query from sidebar. |
| **Per-entry puts (status quo)** | ~250 ms per log line adds 12+ seconds of overhead to every agent run. |
