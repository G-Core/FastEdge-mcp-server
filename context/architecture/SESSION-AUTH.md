# Session auth and the token broker

How the server authenticates to the Gcore API. **Branch: `feat/token-gen`, not released** (see
"Release gate"). Read this before touching `docker-entrypoint.sh`, `src/auth/`, `src/broker.ts`,
`src/login.ts`, or how the API tools get credentials.

Contract docs live in the fastedge-coordinator repo under `context/session-approval/`:
PROTOCOL.md is the wire and file contract, SECURITY.md the rules and gate rows, and
`tasks/09-token-broker.md` / `tasks/10-ephemeral-session.md` hold the history. Change the contract
there first. This file is the implementation map.

## Two modes, decided once at container start

| | Explicit key | Session (no key) |
|---|---|---|
| Credential | `GCORE_API_KEY`/`FASTEDGE_API_KEY`, passed on fd 3 and unset from the env | IAM API token approved in the portal, cached in the `fastedge-session` volume |
| Processes | the server only (workspace uid, `setpriv --clear-groups`) | **broker** (uid 10002) + server (workspace uid or 10001); both get the full drop: `--clear-groups --no-new-privs`, all capability sets empty |
| Who holds the credential | the server | **the broker only**; the server and build tools never see it |
| Cache | ignored, even if mounted (S1: an explicit key always wins) | `/run/fastedge` mounted `:ro`; must be broker-only (`10002`, dirs `0700`, files `0600`, no links), or startup is refused |

Why the broker exists: `build-wasm` runs third-party build code (Cargo `build.rs`, proc macros,
npm scripts) as the server's uid. With a readable cache, any dependency could read every
cached account's token (risk R1).

## Processes and files

- **`docker-entrypoint.sh`**:
  - **`login …`:** as root, migrates the cache (refuses links and odd types; `chown 10002`,
    `0700`/`0600`), then runs `build/login.js` as 10002 with the full drop, `env -i` and core dumps
    off.
  - **Every mode:** `HOST_UID`/`HOST_GID` must be numeric and must not be 10002.
  - **Session mode:**
    - Requires root (no `--user`), and refuses a cache that isn't broker-only.
    - Starts `build/broker.js` as 10002 (`env -i` with `PATH`, `HOME`, `GCORE_API_BASE`; core
      dumps off), and waits ≤5 s on a ready FIFO.
    - Then execs the server with the full drop.
- **`src/broker.ts`** (process):
  - Checks its own identity, then listens on `/run/fastedge-broker/sock`.
  - Accepts **one** connection, then closes the listener and unlinks the socket.
  - Exits when that connection ends, or if nothing connects within 30 s.
- **`src/auth/broker.ts`:**
  - Frames: 4-byte length + JSON, plus raw bodies.
  - `checkRequest`: method enum; strict path grammar; same origin and exact pathname; `ALLOWED_OPS`
    or `GET /iam/clients/me`; query and body limits; JSON or octet-stream only.
  - `serveBroker`: handshake first; at most 8 requests in flight.
  - `connectBroker` (server side): checks the process is unprivileged and not 10002, and that the
    socket belongs to uid 10002. Any failure gives an `Auth` that answers `broker_unavailable`. It
    **never** falls back to reading the cache.
- **`src/auth/credentials.ts`:**
  - `Auth.call()` is the only way tools reach the API.
  - `createAuth(key)` is the explicit key, or the session logic (which **only the broker runs**).
  - **Session logic:**
    - Reads and validates the cache on every call.
    - **Account check:** `GET /iam/clients/me` once per token; `id` must equal the file's
      `client_id`. Only then does it pin the account (one per process, S5).
    - Uses manual redirects and a 16 MiB response cap.
    - A 401 maps to `rejected`; a response containing the token is withheld.
  - `authRequiredResult()` builds the agent-facing text, which offers sign-in as three choices.
- **`src/auth/store.ts`:** the volume layout and writers (all `0700`/`0600`), lock and installation id:
  - `accounts/<api host>_<client_id>.json`
  - `active-<api host>.json`
  - `installation_id`
  - `.lock`
- **`src/auth/login-server.ts` + `src/login.ts`** (`login` subcommand):
  - Loopback callback on 47215 for the portal's form POST (`state` check, 7-day cap).
  - `--use <client_id>`, `--logout` (local only), `--code` (hidden TTY prompt; manual connect code).
