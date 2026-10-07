#!/usr/bin/env bash
# Release gate for the token broker (fastedge-coordinator task 09, SECURITY.md "Release gate").
# Runs the real image in session mode with a canary token in the cache, then attacks it the way
# build code would: as the MCP server's uid, with the server's privileges. Every row must pass.
#
# Usage: scripts/tests/test-broker-isolation.sh [image]   (default: fastedge-mcp-server:session-poc)
# Platform sign-off runbook (macOS, Windows, rootless, arm64): DEVELOPMENT.md.
# Needs Docker. The gcore_api row calls api.preprod.world with the fake token (expects a 401).
set -u
IMAGE="${1:-fastedge-mcp-server:session-poc}"
API=https://api.preprod.world
CANARY="4242_GATE-CANARY-token-$(date +%s)"
DROP="--clear-groups --no-new-privs --inh-caps=-all --ambient-caps=-all --bounding-set=-all"
VOL_GOOD="fe-gate-good-$$"
VOL_LEGACY="fe-gate-legacy-$$"
VOL_LINK="fe-gate-link-$$"
VOL_EPH="fe-gate-eph-$$"
EPH_NAME="fe-gate-eph-server-$$"
EPH_DIR=""
# GATE_WS_PARENT: where the test workspace goes (e.g. /mnt/c/Users/me on Windows, to test a Windows-drive mount).
WS="$(mktemp -d "${GATE_WS_PARENT:-${TMPDIR:-/tmp}}/fe-gate-XXXXXX")"
chmod 0755 "$WS"
CONTAINER=""
failures=0

# macOS has no `timeout` (coreutils installs it as gtimeout); without either, run unbounded.
if command -v timeout >/dev/null 2>&1; then t_out() { timeout "$@"; }
elif command -v gtimeout >/dev/null 2>&1; then t_out() { gtimeout "$@"; }
else t_out() { shift; "$@"; }
fi

pass() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; failures=$((failures + 1)); }
check() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (expected '$3', got '$2')"; fi; }

cleanup() {
  [ -n "$CONTAINER" ] && docker rm -f "$CONTAINER" >/dev/null 2>&1
  docker rm -f "$EPH_NAME" >/dev/null 2>&1
  docker volume rm -f "$VOL_GOOD" "$VOL_LEGACY" "$VOL_LINK" "$VOL_EPH" >/dev/null 2>&1
  rm -rf "$WS" ${EPH_DIR:+"$EPH_DIR"}
}
trap cleanup EXIT

# --- Fixtures: a broker-only cache with the canary, and two insecure ones ---------------
seed() { # volume owner dirmode filemode [extra shell]
  docker run --rm -v "$1:/run/fastedge" --entrypoint sh "$IMAGE" -c "
    mkdir -p /run/fastedge/accounts
    printf '%s' '{\"version\":1,\"generation\":\"g\",\"token\":\"$CANARY\",\"token_id\":4242,\"client_id\":123,\"api_origin\":\"$API\",\"expires_at\":\"2099-01-01T00:00:00.000Z\",\"created_at\":\"2026-01-01T00:00:00.000Z\"}' > /run/fastedge/accounts/api.preprod.world_123.json
    printf '%s' '{\"version\":1,\"api_origin\":\"$API\",\"client_id\":123,\"generation\":\"p\"}' > /run/fastedge/active-api.preprod.world.json
    chown -R $2 /run/fastedge
    find /run/fastedge -type d -exec chmod $3 {} +
    find /run/fastedge -type f -exec chmod $4 {} +
    ${5:-true}"
}
seed "$VOL_GOOD" 10002:10002 0700 0600
seed "$VOL_LEGACY" 10001:10001 0755 0644
seed "$VOL_LINK" 10002:10002 0700 0600 "ln -s /etc/passwd /run/fastedge/accounts/link"
seed "$VOL_EPH" 10002:10002 0700 0600

RUN=(docker run --rm -i -v "$WS:/workspace" -e GCORE_API_BASE=$API)

