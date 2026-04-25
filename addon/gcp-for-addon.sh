#!/usr/bin/env bash
# addon/gcp-for-addon.sh
#
# PURPOSE
#   Verify and configure the GCP project association for a GAS Editor Add-on.
#   Reads .clasp.addon.json (or a specified clasp file), checks the projectId
#   field, enables required Google APIs on that project, and provides actionable
#   instructions for the two manual steps that cannot be scripted (OAuth consent
#   screen and GAS↔GCP link in the Apps Script editor).
#
# USAGE
#   bash addon/gcp-for-addon.sh [--clasp <file>] [--yes]
#
#   --clasp <file>   Path (relative to project root) to the clasp JSON file.
#                    Default: .clasp.addon.json
#   --yes            Skip the "Use this project? [Y/n]" confirmation when
#                    projectId is already set. Safe for non-interactive use once
#                    the project is configured.
#
# REQUIRES
#   gcloud   https://cloud.google.com/sdk/docs/install
#   jq       brew install jq
#   clasp    npm install -g @google/clasp

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Defaults ──────────────────────────────────────────────────────────────────
CLASP_FILE_REL=".clasp.addon.json"
AUTO_YES=false

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --clasp) CLASP_FILE_REL="$2"; shift 2 ;;
    --yes)   AUTO_YES=true;        shift   ;;
    *) echo "Unknown argument: $1"; echo "Usage: $0 [--clasp <file>] [--yes]"; exit 1 ;;
  esac
done

CLASP_FILE="$PROJECT_ROOT/$CLASP_FILE_REL"

# ── Dependency checks ─────────────────────────────────────────────────────────
MISSING_DEPS=()
for cmd in jq gcloud; do
  command -v "$cmd" >/dev/null || MISSING_DEPS+=("$cmd")
