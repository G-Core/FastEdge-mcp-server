<!--
  auto-updated: true
  sources:
    - id: fastedge-test
      ref: v0.2.4
      commit: cbb5bebd8bad7e9fee4f1a006a39c8511f951717
      updated: 2026-06-11
-->

# FastEdge Visual Debugger

The visual debugger is an **Express + React server** packaged inside `@gcoredev/fastedge-test`.
The same server is bundled into the FastEdge VSCode extension, so both routes give an identical experience.

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
npx @gcoredev/fastedge-test

# Or using the explicit binary name (preferred):
npx fastedge-debug
```

> The shorthand `npx @gcoredev/fastedge-test` works because the package declares exactly one `bin` entry. Prefer the explicit `fastedge-debug` form — it stays correct if a second binary is ever added.

Opens the debugger UI at `http://localhost:5179`.

Custom port:
```bash
PORT=8080 npx fastedge-debug
```

Anchor workspace root discovery to a specific starting location by passing a path as the first argument:
```bash
npx fastedge-debug /path/to/my-app
```

The CLI automatically discovers the workspace root by walking up from the current directory, looking first for an existing `.fastedge-debug/` directory, then for a `package.json` or `Cargo.toml`. The resolved root is used as the base for port file and configuration file placement.

#### `--project-dir <path>` (or `-C <path>`)

For setups where the CLI is invoked from a subdirectory of the project (for example, a Rust app with a `fastedge-test/` Node sandbox holding the debugger install), pass `--project-dir` to anchor workspace discovery at a different path:

```bash
# From inside fastedge-test/, point the debugger at the parent project root
cd fastedge-test
npx fastedge-debug --project-dir ..
```

The flag accepts both `--project-dir <path>` and `--project-dir=<path>`. `-C` is a short alias. The resolved path drives `WORKSPACE_PATH` and all config / fixture / dotenv resolution. The flag is stripped before any remaining positional arguments are forwarded, so you can combine it with a fixture path:

```bash
npx fastedge-debug --project-dir .. ../fixtures/scenario-1.test.json
```

When omitted, behavior is unchanged — the positional argument or `process.cwd()` is used as the starting point.

Programmatic usage:
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

The returned promise resolves once the server is bound and ready to accept connections.

---

## Dual-Mode Behaviour

`npx @gcoredev/fastedge-test` has two modes:

| Invocation | Mode |
|---|---|
| `npx @gcoredev/fastedge-test` (no args) | Visual debugger UI at `http://localhost:5179` |
| Import `@gcoredev/fastedge-test/test` + call `runAndExit(defineTestSuite(...))` | Headless test runner — exits with pass/fail |

If port `5179` is already in use, the server auto-increments through up to 50 sequential ports (e.g. `5179` through `5228`). If no free port is found in that range, the server exits with an error. The bound port is written to `.fastedge-debug/.debug-port` and deleted on shutdown.

There is **no CLI argument mode** for running tests. Tests are always run programmatically by importing the test API and calling `runAndExit`. See the test-framework reference for the full test framework API.

---

## Providing Secrets and Environment Variables

Secrets and env vars are **not** fields in `fastedge-config.test.json`. They are injected at runtime from dotenv files.

See the dotenv reference for the full setup — prefix scheme, file options, priority order, and gitignore guidance.

---

## What the UI Shows

| Panel | Content |
|---|---|
| Request | Method, URL, headers, body sent to the WASM |
| Response | Status, headers, body returned by the WASM |
| Logs | Streamed log output, filterable by level (trace/debug/info/warn/error/critical) |
| Hook results | **CDN only** — phase callbacks (`onRequestHeaders`, `onRequestBody`, `onResponseHeaders`, `onResponseBody`) |
| Property accesses | **CDN only** — which CDN properties the filter read |

Log verbosity is controlled by `logLevel` in `fastedge-config.test.json`:
`0` = trace (everything), `1` = debug, `2` = info, `3` = warn, `4` = error.

---

## test-config Integration

The debugger auto-loads `fastedge-config.test.json` from the project root on startup — WASM path, request, headers, and CDN properties are pre-filled each session.

Use `/gcore-fastedge:test` to create or update this file. Full schema: see the test-config reference.

---

## Environment Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `PORT` | `number` | `5179` | Port the HTTP server listens on. Defaults to `5179` when not set. |
| `PROXY_RUNNER_DEBUG` | `"1"` | unset | Enable verbose debug logging for WebSocket and runner activity. |
| `VSCODE_INTEGRATION` | `"true"` | unset | Set to `"true"` when running inside the VSCode extension; enables workspace WASM detection. |
| `WORKSPACE_PATH` | `string` | unset | Absolute path to the workspace root; used as the `.env` file base and for port file placement. |
| `FASTEDGE_RUN_PATH` | `string` | unset | Override the path to the `fastedge-run` CLI binary used to execute WASM modules. |

Usage examples:
```bash
# Enable debug logging
PROXY_RUNNER_DEBUG=1 npx fastedge-debug

# Use a non-default port with debug logging
PORT=8080 PROXY_RUNNER_DEBUG=1 npx fastedge-debug

# Point to a workspace and override the fastedge-run binary
WORKSPACE_PATH=/home/user/myproject \
FASTEDGE_RUN_PATH=/usr/local/bin/fastedge-run \
npx fastedge-debug
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

The `service` field is always `"fastedge-debugger"`.

```bash
curl http://localhost:5179/health
```

---

## Port File

When `WORKSPACE_PATH` is set, the server writes the bound port number to `$WORKSPACE_PATH/.fastedge-debug/.debug-port` on startup and deletes it on shutdown. When `WORKSPACE_PATH` is not set, the file is written under the current working directory. Use this file for programmatic port discovery when starting the server as a subprocess.

---

## Port Conflicts

The debugger uses port `5179` by default. If it is already in use, the server auto-increments through up to 50 sequential ports. If no free port is found, the server exits with an error.

Check whether a port is occupied:
```bash
lsof -i :5179
```

Set `PORT` to a specific value to bypass auto-increment when a predictable port is required.

---

## Graceful Shutdown

The server handles `SIGTERM` and `SIGINT`:

1. Logs the received signal.
2. Cleans up the active WASM runner (frees memory, closes child processes).
3. Closes all WebSocket connections.
4. Deletes the `.fastedge-debug/.debug-port` file.
5. Closes the HTTP server.
6. Exits with code `0`.

The `.fastedge-debug/.debug-port` file is also deleted on the Node.js `exit` event, which covers Windows environments where `SIGTERM` is not delivered.

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

- API reference — REST endpoint reference for loading WASM, sending requests, and managing configuration
- WEBSOCKET reference — WebSocket protocol, event types, and real-time state updates
- test-framework reference — Programmatic test framework for writing automated WASM tests
- test-config reference — `fastedge-config.test.json` schema and configuration options
- dotenv reference — environment variable and secrets injection setup
