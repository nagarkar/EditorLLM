// ============================================================
// httpRetry.test.ts — unit tests for the pure parts of
// HttpRetry (computeBaseMs + parseRetryAfterMs).  The retry
// loop itself depends on UrlFetchApp / Tracer / Utilities and
// is exercised through the existing integration tests of the
// services that wrap it.
// ============================================================

// HttpRetry exposes its public surface as `export function ...` declarations
// so ts-jest can import them directly and the GAS build sees flat-scope
// globals via the existing `function X(){}` declaration emitted by tsc.
// See .claude/rules/typescript-gas.md §16 and src/agentHelpers.ts for the
// same pattern.
import { httpComputeBaseMs, httpParseRetryAfterMs } from '../HttpRetry';

describe('httpComputeBaseMs', () => {

  it('clamps to minMs (5000) for very small inputs', () => {
    expect(httpComputeBaseMs(0)).toBe(5000);
    expect(httpComputeBaseMs(100)).toBe(5000);
    expect(httpComputeBaseMs(8000)).toBe(5000);  // 8000/2 = 4000 → clamped
  });

  it('scales linearly between min and max', () => {
    // 20 KB → 10 000 ms
    expect(httpComputeBaseMs(20_000)).toBe(10_000);
    // 30 KB → 15 000 ms
    expect(httpComputeBaseMs(30_000)).toBe(15_000);
    // 50 KB → 25 000 ms
    expect(httpComputeBaseMs(50_000)).toBe(25_000);
  });

  it('clamps to maxMs (30000) for very large inputs', () => {
    expect(httpComputeBaseMs(60_000)).toBe(30_000);
    expect(httpComputeBaseMs(1_000_000)).toBe(30_000);
  });

  it('honours custom min/max/bytesPerMs overrides', () => {
    expect(httpComputeBaseMs(20_000, { minMs: 1000, maxMs: 10_000, bytesPerMs: 4 })).toBe(5000);
    expect(httpComputeBaseMs(100, { minMs: 1000, maxMs: 10_000, bytesPerMs: 4 })).toBe(1000);
    expect(httpComputeBaseMs(100_000, { minMs: 1000, maxMs: 10_000, bytesPerMs: 4 })).toBe(10_000);
  });

  it('treats negative or non-finite bytes as zero (fall through to minMs)', () => {
    expect(httpComputeBaseMs(-5)).toBe(5000);
    expect(httpComputeBaseMs(NaN)).toBe(5000);
    // Infinity is also non-finite — sensible default is minMs since we don't
    // actually know the input size at that point.
    expect(httpComputeBaseMs(Infinity)).toBe(5000);
  });

});

describe('httpParseRetryAfterMs', () => {

  const NOW = Date.UTC(2026, 3, 29, 12, 0, 0);

  it('returns null when the header is absent', () => {
    expect(httpParseRetryAfterMs({}, NOW)).toBeNull();
  });

  it('returns null for empty string headers', () => {
    expect(httpParseRetryAfterMs({ 'Retry-After': '' }, NOW)).toBeNull();
    expect(httpParseRetryAfterMs({ 'retry-after': '   ' }, NOW)).toBeNull();
  });

  it('parses an integer-seconds header into milliseconds', () => {
    expect(httpParseRetryAfterMs({ 'Retry-After': '30' }, NOW)).toBe(30_000);
    expect(httpParseRetryAfterMs({ 'retry-after': '5' }, NOW)).toBe(5_000);
  });

  it('parses a fractional-seconds header (some servers emit floats)', () => {
    expect(httpParseRetryAfterMs({ 'Retry-After': '2.5' }, NOW)).toBe(2_500);
  });

  it('caps the parsed value at RETRY_AFTER_MAX_MS (60 s)', () => {
    expect(httpParseRetryAfterMs({ 'Retry-After': '120' }, NOW)).toBe(60_000);
    expect(httpParseRetryAfterMs({ 'Retry-After': '999999' }, NOW)).toBe(60_000);
  });

  it('parses an HTTP-date relative to nowMs', () => {
    const fifteenSeconds = new Date(NOW + 15_000).toUTCString();
    expect(httpParseRetryAfterMs({ 'Retry-After': fifteenSeconds }, NOW)).toBeCloseTo(15_000, -2);
  });

  it('caps an HTTP-date in the far future at RETRY_AFTER_MAX_MS', () => {
    const farFuture = new Date(NOW + 3_600_000).toUTCString();
    expect(httpParseRetryAfterMs({ 'Retry-After': farFuture }, NOW)).toBe(60_000);
  });

  it('returns 0 for an HTTP-date already in the past', () => {
    const past = new Date(NOW - 30_000).toUTCString();
    expect(httpParseRetryAfterMs({ 'Retry-After': past }, NOW)).toBe(0);
  });

  it('returns null for unparseable garbage', () => {
    expect(httpParseRetryAfterMs({ 'Retry-After': 'lol' }, NOW)).toBeNull();
  });

  it('case-insensitive on the header name (Retry-After vs retry-after)', () => {
    expect(httpParseRetryAfterMs({ 'Retry-After': '5' }, NOW)).toBe(5_000);
    expect(httpParseRetryAfterMs({ 'retry-after': '5' }, NOW)).toBe(5_000);
  });

});
