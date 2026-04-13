// ============================================================
// Apps Script web app helper for E2E integration tests.
//
// Background
// ----------
// Apps Script's Execution API (scripts.run) does NOT support
// container-bound scripts (scripts attached to a Google Doc/Sheet).
// The only way to invoke a bound script externally is via a
// web app deployment:
//
//   Deploy → New deployment → Type: Web app
//   Execute as: Me (script owner)
//   Who has access: Anyone with Google account
//
// The test calls doPost() on the web app URL with a JSON body:
//   { "fn": "<functionName>", "params": [] }
//
// The web app URL is stored in .clasp.json as "webAppUrl".
//
// One-time setup
// --------------
//   1. Push the latest code: clasp push
//   2. Deploy → New deployment → Type: Web app
//      Execute as: Me  |  Who has access: Anyone with Google account
//   3. Copy the web app URL to .clasp.json as "webAppUrl"
//   4. After each clasp push that changes doPost logic, re-deploy:
//        clasp deploy -i <webAppDeploymentId>
//
// Token requirements
// ------------------
// The web app deployed with "Anyone with Google account" requires the
// caller's token to include at minimum:
//   https://www.googleapis.com/auth/userinfo.email
//
// Authenticate:
//   gcloud auth application-default login \
//     --client-id-file="$HOME/.config/gcloud/editorllm-oauth-client.json" \
//     --scopes="https://www.googleapis.com/auth/cloud-platform,\
//               https://www.googleapis.com/auth/drive,\
//               https://www.googleapis.com/auth/documents,\
//               https://www.googleapis.com/auth/script.external_request,\
//               https://www.googleapis.com/auth/script.scriptapp,\
//               https://www.googleapis.com/auth/userinfo.email"
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs   = require('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');

const CLASP_JSON_PATH = path.join(__dirname, '../../../../.clasp.json');

function readClaspField_(field: string): string {
  if (!fs.existsSync(CLASP_JSON_PATH)) {
    throw new Error(
      `readClaspField_: .clasp.json not found at ${CLASP_JSON_PATH}.`
    );
  }
  const clasp = JSON.parse(fs.readFileSync(CLASP_JSON_PATH, 'utf8'));
  if (!clasp[field]) {
    throw new Error(`readClaspField_: .clasp.json has no "${field}" field or it is empty.`);
  }
  return clasp[field] as string;
}

/** Reads the scriptId from .clasp.json. */
export function getScriptId(): string {
  return readClaspField_('scriptId');
}

/** Reads the web app URL from .clasp.json ("webAppUrl" field). */
export function getWebAppUrl(): string {
  return readClaspField_('webAppUrl');
}

export interface GasWebAppResult {
  result?: unknown;
  error?:  string;
}

/**
 * Invokes a GAS function via the web app's doPost() endpoint.
 *
 * The web app must be deployed with:
 *   Execute as: Me  |  Who has access: Anyone with Google account
 *
 * The token must include the userinfo.email scope so Google can
 * verify the caller's identity before forwarding to the web app.
 *
 * @param webAppUrl    - Web app URL from .clasp.json ("webAppUrl")
 * @param functionName - Name of the function to call (mapped in doPost)
 * @param parameters   - Array of JSON-serialisable parameters (passed as "params")
 * @param token        - OAuth2 access token
 * @returns            The "result" field from the doPost JSON response
 * @throws             On HTTP error, doPost error, or JSON parse failure
 */
/**
 * Makes a synchronous HTTP POST via curl, handling the 302 redirect that
 * Apps Script web apps always return.
 *
 * Flow:
 *   1. POST to webAppUrl with Authorization header → 302 to echo URL
 *   2. GET the echo URL (no auth needed) → JSON response body
 *
 * We do NOT use curl -L because curl strips the Authorization header on
 * cross-domain redirects (security policy), and the final echo URL does not
 * accept POST. Instead we extract the Location header and make a second GET.
 */
