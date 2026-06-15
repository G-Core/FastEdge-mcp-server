#!/bin/sh
# Drop privileges to the host user so files created in the bind-mounted
# workspace are owned by that user instead of root.
#
# Target UID/GID resolution order:
#   1. Explicit HOST_UID / HOST_GID environment variables
#   2. Owner of the mounted workspace directory ($WORKSPACE_ROOT)
#   3. Fall back to running as-is (root) for backward compatibility
#
# This keeps the container backward-compatible: with no writable mount, or on
# Docker Desktop (macOS/Windows) where bind-mount ownership is virtualized to
# the calling user, the workspace owner resolves to 0 and we stay root.
set -e

WORKSPACE_ROOT="${WORKSPACE_ROOT:-/workspace}"

target_uid="${HOST_UID:-}"
target_gid="${HOST_GID:-}"

if [ -z "$target_uid" ] && [ -d "$WORKSPACE_ROOT" ]; then
  target_uid="$(stat -c '%u' "$WORKSPACE_ROOT" 2>/dev/null || echo 0)"
  target_gid="$(stat -c '%g' "$WORKSPACE_ROOT" 2>/dev/null || echo 0)"
fi

target_uid="${target_uid:-0}"
target_gid="${target_gid:-$target_uid}"

if [ "$(id -u)" = "0" ] && [ "$target_uid" != "0" ] && command -v setpriv >/dev/null 2>&1; then
  # Give the unprivileged user a writable HOME for tool caches
  # (npm / pnpm / create-fastedge-app). The cargo registry already lives in a
  # world-writable CARGO_HOME, so Rust builds work without further changes.
  export HOME=/tmp
  exec setpriv --reuid="$target_uid" --regid="$target_gid" --clear-groups "$@"
fi

exec "$@"
