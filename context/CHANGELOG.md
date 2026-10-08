# FastEdge MCP Server - Changelog

**IMPORTANT**: Do not read this file linearly. Use grep to search for keywords.

**Example searches**:
```bash
grep -i "build-wasm" context/CHANGELOG.md
grep -i "tool" context/CHANGELOG.md
grep -i "fix.*api" context/CHANGELOG.md
grep "## \[2026-" context/CHANGELOG.md
```

See `SEARCH_GUIDE.md` for more search patterns.

---

## [2026-10-08] - `--account`: sign in one specific account

- **Why:** found in a Codex test. Renewing account 5724274 while the portal was on 4732724 silently
  saved 4732724. Approval connects whichever account the portal is signed in to, and the user
  wasn't told which one was meant.
- **Login:** `login … --account <client_id>` puts `&account=` in the link and refuses any other
  account (400; a code → exit 8).
- **Renewals:** for `expired`/`rejected`, the broker reports the session's account. `auth_required`
  names it, tells the agent what to tell the user, and pins both commands.
- **Switches:** the status tool's `login_for_account` handles switching to a known account.
- **Portal:** the page warns and disables Approve on a mismatch (frontend; PROTOCOL §7b).

## [2026-10-08] - logout by account, or everything

- **New forms:**
  - `login --logout <client_id>` removes that account (and the active pointer only if it pointed
    there).
  - `login --logout all` removes every saved session for prod **and** preprod, the legacy file and
    sealed files, keeping the installation id.
- **Output:** each removed account's client id, environment, token id and expiry, and where to
  revoke them. Never a token.
- **Agents:** the status tool now offers `logout_command` and a `sign_out` hint, so "log me out of
  account X / all my accounts" works through the agent.
- **Effect:** a running server sees the logout on its next call. A "don't keep" session lasts
  until its server stops.
- **Tests:** 4 new, in `test:session-auth` (70).

## [2026-10-07] - login callback redirects to the portal's outcome page

- **What changed:** a handled `POST /callback` (approve or deny, in every mode) now answers
  `303 See Other` to `<portal>/fastedge/agent-connect?result=connected|denied` instead of
  serving our own unstyled page. The portal page follows the portal's and resellers' themes.
- **Where it points:** the portal origin comes only from the login's API→portal mapping (never
  from `Origin`, `Referer` or form fields). The URL carries only the result.
- **Ordering:** the state is consumed and the session written before the redirect is sent.
- **Rejections:** still a static 400, never a redirect.
- **Gate:** the release is held, with no switch in code. The portal outcome page must be live in
  preprod and prod before the session release (coordinator PROTOCOL §6).

## [2026-10-07] - "Keep me signed in" per sign-in (task 10 v2)

Users choose on the Approve page instead of in config. `FASTEDGE_SESSION=ephemeral` stays as
the forced policy.
- **The choice:** the broker always has a key, and login commands always carry `--seal-to`.
  - The page (`seal=1`) sends `persist=0|1`: `0` seals to the running server (8 h); `1` saves as
    before.
  - Codes: `fe1` = keep, `fe2` = don't keep.
- **MoM design review:** three gaps made the draft less safe than v1; eight rules closed them:
  - an old reader saving `fe2` as plaintext;
  - a fallback from an unusable sealed file;
  - two credential states.
- **MoM implementation review:**
  - fixed a High: cross-account re-dispatch;
  - fixed the status pin conflict, lock takeover verification, fencing on the callback save, and
    restart-first and cache-only wording.
- **Lock:** accepted as best-effort; no security harm.
- **Tests:** `test:choice` (19), and the gate at 54.

## [2026-10-07] - login lock: heartbeat instead of a 10-minute stale rule

Found in the real-client test: killing the containers (SIGKILL) left `.lock` behind, and every
new login exited 3 for 10 minutes. Agents kill tool processes routinely.
- **The lock:** holds a random owner id and is refreshed every 5 s. One not refreshed for 30 s is
  taken over.
- **Takeover:** by rename, so two contenders can't both win. This fixes the race MoM flagged.
- **Release:** removes the lock only if it's still ours.

## [2026-10-07] - ephemeral session mode (`FASTEDGE_SESSION=ephemeral`)

Coordinator task 10, v1 (forced by config).
- **The mode:** the broker generates an X25519 key at start, and login seals the approved token to
  it (`src/auth/seal.ts`). The volume holds only ciphertext that no one can decrypt once the broker
  exits.
- **The broker:**
  - adopts one sealed token per lifetime, after the `/iam/clients/me` check;
  - never reads the plaintext cache;
  - treats expiry or a 401 as terminal: `restart_required`.
- **Login:** `--seal-to`, an 8 h cap (plus 5 min of skew), `ephemeral=1` and no installation id
  in the URL, and no plaintext writes or migration. `--use` and `--logout` are refused.
- **Entrypoint:** validates the value and refuses it together with a key.
- **Review:** MoM (Codex) found five issues, all fixed in `7c02c82`:
  - a 401 wasn't terminal;
  - low-order recipient keys passed the check;
  - the manual link was missing `ephemeral=1`;
  - ephemeral login with a key wasn't refused;
  - the server accepted a handshake without a key.
- **Deferred:** the stale-lock reclaim race. It predates this work.
- **Tests:** `test:seal` (10, with an independent known-answer vector), `test:ephemeral` (15), and
  13 new gate rows (50 in total).

## [2026-10-07] - entrypoint: reserved-id check before the root fallback; status wording

- **`docker-entrypoint.sh`:** the `HOST_UID`/`HOST_GID` checks (numeric, not 10002) now run before the fallback to 10001. When the workspace looks root-owned (rootless Docker, likely Docker Desktop for Mac), the fallback replaced a requested `HOST_GID=10002` before it was checked, so the refusal was skipped. The server still ran as 10001:10001, so the broker's identity was never shared. Found by the rootless gate run.
- **Status tool:** a new `renew_session` field says a login for the same account needs no restart, and `switch_account` now starts "Only to use a different account". In the Windows test, the agent told the user to restart `/mcp` after any sign-in. `login --use` prints the restart hint only for an MCP server that is running with another account.

## [2026-10-06] - auth_required: sign-in as three choices

After the preprod test, the agent showed two command blocks and then asked a separate question. `auth_required` now asks the agent to offer **1. Browser on this computer (recommended) / 2. Remote (SSH, Codespaces) / 3. Not now**, as a multiple-choice question where the client supports one (Claude Code shows a menu), or as a list otherwise. This folds the permission ask and the method choice into one. It also says that the listener is a one-time local handoff, not OAuth. The manual-fallback text (`session.ts`) now reads as choice 2, and it's also the status tool's `manual_login`. There's a new wording test, and the coordinator's PROTOCOL §4 is updated.

## [2026-10-06] - security: broker confirms the account behind a session token

A cache file only *claims* an account. Anyone who can write the volume could plant a token from another account labelled with yours, and pinning trusted the label.
- **`src/auth/credentials.ts` (session mode, runs in the broker):**
  - **The check:** before a token's first use, the broker calls `GET /iam/clients/me` (`id` is the account ID, per the IAM OpenAPI spec) and requires it to equal the file's `client_id`. Only then does it pin the account.
  - **Repeat checks:** concurrent first calls share one check; renewed or replaced tokens are checked again.
  - **Outcomes:**
    - A mismatch gives the new reason `account_mismatch` (log in again; if it repeats, stop and tell the user), and the token is never used.
    - A 401 gives `rejected`.
    - Anything else (403, 429, 5xx) is an error result, with no login prompt and no fallback.
  - **Status:** gains `account_verified`.
- **Explicit keys** are not checked (S1).
- **Tests:** test:broker now has 39 tests, covering one check per token, shared concurrent checks, mismatch with nothing sent or pinned, 401/403/429/503, a non-numeric id, and a planted replacement after pinning. The fetch stubs answer `/iam/clients/me`. The container gate still passes.

## [2026-10-06] - docs: portal session login and what it protects (session-approval task 09, phase 8)