done
if [[ ${#MISSING_DEPS[@]} -gt 0 ]]; then
  echo "ERROR: missing required tools: ${MISSING_DEPS[*]}"
  command -v jq      >/dev/null || echo "  jq:     brew install jq"
  command -v gcloud  >/dev/null || echo "  gcloud: https://cloud.google.com/sdk/docs/install"
  exit 1
fi

# ── Ensure .clasp.addon.json exists ───────────────────────────────────────────
if [[ ! -f "$CLASP_FILE" ]]; then
  echo "$CLASP_FILE_REL not found."
  echo ""
  read -rp "Create a new standalone GAS project now? [Y/n]: " CREATE_NEW
  CREATE_NEW="${CREATE_NEW:-Y}"
  if [[ ! "$CREATE_NEW" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi

  command -v clasp >/dev/null || {
    echo "ERROR: clasp is not installed.  Run: npm install -g @google/clasp"
    exit 1
  }

  read -rp "Add-on project title [EditorLLM Add-on]: " ADDON_TITLE
  ADDON_TITLE="${ADDON_TITLE:-EditorLLM Add-on}"

  # Back up the existing .clasp.json so clasp create cannot overwrite it.
  ORIG_CLASP="$PROJECT_ROOT/.clasp.json"
  CLASP_BACKUP=""
  if [[ -f "$ORIG_CLASP" ]]; then
    CLASP_BACKUP="$ORIG_CLASP.bak.$$"
    cp "$ORIG_CLASP" "$CLASP_BACKUP"
    echo "  Backed up existing .clasp.json → $(basename "$CLASP_BACKUP")"
  fi

  # clasp create writes a new .clasp.json in the project root.
  # Trap to restore the backup if anything goes wrong from here.
  restore_backup_() {
    if [[ -n "$CLASP_BACKUP" && -f "$CLASP_BACKUP" ]]; then
      mv "$CLASP_BACKUP" "$ORIG_CLASP"
      echo "  Restored original .clasp.json"
    fi
  }
  trap restore_backup_ ERR

  echo ""
  echo "Running: clasp create --type standalone --title \"$ADDON_TITLE\" --rootDir dist"
  cd "$PROJECT_ROOT"
  clasp create --type standalone --title "$ADDON_TITLE" --rootDir dist

  # clasp may write .clasp.json to dist/ instead of the project root on some versions.
  CREATED_CLASP="$PROJECT_ROOT/.clasp.json"
  if [[ ! -f "$CREATED_CLASP" || "$(jq -r '.scriptId // empty' "$CREATED_CLASP")" == "" ]]; then
    if [[ -f "$PROJECT_ROOT/dist/.clasp.json" ]]; then
      mv "$PROJECT_ROOT/dist/.clasp.json" "$CREATED_CLASP"
    else
      restore_backup_
      echo "ERROR: clasp create did not produce a .clasp.json — check that you are logged in (clasp login)."
      exit 1
    fi
  fi

  NEW_SCRIPT_ID="$(jq -r '.scriptId' "$CREATED_CLASP")"
  echo "  ✓ New standalone script created: $NEW_SCRIPT_ID"

  # Build .clasp.addon.json:
  #   - Start from the original config (preserves filePushOrder, scriptExtensions, etc.)
  #   - Swap in the new scriptId
  #   - Remove deploymentId and webAppUrl (those belong to the container-bound project)
  if [[ -n "$CLASP_BACKUP" ]]; then
    jq --arg sid "$NEW_SCRIPT_ID" \
      'del(.deploymentId) | del(.webAppUrl) | .scriptId = $sid' \
      "$CLASP_BACKUP" > "$CLASP_FILE"
  else
    # No original config existed — use what clasp created as-is.
    cp "$CREATED_CLASP" "$CLASP_FILE"
  fi
  echo "  ✓ Created $CLASP_FILE_REL (scriptId=$NEW_SCRIPT_ID)"

  # Restore the original .clasp.json so container-bound deploys are unaffected.
  trap - ERR
  restore_backup_

  echo ""
fi

# ── Read current projectId from clasp file ────────────────────────────────────
EXISTING_PROJECT_ID="$(jq -r '.projectId // empty' "$CLASP_FILE")"
SCRIPT_ID="$(jq -r '.scriptId // empty' "$CLASP_FILE")"

if [[ -n "$EXISTING_PROJECT_ID" ]]; then
  echo "GCP project currently set in $CLASP_FILE_REL: $EXISTING_PROJECT_ID"
  if [[ "$AUTO_YES" == true ]]; then
    GCP_PROJECT_ID="$EXISTING_PROJECT_ID"
    echo "  --yes flag set: using existing project ID."
  else
    read -rp "  Use this project? [Y/n]: " USE_EXISTING
    USE_EXISTING="${USE_EXISTING:-Y}"
    if [[ "$USE_EXISTING" =~ ^[Yy]$ ]]; then
      GCP_PROJECT_ID="$EXISTING_PROJECT_ID"
    else
      read -rp "  Enter new GCP project ID: " GCP_PROJECT_ID
      jq --arg pid "$GCP_PROJECT_ID" '.projectId = $pid' "$CLASP_FILE" > "$CLASP_FILE.tmp"
      mv "$CLASP_FILE.tmp" "$CLASP_FILE"
      echo "  ✓ Updated projectId in $CLASP_FILE_REL"
    fi
  fi
else
  echo "No GCP project ID found in $CLASP_FILE_REL."
  read -rp "  Enter GCP project ID to associate: " GCP_PROJECT_ID
  if [[ -z "$GCP_PROJECT_ID" ]]; then
    echo "ERROR: project ID cannot be empty."
    exit 1
  fi
  jq --arg pid "$GCP_PROJECT_ID" '.projectId = $pid' "$CLASP_FILE" > "$CLASP_FILE.tmp"
  mv "$CLASP_FILE.tmp" "$CLASP_FILE"
  echo "  ✓ Wrote projectId=$GCP_PROJECT_ID to $CLASP_FILE_REL"
fi

# ── Set gcloud active project ─────────────────────────────────────────────────
echo ""
echo "Setting gcloud active project → $GCP_PROJECT_ID"
gcloud config set project "$GCP_PROJECT_ID" --quiet

# ── Enable required APIs ──────────────────────────────────────────────────────
REQUIRED_APIS=(
  "script.googleapis.com"               # Apps Script API
  "docs.googleapis.com"                 # Google Docs API (Advanced Service)
  "drive.googleapis.com"                # Google Drive API (Advanced Service)
  "appsmarket-component.googleapis.com" # Workspace Marketplace SDK
)

echo ""
echo "Enabling required APIs on project $GCP_PROJECT_ID ..."
FAILED_APIS=()
for api in "${REQUIRED_APIS[@]}"; do
  printf "  %-52s" "$api"
  if gcloud services enable "$api" --project="$GCP_PROJECT_ID" --quiet 2>/dev/null; then
    echo "✓"
  else
    echo "FAILED"
    FAILED_APIS+=("$api")
  fi
done

if [[ ${#FAILED_APIS[@]} -gt 0 ]]; then
  echo ""
  echo "WARNING: could not enable the following APIs — verify you have"
  echo "  'Service Usage Admin' (roles/serviceusage.serviceUsageAdmin) on the project:"
  for api in "${FAILED_APIS[@]}"; do echo "    $api"; done
  echo "  Fix manually: https://console.cloud.google.com/apis/library?project=$GCP_PROJECT_ID"
fi

# ── Manual step 1: OAuth Consent Screen ───────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "MANUAL STEP 1 — Configure the OAuth Consent Screen"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  URL: https://console.cloud.google.com/apis/credentials/consent?project=$GCP_PROJECT_ID"
echo ""
echo "  Required fields:"
echo "    • User type:           External"
echo "    • App name:            (value in addon/listing/listing.json → name)"
echo "    • User support email"
echo "    • Privacy policy URL   (output of: bash addon/deploy_privacy.sh)"
echo "    • Terms of service URL (output of: bash addon/deploy_privacy.sh)"
echo "    • Authorized domains:  your apex domain"
echo ""
echo "  Required scopes to add:"
echo "    https://www.googleapis.com/auth/documents"
echo "    https://www.googleapis.com/auth/drive.file"
echo "    https://www.googleapis.com/auth/script.container.ui"
echo "    https://www.googleapis.com/auth/script.external_request"
echo "    https://www.googleapis.com/auth/userinfo.email"
echo ""
echo "  Publishing status: set to 'In production' before submitting to Marketplace."
echo "  (Testing status limits installs to 100 users and shows an unverified warning.)"

# ── Manual step 2: Link GAS script to GCP project ────────────────────────────
if [[ -n "$SCRIPT_ID" ]]; then
  PROJECT_NUMBER="$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)' 2>/dev/null || echo '<project-number>')"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "MANUAL STEP 2 — Link the GAS project to this GCP project"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "  1. Open the Apps Script editor for your add-on script:"
  echo "       https://script.google.com/d/$SCRIPT_ID/edit"
  echo "  2. Click the gear icon (Project Settings)."
  echo "  3. Under 'Google Cloud Platform (GCP) Project', click 'Change project'."
  echo "  4. Enter project number: $PROJECT_NUMBER"
  echo "       (GCP project: $GCP_PROJECT_ID)"
  echo ""
  echo "  This step cannot be scripted — it requires the Apps Script editor UI."
fi

echo ""
echo "✓ gcp-for-addon.sh complete. GCP project: $GCP_PROJECT_ID"
