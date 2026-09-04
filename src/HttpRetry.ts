// ============================================================
// HttpRetry.ts — Shared exponential-backoff retry helpers used
// by every external HTTP service in this script (Gemini, OpenAI,
// ElevenLabs).  Centralises:
//   - exponential delay math (base * 2^attempt)
//   - Retry-After header honouring (seconds OR HTTP-date)
//   - Tracer.warn line shape
//   - input-size-aware base computation
//
// Each service supplies a per-call `shouldRetry(response, attempt)`
// callback so that API-specific error semantics (429 vs 503,
// hard-quota short-circuit, JSON-body error parsing) stay local
// to the service.
//
// Uses `export function` rather than an IIFE export-const because
// only `export function` reliably surfaces as a GAS flat-scope
// global through the fixgas alias pass — see workspace rule
// .claude/rules/typescript-gas.md §16 and src/agentHelpers.ts.
// ============================================================

/** Cap on Retry-After header to prevent runaway sleeps if a server
 *  returns an unreasonably long value or an HTTP-date far in the future. */
const HTTP_RETRY_AFTER_MAX_MS = 60_000;

/** Truncates a response body excerpt for log lines, collapsing whitespace. */
function bodyExcerpt_(resp: GoogleAppsScript.URL_Fetch.HTTPResponse, maxChars: number): string {
  let body = '';
  try { body = resp.getContentText(); } catch (_) { /* binary or already-consumed */ }
  if (!body) return '';
  const collapsed = body.replace(/\s+/g, ' ').trim();
  return collapsed.length > maxChars ? collapsed.slice(0, maxChars) + '…' : collapsed;
}

/** GAS wrapper around httpParseRetryAfterMs that pulls headers from a live
 *  HTTPResponse and uses wall-clock now. */
function readRetryAfterMs_(resp: GoogleAppsScript.URL_Fetch.HTTPResponse): number | null {
  let headers: Record<string, string | undefined> = {};
  try {
    headers = resp.getAllHeaders() as any;
  } catch (_) { /* some test stubs don't implement getAllHeaders */ }
  return httpParseRetryAfterMs(headers, Date.now());
}

/**
 * Returns the base back-off in milliseconds, scaled linearly with the
 * estimated input size.  Bigger inputs warrant longer waits because (a)
 * they consume more of the per-minute token quota that's likely the
 * source of a 429, and (b) the per-minute window must roll over before
 * the retry can succeed.
 *
 *   baseMs = clamp(minMs, maxMs, inputBytes / bytesPerMs)
 *
 * Defaults (chosen against Gemini/OpenAI/ElevenLabs typical response
 * times — see commit notes):
 *   - minMs:      5 000  ms (short calls)
 *   - maxMs:     30 000  ms (very long inputs)
 *   - bytesPerMs:    2  bytes/ms (so 60 KB input → 30 s base)
 *
 * Pure function — no GAS globals.
 */
export function httpComputeBaseMs(
  inputBytes: number,
  opts?: { minMs?: number; maxMs?: number; bytesPerMs?: number }
): number {
  const minMs       = opts?.minMs ?? 5_000;
  const maxMs       = opts?.maxMs ?? 30_000;
  const bytesPerMs  = opts?.bytesPerMs ?? 2;
  const safeBytes   = Number.isFinite(inputBytes) && inputBytes > 0 ? inputBytes : 0;
  const scaled      = Math.round(safeBytes / bytesPerMs);
  return Math.max(minMs, Math.min(maxMs, scaled));
}

/**
 * Parses a Retry-After header value (RFC 7231 — either an integer seconds
 * count or an HTTP-date) into a millisecond delay relative to "now".
 * Returns null when the header is absent or unparseable.
 *
 * Capped at HTTP_RETRY_AFTER_MAX_MS so a misbehaving server can't park us
 * for hours.  Pure function — accepts a plain headers map so it is testable
 * without a GAS HTTPResponse stub.
 */
