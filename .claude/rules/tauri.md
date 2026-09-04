# Tauri v2 Desktop App — Architecture & UI Best Practices

Applies to `desktop/` — the EditorLLM Tauri v2 app (Rust backend + TypeScript/Vite frontend).

---

## 1. Re-rendering Strategy — In-Place First

**Never call `renderManifestEditor(root)` when a narrower DOM update is possible.**
Full re-renders are always correct but cause scroll-position reset (mitigated) and
focus loss (not mitigated), and re-run all async data fetches.

### The in-place card rebuild pattern
Used for any action that affects a known subset of section cards:

```typescript
const freshManifest: AudioManifest | null = await invoke('get_manifest');
if (freshManifest) {
  const freshBlocked = computeBlockedSections(freshManifest.sections, selectedFormat_());
  for (const s of freshManifest.sections) {
    if (s.type !== 'speech') continue;
    if (!isAffected(s)) continue;   // skip unrelated cards
    const row    = scroll.querySelector(`[data-id="${s.id}"]`) as HTMLElement | null;
    const oldCard = row?.querySelector('.section-card') as HTMLElement | null;
    if (oldCard) oldCard.replaceWith(buildCard(s, freshBlocked, root, scroll));
  }
} else {
  renderManifestEditor(root);   // safety fallback
}
```

### The in-place row insertion pattern
Used for insert-silence (or any action that adds a new section row):

```typescript
const freshIdx  = freshManifest.sections.findIndex(s => s.id === anchorId);
const newSection = freshManifest.sections[freshIdx + 1];  // or -1 for "above"
const newRow     = buildRow(newSection, freshBlocked, root, scroll);
anchorRow.after(newRow);   // or anchorRow.before() for "above"
```

Always fall back to `renderManifestEditor(root)` if the anchor row can't be found in the DOM.

### When full re-render is correct

| Action | Reason |
|--------|--------|
| Quality selector change | Every card's status, buttons, and audio path change |
| Generate All Remaining (final) | All sections change state simultaneously |
| Clear lower quality | Multiple cards lose their audio state |
| Initial load / manifest switch | No prior DOM to update |

### Preserving scroll on unavoidable full re-renders

Read `scrollTop` before clearing the DOM, restore it in the same `requestAnimationFrame`
that resizes textareas:

```typescript
const prevScrollTop = root.querySelector<HTMLElement>('.sections-scroll')?.scrollTop ?? 0;
root.innerHTML = '';
// ... build new DOM ...
requestAnimationFrame(() => {
  if (prevScrollTop > 0) scroll.scrollTop = prevScrollTop;
  scroll.querySelectorAll<HTMLTextAreaElement>('textarea').forEach(autoResize_);
});
```

---

## 2. Section DOM Identity

Every section row carries `row.dataset.id = section.id`. Use this for all DOM lookups:

```typescript
scroll.querySelector(`[data-id="${sectionId}"]`)
```

Cards are always inside their row as `.section-card`. Text cells are `.text-cell`.

---

## 3. SharedManifest Locking Rules (Rust)

`SharedManifest = Arc<Mutex<Option<AudioManifest>>>`.

- Lock, read or mutate, then **drop the guard before any `await`**. Never hold a
  `MutexGuard` across an async boundary — Tokio will deadlock.
- Pattern: open a `{}` block, do the work, let the guard drop at `}`.

```rust
let data = {
    let guard = state.lock().unwrap();
    guard.as_ref().ok_or("No manifest loaded")?.clone()
};
// guard is dropped here — safe to await
call_elevenlabs(&api_key, &data, output_format).await?;
```

---

## 4. Autosave Is Best-Effort

`try_autosave` writes the manifest to disk only when `SharedFilePath` has a value
(file-opened manifests). HTTP/clipboard manifests have no path and are silently skipped.
Failures are logged, never propagated. Call it after every state mutation.

---

## 5. Tauri Command Registration

Every `#[tauri::command]` pub function in `commands.rs` **must** also appear in the
`tauri::generate_handler![...]` macro in `lib.rs`. Missing registration causes a silent
runtime error ("command not found") — no compile-time warning.

---

## 6. Audio Playback — Base64 + Pause/Resume

WKWebView (macOS) refuses to play audio served from the `asset://` scheme (`NotSupportedError`).
Always load audio via the `read_audio_base64` command.

**Keep the `Audio` element alive while paused** — don't null it out, or you lose the
playback position. Clear refs before calling `pause()` so the element's `'pause'` event
handler can check `currentPlayingId_` and know the stop was intentional:

```typescript
function stopPlayback_(): void {
  if (!currentAudio_) return;
  const audio = currentAudio_, url = currentAudioUrl_;
  currentAudio_ = null; currentAudioUrl_ = null; currentPlayingId_ = null;
  audio.pause();
  if (url) URL.revokeObjectURL(url);
}
```

**Wire browser events to update the button** so Bluetooth disconnects, OS media controls,
and other external interruptions keep the icon in sync automatically:

```typescript
audio.addEventListener('pause', () => { if (currentPlayingId_ === id) setButton('paused'); });
audio.addEventListener('play',  () => { if (currentPlayingId_ === id) setButton('playing'); });
audio.addEventListener('ended', () => { revokeUrl(); clearRefs(); setButton('idle'); });
```

**Swallow `AbortError`** — when `stopPlayback_()` is called while a `play()` promise
is pending, the browser rejects with `AbortError`. This is expected, not an error to show
the user:

```typescript
audio.play().catch(err => {
  if ((err as DOMException).name === 'AbortError') return;
  showErrorOverlay(`Playback failed: ${err}`);
});
```

Always track `currentAudioUrl_` separately from `currentAudio_` so the object URL
is revoked exactly once (in `ended` or in `stopPlayback_`).

---

## 7. Frontend Error Bridge

All JS errors should route to the Rust log file (`~/Library/Logs/com.editorllm.desktop/app.log`)
so they appear alongside Rust errors in chronological order:

```typescript
invoke('log_frontend_error', { context: 'my-feature', message: String(err) });
```

The `window.onerror` and `unhandledrejection` handlers in `logger.ts` do this globally,
but call it explicitly for caught errors in critical paths.

---

## 8. ffmpeg Stdin Must Be Null

Tauri inherits its stdin from the parent process. Passing that fd to ffmpeg causes
SIGPIPE when the parent closes the pipe. Always set `.stdin(Stdio::null())` on every
`Command` that shells out to ffmpeg.

---

## 9. Mono Audio for Silence Clips

ElevenLabs TTS produces **mono** MP3. Silence clips generated with ffmpeg must also be
mono (`channel_layout=mono`), otherwise the ffmpeg concat demuxer silently drops segments
at every channel-count transition.

```
anullsrc=channel_layout=mono:sample_rate=44100
```

---

## 10. Two-Pass EBU R128 Loudnorm

Single-pass `loudnorm` cannot precisely hit the -16 LUFS / -1.5 dBTP targets because
it applies dynamic compression without knowing the input statistics upfront.

For med/high quality (`mp3_44100_128`, `mp3_44100_192`), always use two-pass:
- **Pass 1**: run with `-f null -` and `print_format=json` to measure; parse the JSON
  block from stderr (`stderr.rfind('{')` … `stderr.rfind('}')`).
- **Pass 2**: run with `linear=true` and the measured values to apply a precise gain.

Low quality (`mp3_44100_64`) can use single-pass — the precision difference is
inaudible at 64 kbps.
