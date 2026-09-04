# Desktop App — Development & Verification Workflow

Rules for working on the EditorLLM Desktop app (`desktop/`). These govern
how to build, verify, log, and test the Tauri v2 app so problems are caught
before being declared done.

---

## 1. The Build Gate — Always Run Before Declaring Victory

After **any** change to desktop source files (TypeScript, Rust, CSS,
`tauri.conf.json`, `capabilities/*.json`), run the full dev-server check:

```
cd desktop && ./check-dev.sh
```

**What it does:**
1. Kills any previous dev server instance
2. Starts `npm run dev:log` (`tauri dev --no-watch`) with output piped to
   `/tmp/editorllm-dev.log`
3. Strips ANSI colour codes into `/tmp/editorllm-dev-clean.log` for grep
4. Waits up to 300 s for `Finished 'dev' profile` (success) or any
   `error[E…]:` / `process didn't exit` pattern (failure)
5. Exits 0 on success, 1 on compile/link error, 2 on timeout

**Never declare a task done without `check-dev.sh` exiting 0.**

Unit tests alone (`cargo test`, `vitest run`) are not sufficient — they do
not catch Tauri capability/permission errors, linker errors, or runtime
panics that only surface during app startup.

---

## 2. Why `--no-watch`

`tauri dev` without `--no-watch` watches the source tree and triggers
incremental Rust recompilation on every save. This produces a noisy stream
of partial output that is hard to grep and can produce false "in-progress"
error lines while a recompile is underway.

`check-dev.sh` uses `--no-watch` so the Rust compiler runs exactly once per
invocation. Each run is a clean, stable signal.

---

## 3. Checking App Logs — Procedure (Execute Every Time Asked)

When the user asks to "check the logs", "look at the logs", "what does the
log say", or any similar phrase, execute **all three steps** in order without
being asked to do each one individually.

### Step 1 — Read the runtime log

Use the `Read` tool on this exact path:
```
/Users/nagarkar/Library/Logs/com.editorllm.desktop/app.log
```

This file is written by `tauri-plugin-log` and contains **all** events from
both the Rust backend and the frontend (JS errors are bridged to Rust via
`log_frontend_error`). The log format is:
```
[YYYY-MM-DD][HH:MM:SS][crate::module][LEVEL] message
```

Frontend entries are tagged `[editorllm_desktop_lib::commands][ERROR]` and
contain `[frontend::<context>]` in the message body.

### Step 2 — Read the compilation log (if the app was recently started)

Use the `Read` tool on:
```
/tmp/editorllm-dev-clean.log
```

This is the ANSI-stripped output of the last `check-dev.sh` run. It contains
Vite startup, cargo compilation output, and early Tauri runtime messages.
It is only present after `check-dev.sh` has been run at least once.

### Step 3 — Summarise and flag

Report:
- Any `[ERROR]` or `[WARN]` lines from the runtime log
- Any `panicked at` lines
- Any `[frontend::*]` error entries (these are JS exceptions)
- The last `[INFO]` line (shows the most recent successful operation)
- Whether the HTTP server started: `[http_server] Listening on http://127.0.0.1:3847`
- Whether the frontend booted: `[frontend::boot] App ready`

### What each log line means

| Pattern | Meaning |
|---------|---------|
| `[http_server] Manifest received: N sections` | GAS add-on pushed a manifest |
| `Manifest set: N sections` | Manifest stored in app state |
| `Generating section <id>` | ElevenLabs API call started |
| `Section <id> done → /path/to/file.mp3` | Generation succeeded |
| `Section <id> failed: <msg>` | ElevenLabs call failed |
| `generate blocked: ElevenLabs API key not set` | Settings not configured |
| `[frontend::boot] App ready` | Frontend JS initialised cleanly |
| `[frontend::<ctx>] <msg>` | JS error or info from the browser layer |
| `stitch_audio: output → <path>` | Stitch completed successfully |

---

## 4. Tauri Capability Permissions — Common Pitfall

**Wrong permission names cause a build failure, not a runtime error.**
The build script validates `capabilities/default.json` against the plugin
manifest. If a permission name is wrong the build exits 1 with a long list
of valid permission names.

Confirmed correct names for this project:
| Feature | Permission |
|---------|------------|
| `relaunch()` JS → `plugin:process\|restart` | `process:allow-restart` |
| File logging | `log:default`, `log:allow-log` |
| Save dialog | `dialog:allow-save` |
| Write file | `fs:allow-write-text-file` |

When adding a new plugin, run `check-dev.sh` immediately — the error output
contains the full valid permission list for that plugin.

---

## 5. Unit Tests

Run these independently of `check-dev.sh` to check pure logic:

```bash
# Rust — pure-logic unit tests (no GUI, no Tauri runtime)
cd desktop/src-tauri && cargo test

# Frontend — pure TypeScript utility functions
cd desktop && npx vitest run
```

**22 Rust tests** cover `compute_blocked`, `sanitise_filename`, type
serialisation round-trips, and silence/speech deserialization.

**30 frontend tests** cover `computeBlockedSections`, `sectionStatus`,
`shortModel`, `escHtml`, `statusLabel`, `validateManifestJson`.

---

## 6. Frontend Error Flow

All JavaScript errors are routed to the same `app.log` file as Rust errors:

```
window.onerror / unhandledrejection
  → logError() in src/logger.ts
    → invoke('log_frontend_error', { context, message })
      → log::error!("[frontend::{}] {}", context, message)
        → ~/Library/Logs/com.editorllm.desktop/app.log
```

When debugging a frontend issue, check `app.log` — it contains both Rust
and JS error traces in chronological order.

---

## 7. Dev Server Lifecycle

| Script | Effect |
|--------|--------|
| `npm run dev:log` | Start app, no-watch, pipe to `/tmp/editorllm-dev.log` |
| `npm run dev:static` | Start app, no-watch, output to stdout only |
| `./check-dev.sh` | Kill old instance + start fresh + wait for result |
| `cat /tmp/editorllm-dev.pid \| xargs kill` | Kill current dev server |

The PID of the running dev server is always in `/tmp/editorllm-dev.pid`.

---

## 8. Complete Verification Checklist

Before declaring any desktop-side task complete:

- [ ] `./check-dev.sh` exits 0
- [ ] No `error` or `panicked` lines in `/tmp/editorllm-dev-clean.log`
- [ ] `cargo test` exits 0 (if Rust files changed)
- [ ] `npx vitest run` exits 0 (if `src/utils.ts` or test files changed)
- [ ] App window opened (confirmed by `Finished` + `Listening on` lines in log)