- **`src/auth/session.ts`:**
  - Login, `--use` and `--code` command builders. The image tag comes from `package.json`
    `version`, so the build must set it.
  - Portal origin map, `RESTART_HINT`.
- **Tools** (`src/tools/api/`):
  - `gcore_api`, `batch_execute` and `upload-binary` call `auth.call` and map `authRequired` to
    `authRequiredResult`.
  - `upload-binary` reads the file itself and sends bytes, never a path.
  - `fastedge-auth-status` returns `auth.status()`: metadata only, plus `account_verified`.

## Ephemeral mode (`FASTEDGE_SESSION=ephemeral`, task 10 v1)

Forced by config, fixed at broker start, and never mixed with the plaintext cache.

- **`src/auth/seal.ts`:** the frozen envelope (X25519 + HKDF-SHA256 + AES-256-GCM, stdlib only).
  - `seal`, `open`, and `isValidRecipient`, which refuses low-order keys.
  - Known-answer vector: `scripts/tests/fixtures/seal-kat.{py,json}`, from an independent Python
    implementation. Regenerate with `python3 -I scripts/tests/fixtures/seal-kat.py`.
- **Broker (`src/broker.ts`):**
  - Generates a key pair. The private key stays a `KeyObject` in memory, and `setSealTo(public)`.
  - `createEphemeralAuth` (`credentials.ts`) reads only `sealed/<sha256(R)>.json`, opens it, checks
    the 8 h cap, origin and expiry, then runs the account check, and only then adopts.
  - **One token per lifetime:** it never re-reads after adoption. Expiry or a 401 →
    `restart_required` (terminal), and the agent is told to restart, not to log in.
  - Status carries `mode: "ephemeral"`, sealed login commands, and no cached accounts.
- **Handshake:** `{ ok, seal_to }`. `connectBroker` validates the key and calls `setSealTo`, so the
  server's `auth_required` commands carry `-e FASTEDGE_SESSION=ephemeral … --seal-to <key>`. With
  `FASTEDGE_SESSION=ephemeral`, a handshake without a key means `broker_unavailable`.
- **Login (`--seal-to`):**
  - Validates the key before listening.
  - The cap is 8 h, plus the protocol's 5 min of clock skew, at the callback and at `--code`.
  - URL: `ephemeral=1` and no `install=`.
  - Writes only the envelope, takes the lock only (no migration or cleanup), and refuses `--use` and
    `--logout` (exit 2).
- **Entrypoint:** an unknown value, or ephemeral together with a key, → exit 2 (also in the `login`
  branch). The value is passed through both `env -i` allowlists.

## Choice mode (no `FASTEDGE_SESSION`, task 10 v2)

The Approve page's choice (**Keep me signed in on this computer** or **Only for this MCP server
session**) decides each sign-in. The contract is PROTOCOL
§7a in the coordinator.

- **Broker:** always generates a key. Its handshake sends `seal_to` and `forced`, and the server
  refuses a handshake without them. `setSealTo(key, forced)` keeps capability and policy apart.
- **`createAuth(…, { recipient })`:** one credential state and pin for both sources.
  - It checks its sealed file first, and falls back to plaintext only when the file is absent
    (`sealedPresent`).
  - A sealed adoption is sticky.
  - A request waiting on a plaintext account check is re-sent with a sealed token adopted meanwhile
    only for the same account.
  - A late plaintext 401 can't end a sealed session.
- **Login:**
  - `decidePersist()` maps the callback's `persist` against login's own mode.
  - `fe1` = keep, `fe2` = don't keep.
  - Cleanup runs only after a keep delivery.
  - The callback save checks lock ownership (`held()`).
- **Lock:** a 5 s heartbeat and a 30 s stale window, with a takeover check. It is best-effort
  coordination; no security property depends on it.

## Pre-PR review hardening (2026-10-08)

Coordinator `tasks/pr-review.md` lists each change and its commit. What changed for maintainers:
- **Identities:**
  - `HOST_UID`/`HOST_GID` must be canonical decimal (no leading zeros), at most 4294967294, and
    are compared numerically.
  - Keyless, the server exits if it runs as uid/gid 0 or 10002.
- **API base:** `GCORE_API_BASE` must be a bare origin, and request URLs are built from the
  validated origin.
