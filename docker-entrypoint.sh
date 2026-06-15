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

# Resolve each of UID/GID independently from the workspace owner when not given
# explicitly. This matters when HOST_UID is set but HOST_GID is not: on many
# Linux hosts the user's primary GID differs from the UID, so defaulting the GID
# to the UID would produce files with the wrong group and can break group-based
# write access on shared workspaces.
if [ -d "$WORKSPACE_ROOT" ]; then
  if [ -z "$target_uid" ]; then
    target_uid="$(stat -c '%u' "$WORKSPACE_ROOT" 2>/dev/null || echo 0)"
  fi
  if [ -z "$target_gid" ]; then
    target_gid="$(stat -c '%g' "$WORKSPACE_ROOT" 2>/dev/null || echo 0)"
  fi
fi

target_uid="${target_uid:-0}"
target_gid="${target_gid:-$target_uid}"

if [ "$(id -u)" = "0" ] && [ "$target_uid" != "0" ] && command -v setpriv >/dev/null 2>&1; then
  # Give the unprivileged user a writable HOME for tool caches
  # (npm / pnpm / create-fastedge-app). The cargo registry already lives in a
  # world-writable CARGO_HOME, so Rust builds work without further changes.
  #
  # Use a per-UID home directory rather than a shared /tmp so concurrent runs
  # with different UIDs don't collide on caches or expose per-user config to
  # each other. Create it as root with 0700 perms and chown it to the target
  # user before dropping privileges.
  HOME="/tmp/home-${target_uid}"
  mkdir -p "$HOME"
  chmod 0700 "$HOME"
  chown "$target_uid:$target_gid" "$HOME"
  export HOME
  exec setpriv --reuid="$target_uid" --regid="$target_gid" --clear-groups "$@"
fi

exec "$@"