# --- 1. Startup refusals (exit 2, nothing started) -----------------------------------------
echo "Startup refusals"
expect_refusal() { # label pattern docker-args...
  local label=$1 pattern=$2; shift 2
  local out code
  out="$(t_out 60 "${RUN[@]}" "$@" "$IMAGE" </dev/null 2>&1)"; code=$?
  if [ "$code" = 2 ] && grep -q "$pattern" <<<"$out"; then pass "$label"; else fail "$label (exit $code: $(tail -1 <<<"$out"))"; fi
}
expect_refusal "HOST_UID=10002 is refused" "reserved for the token broker" -v "$VOL_GOOD:/run/fastedge:ro" -e HOST_UID=10002
expect_refusal "HOST_GID=10002 is refused" "reserved for the token broker" -v "$VOL_GOOD:/run/fastedge:ro" -e HOST_GID=10002
expect_refusal "a non-numeric HOST_UID is refused" "must be a number" -v "$VOL_GOOD:/run/fastedge:ro" -e "HOST_UID=1000;id"
expect_refusal "--user without a key is refused" "must start as root" --user "$(id -u)" -v "$VOL_GOOD:/run/fastedge:ro"
expect_refusal "a readable (legacy) cache is refused" "readable by other users" -v "$VOL_LEGACY:/run/fastedge:ro"
expect_refusal "a symlink in the cache is refused" "readable by other users" -v "$VOL_LINK:/run/fastedge:ro"

# --- 2. Explicit key: no broker ---------------------------------------------------------------
echo "Explicit key"
CONTAINER="$(docker run -d -i -v "$WS:/workspace" -v "$VOL_GOOD:/run/fastedge:ro" -e GCORE_API_BASE=$API -e GCORE_API_KEY=not-a-real-key "$IMAGE")"
sleep 2
in_c() { docker exec "$CONTAINER" sh -c "$1" 2>/dev/null; }
broker_pid() { in_c 'for p in /proc/[0-9]*; do [ "$(stat -c %u $p)" = 10002 ] && basename $p; done' | head -1; }
check "no broker process with an explicit key" "$(broker_pid)" ""
check "no broker socket directory with an explicit key" "$(in_c '[ -e /run/fastedge-broker ] && echo yes || echo no')" "no"
docker rm -f "$CONTAINER" >/dev/null; CONTAINER=""

# --- 3. Session mode under attack -------------------------------------------------------------
echo "Session mode"
printf 'console.error("PRELOAD RAN in uid " + process.getuid())\n' > "$WS/evil.cjs"
CONTAINER="$(docker run -d -i -v "$WS:/workspace" -v "$VOL_GOOD:/run/fastedge:ro" -e GCORE_API_BASE=$API \
  -e NODE_OPTIONS="--require /workspace/evil.cjs" -e LD_PRELOAD=/workspace/nope.so -e HTTPS_PROXY=http://127.0.0.1:9 "$IMAGE")"
for _ in $(seq 1 50); do [ -n "$(broker_pid)" ] && [ "$(in_c '[ -e /run/fastedge-broker/sock ] && echo y')" != y ] && break; sleep 0.2; done
BROKER="$(broker_pid)"
[ -n "$BROKER" ] && pass "broker is running (pid $BROKER)" || fail "broker is running"
check "socket is gone once the server has connected (single connection)" "$(in_c '[ -e /run/fastedge-broker/sock ] && echo there || echo gone')" "gone"

