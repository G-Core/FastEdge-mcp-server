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
PLUGIN_PATH="${1:-$MCP_ROOT/../fastedge-plugin}"
TARGET_DIR="$MCP_ROOT/reference-docs"

if [ ! -d "$PLUGIN_PATH" ]; then
  echo "Error: Plugin repo not found at $PLUGIN_PATH"
  echo "Usage: $0 [path-to-fastedge-plugin]"
  exit 1
fi

DOCS_REF="$PLUGIN_PATH/plugins/gcore-fastedge/skills/fastedge-docs/reference"
TEST_REF="$PLUGIN_PATH/plugins/gcore-fastedge/skills/test/reference"

if [ ! -d "$DOCS_REF" ]; then
  echo "Error: Reference docs not found at $DOCS_REF"
  exit 1
fi

# Clean and recreate target
rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"

echo "Syncing reference docs from fastedge-plugin..."

# Core docs (fastedge-docs skill — top level)
for file in "$DOCS_REF"/*.md; do
  [ -f "$file" ] && cp "$file" "$TARGET_DIR/"
  echo "  ✓ $(basename "$file")"
done

# Example docs (fastedge-docs skill — cdn/ and http/ subdirectories)
for subdir in "$DOCS_REF"/cdn "$DOCS_REF"/http; do
  if [ -d "$subdir" ]; then
    for file in "$subdir"/*.md; do
      [ -f "$file" ] && cp "$file" "$TARGET_DIR/"
      echo "  ✓ $(basename "$file") ($(basename "$subdir") example)"
    done
  fi
done

# Test docs (test skill)
if [ -d "$TEST_REF" ]; then
  for file in "$TEST_REF"/*.md; do
    [ -f "$file" ] && cp "$file" "$TARGET_DIR/"
    echo "  ✓ $(basename "$file") (test)"
  done
fi

TOTAL=$(ls -1 "$TARGET_DIR"/*.md 2>/dev/null | wc -l)
echo ""
echo "Synced $TOTAL reference docs to $TARGET_DIR"
