# Bug: Exported manifest has empty voiceName in all speech sections

## Hypothesis 2 — buildManifest reads payload.voice_name which is never stored
**Evidence:**
- `src/Code.ts:3322` — `curVoiceName = d.payload?.voice_name ?? ''`; this is always `''` because
  `voice_name` is not part of the directive payload stored by `addTtsDirectiveFromSelection`
- `src/Code.ts:~2678` — `DirectivePersistence.createDirectiveAtRange` call stores only
  `{tts_model, voice_id, stability, similarity_boost}` — no `voice_name`
- `src/DirectivePersistence.ts:308` — `listDirectivesOnTab` surfaces `voice_id` as a direct property
  but never derives `voice_name` from the cache
- `src/ElevenLabsService.ts:652` — `ensureVoiceMappings()` returns `{voiceId → voiceName}` map from
  CacheService; the TTS panel UI correctly calls this at render time, which is why names appear there
- Failing repro test: `src/__tests__/voiceNameManifest.test.ts` — seeds `{voice123 → 'Great Voice Name'}`
  via `ctx.ElevenLabsService.ensureVoiceMappings`, calls `buildManifest`, asserts `voiceName === 'Great Voice Name'`;
  test fails with `Received: ""`
**Prediction:** Calling `ElevenLabsService.ensureVoiceMappings()` once before the directive loop in
`buildManifest` and deriving `curVoiceName = voiceMap?.[curVoiceId] ?? ''` will populate voice names.
**Outcome:** FIXED

## Resolution (voice name bug)

Root cause: `buildManifest` at `src/Code.ts:3322` read `d.payload?.voice_name ?? ''`. Since
`addTtsDirectiveFromSelection` never stores `voice_name` in the directive payload, this was
always `''`. The TTS panel UI showed names correctly because it calls
`ElevenLabsService.ensureVoiceMappings()` at render time — `buildManifest` did not.

Fix (two lines in `src/Code.ts`):
1. Added `const voiceMap = ElevenLabsService.ensureVoiceMappings() ?? {};` before the directive loop.
2. Changed `curVoiceName = d.payload?.voice_name ?? ''` to
   `curVoiceName = (voiceMap as Record<string, string>)[curVoiceId] ?? ''`.

Also added `getVoiceMappings`, `ensureVoiceMappings`, and `getSelectedDictionary` stubs to
`global.ElevenLabsService` in `config/jest/jest.setup.js` so vm-context tests that spread
`global` into the sandbox start with a complete ElevenLabsService mock.

638 tests pass, lint clean.

---

---

# Bug: Full stitched audio file missing after "Generate All Remaining"

## Hypothesis 1 — ffmpeg stderr swallowed; auto-stitch failure silently discarded

**Evidence:**
- `desktop/src-tauri/src/stitch.rs:99` — `.status()` discards stdout/stderr; on failure only the
  exit code is known (`"ffmpeg exited with {status}"`), making it impossible to diagnose the cause.
- `desktop/src-tauri/src/commands.rs` — auto-stitch in `generate_all_remaining` uses `log::warn!`;
  the error is never surfaced to the frontend, so the user sees a successful return but no file.

**Prediction:** Switching to `.output()` (captures stderr) and returning the stitch error as `Err`
from `generate_all_remaining` will reveal the exact ffmpeg failure and let the user see the error.

**Outcome:** FIXED. Root causes confirmed and resolved:
- `stitch::run` now uses `.output()` and includes stderr in all error strings.
- `generate_all_remaining` returns `Err` when auto-stitch fails so the error overlay is shown.
- Added `loudnorm=I=-16:TP=-1.5:LRA=11` filter for EBU R128 volume normalization.
- Added "Full Audio File" Finder link in the manifest editor when `audioFilePath` is set.

## Resolution (stitched audio bug)

Root cause: ffmpeg errors were invisible (no stderr capture). Any ffmpeg failure produced no output
file while the app continued as if nothing happened. `generate_all_remaining` discarded the stitch
error with `log::warn!`.

Fix: `stitch::run` uses `.output()` and includes stderr in error strings. `generate_all_remaining`
returns `Err` on stitch failure. Loudnorm normalization added for consistent output loudness.

---

# Bug: Desktop audio playback fails — NotSupportedError

## Hypothesis 1 — WKWebView refuses asset:// URLs as media sources
**Evidence:**
- `desktop/src/manifest.ts:414` — play handler calls `convertFileSrc(sp.audioFilePath!)` which
  produces `asset://localhost/{path}` URLs
- `capabilities/default.json` — no `core:asset-protocol:allow-read` permission or scope config
- AppScript version works because it receives base64 audio and plays via a `blob:` URL, which
  WKWebView accepts for media unconditionally
- `NotSupportedError: The operation is not supported` is the exact DOMException WKWebView throws
  when `audio.play()` has no valid/accessible media source
**Prediction:** Replacing `convertFileSrc` with a Rust command that reads the file and returns
base64 (same pattern as AppScript) will allow playback.
**Outcome:** FIXED

## Resolution

Root cause was `convertFileSrc(path)` producing an `asset://localhost/…` URL.
macOS WKWebView (used by Tauri) refuses to serve audio media from non-standard
URL schemes, throwing `NotSupportedError: The operation is not supported` from
`audio.play()`.

Fix mirrors the working AppScript approach (base64 → blob URL):
1. Added `read_audio_base64` Rust command in `commands.rs` — reads file bytes
   with `std::fs::read`, encodes with `base64::engine::general_purpose::STANDARD`.
2. Registered command in `lib.rs` invoke_handler.
3. Updated play button handler in `desktop/src/manifest.ts` to call
   `invoke('read_audio_base64', { filePath })`, decode with `atob()`, create a
   `Blob`, and play via `URL.createObjectURL()`. Blob URL is revoked on `ended`.
4. Removed `convertFileSrc` import (no longer used).

All 22 Rust tests pass. All 30 frontend tests pass.
