#!/usr/bin/env bash
# =============================================================================
# gas-redeploy.sh — Build, push, and re-point the web app to fresh code.
#
# HOW THIS WORKS (fully automated, no UI steps needed)
# -----------------------------------------------------
# The `webapp` section in appsscript.json defines the web app entry point:
#   { "executeAs": "USER_DEPLOYING", "access": "ANYONE" }
# When we PUT /deployments/{id} with only `deploymentConfig` (no entryPoints),
# the server derives the web app configuration from the pushed manifest.
# This means `clasp push` + version snapshot + PUT is sufficient to re-point
# an existing web app deployment to new code without any UI interaction.
#
# NOTE: The /exec URL returns 404 for ~5 seconds after the PUT while the
# deployment propagates. The smoke check waits 8 s before verifying.
#
# TYPICAL USE
# -----------
#   ./gas-redeploy.sh                         # full redeploy + all E2E tests
#   ./gas-redeploy.sh --no-e2e               # redeploy only (skip tests)
#   ./gas-redeploy.sh --test "multi-thread"  # redeploy + one matching test
#
# To iterate on a test WITHOUT redeploying (test helper changes only):
#   npm run test:e2e                          # all E2E tests
#   npm run test:e2e -- -t "multi-thread"    # one matching test
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

SKIP_E2E=false
SKIP_BUILD=false
TEST_PATTERN=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --no-e2e)     SKIP_E2E=true ;;
    --skip-build) SKIP_BUILD=true ;;
    --test=*)     TEST_PATTERN="${1#--test=}" ;;
    --test)       shift; TEST_PATTERN="$1" ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
  shift
done

info()    { echo "  ✔  $*"; }
warn()    { echo "  ⚠  $*"; }
fail()    { echo "  ✘  $*" >&2; exit 1; }
section() { echo ""; echo "── $* ──────────────────────────────────────────"; }

# ── Read config from .clasp.json ──────────────────────────────────────────────
SCRIPT_ID=$(python3 -c "import json; print(json.load(open('.clasp.json'))['scriptId'])")
WEB_APP_URL=$(python3 -c "import json; print(json.load(open('.clasp.json')).get('webAppUrl',''))")

DEPLOY_ID=$(echo "$WEB_APP_URL" | python3 -c "
import sys, re
m = re.search(r'/macros/s/([^/]+)/exec', sys.stdin.read())
print(m.group(1) if m else '')
")

if [[ -z "$DEPLOY_ID" ]]; then
  fail "Cannot parse deployment ID from webAppUrl in .clasp.json: $WEB_APP_URL"
fi

# ── Token helpers ─────────────────────────────────────────────────────────────
refresh_clasp_token() {
  clasp deployments > /dev/null 2>&1 || true
}

clasp_token() {
  python3 -c "
import json
d = json.load(open('$HOME/.clasprc.json'))
print(d['tokens']['default']['access_token'])
"
}

script_api() {
  local method="$1"; local path="$2"; local body="${3:-}"
  local token; token="$(clasp_token)"
  if [[ -n "$body" ]]; then
    curl -s -X "$method" \
      -H "Authorization: Bearer $token" \
      -H "Content-Type: application/json" \
      -d "$body" \
      "https://script.googleapis.com/v1/$path"
  else
    curl -s -X "$method" \
      -H "Authorization: Bearer $token" \
      "https://script.googleapis.com/v1/$path"
  fi
}

# ── Step 1: Build ─────────────────────────────────────────────────────────────
section "Step 1 — Build"
if $SKIP_BUILD; then
  info "Build skipped (--skip-build)"
else
  npm run build
  info "Compiled → dist/"
fi

# ── Step 2: clasp push ────────────────────────────────────────────────────────
section "Step 2 — clasp push"
clasp push --force
info "Pushed to Apps Script HEAD"

# ── Step 3: Create new version snapshot ──────────────────────────────────────
section "Step 3 — Create version snapshot"
refresh_clasp_token
VER_RESP=$(script_api POST "projects/$SCRIPT_ID/versions" '{"description":"gas-redeploy-auto"}')
NEW_VERSION=$(echo "$VER_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('versionNumber', ''))
")
if [[ -z "$NEW_VERSION" ]]; then
  fail "Failed to create version snapshot. Response: $VER_RESP"
fi
info "New version: @$NEW_VERSION"

# ── Step 4: GET current deployment (capture deploymentConfig) ─────────────────
section "Step 4 — Fetch current deployment config"
DEPLOY_RESP=$(script_api GET "projects/$SCRIPT_ID/deployments/$DEPLOY_ID")
DEPLOY_ERROR=$(echo "$DEPLOY_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('error', {}).get('message', ''))
" 2>/dev/null || echo "")
if [[ -n "$DEPLOY_ERROR" ]]; then
  fail "Could not fetch deployment $DEPLOY_ID: $DEPLOY_ERROR"
fi
info "Fetched deployment config"

# ── Step 5: PUT — re-point deployment to new version ─────────────────────────
# The server derives entryPoints from the manifest's `webapp` section, so we
# only need to send deploymentConfig with the new versionNumber.
section "Step 5 — Update deployment to @$NEW_VERSION"
UPDATE_BODY=$(echo "$DEPLOY_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
config = d['deploymentConfig']
config['versionNumber'] = int('$NEW_VERSION')
print(json.dumps({'deploymentConfig': config}))
")
UPDATE_RESP=$(script_api PUT "projects/$SCRIPT_ID/deployments/$DEPLOY_ID" "$UPDATE_BODY")
UPDATE_ERROR=$(echo "$UPDATE_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('error', {}).get('message', ''))
" 2>/dev/null || echo "")
if [[ -n "$UPDATE_ERROR" ]]; then
  fail "Deployment update failed: $UPDATE_ERROR
  Response: $UPDATE_RESP"
fi
info "Deployment updated → @$NEW_VERSION"

# ── Step 6: Smoke-check (wait for propagation first) ─────────────────────────
section "Step 6 — Smoke-check /exec URL (waiting 8 s for propagation)"
sleep 8
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$WEB_APP_URL")
if [[ "$STATUS" == "302" ]]; then
  info "Web app live: HTTP 302 ✔  ($WEB_APP_URL)"
else
  warn "HTTP $STATUS after 8 s. Waiting 10 more seconds..."
  sleep 10
  STATUS2=$(curl -s -o /dev/null -w "%{http_code}" "$WEB_APP_URL")
  if [[ "$STATUS2" == "302" ]]; then
    info "Web app live: HTTP 302 ✔ (after extended wait)"
  else
    warn "Still HTTP $STATUS2. The deployment may still be propagating — proceed with caution."
  fi
fi

# ── Step 7: E2E tests ─────────────────────────────────────────────────────────
if $SKIP_E2E; then
  section "Step 7 — E2E tests (skipped via --no-e2e)"
elif [[ -n "$TEST_PATTERN" ]]; then
  section "Step 7 — E2E tests (pattern: \"$TEST_PATTERN\")"
  npm run test:e2e -- -t "$TEST_PATTERN"
  info "Matched tests passed"
else
  section "Step 7 — E2E tests"
  npm run test:e2e
  info "All E2E tests passed"
fi

echo ""
echo "── Done ─────────────────────────────────────────────────────────────────"
echo "  Script ID    : $SCRIPT_ID"
echo "  Deployment   : $DEPLOY_ID"
echo "  Version      : @$NEW_VERSION"
echo "  Web app URL  : $WEB_APP_URL"
echo ""
