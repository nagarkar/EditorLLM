// GAS global polyfills for integration tests.
//
// UrlFetchApp uses real synchronous HTTP via xmlhttprequest so that
// Gemini API calls in integration tests hit the live API.
//
// All other GAS globals are safe stubs matching jest.setup.js so that
// source-file references to DocumentApp, Drive, etc. do not crash.

// ── Load .env.integration if present ─────────────────────────────────────────
// Allows credentials to be stored in a gitignored file rather than requiring
// the caller to export env vars manually each session.
// Run `bash src/__tests__/integration/setup-test-env.sh` to create the file.
const fs = require('fs');
const path = require('path');

const envFile = path.join(__dirname, '.env.integration');
if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes (single or double)
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // Only set if not already defined (explicit env vars take precedence)
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}

// ── Auto-fetch Google OAuth token via gcloud ──────────────────────────────────
// GOOGLE_TOKEN is ALWAYS fetched fresh from gcloud at test startup.
// We intentionally ignore any GOOGLE_TOKEN value from .env.integration because
// tokens expire after ~1 hour and a stale cached value causes silent 403s.
//
// If gcloud is not installed or not authenticated, we abort with instructions.
{
  let gcloudError = null;
  let token = '';

  try {
    const { execSync } = require('child_process');
    // application-default credentials support explicit scopes.
    // gcloud auth login --enable-gdrive-access only adds Drive scope, not Docs.
    token = execSync('gcloud auth application-default print-access-token', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    gcloudError = e;
  }

  if (token) {
    process.env.GOOGLE_TOKEN = token;
    console.log(`[integration setup] GOOGLE_TOKEN: fresh gcloud token (prefix: ${token.slice(0, 12)}...)`);
  } else {
    const reason = gcloudError
      ? `gcloud error: ${gcloudError.message ?? gcloudError}`
      : 'gcloud returned an empty token';
    throw new Error(
      `\n\nCannot run integration tests: ${reason}\n\n` +
      `A Google OAuth token with Drive + Docs scopes is required.\n\n` +
      `Fix:\n` +
      `  1. Install gcloud: https://cloud.google.com/sdk/docs/install\n` +
      `  2. Authenticate with all required scopes (must include userinfo.email for E2E):\n` +
      `       gcloud auth application-default login \\\n` +
      `         --client-id-file="$HOME/.config/gcloud/editorllm-oauth-client.json" \\\n` +
      `         --scopes="https://www.googleapis.com/auth/cloud-platform,\\\n` +
      `                   https://www.googleapis.com/auth/drive,\\\n` +
      `                   https://www.googleapis.com/auth/documents,\\\n` +
      `                   https://www.googleapis.com/auth/script.external_request,\\\n` +
      `                   https://www.googleapis.com/auth/script.scriptapp,\\\n` +
      `                   https://www.googleapis.com/auth/userinfo.email"\n` +
      `  3. Re-run the tests.\n`
    );
  }
}

// ── Log key config for observability ─────────────────────────────────────────
console.log(`[integration setup] GOOGLE_DOC_ID: ${process.env.GOOGLE_DOC_ID || '(not set)'}`);
console.log(`[integration setup] GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? '(set)' : '(not set)'}`);
console.log(`[integration setup] GEMINI_FAST_MODEL: ${process.env.GEMINI_FAST_MODEL || '(default)'}`);
console.log(`[integration setup] GEMINI_THINKING_MODEL: ${process.env.GEMINI_THINKING_MODEL || '(default)'}`);
console.log(`[integration setup] GEMINI_DEEPSEEK_MODEL: ${process.env.GEMINI_DEEPSEEK_MODEL || '(default)'}`);

const { XMLHttpRequest } = require('xmlhttprequest');

// ── Real synchronous HTTP ─────────────────────────────────────────────────────
//
// GAS's UrlFetchApp.fetch() is synchronous; xmlhttprequest replicates this
// in Node.js using the underlying WHATWG XHR synchronous mode.
global.UrlFetchApp = {
  fetch(url, opts = {}) {
    const xhr = new XMLHttpRequest();
    xhr.open((opts.method || 'GET').toUpperCase(), url, false); // false = synchronous
    const headers = opts.headers || {};
    if (opts.contentType) headers['Content-Type'] = opts.contentType;
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, String(v));
    }
    xhr.send(opts.payload || null);
    return {
      getContentText: () => xhr.responseText,
      getResponseCode: () => xhr.status,
    };
  },
};

