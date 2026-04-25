/**
 * After integration tests: sums token estimates (one integer per line, written
 * by helpers/gemini.ts) and prints a single summary line.
 *
 * Dollar heuristic: blended ~$0.10 per million tokens (rough order-of-magnitude
 * for small Gemini API workloads; not billing advice).
 */
const fs = require('fs');
const path = require('path');

const TOKEN_LOG = path.join(__dirname, '..', '..', '.integration-gemini-token-estimates.log');
/** USD per million tokens (rough blended heuristic for console summary only) */
const USD_PER_MILLION = 0.1;

module.exports = async function globalTeardown() {
  if (!fs.existsSync(TOKEN_LOG)) {
    console.log('\n0 TOKENS USED OVER 0 Gemini calls ($0.0000)\n');
    return;
  }

  const raw = fs.readFileSync(TOKEN_LOG, 'utf8').trim();
  const lines = raw ? raw.split('\n').filter(Boolean) : [];
  const m = lines.length;
  const nTokens = lines.reduce((sum, line) => sum + (parseInt(line, 10) || 0), 0);
  const usd = (nTokens / 1e6) * USD_PER_MILLION;

  try {
    fs.unlinkSync(TOKEN_LOG);
  } catch (_) {
    /* non-fatal */
  }

  console.log(`\n${nTokens} TOKENS USED OVER ${m} Gemini calls ($${usd.toFixed(4)})\n`);
};
