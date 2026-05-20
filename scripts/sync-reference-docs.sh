#!/usr/bin/env bash
set -euo pipefail

# Sync reference docs from the fastedge-plugin repo into the MCP server.
#
# This script copies pipeline-generated reference docs from the plugin repo
# to the MCP server's reference-docs/ directory, where they're loaded at
# runtime by the fastedge-docs tool.
#
# Usage:
#   ./scripts/sync-reference-docs.sh [plugin-repo-path]
#
# If plugin-repo-path is not provided, defaults to ../fastedge-plugin
# (assumes coordinator directory structure).

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MCP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PLUGIN_PATH="${1:-${PLUGIN_PATH:-$MCP_ROOT/../fastedge-plugin}}"
TARGET_DIR="$MCP_ROOT/reference-docs"

if [ ! -d "$PLUGIN_PATH" ]; then
  echo "Error: Plugin repo not found at $PLUGIN_PATH"
  echo "Usage: $0 [path-to-fastedge-plugin]"
  exit 1
fi

INDEX_REF="$PLUGIN_PATH/plugins/gcore-fastedge/docs-index.json"

if [ ! -f "$INDEX_REF" ]; then
  echo "Error: Docs index not found at $INDEX_REF"
  echo "Run fastedge-plugin/scripts/sync/generate-docs-index.sh first."
  exit 1
fi

# Clean and recreate target
rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"

echo "Syncing reference docs from fastedge-plugin..."

# Index-driven copy: every topic's source path is copied to
# reference-docs/<topic.id>.md. Using topic.id (a unique slug derived from
# the path under reference/) means files from different subdirs that share
# a basename — e.g. cdn/examples-kv-store-rust.md and
# http/examples-kv-store-rust.md — land as distinct files.
while IFS=$'\t' read -r id src; do
  src_abs="$PLUGIN_PATH/$src"
  if [ ! -f "$src_abs" ]; then
    echo "Error: Topic ${id} source missing: ${src_abs}"
    exit 1
  fi
  cp "$src_abs" "$TARGET_DIR/${id}.md"
  echo "  ✓ ${id}.md  (← ${src})"
done < <(jq -r '.topics[] | "\(.id)\t\(.path)"' "$INDEX_REF")

# Copy canonical docs index from fastedge-plugin
cp "$INDEX_REF" "$TARGET_DIR/docs-index.json"
echo "  ✓ docs-index.json"

# Build local index view: local_path mirrors the slug-id naming used above.
# Canonical "path" remains repo-root-relative for traceability; MCP server
# resolves files via local_path / id.
jq '
  .topics |= map(
    . + { local_path: ("reference-docs/" + .id + ".md") }
  )
' "$TARGET_DIR/docs-index.json" > "$TARGET_DIR/docs-index.local.json"
echo "  ✓ docs-index.local.json"

TOTAL=$(ls -1 "$TARGET_DIR"/*.md 2>/dev/null | wc -l)
echo ""
echo "Synced $TOTAL reference docs to $TARGET_DIR"