// ── PropertiesService — reads API key and model overrides from environment ────
global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (key) => {
      if (key === 'GEMINI_API_KEY')       return process.env.GEMINI_API_KEY       || '';
      if (key === 'GEMINI_FAST_MODEL')    return process.env.GEMINI_FAST_MODEL    || null;
      if (key === 'GEMINI_THINKING_MODEL') return process.env.GEMINI_THINKING_MODEL || null;
      if (key === 'GEMINI_DEEPSEEK_MODEL') return process.env.GEMINI_DEEPSEEK_MODEL || null;
      return null;
    },
    setProperty: jest.fn(),
  }),
  getUserProperties: () => ({
    getProperty: () => null,
    setProperty: jest.fn(),
    deleteProperty: jest.fn(),
  }),
  getDocumentProperties: jest.fn(() => ({
    getProperty: jest.fn(() => null),
    setProperty: jest.fn(),
    deleteProperty: jest.fn(),
  })),
};

// ── DocumentApp — same safe stubs as jest.setup.js ───────────────────────────
const mockBody = {
  getText: jest.fn().mockReturnValue(''),
  clear: jest.fn(),
  appendParagraph: jest.fn(),
  findText: jest.fn().mockReturnValue(null),
};

const mockDocumentTab = {
  getBody: jest.fn().mockReturnValue(mockBody),
  getId: jest.fn().mockReturnValue('mock-tab-id'),
};

const mockTab = {
  getTitle: jest.fn().mockReturnValue('MockTab'),
  getId: jest.fn().mockReturnValue('mock-tab-id'),
  getChildTabs: jest.fn().mockReturnValue([]),
  asDocumentTab: jest.fn().mockReturnValue(mockDocumentTab),
};

const mockDocument = {
  getTabs: jest.fn().mockReturnValue([mockTab]),
  addTab: jest.fn().mockReturnValue(mockTab),
  getId: jest.fn().mockReturnValue('mock-doc-id'),
  getName: jest.fn().mockReturnValue('Mock Document'),
};

global.DocumentApp = {
  getActiveDocument: jest.fn().mockReturnValue(mockDocument),
  ElementType: { TEXT: 'TEXT', PARAGRAPH: 'PARAGRAPH' },
  openById: jest.fn().mockReturnValue(mockDocument),
};

// ── Drive — mocked stubs ──────────────────────────────────────────────────────
global.Drive = {
  Comments: {
    create: jest.fn().mockReturnValue({ id: 'mock-comment-id' }),
    list: jest.fn().mockReturnValue({ comments: [], items: [] }),
    remove: jest.fn(),
  },
  Replies: {
    create: jest.fn().mockReturnValue({ id: 'mock-reply-id' }),
  },
};

// ── Docs Advanced Service — mocked stubs ─────────────────────────────────────
global.Docs = {
  Documents: {
    batchUpdate: jest.fn().mockReturnValue({}),
    get: jest.fn().mockReturnValue({}),
  },
};

// ── Remaining GAS globals ─────────────────────────────────────────────────────
global.ScriptApp = {
  getOAuthToken: jest.fn().mockReturnValue('mock-token'),
};

global.HtmlService = {
  createHtmlOutputFromFile: jest.fn().mockReturnValue({
    setWidth: jest.fn().mockReturnThis(),
    setHeight: jest.fn().mockReturnThis(),
    setSandboxMode: jest.fn().mockReturnThis(),
  }),
  SandboxMode: { IFRAME: 'IFRAME' },
};

global.SpreadsheetApp = {
  getActiveSpreadsheet: jest.fn().mockReturnValue({}),
};

global.Logger = {
  log: jest.fn(),
};

global.Tracer = {
  info:       jest.fn(),
  warn:       jest.fn(),
  error:      jest.fn(),
  startJob:   jest.fn(),
  finishJob:  jest.fn(),
  failJob:    jest.fn(),
  getLogs:    jest.fn().mockReturnValue([]),
  getJobStatus: jest.fn().mockReturnValue({ label: 'Agent', done: false, error: null }),
};

global.Utilities = {
  sleep: jest.fn(),
};
