#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Full test pyramid + push to the Apps Script staging project.
#
# Steps (in order):
#   1.  Build + lint + unit tests  (npm run build:all)
#   2.  Integration tests          (npm run test:integration — real Gemini API)
#   3-7. gas-redeploy.sh           (build + clasp push + new version snapshot +
#                                   update deployment + smoke-check + E2E tests)
#
# GAS deployment model
# --------------------
# The webapp section in appsscript.json defines the web app entry point.
# gas-redeploy.sh (step 3-7) creates a numbered version snapshot and re-points
# the existing EditorLLMTest deployment to it via the Apps Script REST API —
# no UI interaction required.  The /exec URL never changes.
#
# Usage:
#   chmod +x deploy.sh && ./deploy.sh [flags]
#
# Flags:
#   --skip-tests        Skip all integration + E2E tests. Push only.
#                       Use for emergency hotfixes — the pushed code is unverified.
#   --skip-integration  Skip integration + E2E tests. Unit tests still run.
#                       Use when you have not changed any agent or Drive/Docs logic.
#   --skip-e2e          Skip E2E only. Unit + integration tests still run.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKIP_TESTS=false
SKIP_INTEGRATION=false
SKIP_E2E=false
START_TIME=$(date +%s)

for arg in "$@"; do
  case $arg in
    --skip-tests)       SKIP_TESTS=true; SKIP_INTEGRATION=true; SKIP_E2E=true ;;
    --skip-integration) SKIP_INTEGRATION=true; SKIP_E2E=true ;;
    --skip-e2e)         SKIP_E2E=true ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────────────
info()    { echo "  ✔  $*"; }
warn()    { echo "  ⚠  $*"; }
fail()    { echo "  ✘  $*"; exit 1; }
section() { echo ""; echo "── $* ──────────────────────────────────────────"; }

elapsed() {
  local end=$(date +%s)
  echo $(( end - START_TIME ))s
}

cd "$SCRIPT_DIR"

# ── Guard: .clasp.json must exist with a real scriptId ───────────────────────
section "Pre-flight checks"

if [[ ! -f ".clasp.json" ]]; then
  fail ".clasp.json not found. Run ./initclasp.sh first."
fi

SCRIPT_ID=$(python3 -c "import json; d=json.load(open('.clasp.json')); print(d.get('scriptId',''))" 2>/dev/null || echo "")
if [[ -z "$SCRIPT_ID" || "$SCRIPT_ID" == "YOUR_SCRIPT_ID_HERE" ]]; then
  fail "scriptId is not set in .clasp.json. Run ./initclasp.sh first."
fi

WEB_APP_URL=$(python3 -c "import json; d=json.load(open('.clasp.json')); print(d.get('webAppUrl',''))" 2>/dev/null || echo "")

info "scriptId    : $SCRIPT_ID"
info "Project URL : https://script.google.com/u/0/home/projects/$SCRIPT_ID/edit"
if [[ -n "$WEB_APP_URL" ]]; then
  info "Web App URL : $WEB_APP_URL"
else
  warn "webAppUrl not set in .clasp.json — E2E tests will be skipped"
fi

if ! command -v clasp &>/dev/null; then
  fail "clasp not found. Install with: npm install -g @google/clasp"
fi
info "clasp       : $(clasp --version)"

# ── Step 1: Build + Lint + Unit tests ────────────────────────────────────────
section "Step 1 — Build, lint, and unit tests (build:all)"
if $SKIP_TESTS; then
  warn "All tests skipped (--skip-tests) — running build only"
  npm run build
  info "Compiled → dist/"
else
  npm run build:all
  info "Build, lint, and unit tests passed"
fi

# ── Step 2: Integration tests ─────────────────────────────────────────────────
if $SKIP_INTEGRATION; then
  section "Step 2 — Integration tests (skipped)"
  warn "Skipped via --skip-integration or --skip-tests"
else
  section "Step 2 — Integration tests (real Gemini API)"
  npm run test:integration
  info "Integration tests passed"
fi

# ── Steps 3-7: GAS push + version snapshot + deployment update + E2E ─────────
# Delegate to gas-redeploy.sh.  Pass --skip-build because build:all already ran
# in step 1.  Pass --no-e2e when E2E is disabled.
section "Steps 3-7 — GAS deploy (via gas-redeploy.sh)"
GAS_FLAGS="--skip-build"
if $SKIP_E2E; then
  GAS_FLAGS="$GAS_FLAGS --no-e2e"
elif [[ -z "$WEB_APP_URL" ]]; then
  warn "webAppUrl not set — skipping E2E"
  GAS_FLAGS="$GAS_FLAGS --no-e2e"
fi
"$SCRIPT_DIR/gas-redeploy.sh" $GAS_FLAGS

# ── Summary ───────────────────────────────────────────────────────────────────
section "Staging deploy complete ($(elapsed))"
echo ""
echo "  Script ID   : $SCRIPT_ID"
echo "  Project URL : https://script.google.com/u/0/home/projects/$SCRIPT_ID/edit"
echo ""
echo "  The EditorLLM menu will appear next time the bound document"
echo "  is opened (or refreshed)."
echo ""
echo "  To deploy to production: ./deploy_prod.sh"
echo ""
