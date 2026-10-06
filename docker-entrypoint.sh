#!/bin/sh
# Resolve the UID/GID to run as, then drop privileges before exec-ing the
# server process.
#
# Resolution order:
#   1. HOST_UID / HOST_GID environment variables (explicit override)
#   2. Owner of the mounted workspace directory ($WORKSPACE_ROOT)
#   3. If the resolved UID is 0 (no mount, root-owned mount, or Docker Desktop
#      where bind-mount ownership appears as uid 0 inside the container), fall
#      back to the baked-in uid/gid 10001 to avoid running as container root.
#
# Pass -e HOST_UID=$(id -u) -e HOST_GID=$(id -g) to docker run when the
# workspace mount is owned by a non-root user but the above detection does not
# pick it up correctly (e.g. userns-remap setups).
#
# The API key is passed to the Node process via fd 3 (a heredoc opened below)
# and removed from the environment before exec so it does not appear in
# /proc/<pid>/environ of child processes.
#
# Without an API key the server runs in session mode: a token broker (uid 10002)
# is started first and is the only process that can read the session cache
# (fastedge-coordinator PROTOCOL.md §2a). Session mode refuses to start rather
# than run with a readable cache or an unverified broker.
set -e

BROKER_ID=10002
DROP="--clear-groups --no-new-privs --inh-caps=-all --ambient-caps=-all --bounding-set=-all"

# `docker run <image> login …` is the session login, not the system /bin/login.
# The session cache is broker-only (uid 10002; dirs 0700, files 0600): build code running as the
# MCP server's uid must never be able to read it (fastedge-coordinator PROTOCOL.md §2/§2a).
if [ "${1:-}" = "login" ]; then
  shift
  CACHE=/run/fastedge
  login_fail() { echo "login: $*" >&2; exit 2; }
  [ "$(id -u)" = "0" ] || login_fail "must start as root (don't pass --user)"
  command -v setpriv >/dev/null 2>&1 || login_fail "setpriv is missing from the image"

  # Migrate as root: refuse links and odd file types, then make everything broker-only.
  # This also upgrades POC volumes (0644, owned by 10001) in place.
  if [ -e "$CACHE" ]; then
    [ -d "$CACHE" ] && [ ! -L "$CACHE" ] || login_fail "$CACHE is not a directory"
    odd="$(find "$CACHE" -mindepth 1 \( -type l -o ! \( -type f -o -type d \) \) -print | head -1)"
    [ -z "$odd" ] || login_fail "unexpected entry in the session cache: $odd"
    chown -R "$BROKER_ID:$BROKER_ID" "$CACHE"
    find "$CACHE" -type d -exec chmod 0700 {} +
    find "$CACHE" -type f -exec chmod 0600 {} +
  fi

  # Run login as the broker uid, with no capabilities, no privilege gain and a clean environment.
  unset GCORE_API_KEY FASTEDGE_API_KEY
  exec env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp TERM="${TERM:-dumb}" \
    GCORE_API_BASE="${GCORE_API_BASE:-}" \
    setpriv --reuid="$BROKER_ID" --regid="$BROKER_ID" $DROP \
    /usr/local/bin/node /app/build/login.js "$@"
fi

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

# When the resolved owner is root (root-owned or absent mount, Docker Desktop
# virtualized ownership), drop to the baked-in fallback user instead of
# staying root. This prevents untrusted build code from running as container root.
if [ "$target_uid" = "0" ]; then
  target_uid=10001
  target_gid=10001
fi

fail() { echo "fastedge-mcp-server: $*" >&2; exit 2; }
case "$target_uid" in ''|*[!0-9]*) fail "HOST_UID must be a number";; esac
case "$target_gid" in ''|*[!0-9]*) fail "HOST_GID must be a number";; esac
# The server (and the build tools it runs) must never share the broker's identity.
[ "$target_uid" != "$BROKER_ID" ] && [ "$target_gid" != "$BROKER_ID" ] ||
  fail "uid/gid $BROKER_ID is reserved for the token broker; set HOST_UID/HOST_GID to another id"

if [ -z "${GCORE_API_KEY:-${FASTEDGE_API_KEY:-}}" ]; then
  # --- Session mode (no API key) ---------------------------------------------
  [ "$(id -u)" = "0" ] ||
    fail "without GCORE_API_KEY the container must start as root to isolate the session (don't pass --user)"
  command -v setpriv >/dev/null 2>&1 || fail "setpriv is missing from the image"

  # The cache must be broker-only. It is mounted read-only here, so refuse, never fix.
  # The image always has /run/fastedge; anything but a real directory is refused.
  [ -d /run/fastedge ] && [ ! -L /run/fastedge ] || fail "/run/fastedge is not a directory"
  bad="$(find /run/fastedge \( -type l -o ! \( -type f -o -type d \) -o ! -user "$BROKER_ID" \
    -o \( -type d ! -perm 0700 \) -o \( -type f -perm /077 \) \) -print 2>/dev/null | head -1)"
  [ -z "$bad" ] || fail "the session cache is readable by other users ($bad). Run the login command once to upgrade it."

  mkdir -p /run/fastedge-broker /tmp/broker-home /run/fastedge-launch
  chown "$BROKER_ID:$BROKER_ID" /run/fastedge-broker /tmp/broker-home
  chmod 0755 /run/fastedge-broker
  chmod 0700 /tmp/broker-home
  rm -f /run/fastedge-launch/ready
  mkfifo -m 0600 /run/fastedge-launch/ready
  chown "$BROKER_ID" /run/fastedge-launch/ready
  chmod 0711 /run/fastedge-launch
  ulimit -Sc 0
  ulimit -Hc 0

  # Clean, allowlisted environment; absolute paths; a trusted working directory.
  (cd /app && exec env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/broker-home \
    GCORE_API_BASE="${GCORE_API_BASE:-}" \
    setpriv --reuid="$BROKER_ID" --regid="$BROKER_ID" $DROP \
    /usr/local/bin/node /app/build/broker.js) &

  ready="$(timeout 5 cat /run/fastedge-launch/ready || true)"
  rm -rf /run/fastedge-launch
  [ "$ready" = "ready" ] || fail "the token broker did not start"

  HOME="/tmp/home-${target_uid}"
  mkdir -p "$HOME"
  chmod 0700 "$HOME"
  chown "$target_uid:$target_gid" "$HOME"
  export HOME
  unset GCORE_API_KEY FASTEDGE_API_KEY
  exec setpriv --reuid="$target_uid" --regid="$target_gid" $DROP "$@"
fi

# --- Explicit API key (unchanged; no broker, the cache isn't used) ----------------

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
  exec 3<<EOF
${GCORE_API_KEY:-${FASTEDGE_API_KEY:-}}
EOF
  unset GCORE_API_KEY FASTEDGE_API_KEY
  exec setpriv --reuid="$target_uid" --regid="$target_gid" --clear-groups "$@"
fi

if [ "$(id -u)" = "0" ]; then echo "Warning: running as root — setpriv not found" >&2; fi
exec 3<<EOF
${GCORE_API_KEY:-${FASTEDGE_API_KEY:-}}
EOF
unset GCORE_API_KEY FASTEDGE_API_KEY
exec "$@"
