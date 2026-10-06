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

`auth_required` reasons:
- `no_session`, `expired`, `origin_mismatch`: offer login.
- `rejected` (a 401 on the session token): offer login, but stop if a fresh login is rejected too.
- `account_mismatch`: offer login, but stop if it repeats.
- `account_changed`: restart the MCP server (no login).
- `broker_unavailable`: restart the MCP server, or set a key (no login).

## Invariants (don't break)

- The token never appears in tool output, logs, argv, the environment of anything but the
  broker, or files outside the cache.
- Nothing but the broker reads the cache in session mode. No fallback, ever.
- Explicit-key behaviour is unchanged by session work, and starts no broker.
- The broker enforces its own policy: build code bypasses the MCP handlers.
- Never ask users to paste tokens or connect codes into the chat.

## Tests

| Command | Covers |
|---|---|
| `pnpm run test:session-auth` (66) | cache reader, pinning, login callback, `--use`/`--logout`/`--code`, lock, modes, tool mapping, sign-in wording |
| `pnpm run test:broker` (39) | frames, `checkRequest`, broker↔client over a Unix socket, redirects, size cap, the token-echo canary, the account check, broker loss, socket owner |
| `pnpm run test:broker-isolation` | **container release gate** (37 checks; needs Docker, not in `test`): startup refusals, process identities, the broker env, a hostile build as the server uid, tools through the broker against preprod. Runbook: DEVELOPMENT.md |

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
