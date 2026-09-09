#!/bin/bash
# Verify that GCORE_API_KEY does not appear in /proc/1/environ after the
# entrypoint runs. Requires docker on PATH and a locally built image.
set -e

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found, skipping"
  exit 0
fi

IMAGE="fastedge-mcp-server:local"

echo "Building $IMAGE for key-isolation test..."
docker build -t "$IMAGE" "$(dirname "$0")/../.."

echo "Checking that GCORE_API_KEY is absent from /proc/1/environ inside the container..."
count=$(docker run --rm \
  -e GCORE_API_KEY=SECRET_CANARY \
  -v "$(mktemp -d)":/workspace \
  --entrypoint sh \
  "$IMAGE" \
  -c 'sleep 1; tr "\0" "\n" </proc/1/environ | grep -c SECRET_CANARY || true')

if [ "$count" != "0" ]; then
  echo "FAIL: GCORE_API_KEY found in /proc/1/environ ($count occurrences)"
  exit 1
fi

echo "PASS: GCORE_API_KEY not present in /proc/1/environ"
