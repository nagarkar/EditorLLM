/**
 * Runs once before all integration test files.
 * Removes the token-estimate scratch file from any prior run.
 */
const fs = require('fs');
const path = require('path');

const TOKEN_LOG = path.join(__dirname, '..', '..', '.integration-gemini-token-estimates.log');

module.exports = async function globalSetup() {
  try {
    fs.unlinkSync(TOKEN_LOG);
  } catch (_) {
    /* absent is fine */
  }
};
