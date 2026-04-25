#!/usr/bin/env bash
# addon/launch-checks.sh
#
# PURPOSE
#   Deterministic pre-launch readiness check for a GAS Editor Add-on.
#   Verifies manifest, clasp config, source code, legal documents, GCP API
#   enablement, and marketplace listing assets. Prints a pass/fail/warn
#   summary and exits non-zero if any MUST-FIX check fails.
#
#   Run this before submitting the add-on for Marketplace review.
#   All checks that can be scripted are covered here; the remaining manual
#   steps (OAuth consent screen, GAS↔GCP link) are covered by gcp-for-addon.sh.
#
# USAGE
#   bash addon/launch-checks.sh
#
# EXIT CODES
#   0   All required checks passed (warnings may still be present)
#   1   One or more required checks failed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PASS=0; FAIL=0; WARN=0
FAILURES=()
WARNINGS=()

# ── Helpers ───────────────────────────────────────────────────────────────────
pass()    { echo "  ✓  $1"; ((PASS++))  || true; }
fail()    { echo "  ✗  $1"; FAILURES+=("$1"); ((FAIL++)) || true; }
warn()    { echo "  ⚠  $1"; WARNINGS+=("$1"); ((WARN++)) || true; }
section() { echo ""; echo "── $1"; }

# ── File references ───────────────────────────────────────────────────────────
ADDON_JSON="$PROJECT_ROOT/appsscript-addon.json"
ADDON_CLASP="$PROJECT_ROOT/.clasp.addon.json"
CODE_FILE="$PROJECT_ROOT/src/Code.ts"
LISTING_DIR="$SCRIPT_DIR/listing"
LISTING_JSON="$LISTING_DIR/listing.json"

# ════════════════════════════════════════════════════════════════════════════
section "Manifest — appsscript-addon.json"
# ════════════════════════════════════════════════════════════════════════════

if [[ ! -f "$ADDON_JSON" ]]; then
  fail "appsscript-addon.json not found  →  run: bash addon/fix-appscript-json.sh"
else
  pass "appsscript-addon.json exists"

  # addOns.docs block
  HAS_DOCS="$(jq 'has("addOns") and (.addOns | has("docs"))' "$ADDON_JSON")"
  [[ "$HAS_DOCS" == "true" ]] \
    && pass "addOns.docs block present" \
    || fail "addOns.docs block missing  →  run: bash addon/fix-appscript-json.sh"

  # No webapp block
  HAS_WEBAPP="$(jq 'has("webapp")' "$ADDON_JSON")"
  [[ "$HAS_WEBAPP" == "false" ]] \
    && pass "webapp block absent" \
    || fail "webapp block must be removed  →  run: bash addon/fix-appscript-json.sh"

  # No script.scriptapp scope
  HAS_SCRIPTAPP="$(jq '[.oauthScopes[]? | select(. == "https://www.googleapis.com/auth/script.scriptapp")] | length > 0' "$ADDON_JSON")"
  [[ "$HAS_SCRIPTAPP" == "false" ]] \
    && pass "script.scriptapp scope absent" \
    || fail "script.scriptapp scope must be removed  →  run: bash addon/fix-appscript-json.sh"

  # Logo URL set and not a placeholder
  LOGO_URL="$(jq -r '.addOns.common.logoUrl // empty' "$ADDON_JSON")"
  if [[ -z "$LOGO_URL" || "$LOGO_URL" == "PLACEHOLDER_LOGO_URL" ]]; then
    fail "addOns.common.logoUrl not set  →  upload a 128×128 PNG and set the URL"
  else
    pass "addOns.common.logoUrl = $LOGO_URL"
  fi

  # Add-on name set and not a placeholder
  ADDON_NAME="$(jq -r '.addOns.common.name // empty' "$ADDON_JSON")"
  if [[ -z "$ADDON_NAME" || "$ADDON_NAME" == "PLACEHOLDER_ADDON_NAME" ]]; then
    fail "addOns.common.name not set  →  set .name in addon/listing/listing.json and re-run fix-appscript-json.sh"
  else
    pass "addOns.common.name = \"$ADDON_NAME\""
  fi
fi

# ════════════════════════════════════════════════════════════════════════════
section "Clasp config — .clasp.addon.json"
# ════════════════════════════════════════════════════════════════════════════

if [[ ! -f "$ADDON_CLASP" ]]; then
  fail ".clasp.addon.json not found  →  create a standalone GAS project and copy its scriptId here"
else
  pass ".clasp.addon.json exists"

  ADDON_SCRIPT_ID="$(jq -r '.scriptId // empty' "$ADDON_CLASP")"
  if [[ -z "$ADDON_SCRIPT_ID" ]]; then
    fail "scriptId missing in .clasp.addon.json"
  else
    pass "scriptId = $ADDON_SCRIPT_ID"
  fi

  ADDON_GCP="$(jq -r '.projectId // empty' "$ADDON_CLASP")"
  if [[ -z "$ADDON_GCP" ]]; then
    warn "projectId not set in .clasp.addon.json  →  run: bash addon/gcp-for-addon.sh"
  else
    pass "projectId = $ADDON_GCP"
  fi