- **No credential read-back:** `LocalAuth` has no `resolve()`; requests go through `call()` only.
  - Tests use `connectBrokerForTest()` and `sealForTest()`.
  - Production `connectBroker()` and `seal()` take no overrides.
- **One sealed-session implementation:** `createEphemeralAuth` is `createAuth(…, { forced: true })`.
- **Session handling:**
  - A saved token that got a 401 is never sent again; status says `rejected` until a new token
    arrives.
  - The echo filter also matches the JSON-escaped token.
  - The legacy `session.json` is read only when no active pointer exists at all.
  - Ids go through `parseId()` (safe integers); stored sessions need their full shape.
- **Login callback:** oversized bodies are refused early, with header and request timeouts and a
  connection cap.
- **Wire types:** broker replies are parsed and typed, and unknown `auth_required` reasons become
  `broker_unavailable`. Failures cross as a short category, never exception text.

`auth_required` reasons:
- `no_session`, `expired`, `origin_mismatch`: offer login.
- `rejected` (a 401 on the session token): offer login, but stop if a fresh login is rejected too.
- `account_mismatch`: offer login, but stop if it repeats.
- `account_changed`: restart the MCP server (no login).
- `broker_unavailable`: restart the MCP server, or set a key (no login).
- `restart_required` (ephemeral only): the adopted token expired or got a 401; restart, then approve (no login).

## Invariants (don't break)

- The token never appears in tool output, logs, argv, the environment of anything but the
  broker, or files outside the cache.
- Nothing but the broker reads the cache in session mode. No fallback, ever.
- Ephemeral mode never reads or writes plaintext session files, and never replaces an adopted token.
- Explicit-key behaviour is unchanged by session work, and starts no broker.
- The broker enforces its own policy: build code bypasses the MCP handlers.
- Never ask users to paste tokens or connect codes into the chat.

## Tests

| Command | Covers |
|---|---|
| `pnpm run test:session-auth` (66) | cache reader, pinning, login callback, `--use`/`--logout`/`--code`, lock, modes, tool mapping, sign-in wording |
| `pnpm run test:broker` (39) | frames, `checkRequest`, broker↔client over a Unix socket, redirects, size cap, the token-echo canary, the account check, broker loss, socket owner |
| `pnpm run test:seal` (10) | envelope: known-answer vector, tampering, wrong recipient, low-order keys, strict base64url |
| `pnpm run test:choice` (19) | choice mode: persist matrix, fe1/fe2, no fallback from a present sealed file, sealed↔plaintext transitions and races (cross-account), sticky mode, lock fencing |
| `pnpm run test:ephemeral` (16) | adoption rules, fail-closed (plaintext cache ignored), terminal 401, 8 h cap, sealed login and `--code`, handshake key |
| `pnpm run test:broker-isolation` | **container release gate** (59 checks: 13 forced-ephemeral, 4 choice mode, 5 id-validation; needs Docker, not in `test`): startup refusals, process identities, the broker env, a hostile build as the server uid, tools through the broker against preprod; ephemeral refusals, a sealed token planted for the live key, no plaintext anywhere, a new key after restart. Runbook: DEVELOPMENT.md |

Run the container gate after any change to the entrypoint, `Dockerfile`, `src/broker.ts`,
`src/auth/broker.ts` or `src/auth/store.ts`.

## Release gate

Don't merge `feat/token-gen` to `main` or push a `v*` tag. `create-release` publishes to public
ghcr **and moves `latest`** for any `v*` tag, and `sync-and-release` builds from `main`.

The gate lifts when `test-broker-isolation.sh` passes on Docker Desktop for macOS and Windows,
rootless Docker, and arm64 (DEVELOPMENT.md → Platform sign-off).

Test images go to a **private** registry only (details in the coordinator's task 09), built from a
clean export with the `package.json` version set to the pre-release version.

## Local testing tips

- The login command the server prints names `ghcr.io/g-core/fastedge-mcp-server:<version>`.
  - For a local or private build, `docker tag` it to that name.
  - Never `docker pull` that tag afterwards, or it reverts.
- **Volumes from the earlier POC** (`10001`, `0644`) make session mode refuse to start, and the
  message only shows in the MCP logs. Running any `login` command (`login --use 1` is enough)
  migrates the volume.
