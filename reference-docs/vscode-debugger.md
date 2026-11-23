<!--
  auto-updated: true
  sources:
    - id: fastedge-test
      ref: v0.3.1
      commit: ccc68985ba8dcb688c077c04f2a3762ee34f944d
      updated: 2026-11-23
-->

# FastEdge Visual Debugger

The visual debugger is a local server with a browser UI, shipped in `@gcoredev/fastedge-test`.
The FastEdge VSCode extension runs the same debugger, so both routes give the same experience.

---

## Two Ways to Launch

### Option A — VSCode Extension (zero setup)

Install the FastEdge VSCode extension. The extension bundles the debugger server internally — no Node.js installation required.

Use the **`FastEdge: Debug Application`** command from the Command Palette to open the debugger UI.

### Option B — Via npm (any editor, Node.js required)

```bash
# Install
npm install --save-dev @gcoredev/fastedge-test

# Start the visual debugger
npx fastedge-debug
```

If the package is not installed, fetch and run it in one shot:

```bash
npx -p @gcoredev/fastedge-test fastedge-debug
```

> The shorthand `npx @gcoredev/fastedge-test` works because the package declares exactly one `bin` entry. Prefer the explicit `fastedge-debug` form — it stays correct if a second binary is ever added.

Once started, the server listens on the loopback interface (`http://127.0.0.1:5179` by default) and logs the bound address to stderr. In CLI mode it also prints the full browser URL with the session token in the fragment:

```
Open: http://127.0.0.1:5179/#token=<hex>
```

Open that URL directly — the frontend reads the `#token=` fragment and includes it as an `x-fastedge-token` header on every API request. See the API reference for authentication details, including the `x-fastedge-token` header and WebSocket token parameter.

Custom port:
```bash
PORT=8080 npx fastedge-debug
```

Anchor workspace root discovery to a specific starting location by passing a path as the first argument (if the path is a file, its parent directory is used):
```bash
npx fastedge-debug /path/to/my-app
```

The CLI discovers the workspace root by walking up from the current directory to the nearest folder that holds a `.fastedge-debug/` directory, a `package.json`, or a `Cargo.toml` — whichever is nearest. Each marks an app of its own, so a `.fastedge-debug/` in a parent folder does not capture a project below it. If none is found, the starting directory is used. The resolved root becomes `WORKSPACE_PATH`, which is the base for the port file and configuration file placement.

#### `--project-dir <path>` (or `-C <path>`)

For setups where the CLI is invoked from a subdirectory of the project (for example, a Rust app with a `fastedge-test/` Node sandbox holding the debugger install), pass `--project-dir` to anchor workspace discovery at a different path:

```bash
# From inside fastedge-test/, point the debugger at the parent project root
cd fastedge-test
npx fastedge-debug --project-dir ..
```

The flag accepts `--project-dir <path>`, `--project-dir=<path>`, and the short alias `-C <path>` / `-C=<path>`. The resolved path drives `WORKSPACE_PATH` and all config, fixture, and dotenv resolution. The flag is removed from the argument list before any positional arguments are read; when `--project-dir` is given, it takes precedence over a positional start path. Passing the flag without a value exits with code `2`.

When omitted, the positional argument (if any) or `process.cwd()` is used as the starting point.

#### `--allow <dir>` (repeatable)

Lets the debugger read a folder outside the workspace, for example a folder of prebuilt WASM files or a website used as an origin:

```bash
npx fastedge-debug --allow ~/apps/wasm --allow ~/sites/my-site
```

The first time a load reads from an allowed folder, the debugger asks in this terminal whether to allow it for the session (the page shows a notice while it waits, and the request fails after 2 minutes without an answer); without a terminal it refuses. Allowed folders are read-only: saves stay inside the workspace. The flag accepts `--allow <dir>` and `--allow=<dir>`; a folder that does not exist is ignored with a warning.

---

## Dual-Mode Behaviour

`npx @gcoredev/fastedge-test` has two modes:

| Invocation | Mode |
|---|---|
| `npx @gcoredev/fastedge-test` (no args) | Visual debugger UI at `http://127.0.0.1:5179` |
| Import `@gcoredev/fastedge-test/test` + call `runAndExit(defineTestSuite(...))` | Headless test runner — exits with pass/fail |

If the preferred port is already in use, the server auto-increments through up to 50 sequential ports (e.g. `5179` through `5228`). If no free port is found in that range, the server exits with an error. The bound port is written to `.fastedge-debug/.debug-port` and deleted on shutdown.

There is **no CLI argument mode** for running tests. Tests are always run programmatically by importing the test API and calling `runAndExit`. See the test-framework reference for the full test framework API.

---

## Providing Secrets and Environment Variables

Secrets and env vars are **not** fields in `fastedge-config.test.json`. They are injected at runtime from dotenv files.

See the dotenv reference for the full setup — prefix scheme, file options, priority order, and gitignore guidance.

---

## What the UI Shows

The page loads a `.wasm`, sends a request (method, URL, headers, body; only ticked header rows are sent) and shows what happened. Each panel collapses:

- **Dotenv** — load env vars and secrets from `.env` files; off by default
- **Request Context** — client and edge location (the edge dc is also the cache bucket), the origin (CDN apps) and explicit properties (CDN apps)
- **Logging** — filterable by log level (trace, debug, info, warn, error, critical). CDN apps get a tab per hook (`onRequestHeaders`, `onRequestBody`, `onResponseHeaders`, `onResponseBody`), each with Logs (return code and log lines), Storage (cache and Edge KV calls), Inputs (headers, body and properties before the hook ran) and Outputs (what the hook changed). HTTP apps have Logs and Storage only
- **Storage** — the cache and Edge KV as the app sees them, with a pausable clock and a reset
- **Response** — status, content type, body and headers, with a preview for HTML and images

All UI interactions use the same REST and WebSocket endpoints available to API consumers.

---

## Programmatic Usage

The `./server` export is the server bundle. Importing it starts the server automatically, using the `PORT` environment variable or the default port. Set environment variables before the import:

```typescript
process.env.PORT = "5200";

await import("@gcoredev/fastedge-test/server");
```

The module also exports `startServer`:

```typescript
import { startServer } from "@gcoredev/fastedge-test/server";

// Start on the default port (5179)
await startServer();

// Start on a custom port
await startServer(3000);
```

**Signature:**
```typescript
function startServer(port?: number): Promise<void>;
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `port` | `number` | `PORT` env var, or `5179` | Preferred port. A later free port is used if it is busy. |

The returned promise resolves once the server is bound and ready to accept connections. The actual bound port is printed to stderr and written to the port file; it can differ from the requested port when the preferred port is in use.

Because importing the module already starts the server, prefer setting `PORT` before the import when a specific starting port is needed.

---

## Environment Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `PORT` | `number` | `5179` | Preferred port for the HTTP server. See Port Configuration. |
| `PROXY_RUNNER_DEBUG` | `"1"` | unset | Set to `1` to enable verbose debug logging for WebSocket and runner activity. |
| `VSCODE_INTEGRATION` | `"true"` | unset | Set to `true` when running inside the VSCode extension; enables workspace WASM detection. |
| `WORKSPACE_PATH` | `string` | unset | Workspace root; base for `.fastedge-debug/` files and dotenv paths. Set by the CLI. |
| `FASTEDGE_APP_ROOT` | `string` | the workspace root | App root inside the workspace: `.fastedge-debug/` (port file, `app.wasm`, the single-app config), `<workspace>` paths and the default dotenv folder. Set by the VSCode extension; ignored when outside `WORKSPACE_PATH`. |
| `FASTEDGE_RUN_PATH` | `string` | unset | Override the path to the `fastedge-run` binary used to execute WASM modules. |
| `FASTEDGE_BIND_HOST` | `string` | `"127.0.0.1"` | Interface the server binds to. Non-loopback values require explicit opt-in. |

`WORKSPACE_PATH` falls back to the current working directory when unset. The `fastedge-debug` CLI always sets it from the resolved workspace root, overriding any value in the environment; use `--project-dir` to choose the root when running through the CLI. Setting `WORKSPACE_PATH` directly applies when the server is started programmatically.

Session token and host-validation variables (`FASTEDGE_DEBUG_TOKEN`, `FASTEDGE_EXPECTED_HOST`) are documented in the API reference under Authentication.

Usage examples:
```bash
# Enable debug logging
PROXY_RUNNER_DEBUG=1 npx fastedge-debug

