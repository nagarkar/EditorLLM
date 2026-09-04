'use strict';
// Provide browser globals expected by client-side TypeScript modules.
// This runs before each test file via setupFilesAfterEnv.

// Node.js 20+ ships a global `fetch` (undici). Emscripten v0.11's generated
// ffmpeg-core.js prefers fetch() over readBinary()/fs.readFileSync() to load
// the WASM binary, but undici rejects file:// URLs ("not implemented").
// Removing the global makes Emscripten fall back to its Node.js readBinary
// path (fs.readFileSync with the absolute WASM path), which works correctly.
delete global.fetch;
