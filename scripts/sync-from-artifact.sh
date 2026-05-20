#!/usr/bin/env bash
# sync-from-artifact.sh — Download, verify, and sync a fastedge-plugin release artifact.
#
# Called by sync-and-release.yml on repository_dispatch (plugin-release).
# For manual/dev syncs use sync-reference-docs.sh (sparse checkout path).
#
# Usage:
#   ./scripts/sync-from-artifact.sh \
#     --artifact-url https://github.com/.../fastedge-reference-docs-vX.Y.Z.tar.gz \
#     --sha256-url   https://github.com/.../fastedge-reference-docs-vX.Y.Z.tar.gz.sha256 \
#     --version      X.Y.Z
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_DIR="$MCP_ROOT/reference-docs"

ARTIFACT_URL=""
SHA256_URL=""
VERSION=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --artifact-url) ARTIFACT_URL="$2"; shift 2 ;;
    --sha256-url)   SHA256_URL="$2";   shift 2 ;;
    --version)      VERSION="$2";      shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$ARTIFACT_URL" || -z "$SHA256_URL" || -z "$VERSION" ]]; then
  echo "Error: --artifact-url, --sha256-url, and --version are all required" >&2
  exit 1
fi

TMPDIR_WORK=$(mktemp -d)
trap 'rm -rf "$TMPDIR_WORK"' EXIT

TARBALL="$TMPDIR_WORK/artifact.tar.gz"
SHA256_FILE="$TMPDIR_WORK/artifact.tar.gz.sha256"
ARTIFACT_BASENAME="fastedge-reference-docs-v${VERSION}"
EXTRACT_DIR="$TMPDIR_WORK/$ARTIFACT_BASENAME"

# Download
echo "Downloading artifact v${VERSION}..."
curl -fsSL "$ARTIFACT_URL" -o "$TARBALL"
curl -fsSL "$SHA256_URL"   -o "$SHA256_FILE"

# Verify checksum
echo "Verifying checksum..."
EXPECTED=$(awk '{print $1}' "$SHA256_FILE")
ACTUAL=$(sha256sum "$TARBALL" | awk '{print $1}')
if [[ "$EXPECTED" != "$ACTUAL" ]]; then
  echo "Error: checksum mismatch" >&2
  echo "  Expected: $EXPECTED" >&2
  echo "  Actual:   $ACTUAL" >&2
  exit 1
fi
echo "Checksum OK: $ACTUAL"

# Extract
tar -xzf "$TARBALL" -C "$TMPDIR_WORK"

if [[ ! -d "$EXTRACT_DIR" ]]; then
  echo "Error: expected artifact dir not found after extraction: $EXTRACT_DIR" >&2
  exit 1
fi

# Sync reference-docs using the artifact's docs-index.json.
# Artifact paths are artifact-relative (e.g. reference/fastedge-docs/sdk-reference-js.md).
INDEX="$EXTRACT_DIR/docs-index.json"
if [[ ! -f "$INDEX" ]]; then
  echo "Error: docs-index.json not found in artifact at $INDEX" >&2
  exit 1
fi

rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"

echo "Syncing reference docs from artifact..."

while IFS=$'\t' read -r id src; do
  src_abs="$EXTRACT_DIR/$src"
  if [[ ! -f "$src_abs" ]]; then
    echo "Error: Topic ${id} source missing: ${src_abs}" >&2
    exit 1
  fi
  cp "$src_abs" "$TARGET_DIR/${id}.md"
  echo "  ✓ ${id}.md  (← ${src})"
done < <(jq -r '.topics[] | "\(.id)\t\(.path)"' "$INDEX")

cp "$INDEX" "$TARGET_DIR/docs-index.json"
echo "  ✓ docs-index.json"

# Generate local index: MCP tool resolves files via local_path.
jq '
  .topics |= map(
    . + { local_path: ("reference-docs/" + .id + ".md") }
  )
' "$TARGET_DIR/docs-index.json" > "$TARGET_DIR/docs-index.local.json"
echo "  ✓ docs-index.local.json"

echo "$VERSION" > "$TARGET_DIR/VERSION"
echo "  ✓ VERSION"

TOTAL=$(find "$TARGET_DIR" -name "*.md" | wc -l)
echo ""
echo "Synced $TOTAL reference docs to $TARGET_DIR (v${VERSION})"