status_of() { in_c "grep -E '^(Uid|Gid|Groups|CapInh|CapPrm|CapEff|CapBnd|CapAmb|NoNewPrivs):' /proc/$1/status | tr -s '\t' ' '"; }
dropped() { # pid uid
  local s; s="$(status_of "$1")"
  grep -q "^Uid: $2 $2 $2 $2" <<<"$s" && grep -q '^Groups: *$' <<<"$s" && grep -q '^NoNewPrivs: 1' <<<"$s" &&
    [ "$(grep -c '^Cap[A-Za-z]*: 0000000000000000' <<<"$s")" = 5 ]
}
# The server's ids as the entrypoint chose them: the workspace owner on Linux, the 10001 fallback
# where mounts look root-owned (Docker Desktop).
SERVER_UID="$(in_c "awk '/^Uid:/{print \$2}' /proc/1/status")"
SERVER_GID="$(in_c "awk '/^Gid:/{print \$2}' /proc/1/status")"
dropped "$BROKER" 10002 && pass "broker: uid 10002, no groups, no capabilities, no_new_privs" || fail "broker identity: $(status_of "$BROKER")"
dropped 1 "$SERVER_UID" && pass "server: uid $SERVER_UID, no groups, no capabilities, no_new_privs" || fail "server identity: $(status_of 1)"
# Even container root needs CAP_SYS_PTRACE to read the broker's environ (it isn't dumpable).
check "broker environment is the allowlist only" "$(docker exec --privileged "$CONTAINER" sh -c "tr '\0' '\n' </proc/$BROKER/environ | cut -d= -f1 | sort | tr '\n' ' '" 2>/dev/null)" "FASTEDGE_SESSION GCORE_API_BASE HOME PATH "
check "broker core dumps are off" "$(in_c "grep 'Max core file size' /proc/$BROKER/limits | tr -s ' ' | cut -d' ' -f5,6")" "0 0"
check "NODE_OPTIONS from the launch config did not reach the broker" "$(docker logs "$CONTAINER" 2>&1 | grep -c 'PRELOAD RAN in uid 10002')" "0"

# The hostile build: same uid and privileges as the server, as build-wasm's children have.
cat > "$WS/evil.sh" <<'EOF'
B=$1; C=$2
t() { label=$1; shift; out=$("$@" 2>&1); code=$?; case "$out" in *"$C"*) echo "LEAK $label";; *) [ $code = 0 ] && echo "OPEN $label: $(echo "$out" | head -c 60 | tr '\n' ' ')" || echo "DENY $label";; esac; }
t "read the token file"            cat /run/fastedge/accounts/api.preprod.world_123.json
t "list the session cache"         ls /run/fastedge/accounts
t "broker /proc environ"           cat /proc/$B/environ
t "broker /proc mem"               head -c 16 /proc/$B/mem
t "broker /proc fd"                ls /proc/$B/fd
t "broker /proc maps"              cat /proc/$B/maps
t "server /proc mem"               head -c 16 /proc/1/mem
t "reopen the server's socket fd"  sh -c 'for f in /proc/1/fd/*; do [ -S "$f" ] && cat "$f" && exit 0; done; exit 1'
t "connect to the broker socket"   node -e 'require("net").connect("/run/fastedge-broker/sock").on("connect",()=>process.exit(0)).on("error",()=>process.exit(1))'
t "plant a fake broker socket"     node -e 'require("net").createServer().listen("/run/fastedge-broker/sock",()=>process.exit(0)).on("error",()=>process.exit(1))'
t "signal the broker"              kill -0 $B
t "become root (su)"               su -c id root
t "mount"                          mount -t tmpfs none /mnt
t "write the broker code"          sh -c 'echo x >> /app/build/broker.js'
t "write the node binary"          sh -c 'echo x >> /usr/local/bin/node'
t "write into /app/build"          touch /app/build/evil.js
# Any readable copy of the canary anywhere on the filesystem (no output = none found).
found=$(timeout 30 grep -rlsF --exclude-dir=proc --exclude-dir=sys --exclude-dir=dev "$C" / 2>/dev/null | head -3)
[ -z "$found" ] && echo "DENY find a readable token copy" || echo "LEAK find a readable token copy: $found"
EOF
while read -r verdict label; do
  case "$verdict" in
    DENY) pass "build code can't: $label" ;;
    LEAK | OPEN) fail "build code: $verdict $label" ;;
    *) ;; # e.g. ld.so warnings from the hostile LD_PRELOAD in the container environment
  esac
