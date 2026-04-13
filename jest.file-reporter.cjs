/**
 * jest.file-reporter.cjs
 *
 * A lightweight Jest reporter that writes a human-readable test summary to a
 * file after every run.  Configure it in a Jest config's `reporters` array:
 *
 *   reporters: [
 *     'default',
 *     ['<rootDir>/jest.file-reporter.cjs', { outputFile: '.last_e2e_test_results' }],
 *   ]
 *
 * The file is always written (pass or fail) so the AI assistant can read it
 * directly without copy-paste from the terminal.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

class FileReporter {
  constructor(_globalConfig, options = {}) {
    this._outputFile = path.resolve(options.outputFile || '.last_test_results');
  }

  onRunComplete(_contexts, results) {
    const lines = [];
    const ts = new Date().toISOString();

    // ── Header ──────────────────────────────────────────────────────────────
    lines.push(`Jest results — ${ts}`);
    lines.push('═'.repeat(72));

    const { numPassedTests, numFailedTests, numPendingTests, numTotalTests,
            numPassedTestSuites, numFailedTestSuites, numTotalTestSuites,
            startTime } = results;

    const elapsed = results.startTime
      ? `${((Date.now() - startTime) / 1000).toFixed(1)}s`
      : '—';

    lines.push(
      `Suites : ${numPassedTestSuites} passed, ` +
      `${numFailedTestSuites} failed, ` +
      `${numTotalTestSuites} total`
    );
    lines.push(
      `Tests  : ${numPassedTests} passed, ` +
      `${numFailedTests} failed, ` +
      (numPendingTests ? `${numPendingTests} skipped, ` : '') +
      `${numTotalTests} total`
    );
    lines.push(`Time   : ${elapsed}`);
    lines.push('');

    // ── Per-suite detail ─────────────────────────────────────────────────────
    for (const suite of results.testResults) {
      const relPath = path.relative(process.cwd(), suite.testFilePath);
      const suiteStatus = suite.numFailingTests > 0 || suite.failureMessage ? 'FAIL' : 'PASS';
      lines.push(`${suiteStatus}  ${relPath}`);

      if (suite.failureMessage) {
        lines.push('');
        lines.push('  Suite Failure (e.g. beforeAll error):');
        for (const fline of suite.failureMessage.split('\n')) {
          lines.push(`    ${fline}`);
        }
      }

      for (const t of suite.testResults) {
        const icon = t.status === 'passed' ? '  ✓' : t.status === 'failed' ? '  ✕' : '  ○';
        const dur  = t.duration != null ? ` (${t.duration}ms)` : '';
        const name = [...(t.ancestorTitles || []), t.title].join(' › ');
        lines.push(`${icon} ${name}${dur}`);

        if (t.status === 'failed') {
          for (const msg of t.failureMessages || []) {
            // Indent each line of the failure message
            for (const fline of msg.split('\n')) {
              lines.push(`      ${fline}`);
            }
          }
        }
      }

      // Suite-level console output (if any)
      if (suite.console && suite.console.length > 0) {
        lines.push('');
        lines.push('  Console output:');
        for (const entry of suite.console) {
          const prefix = `    [${entry.type}] `;
          for (const cline of entry.message.split('\n')) {
            lines.push(`${prefix}${cline}`);
          }
        }
      }

      lines.push('');
    }

    // ── Failure summary ──────────────────────────────────────────────────────
    const failures = results.testResults.flatMap(s =>
      s.testResults.filter(t => t.status === 'failed').map(t => ({
        suite: path.relative(process.cwd(), s.testFilePath),
        name:  [...(t.ancestorTitles || []), t.title].join(' › '),
        msgs:  t.failureMessages || [],
      }))
    );

    if (failures.length > 0) {
      lines.push('─'.repeat(72));
      lines.push(`FAILURES (${failures.length})`);
      lines.push('─'.repeat(72));
      for (const f of failures) {
        lines.push('');
        lines.push(`● ${f.suite}`);
        lines.push(`  ${f.name}`);
        lines.push('');
        for (const msg of f.msgs) {
          for (const fline of msg.split('\n')) {
            lines.push(`  ${fline}`);
          }
        }
      }
      lines.push('');
    }

    lines.push(numFailedTests > 0 ? 'RESULT: FAILED' : 'RESULT: PASSED');

    fs.writeFileSync(this._outputFile, lines.join('\n') + '\n', 'utf8');
  }
}

module.exports = FileReporter;