- **`STANDALONE-SETUP.md`**: a new "Sign In Without an API Key" section. It covers:
  - the keyless config (`-v fastedge-session:/run/fastedge:ro`), the login flow and lifetimes;
  - `--use`, `--logout`, and `--code` (never paste the code into chat);
  - restarting after an account switch; no `--user`; uid 10002 reserved;
  - **What's protected, and what isn't**: build dependencies are protected. Not protected: anything that can run Docker or is root, `ptrace_scope=0` hosts (the server's connection can be used, but the token can't be read), MCP configs you didn't write, and unencrypted disks.
- **`README.md`**: `GCORE_API_KEY` is optional; new `fastedge-auth-status` tool entry.
- **`DEVELOPMENT.md`**:
  - The env table is updated, and the test commands now include `test:session-auth` and `test:broker`.
  - A new section covers the container gate, with a **platform sign-off runbook** (macOS, Windows via WSL 2 including a C: drive workspace, rootless Docker, arm64) and what to send back.
- **`scripts/tests/test-broker-isolation.sh`**: portable to the sign-off platforms.
  - It reads the server's uid/gid from the container, since Docker Desktop uses the 10001 fallback.
  - It uses `gtimeout`, or no timeout, where `timeout` is missing (macOS).
  - `GATE_WS_PARENT` chooses where the workspace goes.

Release gate: only the platform sign-off (phase 7) remains.

## [2026-10-06] - security: token broker (session-approval task 09, phases 3–6 of 8)

**Still not releasable**: the release gate stays closed until the container gate test passes on Docker Desktop (macOS, Windows), rootless Docker and arm64 (phase 7), and the user docs are written (phase 8). Coordinator: `context/session-approval/` PROTOCOL §2a, SECURITY "Release gate".

Session mode now works in a container again, with the session cache readable only by a broker process under its own uid.
- **`docker-entrypoint.sh`**:
  - **Every mode:** `HOST_UID`/`HOST_GID` must be numbers and must not be 10002 (exit 2).
  - **Without a key (session mode):**
    - It must start as root, and `/run/fastedge` must be a real directory that's entirely `10002`, `0700`/`0600`, with no links. Otherwise it exits 2 and says to run login once, and never fixes anything.
    - It starts `build/broker.js` as 10002 with the full `setpriv` drop, `env -i` (`PATH`, `HOME`, `GCORE_API_BASE`) and core dumps off, then waits up to 5 s for a ready FIFO.
    - It then execs the server with the full drop.
  - **The explicit-key path** is otherwise unchanged and starts no broker.
- **`src/broker.ts`**:
  - It checks its own identity (all uids and gids 10002, no capabilities or groups, `no_new_privs`) and listens on `/run/fastedge-broker/sock`.
  - It accepts **one** connection, then closes the listener and unlinks the socket. It exits when that connection ends, and exits if nothing connects within 30 s.
