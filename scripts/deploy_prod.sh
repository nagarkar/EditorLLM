#!/usr/bin/env bash
# =============================================================================
# deploy_prod.sh — Build, test, and create a versioned production deployment.
#
# Each run creates an immutable Apps Script Version and either:
#   • Creates a new @latest deployment (first run), or
#   • Updates the existing deployment ID stored in .clasp.json /
#     the DEPLOYMENT_ID env var (subsequent runs).
#
# Usage:
#   chmod +x deploy_prod.sh && ./deploy_prod.sh [--skip-tests] [--dry-run]
#
# Flags:
#   --skip-tests   Bypass Jest.
#   --dry-run      Compile and test but do NOT push or deploy. Useful for CI
#                  validation without touching the live script.
#
# Environment variables (override .clasp.json defaults):
#   DEPLOYMENT_ID  Existing clasp deployment ID to update. If unset, a new
#                  deployment is created and its ID is printed for you to save.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKIP_TESTS=false
DRY_RUN=false
START_TIME=$(date +%s)

for arg in "$@"; do
  case $arg in
    --skip-tests) SKIP_TESTS=true ;;
    --dry-run)    DRY_RUN=true ;;
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

cd "$SCRIPT_DIR/.."

# ── Pre-flight ────────────────────────────────────────────────────────────────
section "Pre-flight checks"

if [[ ! -f ".clasp.prod.json" ]]; then
  fail ".clasp.prod.json not found. This file holds the production scriptId. Create it from .clasp.json with the production scriptId."
fi

SCRIPT_ID=$(python3 -c "import json; d=json.load(open('.clasp.prod.json')); print(d.get('scriptId',''))" 2>/dev/null || echo "")
if [[ -z "$SCRIPT_ID" || "$SCRIPT_ID" == "YOUR_SCRIPT_ID_HERE" ]]; then
  fail "scriptId is not set in .clasp.prod.json."
fi
info "scriptId (prod) : $SCRIPT_ID"
info "Project URL     : https://script.google.com/u/0/home/projects/$SCRIPT_ID/edit"
info "Settings        : https://script.google.com/u/0/home/projects/$SCRIPT_ID/settings"

if ! command -v clasp &>/dev/null; then
  fail "clasp not found. Install with: npm install -g @google/clasp"
fi
info "clasp    : $(clasp --version)"

# Resolve DEPLOYMENT_ID: env var → package.json → none (create new)
if [[ -z "${DEPLOYMENT_ID:-}" ]]; then
  # Try to read from package.json deploy:prod script
  DEPLOYMENT_ID=$(python3 -c "
import json, re, sys
d = json.load(open('package.json'))
script = d.get('scripts', {}).get('deploy:prod', '')
m = re.search(r'--deploymentId\s+([A-Za-z0-9_-]+)', script)
print(m.group(1) if m and m.group(1) != 'YOUR_DEPLOYMENT_ID_HERE' else '')
" 2>/dev/null || echo "")
fi

if [[ -n "$DEPLOYMENT_ID" ]]; then
  info "deploymentId : $DEPLOYMENT_ID (will update)"
else
  warn "No DEPLOYMENT_ID found — a new deployment will be created"
fi

if $DRY_RUN; then
  warn "DRY RUN mode — no files will be pushed or deployed"
fi

# ── Step 1: Build + Lint + Tests ────────────────────────────────────────────
section "Step 1 — Build, lint, and test (build:all)"
if $SKIP_TESTS; then
  warn "Lint and tests skipped (--skip-tests) — running build only"
  npm run build
  info "Compiled → dist/"
else
  npm run build:all
  info "Build, lint, and all tests passed"
fi

if $DRY_RUN; then
  section "Dry run complete ($(elapsed))"
  echo ""
  echo "  Build and tests succeeded. Nothing was pushed or deployed."
  echo ""
  exit 0
fi

# ── Step 2: Swap to production .clasp.json and push ──────────────────────────
section "Step 2 — clasp push (production script)"

# Temporarily replace .clasp.json with .clasp.prod.json so clasp targets
# the production script. The trap ensures the staging .clasp.json is always
# restored — even if the push or deploy step fails.
CLASP_BACKUP="$(mktemp)"
cp .clasp.json "$CLASP_BACKUP"
trap 'cp "$CLASP_BACKUP" .clasp.json; rm -f "$CLASP_BACKUP"; info "Restored .clasp.json (staging)"' EXIT

cp .clasp.prod.json .clasp.json
info "Switched .clasp.json → production script ($SCRIPT_ID)"

clasp push --force
info "Pushed source to @HEAD (production)"

# ── Step 3: Version + deploy ─────────────────────────────────────────────────
section "Step 3 — Create version and deploy"

# Generate a version description from git or timestamp
if git rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
  GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "nogit")
  VERSION_DESC="prod deploy $(date '+%Y-%m-%d %H:%M') git:$GIT_SHA"
else
  VERSION_DESC="prod deploy $(date '+%Y-%m-%d %H:%M')"
fi
info "Version description: $VERSION_DESC"

if [[ -n "$DEPLOYMENT_ID" ]]; then
  # Update existing deployment
  clasp deploy \
    --deploymentId "$DEPLOYMENT_ID" \
    --description "$VERSION_DESC"
  info "Deployment updated: $DEPLOYMENT_ID"
else
  # Create a new deployment and capture its ID
  DEPLOY_OUTPUT=$(clasp deploy --description "$VERSION_DESC" 2>&1)
  echo "$DEPLOY_OUTPUT"

  NEW_DEPLOYMENT_ID=$(echo "$DEPLOY_OUTPUT" | grep -oE '[A-Za-z0-9_-]{50,}' | head -1 || echo "")

  if [[ -n "$NEW_DEPLOYMENT_ID" ]]; then
    info "New deployment created: $NEW_DEPLOYMENT_ID"
    echo ""
    echo "  ┌─────────────────────────────────────────────────────────┐"
    echo "  │  Save this deployment ID for future prod deploys:        │"
    echo "  │                                                           │"
    echo "  │  export DEPLOYMENT_ID=$NEW_DEPLOYMENT_ID"
    echo "  │                                                           │"
    echo "  │  Or update package.json deploy:prod script.              │"
    echo "  └─────────────────────────────────────────────────────────┘"

    # Patch package.json with the new deployment ID
    python3 - <<PYEOF
import json, re

with open('package.json', 'r') as f:
    data = json.load(f)

old_script = data['scripts'].get('deploy:prod', '')
new_script = re.sub(
    r'--deploymentId\s+\S+',
    f'--deploymentId $NEW_DEPLOYMENT_ID',
    old_script
)
if new_script == old_script:
    # Pattern wasn't found — append it
    new_script = old_script.replace('clasp deploy', f'clasp deploy --deploymentId $NEW_DEPLOYMENT_ID')

data['scripts']['deploy:prod'] = new_script

with open('package.json', 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')

print('  ✔  package.json deploy:prod updated with new deployment ID')
PYEOF
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────
# Note: .clasp.json has been restored to staging by the EXIT trap by the time
# this section prints, but SCRIPT_ID was captured from .clasp.prod.json above.
section "Production deploy complete ($(elapsed))"
echo ""
echo "  Script ID   : $SCRIPT_ID  (production)"
echo "  Project URL : https://script.google.com/u/0/home/projects/$SCRIPT_ID/edit"
echo "  Settings    : https://script.google.com/u/0/home/projects/$SCRIPT_ID/settings"
echo ""
echo "  Deployments : clasp deployments"
echo ""
