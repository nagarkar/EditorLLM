// ============================================================
// Integration test configuration.
// Edit this file to change test targets, or set the environment
// variables listed below before running `npm run test:integration`.
//
// Required env vars:
//   GEMINI_API_KEY           — Gemini API key for real model calls
//
// Optional env vars (for Drive/Docs REST collaboration tests):
//   GOOGLE_DOC_ID            — Google Doc ID (from the document URL)
//   GOOGLE_TOKEN             — fetched automatically from gcloud at test startup;
//                              only set this manually to override (e.g. in CI)
//
// Model override env vars (leave unset to use production defaults):
//   GEMINI_FAST_MODEL        — override the 'fast' tier model for all tests
//   GEMINI_THINKING_MODEL    — override the 'thinking' tier model for all tests
//   GEMINI_DEEPSEEK_MODEL    — override the 'deepseek' tier model for all tests
//
// Example .env.integration entry to use cheaper models and avoid quota exhaustion:
//   GEMINI_THINKING_MODEL=gemini-2.5-flash
//
// The collaboration tests also require two GCP APIs to be enabled:
//   • Drive API    — https://console.developers.google.com/apis/api/drive.googleapis.com
//   • Docs API     — https://console.developers.google.com/apis/api/docs.googleapis.com
// ============================================================

export const INTEGRATION_CONFIG = {
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  googleDocId:  process.env.GOOGLE_DOC_ID  ?? '',
  googleToken:  process.env.GOOGLE_TOKEN   ?? '',

  /**
   * Per-tier model overrides for integration tests.
   * Undefined means "use the production default" (gemini-3.1-pro-preview for
   * thinking, gemini-3-flash-preview for fast, etc.).
   *
   * Set GEMINI_THINKING_MODEL=gemini-2.5-flash in .env.integration to cut
   * quota consumption during development runs.
   */
  models: {
    fast:     process.env.GEMINI_FAST_MODEL     || undefined,
    thinking: process.env.GEMINI_THINKING_MODEL || undefined,
    deepseek: process.env.GEMINI_DEEPSEEK_MODEL || undefined,
  } as { fast?: string; thinking?: string; deepseek?: string },
};