fi

# ════════════════════════════════════════════════════════════════════════════
section "Source code — src/Code.ts"
# ════════════════════════════════════════════════════════════════════════════

if [[ ! -f "$CODE_FILE" ]]; then
  fail "src/Code.ts not found"
else
  # onInstall
  grep -q 'function onInstall' "$CODE_FILE" \
    && pass "onInstall() defined" \
    || fail "onInstall() missing  →  add: function onInstall(e) { onOpen(e); }"

  # onOpen accepts e
  grep -qP 'function onOpen\s*\(\s*e' "$CODE_FILE" \
    && pass "onOpen(e) accepts event parameter" \
    || fail "onOpen() must accept 'e' (event with authMode)  →  see 02-code-migration.md"

  # createAddonMenu used
  grep -q 'createAddonMenu' "$CODE_FILE" \
    && pass "createAddonMenu() found in Code.ts" \
    || fail "createAddonMenu() not found  →  replace createMenu() calls per 02-code-migration.md"

  # createMenu not used (outside comments)
  CREATEMENU_HITS="$(grep -n '\.createMenu(' "$CODE_FILE" | grep -v '^\s*//' || true)"
  if [[ -n "$CREATEMENU_HITS" ]]; then
    fail "createMenu() still present (must use createAddonMenu for add-ons):"
    echo "$CREATEMENU_HITS" | while read -r line; do echo "       $line"; done
  else
    pass "No createMenu() calls remain"
  fi

  # AuthMode guard
  grep -q 'AuthMode\.NONE\|authMode' "$CODE_FILE" \
    && pass "AuthMode guard present in Code.ts" \
    || warn "No AuthMode.NONE guard found  →  add minimal menu branch for pre-auth state"
fi

# ════════════════════════════════════════════════════════════════════════════
section "Portability — no module-level GAS API calls in src/"
# ════════════════════════════════════════════════════════════════════════════

# We look for known GAS service calls that appear on lines that are NOT inside
# a function body. The heuristic: lines that match the pattern but whose
# indentation is 0 (or inside an IIFE top level) are flagged.
# grep is approximate; use 01-portability-audit.md for the authoritative LLM scan.

MODULE_LEVEL="$(grep -rn \
  'DocumentApp\.getActiveDocument()\|DocumentApp\.getUi()\|LockService\.getDocumentLock()' \
  "$PROJECT_ROOT/src/" \
  --include='*.ts' \
  | grep -v '__tests__' \
  | grep -v '^\s*//' \
  || true)"

if [[ -z "$MODULE_LEVEL" ]]; then
  pass "No obvious module-level DocumentApp / LockService calls"
else
  # Heuristic check for calls at the start of a line (indentation ~0)
  TOP_LEVEL="$(echo "$MODULE_LEVEL" | grep -P '^[^:]+:\d+:\s{0,2}[A-Z]' || true)"
  if [[ -n "$TOP_LEVEL" ]]; then
    fail "Possible module-level GAS call (fails before auth in add-on mode):"
    echo "$TOP_LEVEL" | while read -r l; do echo "       $l"; done
  else
    pass "GAS calls appear to be inside function bodies (verify with 01-portability-audit.md)"
  fi
fi

# Script Properties cross-user key store
SCRIPT_PROPS="$(grep -rn 'getScriptProperties' "$PROJECT_ROOT/src/" --include='*.ts' | grep -v '__tests__' || true)"
if [[ -n "$SCRIPT_PROPS" ]]; then
  warn "getScriptProperties() still referenced — confirm it is not used as a shared API key store:"
  echo "$SCRIPT_PROPS" | while read -r l; do echo "       $l"; done
fi

# ════════════════════════════════════════════════════════════════════════════
section "Legal documents — docs/"
# ════════════════════════════════════════════════════════════════════════════

[[ -f "$PROJECT_ROOT/docs/privacy.html" ]] \
  && pass "docs/privacy.html exists" \
  || fail "docs/privacy.html not found  →  run: bash addon/deploy_privacy.sh"

[[ -f "$PROJECT_ROOT/docs/tos.html" ]] \
  && pass "docs/tos.html exists" \
  || fail "docs/tos.html not found  →  run: bash addon/deploy_privacy.sh"

# Verify live URLs if listing.json has them
if [[ -f "$LISTING_JSON" ]]; then
  PRIVACY_URL="$(jq -r '.privacyUrl // empty' "$LISTING_JSON")"
  TOS_URL="$(jq -r '.tosUrl     // empty' "$LISTING_JSON")"

  if [[ -n "$PRIVACY_URL" ]]; then
    STATUS="$(curl -sL -o /dev/null -w "%{http_code}" "$PRIVACY_URL" --max-time 10 2>/dev/null || echo "000")"
    [[ "$STATUS" == "200" ]] \
      && pass "Privacy URL live: $PRIVACY_URL" \
      || fail "Privacy URL returned HTTP $STATUS: $PRIVACY_URL  →  run: bash addon/deploy_privacy.sh"
  else
    warn "privacyUrl not set in listing.json  →  run: bash addon/deploy_privacy.sh"
  fi

  if [[ -n "$TOS_URL" ]]; then
    STATUS="$(curl -sL -o /dev/null -w "%{http_code}" "$TOS_URL" --max-time 10 2>/dev/null || echo "000")"
    [[ "$STATUS" == "200" ]] \
      && pass "ToS URL live: $TOS_URL" \
      || fail "ToS URL returned HTTP $STATUS: $TOS_URL  →  run: bash addon/deploy_privacy.sh"
  else
    warn "tosUrl not set in listing.json  →  run: bash addon/deploy_privacy.sh"
  fi