function httpsPostSync_(
  url:     string,
  headers: Record<string, string>,
  body:    string
): { status: number; text: string } {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execSync } = require('child_process');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('os');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsSync = require('fs');

  const tmpBody = `${os.tmpdir()}/gas_e2e_body_${Date.now()}.json`;
  fsSync.writeFileSync(tmpBody, body, 'utf8');

  try {
    const headerArgs = Object.entries(headers)
      .map(([k, v]) => `-H ${JSON.stringify(`${k}: ${v}`)}`)
      .join(' ');

    // Step 1: POST — stop at first response (--max-redirs 0), dump headers (-D -)
    // -w '\n%{http_code}' appends the HTTP status code on its own line at the end.
    const step1Cmd = [
      'curl', '-s', '-D', '-',
      '--max-redirs', '0',
      '-X', 'POST',
      headerArgs,
      `--data-binary @${tmpBody}`,
      `-w '\\n%{http_code}'`,
      JSON.stringify(url),
    ].join(' ');

    let step1Out: string;
    try {
      step1Out = execSync(step1Cmd, { encoding: 'utf8', timeout: 360_000 });
    } catch (e: any) {
      // execSync timeout/signal errors have circular .error references that
      // crash Jest's messageParent JSON serialization in worker mode.
      // Re-throw a clean, non-circular Error.
      throw new Error(`httpsPostSync_ step 1 failed: ${e?.message ?? e}`);
    }

    // Parse headers + status from step 1
    const step1Lines = step1Out.split('\n');
    const step1Status = parseInt((step1Lines.pop() ?? '0').trim(), 10) || 0;

    // Find the Location header for the redirect target
    let location = '';
    for (const line of step1Lines) {
      const m = line.match(/^location:\s*(.+)/i);
      if (m) { location = m[1].trim(); break; }
    }

    if (step1Status === 302 && location) {
      // Step 2: GET the echo URL — no auth needed; the key is in the URL params
      const step2Cmd = [
        'curl', '-s', '-L',
        `-w '\\n%{http_code}'`,
        JSON.stringify(location),
      ].join(' ');

      let step2Out: string;
      try {
        step2Out = execSync(step2Cmd, { encoding: 'utf8', timeout: 120_000 });
      } catch (e: any) {
        throw new Error(`httpsPostSync_ step 2 failed: ${e?.message ?? e}`);
      }
      const step2Lines = step2Out.split('\n');
      const step2Status = parseInt((step2Lines.pop() ?? '0').trim(), 10) || 0;
      const text = step2Lines.join('\n');
      return { status: step2Status, text };
    }

    // No redirect — use step 1 body (split off the status line we already popped)
    const bodyLines = step1Lines.filter((l: string) => !l.match(/^HTTP\//i) && !l.match(/^[\w-]+:/));
    return { status: step1Status, text: bodyLines.join('\n') };
  } finally {
    try { fsSync.unlinkSync(tmpBody); } catch { /* ignore */ }
  }
}

export function runGasFunction(
  webAppUrl:     string,
  functionName:  string,
  parameters:    unknown[],
  token:         string
): unknown {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type':  'application/json',
  };
  const body = JSON.stringify({ fn: functionName, params: parameters });

  const { status, text: raw } = httpsPostSync_(webAppUrl, headers, body);

  if (status >= 400) {
    throw new Error(
      `Web app HTTP ${status}: ${raw.slice(0, 300)}\n\n` +
      `Troubleshooting:\n` +
      `  401 — Token missing or expired. Re-run gcloud auth application-default login\n` +
      `         with userinfo.email scope (see setup-test-env.sh for the full command).\n` +
      `  403 — Web app access policy may be set to "Only myself". Re-deploy with\n` +
      `         "Anyone with Google account" access.\n` +
      `  404 — webAppUrl in .clasp.json is wrong, or the web app deployment was deleted.\n` +
      `         Re-deploy as Web app and update webAppUrl in .clasp.json.`
    );
  }

  let parsed: GasWebAppResult;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Web app response is not valid JSON (HTTP ${status}): ${raw}`
    );
  }

  if (parsed.error) {
    throw new Error(`GAS doPost error in ${functionName}: ${parsed.error}`);
  }

  return parsed.result;
}
