#!/usr/bin/env bash
# =============================================================================
# initclasp.sh — One-time setup: authenticate clasp and bind to a Google
#                Apps Script project for EditorLLM.
#
# Usage:
#   chmod +x initclasp.sh && ./initclasp.sh [--reuse]
#
# Flags:
#   --reuse   Skip `clasp create` and only run `clasp login`.
#             Use this when a script already exists and .clasp.json has a
#             valid scriptId (e.g. after cloning the repo).
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLASP_JSON="$REPO_DIR/.clasp.json"
REUSE=false

# ── Parse flags ──────────────────────────────────────────────────────────────
for arg in "$@"; do
  case $arg in
    --reuse) REUSE=true ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────────────
info()    { echo "  ✔  $*"; }
warn()    { echo "  ⚠  $*"; }
section() { echo ""; echo "── $* ──────────────────────────────────────────"; }

# ── Prerequisite: clasp must be installed ────────────────────────────────────
section "Checking prerequisites"
if ! command -v clasp &>/dev/null; then
  echo ""
  echo "  ✘  clasp not found. Install it globally first:"
  echo "       npm install -g @google/clasp"
  exit 1
fi
info "clasp $(clasp --version) found"

# ── Step 1: Authenticate ─────────────────────────────────────────────────────
section "Step 1 — clasp login"
echo ""
echo "  Opening Google sign-in in your browser."
echo "  Grant the Apps Script API permission when prompted."
echo ""
clasp login
info "Authentication complete"

# ── Step 2: Create or reuse script project ───────────────────────────────────
section "Step 2 — Google Apps Script project"

if $REUSE; then
  CURRENT_ID=$(python3 -c "import json,sys; d=json.load(open('$CLASP_JSON')); print(d.get('scriptId',''))" 2>/dev/null || echo "")
  if [[ -z "$CURRENT_ID" || "$CURRENT_ID" == "YOUR_SCRIPT_ID_HERE" ]]; then
    warn ".clasp.json has no valid scriptId. Run without --reuse to create a new project."
    exit 1
  fi
  info "Reusing existing scriptId: $CURRENT_ID"
else
  echo ""
  echo "  Creating a new Google Apps Script project bound to Google Docs."
  echo "  This will update .clasp.json with the new scriptId."
  echo ""

  cd "$REPO_DIR"

  # Build dist/ first so clasp create has files to reference
  if [[ ! -d "dist" ]]; then
    warn "dist/ not found — running build first..."
    npm run build
  fi

  clasp create \
    --title "EditorLLM" \
    --type docs \
    --rootDir dist

  info "Script project created."

  # clasp create writes .clasp.json into rootDir (dist/) — move it to repo root
  if [[ -f "$REPO_DIR/dist/.clasp.json" && ! -f "$CLASP_JSON" ]]; then
    mv "$REPO_DIR/dist/.clasp.json" "$CLASP_JSON"
    info "Moved .clasp.json from dist/ to project root"
  fi
fi

# ── Step 3: Show summary ─────────────────────────────────────────────────────
section "Done"
echo ""
SCRIPT_ID=$(python3 -c "import json; d=json.load(open('$CLASP_JSON')); print(d.get('scriptId','(unknown)'))" 2>/dev/null || echo "(unknown)")
echo "  Script ID : $SCRIPT_ID"
echo "  Open URL  : https://script.google.com/d/$SCRIPT_ID/edit"
echo ""
echo "  Next steps:"
echo "    1. Run ./deploy.sh          → push to staging"
echo "    2. Run ./deploy_prod.sh     → create a versioned production deployment"
echo ""