else
  warn "addon/listing/listing.json not found — cannot verify live URLs"
fi

# ════════════════════════════════════════════════════════════════════════════
section "Marketplace listing assets — addon/listing/"
# ════════════════════════════════════════════════════════════════════════════

for asset in "short-description.txt" "long-description.txt" "scope-justifications.md" "privacy.html" "tos.html"; do
  [[ -f "$LISTING_DIR/$asset" ]] \
    && pass "listing/$asset" \
    || fail "listing/$asset missing  →  run 03-generate-listing-assets.md"
done

[[ -f "$LISTING_DIR/logo128.png" ]] && pass "listing/logo128.png" || warn "listing/logo128.png missing (required for Marketplace)"
[[ -f "$LISTING_DIR/logo512.png" ]] && pass "listing/logo512.png" || warn "listing/logo512.png missing (recommended)"

SCREENSHOT_COUNT="$(find "$LISTING_DIR" -name "screenshot*.png" 2>/dev/null | wc -l | tr -d ' ')"
if [[ "$SCREENSHOT_COUNT" -ge 1 ]]; then
  pass "$SCREENSHOT_COUNT screenshot(s) found in listing/"
else
  fail "No screenshots in listing/  →  see screenshot-guide.md for dimensions and capture guidance"
fi

# ════════════════════════════════════════════════════════════════════════════
section "GCP API enablement"
# ════════════════════════════════════════════════════════════════════════════

if command -v gcloud >/dev/null; then
  # Prefer projectId from .clasp.addon.json; fall back to .clasp.json
  GCP_PROJECT=""
  [[ -f "$ADDON_CLASP"                ]] && GCP_PROJECT="$(jq -r '.projectId // empty' "$ADDON_CLASP"     2>/dev/null || true)"
  [[ -z "$GCP_PROJECT" && -f "$PROJECT_ROOT/.clasp.json" ]] && \
    GCP_PROJECT="$(jq -r '.projectId // empty' "$PROJECT_ROOT/.clasp.json" 2>/dev/null || true)"

  if [[ -n "$GCP_PROJECT" ]]; then
    REQUIRED_APIS=(
      "script.googleapis.com"
      "docs.googleapis.com"
      "drive.googleapis.com"
      "appsmarket-component.googleapis.com"
    )
    for api in "${REQUIRED_APIS[@]}"; do
      ENABLED="$(gcloud services list \
        --project="$GCP_PROJECT" \
        --filter="name:$api" \
        --format="value(name)" 2>/dev/null || true)"
      if [[ -n "$ENABLED" ]]; then
        pass "$api enabled on $GCP_PROJECT"
      else
        fail "$api NOT enabled  →  gcloud services enable $api --project=$GCP_PROJECT"
      fi
    done
  else
    warn "No GCP project ID resolvable  →  run: bash addon/gcp-for-addon.sh"
  fi
else
  warn "gcloud not installed — skipping API checks  (install: https://cloud.google.com/sdk/docs/install)"
fi

# ════════════════════════════════════════════════════════════════════════════
section "Build artifacts — dist/"
# ════════════════════════════════════════════════════════════════════════════

[[ -f "$PROJECT_ROOT/dist/Code.js" ]] \
  && pass "dist/Code.js present" \
  || fail "dist/ not built  →  run: npm run build"

# Confirm the addon manifest would be swapped in correctly
[[ -f "$PROJECT_ROOT/appsscript-addon.json" ]] \
  && pass "appsscript-addon.json ready for swap into dist/" \
  || fail "appsscript-addon.json missing  →  run: bash addon/fix-appscript-json.sh"

# ════════════════════════════════════════════════════════════════════════════
# Summary
# ════════════════════════════════════════════════════════════════════════════
echo ""
echo "════════════════════════════════════════════════════════════════════"
printf "  Launch Checks:  %d passed  |  %d failed  |  %d warnings\n" "$PASS" "$FAIL" "$WARN"
echo "════════════════════════════════════════════════════════════════════"

if [[ $FAIL -gt 0 ]]; then
  echo ""
  echo "FAILURES — must resolve before launch:"
  for f in "${FAILURES[@]}"; do echo "  ✗  $f"; done
fi

if [[ $WARN -gt 0 ]]; then
  echo ""
  echo "WARNINGS — review before launch:"
  for w in "${WARNINGS[@]}"; do echo "  ⚠  $w"; done
fi

echo ""
if [[ $FAIL -eq 0 ]]; then
  echo "✅  All required checks passed."
else
  echo "❌  Resolve failures above before submitting to the Workspace Marketplace."
  exit 1
fi