- **`src/auth/broker.ts`**:
  - **Frames:** length-prefixed JSON frames with raw bodies.
  - **`checkRequest`:**
    - fields: a strict field set;
    - methods: a method enum;
    - paths: the path grammar (no dot segments, `%`, `//`, `?`, `#`, `\`), and the URL must keep the fixed origin and the exact pathname;
    - policy: `ALLOWED_OPS` plus `GET /iam/clients/me`;
    - limits on query and body; JSON and octet-stream content types only.
  - **`serveBroker`:** a handshake first, 8 requests in flight, and fixed error strings.
  - **`connectBroker` (server side):**
    - It refuses unless this process is unprivileged and not 10002, and the socket is a socket owned by 10002.
    - It completes the handshake at startup. If anything fails, it never falls back to reading the cache: every API tool returns `auth_required` `broker_unavailable`.
- **`src/auth/credentials.ts`**:
  - `Auth.call()` replaces handing tools a header.
  - Session mode (broker only) uses manual redirects and a 16 MiB response cap.
  - A 401 maps to `rejected`, and any response containing the token is withheld.
  - New reason `broker_unavailable`: restart the MCP server, logging in won't help.
- **`src/server.ts`**: connects to the broker before registering tools.
- **API tools**:
  - `gcore_api`, `batch_execute`, `upload-binary` and `fastedge-auth-status` go through `Auth`.
  - `upload-binary` now uses `callGcoreApi`, so it gets the same origin check and 60 s timeout as the batch upload workflows. It previously had no timeout.
- **`src/api-client.ts`**:
  - `serializeBody` passes `Uint8Array` bodies through.
  - New optional `TransportLimits` (manual redirects, capped responses), used only for session tokens.
- **Tests**:
  - `test:broker`: 34 unit tests (frames, policy, the `Authorization` canary, redirects, size cap, broker loss, socket owner).
  - `test:broker-isolation`: the container gate, 37 checks. It covers startup refusals, the explicit-key path having no broker, the identities of both processes, the broker environment and core limits, a hostile build as the server uid (cache, `/proc`, socket, `su`/`mount`, writing broker code, a filesystem-wide canary search), and tools working through the broker against preprod.
  - Passes on rootful Linux amd64.

## [2026-10-06] - security: broker-only session cache (session-approval task 09, phase 2 of 8)

**Not releasable on its own**: session mode can't work in a container again until the token broker lands (phases 3–5). Explicit-key mode is unaffected. Release gate: coordinator `context/session-approval/` README and SECURITY R1.

Why: `build-wasm` runs third-party build code (`build.rs`, npm scripts) as the MCP server's uid, and the `0644` cache let it read every cached token (R1).
- **`src/auth/store.ts`**: every writer is owner-only. Directories are `0700` (created *and* tightened if they already exist); files, temp files, `.lock` and `installation_id` are `0600`, regardless of the umask. The lock is also released on process exit.
- **`docker-entrypoint.sh` `login …`**: refuses `--user` and a missing `setpriv` (exit 2). As root, it migrates the cache: it refuses symlinks or odd file types (exit 2), then `chown`s everything to `10002:10002` with `0700`/`0600`, which upgrades POC volumes in place. It then execs `login` as **10002** with `--clear-groups --no-new-privs --inh-caps=-all --ambient-caps=-all --bounding-set=-all`, a clean `env -i` (only `PATH`, `HOME`, `TERM`, `GCORE_API_BASE`), and absolute paths.
- **`Dockerfile`**: `/run/fastedge` is now `10002:10002 0700`.
- **`src/login.ts`**: SIGINT and SIGTERM exit normally (node is PID 1 in Docker and would ignore SIGTERM), so an interrupted login no longer leaves `.lock` blocking the next login for 10 minutes.

Verified in containers:
- a legacy `0644`/10001 volume migrated to `10002 0700/0600`;
- a uid-1000 process gets "Permission denied" listing the cache;
- a symlink in the cache and `--user 1000` each exit 2;
- the login process is uid/gid 10002 everywhere, with no groups, zero capability sets and `NoNewPrivs=1`;
- `docker stop` on a waiting login removes `.lock`.

Tests: 65 session tests (mode assertions updated to `0600`; new tests for writer modes and for a signal releasing the lock).

---

## [2026-10-06] - feat: `login --code` for setups where the browser can't reach this machine (session-approval task 08)

In a browser-based Codespace, an SSH session or with a remote Docker host, the portal page can't POST to `127.0.0.1` on the agent's machine. The page's manual mode now shows a **connect code** (`fe1.` + base64url JSON of the callback fields), and the user pastes it here:

`docker run --rm -it -v fastedge-session:/run/fastedge -e GCORE_API_BASE=<origin> <image> login --code`

- **Terminal only:** `-it` makes Docker itself refuse without a terminal, and `login.ts` also exits 2 if stdin isn't a TTY. An agent's shell can't feed it a code.
- **Hidden prompt:** raw mode, no echo, at most 8 KiB. Ctrl-C or Ctrl-D cancels, Backspace works, and bracketed-paste markers are stripped. The code is never read from arguments, environment or a pipe (S18).
- **Same checks as the browser callback:** `validateDelivery()` in `src/auth/login-server.ts` is now shared. That covers origin, token and id formats, and expiry in the future and at most 7 days + 5 minutes ahead.
- **Saved like a browser login:** `connectWithCode()` saves under the lock (account file plus active pointer). It exits 0, or 8 for a bad or expired code; the message never echoes the code.
- **Agent guidance:** `auth_required` now ends with a manual fallback: open `<portal>/fastedge/agent-connect` yourself, approve, and run the `--code` command in your own terminal, and never paste the code into the chat. `fastedge-auth-status` adds `code_command` and `manual_login`.

Tests: 13 new (63 total): a valid code; ten bad codes, each exit 8 with nothing written; a piped stdin exits 2; the fallback text and status fields.

---

## [2026-10-06] - feat: 7-day lifetime cap on session tokens (session-approval task 06)

The Approve page now offers a lifetime: 4 h, 8 h (default), 2 days or 7 days. That's built in `fastedge-frontend`. This server side:
- The login callback rejects an `expires_at` more than 7 days + 5 minutes ahead (`MAX_LIFETIME_MS` in `src/auth/login-server.ts`), so a tampered callback can't plant a longer session than the page allows.
- `auth_required` now says "a time-limited session" instead of "an 8-hour session".

Tests: exactly 7 days is accepted; 7 days + 6 minutes is rejected with 400 and nothing written; the wording (50 total).

---

## [2026-10-06] - feat: one cached session per account, `login --use`, `--logout`, login lock (session-approval task 07)

Switching A → B → A used to create a new token each time, because the volume held one `session.json`.

- **Layout** (`src/auth/store.ts`, new): `accounts/<api host>_<client_id>.json` (same shape as the old `session.json`) plus one `active-<api host>.json` pointer **per API origin**, so prod and preprod sessions don't affect each other.
  - Readers build the account file name themselves from their own origin and the pointer's `client_id`, and refuse a mismatch.
  - All writes are temp + fsync + rename.
  - `store.ts` now holds every volume helper (reads, atomic writes, lock, migration, cleanup, installation id), shared by `credentials.ts` and `login-server.ts`.
- **Migration**: a POC `session.json` is still read while no pointer exists. The first login, `--use` or `--logout` moves it into `accounts/` and removes it.
- **`login --use <client_id>`**: no port, no browser. It points the origin at a cached, unexpired account, or exits 7. A running MCP server stays pinned until restart (S5).
- **`login --logout`**: removes the active account and its pointer (only if the pointer's `generation` is unchanged). It's local only, and prints when the token expires. `login --status` is dropped; `fastedge-auth-status` covers it.
- **Lock**: an `O_EXCL` `.lock` held by login, `--use` and `--logout` (exit 3 if held; stale after 10 minutes). Expired accounts and dangling pointers are removed under it. An unwritable volume now fails with exit 2 at the lock (login could never save a session anyway).
- **`fastedge-auth-status`**: `cached_session` is renamed `active_session`. It adds `cached_accounts` (`client_id`, `expires_at`, `usable`; never tokens) and `use_command`, and `switch_account` prefers `--use`.

Tests: 48 in `test-session-auth.ts` (11 new for task 07, existing ones moved to the new layout).

---

## [2026-10-06] - feat: installation id in the login link (session-approval task 05)

`login` reads or creates `/run/fastedge/installation_id` (32 lowercase hex characters, `0644`) and adds `&install=<id>` to the approval link. The portal uses it to replace this installation's earlier tokens after creating the new one, so repeated logins on one machine don't pile up tokens.
- `ensureInstallationId()` in `src/auth/login-server.ts` writes a temp file and links it into place, so the first writer wins a race. A symlinked or malformed file is replaced.
- If the volume can't be written, login carries on without `install`.
- The temp-file writer is now shared with `writeSession`.
- Tests: 4 new (37 total). Container check: two logins share one id, and the file is `10001:10001 0644`.

---

## [2026-10-06] - feat (POC): recover from a revoked session token, `fastedge-auth-status`, safer login command

Found in the preprod demo: a token deleted in the portal before expiry kept being sent, and the raw `401 Invalid API token` came back as a normal result, so the agent never got a login prompt. Reviewed with Codex (MoM) for Codex CLI support and security.

- **`rejected` reason** (`src/auth/credentials.ts`, `src/tools/api/*`): `Auth.resolve()` now returns `source: "explicit" | "session"` with the header. When a request that used the **session** token gets a **401**, `gcore_api`, `batch_execute` and `upload-binary` return `auth_required (rejected)`, judged by that request's credential and not by re-reading the cache. Explicit keys keep the raw 401 (S1); a 403 is never mapped. `batch_execute` keeps its `completed`/`failed` JSON after the text and says to retry only what did not complete. `upload-binary` throws `UploadError` with the HTTP status, so nothing parses "401" out of a message.
- **`fastedge-auth-status` tool** (`src/tools/api/auth-status.ts`): read-only, no arguments. Returns explicit-key mode, or the session state, cached account, the account this process is pinned to, the login command and how to switch account. `Auth.status()` never pins and never includes the token.
- **Login command** (`src/auth/session.ts`): writes the server's own origin (`-e GCORE_API_BASE=<origin>`). A bare `-e GCORE_API_BASE` copied the agent shell's value, which can differ from the server's. The `package.json` version must match the Docker tag grammar, or the server fails at start. Origins with no portal get no login command. `account_changed` now says to restart (Claude Code `/mcp` reconnect; Codex CLI: exit, then `codex resume --last`).
- `createAuthResolver` → `createAuth` (`{ resolve, status }`). `registerApiTools` takes an optional `auth` for tests.

Tests: `scripts/tests/test-session-auth.ts` now has 33 tests; the tool-level ones drive the real tools over the SDK's in-memory transport with a stubbed `fetch`.

---

## [2026-10-02] - feat (POC): keyless mode, session tokens and the `login` command

Users without `GCORE_API_KEY` can sign in through the portal for an 8-hour session instead of exporting a long-lived key. The contract lives in fastedge-coordinator `context/session-approval/` (`PROTOCOL.md`, `SECURITY.md`); the portal side is `fastedge-frontend` `/fastedge/agent-connect`.

- **Keyless startup** (`src/server.ts`): no key no longer exits; it logs one stderr line. Local tools work unchanged.
- **Credential resolver** (`src/auth/credentials.ts`): `createAuthResolver(key)` is created once in `registerApiTools`. An explicit key always returns `APIKey <key>` and never reads the cache (S1), so the wire request for key users is unchanged. Without one, `/run/fastedge/session.json` is re-read on every API call: `O_NOFOLLOW`, 4 KiB cap, `version: 1`, `api_origin` must equal `GCORE_API_ORIGIN` (now exported from `api-client.ts`), expiry more than 60 s away, and the first accepted `client_id` is pinned per process (`account_changed` otherwise). `gcore_api`, `batch_execute` and `upload-binary` (now takes the header, not the key) return the `auth_required` result (`isError: true`, login command, no token) before any request.
- **`login` subcommand** (`src/login.ts`, `src/auth/login-server.ts`): `docker run --rm -i -p 127.0.0.1:47215:47215 -v fastedge-session:/run/fastedge -e GCORE_API_BASE <image> login`. Binds before printing the portal URL, accepts one valid `POST /callback` (path, Host, `Origin` = `null` or the portal, `state` constant-time, `api_origin`, field formats, 8 KiB body), writes the cache atomically (temp + fsync + rename, `0644`), exits 0 / 5 (timeout) / 6 (denied) / 2 (origin with no portal, e.g. the Orange hosts). Browsers send `Origin: null` on this POST (Q3), so `state` is the real control. Node built-ins only.
- **Image**: `docker-entrypoint.sh` maps `login` to `node build/login.js` (otherwise `exec "$@"` would run the system `/bin/login`). `Dockerfile` creates `/run/fastedge` as `10001:10001 0755`, so a new named volume inherits it and the login container (uid 10001) can write while any MCP UID reads.
- **Not yet** (POC): login lock (exit 3), `login --logout`, `login --status`, README/DEVELOPMENT docs. A port clash fails in Docker itself (exit 125, "address already in use") before the code runs.

Tests: `scripts/tests/test-session-auth.ts` (21, phase-1 gate rows). Verified in containers on Linux Docker: keyless `auth_required`, login → cache → the next `gcore_api` call sends the session token without a restart.

---

## [2026-10-01] - docs: standalone config matches the VS Code extension

`STANDALONE-SETUP.md` and `mcp-standalone.json` showed the old `bash -c "docker run … -e \"GCORE_API_KEY=$GCORE_API_KEY\" …"` form with an inline `your_api_key_here` placeholder (and `HOST_UID=$(id -u)` flags in the doc). They now show the same shape the VS Code extension's "FastEdge (Generate mcp.json)" writes and the portal's agent-onboarding "Other agents" tab shows: `docker` called directly with an argv array (works on Windows, no shell splicing), bare `-e GCORE_API_KEY` forwarded from the client, and `"GCORE_API_KEY": "${env:GCORE_API_KEY}"` so the key is read from the user's environment instead of being written into a file that is often committed. `HOST_UID`/`HOST_GID` moved to the Permissions section as an override only — the entrypoint detects the `/workspace` owner and falls back to 10001 (SA-004). Added an "Other MCP Clients" section (`mcpServers` shape, per-client variable syntax).

---

## [2026-10-01] - security: GCORE_API_BASE allowlist

`GCORE_API_BASE` was read from the environment and only checked to be a valid URL, so any MCP config that sets it (e.g. a cloned repo's `.vscode/mcp.json` running our image) could point every authenticated request — and the operator's `GCORE_API_KEY` — at an arbitrary host. The existing origin guard in `callGcoreApi()` only stopped *paths* escaping the configured base; it trusted the base itself.

**Fix** — `src/api-client.ts`: `ALLOWED_API_ORIGINS` (`https://api.gcore.com`, `https://api.preprod.world`) and `allowedApiOrigin()`. Exact origin match (scheme + host + port, no suffix matching), userinfo rejected. A non-allowlisted base exits at startup, before any request carries the key. The list is deliberately not runtime-configurable: adding a host is an image release. The baked-in base (from `SPEC_BASE_URL` at schema generation) is validated too rather than trusted — an earlier draft auto-allowed it; Codex (MoM) review flagged that a build with any other `SPEC_BASE_URL` would then send the key anywhere. `upload-binary` (`src/tools/api/binaries/api.ts`) uses `GCORE_API_BASE` directly and is covered by the same startup check.

Tests: `allowedApiOrigin` case in `scripts/tests/test-api.ts`. Docs: DEVELOPMENT.md env table, README.

Not covered: a workspace MCP config that swaps the image or command entirely already runs arbitrary code; this closes the "looks like ours" case only.

---

## [2026-08-26] - security: OS command injection via shell:true build/scaffold sinks (ICM-50570)

External report (two confirmed PoCs, commit 30f5967): `normalizePath()` (`src/utils/index.ts`) blocks `..` traversal and absolute/Windows-drive paths but never sanitized shell metacharacters (`;`, `"`, `&`, `|`, `$`, backticks). Its output reached shell-executing sinks unescaped — `scaffold-fastedge-project` (`src/tools/local/scaffolding/scaffolds.ts`) built an `npx` command string for `child_process.exec` (always shell-backed) by interpolating the normalized `outputDir`; `build-wasm`'s JS/TS path (`src/tools/local/workspace/compiler/jsBuild.ts`) called `child_process.spawn(..., { shell: true })`. Either let an attacker-controlled `outputDir`/`entryFile` (from a malicious repo an agent scaffolds/builds, or a direct HTTP/SSE tool call) run arbitrary commands with the operator's `GCORE_API_KEY` in the process env.

**First draft (reverted) added a shell-metacharacter denylist to `normalizePath()` itself.** Codex (MoM) review caught that this was the wrong choke point: `normalizePath()` is also used by non-shell callers (`uploadBinary` in `src/tools/api/binaries/api.ts`, build-directory/tsconfig resolution in `src/tools/local/workspace/compiler/index.ts`), so the denylist rejected legitimate paths like `dist/app(v2).wasm` that never reach a shell. It also missed a third shell sink review didn't originally cover — see below — so patching the normalizer wasn't even sufficient on its own.

**Fix — remove the shell from every affected sink instead of sanitizing input for it**:

- `src/tools/local/scaffolding/scaffolds.ts` — `scaffold-fastedge-project` switched from `exec(command string)` to `execFile("npx", argsArray)`. `outputPath` is now passed as a discrete argv element, never concatenated into shell text.
- `src/tools/local/workspace/compiler/jsBuild.ts` — `spawn` no longer hardcodes `shell: true`.
- `src/tools/local/workspace/compiler/asBuild.ts` — same `spawn("npx", ascArgs, { shell: true })` pattern as `jsBuild.ts`, feeding the same `normalizePath`-derived `entryFilePath`/`outputFilePath`. Missed in the first pass; found by the Codex (MoM) review. Fixed the same way.
- All three: no `shell` option at all — not even conditionally on `win32`. An earlier revision of this fix set `shell: process.platform === "win32"`, to preserve `npx`'s ability to run as a `.cmd` shim on native Windows. GitHub Copilot's PR review (on #43) correctly pointed out that still left a real `cmd.exe` injection surface (`%`, `!`, `^`, and historically CVE-2024-27980) — and per `DEVELOPMENT.md`, this server has no supported native-Windows dev path anyway: both end users and in-house devs run it via Docker (`STANDALONE-SETUP.md`, `build-local.sh`). There's nothing to preserve, so the shell is off unconditionally. Native Windows use of `build-wasm`/`scaffold-fastedge-project` outside Docker is not supported.
- `src/utils/index.ts` — left unchanged (reverted to pre-fix behavior): traversal/absolute-path checks only, no metacharacter denylist.

`src/tools/local/workspace/compiler/rustBuild.ts` spawns `cargo` with `shell: "/bin/bash"` unconditionally, and interpolates a `target` value read from `.cargo/config.toml`/`Cargo.toml` in the cloned project (`rustConfigWasiTarget`) into `--target=${target}`. Flagged by Codex (MoM) review as a structurally similar (untrusted-file-content → shell arg) but distinct issue — not `normalizePath`-derived, and the repo comment says bash is intentional for the container's cargo/rustup shims. Not touched here; needs its own investigation before changing.

**Verified**: full `pnpm run test` suite (78 tests) and reference-index tests still pass; `normalizePath("/workspace", "dist/app(v2).wasm")` now resolves correctly instead of being rejected; the two PoC payloads still can't execute anything at any of the three sinks (no shell at all, on any platform, so they're inert argv/array elements, not shell text).

---

## [2026-08-25] - security: batch_execute policy bypass via resolved paths (ICM-50568)

External report: `batch_execute` ran `checkAllowed` on the **template** path (where `$name.field` is one opaque segment, so `/fastedge/v1/apps/$planted.v` matched `/fastedge/v1/apps/{app_id}`), then dispatched the **resolved** path with no second check. A prior step's data is untrusted (prompt injection, or just an API response containing free text), so `$planted.v = "../../../cdn/resources/123"` produced a request `new URL()` normalized to `/cdn/resources/123` — outside the allowlist, sent with the operator's `GCORE_API_KEY`.

**Fix — three parts**. The invariant: *the pathname the policy validates must equal the pathname `fetch()` requests, on the configured origin.*

- `src/policy/enforce.ts` — new exported `normalizePath()`, used by `matchTemplate` (so `gcore_api` and workflow validation get it too). Canonicalizes to the URL parser's own view rather than string-matching: strips TAB/LF/CR **first** (WHATWG removes them anywhere in the input) and runs every check on the cleaned string, then lets `new URL(cleaned, "http://policy.invalid")` split the query/fragment and collapse `.`/`..`. Returns `null` (→ denial) for: any remaining control char; anything not starting with exactly one `/`; backslashes; `%2e`/`%2f` in the resulting pathname.
- `src/api-client.ts` — choke-point guard in `callGcoreApi`: builds the URL in a try/catch and refuses (status 0 + error) when `url.origin !== new URL(GCORE_API_BASE).origin`, before any `fetch`. Independent of the policy layer, so it covers every caller.
- `src/tools/api/batch-execute.ts` — after `resolveRefs`, re-run `checkAllowed` on the concrete path before dispatch. Denial aborts the batch with the same payload shape as a pre-flight denial — `policy_denied` + a `denied_steps` array (one entry, with `template_path` and `resolved_path` added alongside `path`) + `completed`. Segment-count matching in `matchTemplate` means an injected `/` also fails the re-check, so no separate `/`-rejection is needed.

**Why the extra two parts** — Codex (MoM) review of the first draft found that normalizing alone *introduced* a worse bug and left two divergences:

- `@attacker.example/../fastedge/v1/apps` normalized to the allowed `/fastedge/v1/apps`, but `new URL("https://api.gcore.com" + p)` parses `api.gcore.com` as **userinfo** — the request, with the operator's `GCORE_API_KEY`, would have gone to `attacker.example`. (The pre-fix raw-string match rejected this by accident.)
- `..%<LF>2f..` dodged the `%2f` check because the parser strips LF *after* a regex sees the raw string.
- `/<LF>/attacker.example/x` passed a leading-slash check on the raw input, then cleaned into a protocol-relative `//attacker.example/x`.

Verified by diffing `normalizePath(p)` against `new URL(GCORE_API_BASE + p).pathname` over 29 hostile inputs: zero divergence on anything the policy accepts, and all 194 `ALLOWED_OPS` still reachable with ordinary params (the new strictness denies nothing legitimate).

**Not changed** (reviewed, deliberate): resolved query/body values in a batch are not policy-checked — the allowlist is keyed on method + path, and query values go through `url.searchParams.set()`, so they cannot alter the pathname. `GCORE_API_BASE` with a trailing slash or path prefix concatenates oddly; pre-existing and unrelated.

**Tests** (`scripts/tests/test-api.ts`): the reported chain (step 1 plants the traversal, step 2 interpolates it) denies and never dispatches; authority-manipulating paths; control-char divergences; the origin guard. 78 API tests passing.

---

## [2026-05-11] - fix: gcore_api body serialization (finding #23)

POST/PATCH calls through `gcore_api` consistently failed with the FastEdge gateway returning `400 — request body has an error: ... value must be an object`, even when the body was structurally well-formed JSON. Reproduced 3× during the 2026-05-08 `geo-redirect` live-test run; `batch_execute` succeeded with the identical body shape, confirming the bug was specific to `gcore_api`'s wire path.

**Root cause**: `gcore_api`'s body schema was `z.any().optional().describe("Request body (JSON)")`. The describe text reads to the model as "send a JSON-formatted string," so Claude emitted body as a pre-serialized string (`'{"name":"foo"}'`). `api-client.ts:73` then ran `JSON.stringify(opts.body)`, which JSON-quotes a string, producing an escaped string literal on the wire. The gateway's OpenAPI validator parsed that as a JSON value, got a string where `schemas_app` was expected, and rejected. `batch_execute`'s `z.any()` had no misleading describe text and the model was already in "build the structured calls array" mode, so its body came out as an object naturally.

**Fix — two layers**:

- **L1 (schema, primary)**:
  - `src/tools/api/gcore-api.ts` — body schema is now `z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())])` with describe text that explicitly forbids JSON-encoded strings. Exported as `gcoreApiBodySchema` for unit testing.
  - `src/tools/api/batch-execute.ts` — `batchCallSchema` exported; body stays `z.any()` (binary uploads legitimately use a string body with `content_type: application/octet-stream`), but a `superRefine` rejects string body when `content_type` is missing or `application/json`. The error message points users at the `content_type` escape hatch for binary uploads.
- **L2 (defensive parser, safety net)**: `src/api-client.ts` factored the body-serialization logic into an exported `serializeBody(body, contentType)` helper. For `application/json`, if `body` is a string that parses as JSON, parse-then-re-serialize so the wire body is the object, not a quoted string. If the string isn't valid JSON, pass through verbatim. Non-JSON content types are coerced via `String(body)` as before.

**Tests** (`scripts/tests/test-api.ts`): 14 new tests — `gcoreApiBodySchema` accept/reject matrix, `batchCallSchema` content-type-conditional matrix, `serializeBody` round-trip including the bug-shape normalization and the binary-upload pass-through. Total: 72 API tests, all passing.

**Plugin-side companion**: `fastedge-plugin/.../deploy/SKILL.md` Step 4.2 still recommends `gcore_api` POST/PATCH as primary. That recommendation will be updated once this MCP fix is released — until then the plugin documents `batch_execute` as the workaround. Tracked in `fastedge-coordinator/context/PLUGIN_SKILL_FINDINGS.md` finding #23.

---

## [2026-04-28] - cdn: allow POST /cdn/origin_groups (create only)

Added `{ method: "POST", path: "/cdn/origin_groups" }` to `cdn.allowedPaths` in `src/config/products.ts`. Surgical exception under the otherwise read-only cdn product: agents (notably the upcoming live-test setup flow in the gcore-fastedge plugin) can now provision new origin groups for CDN resources without opening PATCH or DELETE on the same tag.

Rationale: live-test scenarios sometimes need a different origin (e.g. `httpbin.org`) than the one already attached to a developer's preconfigured CDN resource. Origin-group creation is non-destructive — a stray new group is harmless until attached to a resource — so the blast radius is low. Modification (PATCH) and deletion (DELETE) of existing groups remain blocked because they could overwrite or destroy shared infra.

Note: origin groups still take ~15–20 minutes to propagate to edge, so a freshly-created group cannot be exercised within a single live-test run. Use this for "set up next time" provisioning, not the hot iteration loop.

Re-run `pnpm run generate:schemas:prod` (or `:preprod`) to regenerate `src/generated/policy.ts` so the new entry takes effect.

---

## [2026-04-28] - workflows: remove `delete-app-and-binary`

Removed the `delete-app-and-binary` workflow. FastEdge auto-cleans dangling binaries (binaries unattached to any application) every 24 hours, so the binary-DELETE step the workflow performed is redundant. App-only deletion remains expressible via `gcore_api` DELETE `/fastedge/v1/apps/{id}` for the rare hand-cleanup case — no workflow needed.

Files: deleted `src/workflows/fastedge/delete-app-and-binary.ts`; updated `src/workflows/registry.ts` to drop the import and registry entry. No skill callers existed (verified via grep across `fastedge-plugin/`). Tracked in `fastedge-coordinator/context/PLUGIN_SKILL_FINDINGS.md` as part of the live-test validation cleanup discussion.

---

## [2026-04-28] - test-reference-index: fix stale path

`scripts/tests/test-reference-index.sh:15` referenced `build/tools/reference/index.js`, the path before the 2026-04-24 tool reorganization (commit `30f5967`) that moved `src/tools/reference/` → `src/tools/local/reference/`. The script was missed in that rename, so all 4 test cases failed with `ERR_MODULE_NOT_FOUND` at the `import { loadReferenceDocs }` step before `loadReferenceDocs(...)` was ever called. Updated to the new path. Full test suite (`pnpm run test`) now reports 58 API tests + 4 reference-index tests, all passing.

---

## [2026-04-28] - build-wasm: AssemblyScript dispatch

`build-wasm` now handles AssemblyScript projects in addition to Rust and JavaScript. Previously the tool always invoked `npx fastedge-build` for any non-`.rs` file, which 404'd on AS projects (which don't depend on `fastedge-build` — they use `asc` from local devDeps). Surfaced during live-test validation against `proxy-wasm-sdk-as/examples/helloWorld` and tracked as Finding #1 in `fastedge-coordinator/context/PLUGIN_SKILL_FINDINGS.md`.

Detection: `.ts`/`.tsx` extension AND `asconfig.json` present in the resolved build directory → AssemblyScript. TypeScript HTTP apps (which have `package.json` with `fastedge-build` in scripts and no `asconfig.json`) correctly stay on the JS path.

Build invocation: `npx asc <entryFile> --target release [--outFile <outputFile>]`, with `cwd` set to the resolved build directory. The `--outFile` flag is only passed when the caller explicitly supplied `outputFile` — otherwise the tool reads `targets.release.outFile` from `asconfig.json` and returns that path. This honors the project's existing AS configuration as the default and lets explicit overrides work as expected.

Auto-derived `buildDirectory`: when the caller doesn't pass `buildDirectory`, the tool walks upward from `entryFile` looking for the nearest project marker (`asconfig.json`, `Cargo.toml`, or `package.json`) within the workspace root, falling back to the workspace root if none is found. Removes the burden of always specifying the build dir for nested project layouts (e.g. examples in a workspace).

Schema change: dropped the previous `outputFile` default of `/wasm/output.wasm`. The field is now genuinely optional. Required for JS and Rust builds (both fall back to `wasm/output.wasm` inside the workspace at the dispatcher level), optional for AS (resolved from asconfig.json).

Files: `src/tools/local/workspace/compiler/asBuild.ts` (new), `src/tools/local/workspace/compiler/index.ts` (detection + dispatch + auto-derive), `src/tools/local/workspace/build.ts` (schema).

Related: Finding #8 in `PLUGIN_SKILL_FINDINGS.md` tracks the parallel parity work in `FastEdge-vscode/src/compiler/asBuild.ts` (which still hardcodes `assembly/index.ts` and overrides asconfig's outFile) plus a separate Rust target-detection improvement (currently both tools fall back to `wasm32-wasip1` without inspecting Cargo.toml deps).

Operational validation pending: this code change requires a Docker image rebuild (`docker build -t ghcr.io/g-core/fastedge-mcp-server:dev .`) before the next live-test sweep can verify AS builds work end-to-end.

---

## [2026-04-28] - Add live-test workflows + fix CDN writableTags

Added three workflows in `src/workflows/fastedge/` to support an upcoming `live-test` skill in the gcore-fastedge plugin:

- **`enable-app-http`**: PATCH `{"debug": true}` on a FastEdge app so `/apps/{id}/logs` captures traffic. Returns `app.url` and `app.debug_until`. Used before issuing test traffic against an HTTP-type app.
- **`attach-app-to-cdn-rule-create`**: PATCH app debug → POST a new CDN rule wiring the app at a given path. Caller provides a pre-built `options.fastedge` body (which decides hook phases). Used on first deploy.
- **`attach-app-to-cdn-rule-update`**: PATCH app debug → PATCH an existing CDN rule. Used on iterative re-runs (idempotent live-test cycle).

Two workflows for create vs update because workflow steps are linear (no conditionals). The skill orchestrates: list rules on the resource, match by path, pick which workflow to call.

Prerequisite policy fix in `src/config/products.ts`: `writableTags` for the `cdn` product was renamed from `["cdn-rules", "cdn-rule-templates"]` (which matched no upstream OpenAPI tags) to `["Rules", "Rule templates"]` (the actual tag names in the upstream spec). This enables POST/PUT/PATCH on rule + rule-template endpoints. DELETE remains blocked — `writableTags` does not promote destroy per `evaluate.ts:27`. Empirically verified PATCH on existing rules returns 200 after the rename.

Files: `src/workflows/fastedge/{enable-app-http,attach-app-to-cdn-rule-create,attach-app-to-cdn-rule-update}.ts`, `src/workflows/registry.ts`, `src/config/products.ts`.

---

## [2026-04-27] - Add `wasm32-wasip2` Rust target to base image

`Dockerfile-base` now installs both `wasm32-wasip1` and `wasm32-wasip2` via `rustup target add`. Motivation: newer FastEdge-sdk-rust apps using `#[wstd::http_server]` (wasi async HTTP) require the `wasip2` target, which they request through a per-project `.cargo/config.toml` (`[build] target = "wasm32-wasip2"`). The build tool already honors that file via `rustConfigWasiTarget()` in `src/tools/local/workspace/compiler/rustBuild.ts` — only the toolchain image was missing the target. `wasip1` is retained for older FastEdge apps and CDN apps. No source code changes.

Files: `Dockerfile-base`.

---

## [2026-04-27] - Per-product access policy for the API tools

Added a configurable access-control layer over the OpenAPI-derived API tools (`gcore_api`, `batch_execute`, `describe_api`, `workflows_list`). Previously every endpoint across all five products was exposed for full CRUD; now each product declares an access tier in `src/config/products.ts`:

- **Tiers**: `read-only` (GET/HEAD/OPTIONS), `read-write` (+ POST/PUT/PATCH), `read-write-destroy` (+ DELETE).
- **Current policy**: `fastedge: read-write-destroy`; `cdn: read-only` with `writableTags: ["cdn-rules", "cdn-rule-templates"]` plus surgical `allowedPaths` PATCH/PUT on `/cdn/resources/{resource_id}`; `dns: read-only` with surgical `allowedPaths` POST/PUT on `/dns/v2/zones/{zoneName}/{rrsetName}/{rrsetType}` (per-record create/update only — no zone create, no DNSSEC, no bulk import); `waap: read-only`; `storage: read-only`. Default fallback is `read-only` (closed by default).
- **Two enforcement points, one source of truth**: `scripts/generate-schemas.ts` strips disallowed ops at parse time AND emits `src/generated/policy.ts` (184 allowed ops). `src/policy/enforce.ts:checkAllowed` validates every runtime call in `gcore-api.ts` and `batch-execute.ts` against that allowlist. `batch_execute` is **atomic** — if any step is denied, zero steps execute.
- **Workflows are validated at module load**: `src/workflows/registry.ts` calls `validateWorkflows` on import; a workflow whose steps violate the policy crashes the server at startup rather than failing silently per-call.
- **Path-template matcher** (`matchTemplate`): segment-by-segment, `{var}` matches one non-empty segment, querystrings stripped, trailing slashes ignored, segment counts must match (no implicit deeper matches).

Deferred extensions documented in the `ProductConfig` doc-block: `destructiveTags`, `forbiddenPaths`, `allowedMethods`. Add when a real use case appears.

Files: `src/config/products.ts`, `src/policy/{evaluate,enforce}.ts`, `src/workflows/validate.ts`, `src/generated/policy.ts` (auto-generated), `scripts/generate-schemas.ts`, `src/tools/api/{gcore-api,batch-execute}.ts`, `src/workflows/registry.ts`. 36 new unit tests in `scripts/tests/test-api.ts`.

---

## [2026-04-24] - Schema-generation scripts split into `:prod` / `:preprod`

Renamed `generate:schemas` → `generate:schemas:prod` (defaults to `SPEC_BASE_URL=https://api.gcore.com`, caller env still wins) and added `generate:schemas:preprod` (`api.preprod.world`). New `build:preprod` pipes the preprod generator into `build:server`; default `build` now invokes `generate:schemas:prod`, so `pnpm build` works without env setup. Motivation: the old script failed if `SPEC_BASE_URL` was unset, which tripped up fresh clones and the 99% prod workflow. Updated `DEVELOPMENT.md` Schemas + preprod sections and `CLAUDE.md` decision tree / anti-patterns / common-commands table.

---

## [2026-04-24] - Absorbed gcore-api-mcp-server: direct Gcore API integration

### Overview

The four API tools previously proxied to the sibling `gcore-api-mcp-server` (edge-deployed WASM, HTTP transport) now run natively in this server. The embedded MCP client, the proxy hop, and the `GCORE_API_MCP_URL` env var are gone. This removes the edge runtime's 30s request timeout as a ceiling on long `batch_execute` chains, eliminates one network hop, and consolidates build-pipeline + API tools into a single image. `gcore-api-mcp-server` will be archived.

### 🎯 What Was Completed

#### 1. Build pipeline migration
- Ported `scripts/generate-schemas.ts` (OpenAPI → LLM-readable schemas)
- Ported `src/config/products.ts` with `cloud` product removed (no FastEdge crossover) and new optional `timeout_ms?: number` field
- Added `@apidevtools/swagger-parser` devDep
- Added `pnpm run generate:schemas` — manual script, commit-time regeneration (not a prebuild hook)
- Generated prod schemas: **55 groups** across 5 products (fastedge 7 · cdn 17 · dns 10 · waap 14 · storage 7)

#### 2. Runtime migration
- Ported `src/api-client.ts` with Node `fetch`, `AbortController`-based timeout, auth header forwarding + `GCORE_API_KEY` fallback
- Ported `src/workflows/` (types, registry, create-app, update-app-binary, delete-app-and-binary)
- Extracted 4 tool handlers into `src/tools/api/` with injectable `apiCaller` for testability
- Moved `upload-binary` into `src/tools/api/binaries/`, simplified signature (drops `ApiConfig`, uses `GCORE_API_BASE` directly)

#### 3. Tool folder reorganization
- `src/tools/local/` — `reference/`, `scaffolding/`, `workspace/`
- `src/tools/api/` — `gcore-api`, `describe-api`, `workflows-list`, `batch-execute`, `binaries/`
- Dropped `src/tools/fastedge/` entirely (contents absorbed into api/)

#### 4. Timeouts
- `DEFAULT_TIMEOUT_MS = 60_000` per-call, hard default
- Per-product override via `products.ts` `timeout_ms`
- `batch_execute`: total budget = sum of per-step product timeouts; rejects if > `BATCH_TOTAL_CAP_MS` (180_000); aborts remaining steps if wall-clock elapsed exceeds budget
- Uniform timeout error shape: `{ error, timeout: true, path, timeout_ms }`

#### 5. Proxy removal
- Deleted `src/mcp-client.ts`, `src/tools/fastedge/proxied.ts`, `src/tools/fastedge/types.ts`
- Removed `GCORE_API_MCP_URL` and `FASTEDGE_API_URL` env var plumbing from `src/server.ts`
- Server startup simplified: reads only `GCORE_API_KEY` and `WORKSPACE_ROOT`

#### 6. Environment variables
- **Added**: `GCORE_API_BASE` (optional runtime override; lets in-house devs point prod-schemas image at preprod endpoints)
- **Removed**: `GCORE_API_MCP_URL`, `FASTEDGE_API_URL`
- **Kept**: `GCORE_API_KEY` (required), `BATCH_MAX_CALLS` (optional, default 5), `WORKSPACE_ROOT`

#### 7. Tests
- Added `scripts/tests/test-api.ts` with 21 tests (node:test + tsx)
- Covers: `resolveTimeoutMs`, `resolveRefs`/`resolveRefsTyped`, all tool handlers with injected mock apiCaller, batch cap and max-calls rejection, fail-fast on 4xx, local HTTP server integration smoke test
- New `pnpm run test` (test:api + test:reference-index) and `pnpm run test:api` scripts

#### 8. Docs
- Updated `README.md`, `DEVELOPMENT.md`, `STANDALONE-SETUP.md`, `mcp-standalone.json` — removed `GCORE_API_MCP_URL`, added `GCORE_API_BASE`, added preprod build recipe
- New "API Tools" section in README listing the 5 absorbed tools

**Files Created:**
- `src/api-client.ts` — Gcore API HTTP client with timeout layer
- `src/config/products.ts` — product registry
- `src/generated/schemas.ts`, `src/generated/config.ts` — auto-generated
- `src/workflows/{types,registry}.ts` + `src/workflows/fastedge/*.ts`
- `src/tools/api/{gcore-api,describe-api,workflows-list,batch-execute,index}.ts`
- `src/tools/api/binaries/` (moved + adapted)
- `scripts/generate-schemas.ts`
- `scripts/tests/test-api.ts`

**Files Deleted:**
- `src/mcp-client.ts`
- `src/tools/fastedge/proxied.ts`
- `src/tools/fastedge/types.ts`

**Files Moved:**
- `src/tools/reference/` → `src/tools/local/reference/`
- `src/tools/scaffolding/` → `src/tools/local/scaffolding/`
- `src/tools/workspace/` → `src/tools/local/workspace/`
- `src/tools/fastedge/binaries/` → `src/tools/api/binaries/`

### 🧪 Testing

```bash
pnpm run test              # 21 passing tests, ~400ms
pnpm run generate:schemas  # regenerate from SPEC_BASE_URL
```

### 📝 Notes

- **No semver bump** in this server. fastedge-plugin's release CI will drive the next version bump and propagate via `sync-and-release.yml`.
- **`GCORE_API_MCP_URL` removal is a breaking change** for any manual standalone setup that hardcoded it — removed from docs, safe to drop from mcp.json.
- **Cloud product dropped** — not a FastEdge workflow crossover. Re-adding is one entry in `products.ts` + `enabledForGeneration`.
- **Preprod recipe**: either set `GCORE_API_BASE=https://api.preprod.world` at runtime (prod schemas, preprod endpoints — 99% compatible) or rebuild image locally with `SPEC_BASE_URL=https://api.preprod.world pnpm run generate:schemas`.

---

## [2026-02-10] - Dynamic Template List from create-fastedge-app

### Overview
Removed hard-coded template list from MCP server. The `list-fastedge-templates` tool now fetches the latest template information dynamically from `create-fastedge-app --list-templates`.

### What Was Completed

**create-fastedge-app enhancements**:
- Added `--list-templates` flag to output template metadata as JSON
- Returns: template name, description, supported languages, application type
- Updated help text to document the new flag
- Alias: `-l` for `--list-templates`

**MCP Server updates**:
- `list-fastedge-templates` tool now calls `npx create-fastedge-app --list-templates`
- Parses JSON output and formats for display
- Removes hard-coded template descriptions and language lists
- Static validation array kept for Zod schema (safety check)

**Files Modified**:
- `create-fastedge-app/src/create-app/index.ts` - Added --list-templates handler
- `create-fastedge-app/src/create-app/types.ts` - Added ParsedArgs property
- `create-fastedge-app/src/create-app/print-info.ts` - Updated help text
- `FastEdge-mcp-server/src/tools/scaffolding/scaffolds.ts` - Dynamic template fetching
- `FastEdge-mcp-server/src/tools/scaffolding/index.ts` - Added clarifying comment

### Benefits
- **Single source of truth**: Templates defined only in create-fastedge-app
- **Always up-to-date**: MCP server shows latest templates without code changes
- **No sync issues**: Add/remove templates in one place
- **Machine-readable**: JSON output enables programmatic usage

### Usage

**create-fastedge-app**:
```bash
npx create-fastedge-app --list-templates
# Returns JSON array of templates
```

**MCP Server**:
```
list-fastedge-templates  # Fetches from create-fastedge-app
```

### Example Output
```json
[
  {
    "name": "http-base",
    "description": "Simple request/response handling application",
    "languages": ["javascript", "typescript", "rust", "assemblyscript"],
    "applicationType": "http"
  },
  ...
]
```

---

## [2026-02-10] - Complete Removal of Documentation Generation System

### Overview
Completed the refactoring by fully removing the create-docs script and all resource generation logic. The MCP server is now purely focused on build and deployment tools, with documentation provided via skills in generated projects.

### What Was Completed

**Files Removed**:
- `assets/scripts/create-docs.ts` - Documentation generation script
- `src/resources/` - Entire directory (fastedge-core, fastedge-examples, fastedge-sdk-js, dotenv)
- `src/tools/context/` - get-fastedge-context tool
- `.github/get-context7-docs/` - GitHub Action for fetching Context7 docs
- `.github/download-start-kit-release/` - GitHub Action for downloading start-kit resources
- `.github/scripts/download-start-kit-release.cjs` - Start-kit download script
- `src/tools/scaffolding/resources.ts` - Bundled template resources (was .gitignored)

**Files Modified**:
- `package.json` - Removed `create:docs` script, simplified build to just TypeScript compilation
- `src/server.ts` - Removed `registerAllResources` import and call
- `src/tools/index.ts` - Removed `registerContextTools` import and call
- `src/prompts/scaffolding.ts` - Updated to reference skills instead of get-fastedge-context tool
- `src/prompts/deploying.ts` - Removed get-fastedge-context reference, added inline dotenv documentation
- `.github/workflows/create-release.yaml` - Removed "Get Context7 Docs" and "Download Start Kit" steps
- `.gitignore` - Removed reference to src/tools/scaffolding/resources.ts
- `context/PROJECT_OVERVIEW.md` - Updated to reflect new architecture (no resources)
- `claude.md` - Updated project structure and removed resource references

### Impact
- **Cleaner separation of concerns**: MCP server = build + deploy, Skills = documentation
- **No external dependencies**: No Context7 API or GitHub releases dependency
- **Simpler build process**: Just `tsc` compilation, no doc/template download steps
- **Runtime template fetching**: Uses `npx create-fastedge-app` instead of bundled templates
- **Single source of truth**: All FastEdge documentation and templates live in create-fastedge-app
- **Smaller codebase**: Removed ~2000+ lines of generated resource/template code
- **Cleaner releases**: Docker builds no longer download external assets

### Build Changes
```bash
# Old
pnpm run build  # Ran create:docs + tsc

# New
pnpm run build  # Just tsc
```

**MCP Server Tools** (after cleanup):
- Build: `build-wasm`
- Deploy: `upload-binary`, `update-or-create-app`, `update-env-vars-app`, `get-secret-id`
- Scaffold: `list-fastedge-templates`, `scaffold-fastedge-project`
- Tracking: `deployment-comments`

**Documentation Access**:
- Generated projects include `.claude/skills/` with comprehensive FastEdge docs
- Skills include: fastedge-development, fastedge-debugging, fastedge-deployment, fastedge-examples

### Testing
```bash
pnpm run build          # Should succeed with just TypeScript compilation
pnpm run server:dev     # Server should start without resource registration
```

**Verified**:
- ✅ Build compiles successfully
- ✅ No references to removed code in src/
- ✅ Prompts updated to reference skills instead of resources
- ✅ Documentation updated to reflect new architecture

---

## [2026-02-10] - MCP Server Refactoring & Deduplication

### Overview
Removed duplicate template code and context assets. MCP server now delegates to create-fastedge-app CLI for scaffolding, eliminating 1MB+ of duplication.

### What Was Completed

**Scaffold Tool Refactored**:
- File: `src/tools/scaffolding/scaffolds.ts`
- Changed from bundled templates to `npx create-fastedge-app`
- Removed dependency on `FastEdgeTemplates` from resources.ts
- Updated tool descriptions to mention skills

**Files Removed**:
- `src/tools/scaffolding/resources.ts` (1MB+ duplicate template code)
- `assets/context/` directory (content moved to skills)
  - `assets/context/fastedge-core.md` migrated to create-fastedge-app skills

**Files Moved**:
- `assets/context/dotenv.md` → `docs/dotenv.md` (MCP-specific docs preserved)

**Files Modified**:
- `README.md` - Updated dotenv.md path reference
- `src/tools/scaffolding/scaffolds.ts` - Delegates to CLI

### Implementation Details

**New Scaffold Pattern**:
```typescript
// Old: Read from bundled FastEdgeTemplates
const template = FastEdgeTemplates[templateType].find(...)

// New: Delegate to create-fastedge-app CLI
const command = `npx create-fastedge-app "${outputPath}" --template ${template} --language ${language}`;
await execAsync(command);
```

**List Templates Tool**:
- Now returns static list of available templates
- Mentions skills included in generated projects
- No longer depends on bundled resources

### Impact
- **30-40% smaller codebase** (~1MB removed)
- **Single source of truth** - create-fastedge-app owns templates
- **Skills-based context** - No hardcoded documentation
- **Easier maintenance** - Update templates in one place
- **Better discoverability** - Skills load dynamically

**Code Changes**:
- Lines removed: ~1,200 (resources.ts + context assets)
- Files deleted: 2+ (resources.ts, context directory)
- Files modified: 2 (scaffolds.ts, README.md)

### Testing
```bash
# Test scaffold tool (requires MCP server running)
# Use MCP: scaffold-fastedge-project
# Verify: Creates project using create-fastedge-app
# Verify: Generated project includes .claude/skills/
```

**Part of**: FastEdge Ecosystem Refactoring - Phase 2: MCP Server Refactoring

### Notes
- MCP server now requires create-fastedge-app to be available via npx
- Docker container already includes Node.js and npm
- Skills are now the source of truth for FastEdge documentation

---

## Format for New Entries

```markdown
## [YYYY-MM-DD] - Feature/Tool/Fix Name

### Overview
Brief description of what was accomplished

### 🎯 What Was Completed

#### 1. Component/Tool Name
- Detail 1
- Detail 2

**Files Modified:**
- path/to/file.ts - What changed

**Files Created:**
- path/to/file.ts - Purpose

### 🧪 Testing
How to test the changes

### 📝 Notes
Any important context, decisions, or gotchas
```

---

## [2026-02-09] - Initial Context Documentation

### Overview
Created comprehensive context documentation system following discovery-based pattern for the FastEdge MCP Server repository.

### 🎯 What Was Completed

#### 1. Core Documentation Structure
- Created `claude.md` - Top-level agent instructions for MCP server (~400 lines)
- Created `context/CONTEXT_INDEX.md` - Navigation hub with decision tree (~150 lines)
- Created `context/PROJECT_OVERVIEW.md` - Comprehensive MCP server overview (~350 lines)
- Created `context/SEARCH_GUIDE.md` - Search patterns guide (~80 lines)
- Created `context/CHANGELOG.md` - This file (searchable history)

**Files Created:**
- `claude.md` - Top-level instructions
- `context/CONTEXT_INDEX.md` - Documentation navigation
- `context/PROJECT_OVERVIEW.md` - Project overview
- `context/SEARCH_GUIDE.md` - Search patterns
- `context/CHANGELOG.md` - This file

**Directory Structure Created:**
- `context/architecture/` - For architecture docs
- `context/tools/` - For tool-specific docs
- `context/prompts/` - For prompt workflow docs
- `context/resources/` - For resource system docs
- `context/development/` - For development guides

### 📝 Notes

**Documentation Philosophy:**
- Discovery-based: Read only what's needed for current task
- Token-efficient: Prevents reading thousands of unnecessary lines
- Decision-tree driven: Quick lookup for common tasks
- Searchable: Use grep instead of linear reading

**Coverage:**
- Core overview: MCP protocol, server architecture, capabilities
- Project structure and tech stack
- Integration with FastEdge API
- Template system and Magic Comments

**Future Documentation Needed:**

**Architecture**:
- `architecture/MCP_PROTOCOL.md` - MCP basics and protocol details
- `architecture/SERVER_ARCHITECTURE.md` - Server lifecycle and structure
- `architecture/API_CLIENT.md` - FastEdge API client implementation
- `architecture/WORKSPACE_UTILS.md` - File operations and workspace utils

**Tools**:
- `tools/TOOL_DEVELOPMENT.md` - How to create/modify tools
- `tools/BUILD_WASM.md` - build-wasm tool details
- `tools/UPLOAD_BINARY.md` - upload-binary tool
- `tools/DEPLOY_APP.md` - update-or-create-app tool
- `tools/DEPLOY_ENV_VARS.md` - update-env-vars-app tool
- `tools/SCAFFOLDING_SYSTEM.md` - scaffold-fastedge-project tool
- `tools/MAGIC_COMMENTS.md` - deployment-comments tool
- `tools/FASTEDGE_API.md` - FastEdge API tools overview

**Prompts**:
- `prompts/PROMPT_SYSTEM.md` - How prompts work in MCP
- `prompts/CREATE_APP_PROMPT.md` - createFastEdgeApp workflow
- `prompts/DEPLOY_APP_PROMPT.md` - deployFastEdgeApp workflow
- `prompts/ENV_VARS_PROMPT.md` - setEnvironmentVariables workflow

**Resources**:
- `resources/RESOURCE_SYSTEM.md` - How resources work
- `resources/FASTEDGE_CONTEXT.md` - fastedge-context resource details
- `resources/CONTENT_GENERATION.md` - How bundled docs are generated

**Development**:
- `development/IMPLEMENTATION_GUIDE.md` - Coding patterns and conventions
- `development/TESTING_GUIDE.md` - Testing MCP server
- `development/MCP_INSPECTOR.md` - Using MCP inspector for debugging

---

**Note**: Add new entries at the TOP of this file (reverse chronological order)
