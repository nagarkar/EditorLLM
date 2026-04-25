#!/usr/bin/env bash
# addon/fix-appscript-json.sh
#
# PURPOSE
#   Generate appsscript-addon.json from appsscript.json.
#   This is the manifest used when deploying to the standalone Editor Add-on
#   project. It is identical to appsscript.json except:
#     • The `webapp` block is removed.
#     • The `script.scriptapp` OAuth scope is removed.
#     • An `addOns` block is added (or updated) with the Docs editor entry point.
#
#   The output is written to appsscript-addon.json in the project root.
#   During deploy:addon, this file overwrites dist/appsscript.json before clasp
#   pushes — the regular build output is not affected.
#
# USAGE
#   bash addon/fix-appscript-json.sh [--name "My Add-on"] [--logo-url "https://..."]
#
#   If --name is omitted the script reads it from (in order):
#     1. addon/listing/listing.json → .name
#     2. appsscript.json → .addOns.common.name  (if already set)
#     3. Falls back to "PLACEHOLDER_ADDON_NAME" and warns.
#
# REQUIRES
#   jq   brew install jq

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

INPUT="$PROJECT_ROOT/appsscript.json"
OUTPUT="$PROJECT_ROOT/appsscript-addon.json"
LISTING_JSON="$SCRIPT_DIR/listing/listing.json"

ADDON_NAME_ARG=""
LOGO_URL_ARG=""

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)     ADDON_NAME_ARG="$2"; shift 2 ;;
    --logo-url) LOGO_URL_ARG="$2";   shift 2 ;;
    *) echo "Unknown argument: $1"; echo "Usage: $0 [--name <name>] [--logo-url <url>]"; exit 1 ;;
  esac
done

# ── Dependency check ──────────────────────────────────────────────────────────
command -v jq >/dev/null || {
  echo "ERROR: jq is required.  Install: brew install jq"
  exit 1
}

[[ -f "$INPUT" ]] || { echo "ERROR: $INPUT not found."; exit 1; }

# ── Resolve add-on name ───────────────────────────────────────────────────────
ADDON_NAME="$ADDON_NAME_ARG"

if [[ -z "$ADDON_NAME" && -f "$LISTING_JSON" ]]; then
  ADDON_NAME="$(jq -r '.name // empty' "$LISTING_JSON" 2>/dev/null || true)"
fi

if [[ -z "$ADDON_NAME" ]]; then
  ADDON_NAME="$(jq -r '.addOns.common.name // empty' "$INPUT" 2>/dev/null || true)"
fi

if [[ -z "$ADDON_NAME" ]]; then
  ADDON_NAME="PLACEHOLDER_ADDON_NAME"
fi

# ── Resolve logo URL ──────────────────────────────────────────────────────────
LOGO_URL="$LOGO_URL_ARG"

if [[ -z "$LOGO_URL" ]]; then
  LOGO_URL="$(jq -r '.addOns.common.logoUrl // empty' "$INPUT" 2>/dev/null || true)"
fi

if [[ -z "$LOGO_URL" ]]; then
  LOGO_URL="PLACEHOLDER_LOGO_URL"
fi

# ── Transform manifest ────────────────────────────────────────────────────────
jq \
  --arg name    "$ADDON_NAME" \
  --arg logoUrl "$LOGO_URL" \
'
  # Remove webapp (container-bound web app entry point — not used by add-ons)
  del(.webapp) |

  # Remove script.scriptapp scope (not required for editor add-ons;
  # its absence narrows the OAuth consent screen prompt)
  if .oauthScopes then
    .oauthScopes = [
      .oauthScopes[] |
      select(. != "https://www.googleapis.com/auth/script.scriptapp")
    ]
  else . end |

  # Add or update the addOns block
  .addOns = {
    "common": {
      "name":    $name,
      "logoUrl": $logoUrl
    },
    "docs": {}
  }
' "$INPUT" > "$OUTPUT"

# ── Print summary ─────────────────────────────────────────────────────────────
echo "✓ Created $OUTPUT"
echo ""
echo "  Removed:  webapp block"
echo "  Removed:  script.scriptapp scope (if present)"
echo "  Set:      addOns.common.name    = \"$ADDON_NAME\""
echo "  Set:      addOns.common.logoUrl = \"$LOGO_URL\""

PLACEHOLDERS=()
[[ "$ADDON_NAME" == "PLACEHOLDER_ADDON_NAME" ]] && PLACEHOLDERS+=("addOns.common.name  — set .name in addon/listing/listing.json or pass --name")
[[ "$LOGO_URL"   == "PLACEHOLDER_LOGO_URL"   ]] && PLACEHOLDERS+=("addOns.common.logoUrl — upload a 128×128 PNG and set the public URL")

if [[ ${#PLACEHOLDERS[@]} -gt 0 ]]; then
  echo ""
  echo "  ⚠  Placeholders remain in $OUTPUT — update before deploying:"
  for p in "${PLACEHOLDERS[@]}"; do echo "       • $p"; done
fi