done < <(docker exec "$CONTAINER" setpriv --reuid="$SERVER_UID" --regid="$SERVER_GID" $DROP sh /workspace/evil.sh "$BROKER" "$CANARY" 2>&1)

check "the canary is not in the container logs" "$(docker logs "$CONTAINER" 2>&1 | grep -c "$CANARY")" "0"
docker rm -f "$CONTAINER" >/dev/null; CONTAINER=""

# --- 4. The tools work through the broker -----------------------------------------------------
echo "Tools through the broker"
rpc() {
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"gate","version":"0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"fastedge-auth-status","arguments":{}}}' \
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"gcore_api","arguments":{"method":"GET","path":"/fastedge/v1/apps"}}}' \
    '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"gcore_api","arguments":{"method":"GET","path":"/iam/users"}}}'
  sleep 8
}
OUT="$(rpc | t_out 60 "${RUN[@]}" -v "$VOL_GOOD:/run/fastedge:ro" "$IMAGE" 2>/dev/null)"
line() { grep "\"id\":$1}" <<<"$OUT"; }
grep -q '\\"client_id\\": 123' <<<"$(line 2)" && pass "fastedge-auth-status reads the account through the broker" || fail "auth status: $(line 2 | head -c 200)"
grep -q '(rejected)' <<<"$(line 3)" && pass "gcore_api reaches the API through the broker (fake token → rejected)" || fail "gcore_api: $(line 3 | head -c 200)"
grep -q 'policy_denied' <<<"$(line 4)" && pass "a path outside the policy is denied" || fail "policy: $(line 4 | head -c 200)"
check "no tool output contains the canary" "$(grep -c "$CANARY" <<<"$OUT")" "0"

# --- 5. Ephemeral mode (task 10): sealed to the broker's in-memory key ------------------------
echo "Ephemeral mode"
expect_refusal "ephemeral together with an API key is refused" "can't be combined" -e FASTEDGE_SESSION=ephemeral -e GCORE_API_KEY=not-a-real-key
expect_refusal "an unknown FASTEDGE_SESSION is refused" "must be unset" -e FASTEDGE_SESSION=sometimes
login_refusal() { # label pattern login-args...
  local label=$1 pattern=$2; shift 2
  local out code
  out="$(t_out 60 docker run --rm -i -v "$VOL_EPH:/run/fastedge" -e GCORE_API_BASE=$API -e FASTEDGE_SESSION=ephemeral "$IMAGE" login "$@" </dev/null 2>&1)"; code=$?
  if [ "$code" = 2 ] && grep -q "$pattern" <<<"$out"; then pass "$label"; else fail "$label (exit $code: $(tail -1 <<<"$out"))"; fi
}
login_refusal "ephemeral login without --seal-to is refused" "needs the MCP server's key"
login_refusal "ephemeral login --use is refused" "can't switch" --use 123 --seal-to AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA

# One MCP server kept running over a FIFO, so a sealed token can be planted for its live key.
CANARY_EPH="4242_GATE-EPHEMERAL-$(date +%s)"
EPH_DIR="$(mktemp -d)"
mkfifo "$EPH_DIR/in"
docker run --rm -i --name "$EPH_NAME" -v "$WS:/workspace" -v "$VOL_EPH:/run/fastedge:ro" -e GCORE_API_BASE=$API \
  -e FASTEDGE_SESSION=ephemeral "$IMAGE" <"$EPH_DIR/in" >"$EPH_DIR/out" 2>"$EPH_DIR/err" &