# Use a non-default port with debug logging
PORT=8080 PROXY_RUNNER_DEBUG=1 npx fastedge-debug

# Anchor the workspace with --project-dir and override the fastedge-run binary
FASTEDGE_RUN_PATH=/usr/local/bin/fastedge-run \
npx fastedge-debug --project-dir /home/user/myproject
```

---

## Health Check

```
GET /health
```

Returns `200 OK`:
```json
{
  "status": "ok",
  "service": "fastedge-debugger"
}
```

The `service` field is always `"fastedge-debugger"`. The endpoint does not require the session token.

```bash
curl http://127.0.0.1:5179/health
```

---

## Port File

The server writes the bound port to `.fastedge-debug/.debug-port` under the app root (`FASTEDGE_APP_ROOT`, else `WORKSPACE_PATH`, else the current working directory), and deletes the file on shutdown.

The file holds the port, a colon, then a hash used by the VSCode extension. To extract just the port:

```js
import fs from "node:fs";

const port = parseInt(
  fs.readFileSync(".fastedge-debug/.debug-port", "utf8").trim().split(":")[0],
  10,
);
```

Use this file for programmatic port discovery when starting the server as a subprocess.

---

## Port Conflicts

The debugger uses port `5179` by default. If it is already in use, the server auto-increments through up to 50 sequential ports, logging each skipped port to stderr. If no free port is found, the server exits with an error.

Check whether a port is occupied:
```bash
lsof -i :5179
```

`PORT` sets the preferred starting port only; if it is busy, the next ports are still tried. Read the port file or stderr for the port actually bound.

---

## Graceful Shutdown

The server handles `SIGTERM` and `SIGINT`:

1. Logs the received signal.
2. Cleans up the loaded WASM app, or every app of a loaded resource (frees memory, stops `fastedge-run` child processes).
3. Releases the shared storage service connection, so an unused storage service can exit without waiting for its lease to expire.
4. Closes all WebSocket connections.
5. Deletes the `.fastedge-debug/.debug-port` file.
6. Closes the HTTP server.
7. Exits with code `0`.

The `.fastedge-debug/.debug-port` file is also deleted on the Node.js `exit` event, which covers Windows environments where `SIGTERM` is not delivered.

The handlers terminate the host process with `process.exit(0)`, so when the server is imported into another Node.js process, a shutdown signal ends that process as well.

Send `SIGTERM` to trigger shutdown programmatically:

```bash
kill -SIGTERM <pid>
```

Or press `Ctrl+C` in the terminal to send `SIGINT`.

Example: start and stop in a test setup:
```typescript
import { startServer } from "@gcoredev/fastedge-test/server";

// Start server for integration tests
await startServer(5200);

// ... run tests ...

// Send SIGTERM to trigger graceful shutdown
process.kill(process.pid, "SIGTERM");
```

---

## What to Commit / Gitignore

**Commit:**
- `fastedge-config.test.json` — use placeholder values for any sensitive fields
- `.env.example` — document expected variable names so teammates know what to set up locally

**Gitignore:**
```
.env
.env.*
!.env.example
```

---

## See Also

- API reference — REST endpoint reference for loading WASM, sending requests, and managing configuration; includes Authentication details for `x-fastedge-token` and related variables
- WEBSOCKET reference — WebSocket protocol, event types, and real-time state updates
- test-framework reference — Programmatic test framework for writing automated WASM tests
- test-config reference — `fastedge-config.test.json` schema and configuration options
- dotenv reference — environment variable and secrets injection setup
