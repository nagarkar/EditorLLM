#!/usr/bin/env bash
# ============================================================
# setup-test-env.sh
#
# Interactive prompt that writes integration test credentials
# to .env.integration at the project root.
#
# Run once before executing `npm run test:integration`:
#
#   bash src/__tests__/integration/setup-test-env.sh
#
# The generated .env.integration file is gitignored and loaded
# automatically by jest.integration.setup.js at test startup.
# ============================================================

set -euo pipefail

# Resolve project root regardless of where this script is called from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env.integration"

echo ""
echo "=========================================="
echo "  EditorLLM — Integration Test Setup"
echo "=========================================="
echo ""
echo "This script writes credentials to:"
echo "  $ENV_FILE"
echo ""
echo "That file is gitignored and will be loaded"
echo "automatically when you run:"
echo "  npm run test:integration"
echo ""
echo "Press Ctrl-C at any time to abort."
echo ""

# ── Helper: prompt with optional default and optional mask ────────────────────

prompt_value() {
  local label="$1"
  local var_name="$2"
  local default_val="${3:-}"
  local secret="${4:-false}"   # pass 'secret' to mask input

  if [[ -n "$default_val" ]]; then
    local display_default
    if [[ "$secret" == "secret" ]]; then
      display_default="[current value hidden — press Enter to keep]"
    else
      display_default="[default: $default_val]"
    fi
    echo -n "$label $display_default: "
  else
    echo -n "$label: "
  fi

  local value
  if [[ "$secret" == "secret" ]]; then
    read -r -s value
    echo ""  # newline after hidden input
  else
    read -r value
  fi

  if [[ -z "$value" && -n "$default_val" ]]; then
    value="$default_val"
  fi

  printf -v "$var_name" '%s' "$value"
}

# ── Load existing values as defaults (if file already exists) ─────────────────

existing_gemini_key=""
existing_doc_id=""

if [[ -f "$ENV_FILE" ]]; then
  echo "Found existing $ENV_FILE — existing values will be used as defaults."
  echo ""
  while IFS='=' read -r key val; do
    # Strip surrounding quotes from value, skip comments and blank lines
    [[ "$key" =~ ^#.*$ || -z "$key" ]] && continue
    val="${val%\"}"
    val="${val#\"}"
    val="${val%\'}"
    val="${val#\'}"
    case "$key" in
      GEMINI_API_KEY)  existing_gemini_key="$val" ;;
      GOOGLE_DOC_ID)   existing_doc_id="$val" ;;
    esac
  done < "$ENV_FILE"
fi

# ── Prompt for each variable ──────────────────────────────────────────────────

echo "--- Required ---"
echo ""
echo "GEMINI_API_KEY"
echo "  Get yours at: https://aistudio.google.com/app/apikey"
echo "  This is required for all integration tests."
echo ""
prompt_value "  Enter API key" GEMINI_API_KEY "$existing_gemini_key"

echo ""
echo "--- Optional (Drive/Docs collaboration integration tests) ---"
echo ""
echo "These tests make real Drive REST API calls and require two GCP APIs"
echo "to be enabled in the Google Cloud project associated with your token:"
echo ""
echo "  Drive API: https://console.developers.google.com/apis/api/drive.googleapis.com"
echo "  Docs API:  https://console.developers.google.com/apis/api/docs.googleapis.com"
echo ""
echo "Enable both before running collaboration tests. Leave all three blank"
echo "to skip the collaboration tests and run only the Gemini tests."
echo ""
echo "GOOGLE_DOC_ID"
echo "  The ID of the Google Doc to use as the test document."
echo "  Find it in the document URL:"
echo "    docs.google.com/document/d/<THIS_PART>/edit"
echo ""
prompt_value "  Enter Doc ID" GOOGLE_DOC_ID "$existing_doc_id"

echo ""
echo "GOOGLE_TOKEN"
echo "  Fetched automatically from gcloud at test startup — no input needed."
echo "  The token must include userinfo.email so the web app can verify identity."
echo ""
echo "    gcloud auth application-default login \\"
echo "      --client-id-file=\"\$HOME/.config/gcloud/editorllm-oauth-client.json\" \\"
echo "      --scopes=\"https://www.googleapis.com/auth/cloud-platform,\\"
echo "                https://www.googleapis.com/auth/drive,\\"
echo "                https://www.googleapis.com/auth/documents,\\"
echo "                https://www.googleapis.com/auth/script.external_request,\\"
echo "                https://www.googleapis.com/auth/script.scriptapp,\\"
echo "                https://www.googleapis.com/auth/userinfo.email\""
echo ""
echo "--- E2E test setup (web app deployment) ---"
echo ""
echo "Apps Script's Execution API (scripts.run) does NOT support container-bound scripts."
echo "E2E tests use the doPost() web app endpoint instead. One-time setup:"
echo ""
echo "  1. clasp push"
echo "  2. In the Apps Script editor: Deploy → New deployment → Type: Web app"
echo "       Execute as: Me (script owner)"
echo "       Who has access: Anyone with Google account"
echo "       Project version: Latest  (so every clasp push is picked up automatically)"
echo "  3. Copy the web app URL into .clasp.json as \"webAppUrl\""
echo ""
echo "  IMPORTANT: Never use 'clasp deploy -i <webAppDeploymentId>'"
echo "  clasp defaults to API Executable and will break the web app."
echo "  After setup, only 'clasp push' is needed for code changes."
echo ""
GOOGLE_TOKEN="__auto__"

# ── Validate required fields ──────────────────────────────────────────────────

if [[ -z "$GEMINI_API_KEY" ]]; then
  echo ""
  echo "ERROR: GEMINI_API_KEY is required. Aborting."
  exit 1
fi

# ── Write the file ────────────────────────────────────────────────────────────

cat > "$ENV_FILE" <<EOF
# Integration test credentials — DO NOT COMMIT
# Generated by: bash src/__tests__/integration/setup-test-env.sh
# Loaded automatically by jest.integration.setup.js

# Required: Gemini API key for live model calls
GEMINI_API_KEY="$GEMINI_API_KEY"

# Optional: Google Doc ID for Drive/Docs collaboration integration tests
GOOGLE_DOC_ID="$GOOGLE_DOC_ID"

# GOOGLE_TOKEN is fetched automatically from gcloud at test startup.
# Run: gcloud auth login --enable-gdrive-access
# (no value stored here)
EOF

echo ""
echo "=========================================="
echo "  Written: $ENV_FILE"
echo "=========================================="
echo ""
echo "You can now run integration tests:"
echo "  npm run test:integration"
echo ""
echo "To re-run this setup at any time:"
echo "  bash src/__tests__/integration/setup-test-env.sh"
echo ""
