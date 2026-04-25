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

const envFile = path.join(__dirname, '..', '..', '.env.integration');
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

// ── Auto-fetch Google OAuth token ────────────────────────────────────────────
// GOOGLE_TOKEN is ALWAYS fetched fresh at test startup — never read from
// .env.integration because tokens expire after ~1 hour.
//
// Strategy (tried in order):
//   1. gcloud auth application-default print-access-token
//      Searched on $PATH first, then the known macOS download location.
//   2. Direct refresh-token exchange via ~/.config/gcloud/application_default_credentials.json
//      Works when gcloud is absent or not on PATH but credentials already exist.
//
// If neither strategy succeeds the suite aborts with actionable instructions.
{
  const { execSync } = require('child_process');
  const os   = require('os');
  const path = require('path');
  const https = require('https');

  // ── Strategy 1: gcloud binary ─────────────────────────────────────────────
  // Candidate locations: $PATH, then the default macOS SDK download directory.
  const GCLOUD_EXTRA_PATHS = [
    path.join(os.homedir(), 'Downloads', 'google-cloud-sdk', 'bin'),
    path.join(os.homedir(), 'google-cloud-sdk', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ];

  function tryGcloud() {
    const extraPath = GCLOUD_EXTRA_PATHS.join(':');
    const env = { ...process.env, PATH: `${process.env.PATH}:${extraPath}` };
    try {
      return execSync('gcloud auth application-default print-access-token', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      }).trim();
    } catch (_) {
      return '';
    }
  }

  // ── Strategy 2: direct refresh-token exchange ──────────────────────────────
  // Reads ~/.config/gcloud/application_default_credentials.json and calls
  // https://oauth2.googleapis.com/token with grant_type=refresh_token.
  function tryRefreshToken() {
    const credFile = path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json');
    if (!fs.existsSync(credFile)) return '';
    let creds;
    try { creds = JSON.parse(fs.readFileSync(credFile, 'utf8')); } catch (_) { return ''; }
    if (creds.type !== 'authorized_user' || !creds.refresh_token) return '';

    const body = new URLSearchParams({
      client_id:     creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type:    'refresh_token',
    }).toString();

    // Synchronous HTTPS POST via a child process (Node https module is async-only).
    try {
      const result = execSync(
        `node -e "
          const https = require('https');
          const body = ${JSON.stringify(body)};
          const req = https.request(
            { hostname:'oauth2.googleapis.com', path:'/token', method:'POST',
              headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)} },
            res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>process.stdout.write(d)); }
          );
          req.on('error', e => process.stderr.write(e.message));
          req.write(body); req.end();
        "`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const parsed = JSON.parse(result);
      return parsed.access_token || '';
    } catch (_) {
      return '';
    }
  }

  // ── Resolve token ──────────────────────────────────────────────────────────
  let token = tryGcloud();
  let source = 'gcloud';
  if (!token) {
    token  = tryRefreshToken();
    source = 'refresh_token';
  }

  if (token) {
    process.env.GOOGLE_TOKEN = token;
    console.log(`[integration setup] GOOGLE_TOKEN: fresh token via ${source} (prefix: ${token.slice(0, 12)}...)`);
  } else {
    throw new Error(
      `\n\nCannot run integration tests: could not obtain a Google OAuth token.\n\n` +
      `Tried:\n` +
      `  1. gcloud auth application-default print-access-token\n` +
      `     (searched PATH and ${GCLOUD_EXTRA_PATHS.join(', ')})\n` +
      `  2. Direct refresh-token exchange from\n` +
      `     ~/.config/gcloud/application_default_credentials.json\n\n` +
      `Fix — one of:\n` +
      `  A. Add gcloud to PATH:  export PATH="$PATH:$HOME/Downloads/google-cloud-sdk/bin"\n` +
      `  B. Re-authenticate:     gcloud auth application-default login \\\n` +
      `       --client-id-file="$HOME/.config/gcloud/editorllm-oauth-client.json" \\\n` +
      `       --scopes="https://www.googleapis.com/auth/cloud-platform,\\\n` +
      `                 https://www.googleapis.com/auth/drive,\\\n` +
      `                 https://www.googleapis.com/auth/documents,\\\n` +
      `                 https://www.googleapis.com/auth/script.external_request,\\\n` +
      `                 https://www.googleapis.com/auth/script.scriptapp,\\\n` +
      `                 https://www.googleapis.com/auth/userinfo.email"\n`
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