exec 4>"$EPH_DIR/in"
send() { printf '%s\n' "$1" >&4; }
reply() { for _ in $(seq 1 150); do grep "\"id\":$1}" "$EPH_DIR/out" && return; sleep 0.2; done; }
send '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"gate","version":"0"}}}'
send '{"jsonrpc":"2.0","method":"notifications/initialized"}'
send '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"fastedge-auth-status","arguments":{}}}'
STATUS="$(reply 2)"
SEAL_KEY="$(grep -oE 'seal-to [A-Za-z0-9_-]{43}' <<<"$STATUS" | head -1 | cut -d' ' -f2)"
grep -q '\\"mode\\": \\"ephemeral\\"' <<<"$STATUS" && grep -q '\\"state\\": \\"no_session\\"' <<<"$STATUS" &&
  pass "ephemeral status: no session, the plaintext account in the volume is ignored" || fail "ephemeral status: $(head -c 300 <<<"$STATUS")"
[ -n "$SEAL_KEY" ] && pass "the login command carries the broker's public key" || fail "no --seal-to key in the status"

# Plant a token sealed to that key, as a volume writer would (root in another container).
docker run --rm -v "$VOL_EPH:/run/fastedge" --entrypoint sh "$IMAGE" -c "cd /app && node --input-type=module -e '
  import { seal } from \"/app/build/auth/seal.js\";
  import { writeSealed } from \"/app/build/auth/store.js\";
  const [k, token] = process.argv.slice(1), now = Date.now();
  writeSealed(\"/run/fastedge\", k, seal(k, { token, api_origin: \"$API\", client_id: 123, token_id: 4242,
    created_at: new Date(now).toISOString(), expires_at: new Date(now + 4 * 3600e3).toISOString() }));
' '$SEAL_KEY' '$CANARY_EPH' && chown -R 10002:10002 /run/fastedge"
send '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"gcore_api","arguments":{"method":"GET","path":"/fastedge/v1/apps"}}}'
grep -q '(rejected)' <<<"$(reply 3)" && pass "the broker opens the sealed token and uses it (fake token → rejected)" || fail "sealed adoption: $(reply 3 | head -c 200)"

EPH_SERVER_UID="$(docker exec "$EPH_NAME" awk '/^Uid:/{print $2}' /proc/1/status)"
found="$(docker exec "$EPH_NAME" setpriv --reuid="$EPH_SERVER_UID" --regid="$EPH_SERVER_UID" $DROP \
  sh -c "timeout 30 grep -rlsF --exclude-dir=proc --exclude-dir=sys --exclude-dir=dev '$CANARY_EPH' / | head -3" 2>/dev/null)"
check "build code can't: find the ephemeral token anywhere" "$found" ""
check "no plaintext ephemeral token in the volume, even for root" \
  "$(docker run --rm -v "$VOL_EPH:/v:ro" --entrypoint sh "$IMAGE" -c "grep -rlF '$CANARY_EPH' /v" 2>/dev/null)" ""
check "the ephemeral token is in no output or log" "$(cat "$EPH_DIR/out" "$EPH_DIR/err" | grep -c "$CANARY_EPH")" "0"

# Stop the server: the broker and its key die with it. A new server can't open the old file.
exec 4>&-
for _ in $(seq 1 150); do docker inspect --type container "$EPH_NAME" >/dev/null 2>&1 || break; sleep 0.2; done
docker inspect --type container "$EPH_NAME" >/dev/null 2>&1 && fail "the ephemeral server stops when its client goes away" || pass "the ephemeral server stops when its client goes away"
AFTER="$(printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"gate","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"gcore_api","arguments":{"method":"GET","path":"/fastedge/v1/apps"}}}' |
  { cat; sleep 6; } | t_out 60 "${RUN[@]}" -v "$VOL_EPH:/run/fastedge:ro" -e FASTEDGE_SESSION=ephemeral "$IMAGE" 2>/dev/null)"
grep -q '(no_session)' <<<"$(grep '"id":2}' <<<"$AFTER")" && pass "after a restart the old sealed token can't be opened (new key)" ||
  fail "restart: $(grep '"id":2}' <<<"$AFTER" | head -c 200)"

echo
if [ "$failures" = 0 ]; then echo "All broker isolation checks passed."; else echo "$failures check(s) FAILED."; fi
exit $((failures > 0))
