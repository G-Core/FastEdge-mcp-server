#!/usr/bin/env bash
# test-reference-index.sh — validates index-required loading for fastedge-docs
#
# Coverage:
#   (1) Missing docs-index.local.json -> throws
#   (2) Valid index + markdown -> loads docs/sections in mode=index
#   (3) Missing mapped markdown file -> throws
#   (4) Topic with no sections -> throws
#
# Usage: bash scripts/tests/test-reference-index.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BUILD_JS="${ROOT_DIR}/build/tools/reference/index.js"

PASS=0
FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; [[ -n "${2:-}" ]] && echo "       $2"; FAIL=$((FAIL + 1)); }

echo ""
echo "FastEdge-mcp-server: reference index tests"
echo "========================================="

if [[ ! -f "$BUILD_JS" ]]; then
  (cd "$ROOT_DIR" && npm run build >/dev/null) || {
    echo "Build failed; cannot run reference index tests."
    exit 1
  }
fi

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

# ── (1) Missing docs-index.local.json -> throws ──────────────────────────────
mkdir -p "${TMPDIR}/case1"
node --input-type=module <<EOF
import { loadReferenceDocs } from "file://${BUILD_JS}";
try {
  loadReferenceDocs("${TMPDIR}/case1");
  process.exit(1);
} catch {
  process.exit(0);
}
EOF
rc1=$?
if [[ "$rc1" -eq 0 ]]; then
  pass "(1) missing docs-index.local.json throws"
else
  fail "(1) missing docs-index.local.json throws" "exit=${rc1}"
fi

# ── (2) Valid index + markdown -> loads ──────────────────────────────────────
mkdir -p "${TMPDIR}/case2"
cat > "${TMPDIR}/case2/sample.md" <<'EOF'
# Sample

## Alpha
KV Store docs
EOF
cat > "${TMPDIR}/case2/docs-index.local.json" <<'EOF'
{
  "schema_version": "1.0.0",
  "topics": [
    {
      "id": "sample",
      "title": "Sample",
      "path": "plugins/gcore-fastedge/skills/fastedge-docs/reference/sample.md",
      "local_path": "reference-docs/sample.md",
      "sections": [
        {
          "id": "sample#alpha",
          "heading": "Alpha",
          "level": 2,
          "anchor": "alpha",
          "line_start": 3,
          "line_end": 4,
          "keywords": ["kv", "store"]
        }
      ]
    }
  ]
}
EOF
node --input-type=module <<EOF
import { loadReferenceDocs } from "file://${BUILD_JS}";
const loaded = loadReferenceDocs("${TMPDIR}/case2");
if (loaded.mode !== "index") process.exit(1);
if (loaded.docs.length !== 1) process.exit(2);
if (loaded.sections.length !== 1) process.exit(3);
if (loaded.sections[0].heading !== "Alpha") process.exit(4);
process.exit(0);
EOF
rc2=$?
if [[ "$rc2" -eq 0 ]]; then
  pass "(2) valid index + markdown loads docs/sections"
else
  fail "(2) valid index + markdown loads docs/sections" "exit=${rc2}"
fi

# ── (3) Missing mapped markdown file -> throws ───────────────────────────────
mkdir -p "${TMPDIR}/case3"
cat > "${TMPDIR}/case3/docs-index.local.json" <<'EOF'
{
  "schema_version": "1.0.0",
  "topics": [
    {
      "id": "missing-doc",
      "title": "Missing Doc",
      "path": "plugins/gcore-fastedge/skills/fastedge-docs/reference/missing-doc.md",
      "local_path": "reference-docs/missing-doc.md",
      "sections": [
        {
          "id": "missing-doc#intro",
          "heading": "Introduction",
          "level": 1,
          "anchor": "introduction",
          "line_start": 1,
          "line_end": 1
        }
      ]
    }
  ]
}
EOF
node --input-type=module <<EOF
import { loadReferenceDocs } from "file://${BUILD_JS}";
try {
  loadReferenceDocs("${TMPDIR}/case3");
  process.exit(1);
} catch {
  process.exit(0);
}
EOF
rc3=$?
if [[ "$rc3" -eq 0 ]]; then
  pass "(3) missing mapped markdown file throws"
else
  fail "(3) missing mapped markdown file throws" "exit=${rc3}"
fi

# ── (4) Topic with no sections -> throws ─────────────────────────────────────
mkdir -p "${TMPDIR}/case4"
cat > "${TMPDIR}/case4/sample.md" <<'EOF'
# Sample
EOF
cat > "${TMPDIR}/case4/docs-index.local.json" <<'EOF'
{
  "schema_version": "1.0.0",
  "topics": [
    {
      "id": "sample",
      "title": "Sample",
      "path": "plugins/gcore-fastedge/skills/fastedge-docs/reference/sample.md",
      "local_path": "reference-docs/sample.md",
      "sections": []
    }
  ]
}
EOF
node --input-type=module <<EOF
import { loadReferenceDocs } from "file://${BUILD_JS}";
try {
  loadReferenceDocs("${TMPDIR}/case4");
  process.exit(1);
} catch {
  process.exit(0);
}
EOF
rc4=$?
if [[ "$rc4" -eq 0 ]]; then
  pass "(4) topic without sections throws"
else
  fail "(4) topic without sections throws" "exit=${rc4}"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]