export function httpParseRetryAfterMs(
  headers: Record<string, string | undefined>,
  nowMs: number
): number | null {
  const raw = headers['Retry-After'] ?? headers['retry-after'];
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  // Form 1: integer seconds
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber)) {
    const ms = Math.max(0, Math.round(asNumber * 1000));
    return Math.min(ms, HTTP_RETRY_AFTER_MAX_MS);
  }

  // Form 2: HTTP-date
  const asDate = Date.parse(trimmed);
  if (Number.isFinite(asDate)) {
    const ms = Math.max(0, asDate - nowMs);
    return Math.min(ms, HTTP_RETRY_AFTER_MAX_MS);
  }

  return null;
}

/**
 * Performs an HTTP fetch with exponential-backoff retry.  On each iteration
 * the supplied `shouldRetry` callback decides whether the response warrants
 * another attempt — that's where each service plugs in its API-specific
 * error semantics (HTTP 429 vs 503 vs JSON-body `error.message` parsing
 * vs hard-quota short-circuit).
 *
 * Delay strategy:
 *   - If the response carries a Retry-After header, honour it
 *     (capped at HTTP_RETRY_AFTER_MAX_MS).
 *   - Otherwise sleep `baseMs * 2^attempt`.
 *
 * Returns the final HTTPResponse — caller decides whether to throw or pass
 * it through to its own response-parsing code.
 *
 * Logs:
 *   - Tracer.warn on each retry sleep, including a body excerpt
 *   - Tracer.info on a closing summary when retries actually happened
 *     ("settled after N retries" or "retry budget exhausted after N retries")
 *   First-attempt successes stay silent to keep log volume manageable.
 */
export function httpFetchWithRetry(
  url: string,
  fetchOpts: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions,
  cfg: {
    maxRetries: number;
    baseMs: number;
    label: string;
    shouldRetry: (response: GoogleAppsScript.URL_Fetch.HTTPResponse, attempt: number) => boolean;
  }
): GoogleAppsScript.URL_Fetch.HTTPResponse {
  let resp: GoogleAppsScript.URL_Fetch.HTTPResponse = UrlFetchApp.fetch(url, fetchOpts);
  let retriesUsed = 0;

  for (let attempt = 0; attempt < cfg.maxRetries; attempt++) {
    if (!cfg.shouldRetry(resp, attempt)) {
      if (retriesUsed > 0) {
        Tracer.info(
          `[${cfg.label}] settled after ${retriesUsed} retr${retriesUsed === 1 ? 'y' : 'ies'} ` +
          `— final HTTP ${resp.getResponseCode()}`
        );
      }
      return resp;
    }

    const expDelay   = cfg.baseMs * Math.pow(2, attempt);
    const retryAfter = readRetryAfterMs_(resp);
    const delay      = retryAfter !== null ? Math.max(retryAfter, 1_000) : expDelay;
    const source     = retryAfter !== null ? 'Retry-After header' : 'exponential backoff';
    // 500 chars catches the `details[].violations[]` array in Google's
    // RESOURCE_EXHAUSTED response, which names the specific quota metric
    // (e.g. "tokensPerDayPerProjectPerModel").  200 was too tight.
    const excerpt    = bodyExcerpt_(resp, 500);

    Tracer.warn(
      `[${cfg.label}] retryable HTTP ${resp.getResponseCode()} — ` +
      `sleeping ${delay} ms (attempt ${attempt + 1}/${cfg.maxRetries}, ${source}) ` +
      `body="${excerpt}"`
    );
    Utilities.sleep(delay);
    resp = UrlFetchApp.fetch(url, fetchOpts);
    retriesUsed++;
  }

  if (retriesUsed > 0) {
    Tracer.info(
      `[${cfg.label}] retry budget exhausted after ${retriesUsed} retr${retriesUsed === 1 ? 'y' : 'ies'} ` +
      `— final HTTP ${resp.getResponseCode()}`
    );
  }
  return resp;
}
