<!--
  auto-updated: true
  sources:
    - id: fastedge-test
      ref: v0.2.5
      commit: 61497eca6ead033ac810165bc1e20e1d6dd4678f
      updated: 2026-07-23
-->

# Runner Internals — Low-Level Runner API

Low-level programmatic API for executing WASM binaries. Use when you need direct control over runner lifecycle, hook execution, or headless test automation outside the test framework.

---

## Runner Lifecycle

### Creation Sequence

1. Call `createRunner(wasmPath, config?)` or `createRunnerFromBuffer(buffer, config?)`.
2. Factory auto-detects WASM type by inspecting the binary's imports and exports (proxy-wasm ABI vs. wasi-http interface), unless `config.runnerType` overrides detection.
3. Factory allocates the appropriate concrete runner (`ProxyWasmRunner` or `HttpWasmRunner`) and calls `load()` internally.
4. `load()` behavior differs by type — see WASM Instance Management below.
5. The returned `IWasmRunner` is ready for execution immediately.
6. When done, call `cleanup()` to release resources.

### Calling `load()` Again

Calling `load()` on an already-loaded runner replaces the current module and restarts any underlying process. The runner remains usable after re-load.

### Import

```typescript
import {
  createRunner,
  createRunnerFromBuffer,
  ProxyWasmRunner,
  HttpWasmRunner,
  WasmRunnerFactory,
  NullStateManager,
  BUILTIN_URL,
  BUILTIN_SHORTHAND,
} from '@gcoredev/fastedge-test';

import type {
  IWasmRunner,
  WasmType,
  RunnerConfig,
  HttpRequest,
  HttpResponse,
  IStateManager,
  HookResult,
  FullFlowResult,
  HookCall,
} from '@gcoredev/fastedge-test';
```

---

## WASM Instance Management

### ProxyWasmRunner (proxy-wasm)

- **On `load()`**: Compiles the WASM module once and loads dotenv files.
- **Per hook call**: Creates a fresh `WebAssembly.Instance` for each `callHook()` or `callFullFlow()` invocation — provides isolation between executions.
- **On `cleanup()`**: No-op. No long-running processes are held. State resets on the next `load()` call.
- **On `applyDotenv()`**: Resets `SecretStore` and `Dictionary` to empty, then re-reads dotenv files. The compiled WASM module is not recompiled.

### HttpWasmRunner (http-wasm)

- **On `load()`**: Writes the WASM binary to a temp file and spawns a `fastedge-run` process.
- **Between requests**: The `fastedge-run` process is kept alive. Requests are forwarded to it via localhost.
- **On `cleanup()`**: Kills the `fastedge-run` process, releases the allocated port, and deletes the temporary WASM file from disk. Always call `cleanup()` in test teardown.
- **On `applyDotenv()`**: Kills the current `fastedge-run` process and restarts it with the updated `--dotenv` flag.

### Auto-Detection

Both factory functions inspect the WASM binary's imports and exports to determine type. Override with `RunnerConfig.runnerType` if detection is incorrect.

---

## Direct API

### Factory Functions

#### `createRunner`

Creates a fully loaded runner from a file path. Detects the WASM type automatically unless overridden via `config.runnerType`.

```typescript
function createRunner(
  wasmPath: string,
  config?: RunnerConfig
): Promise<IWasmRunner>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `wasmPath` | `string` | Absolute or relative path to the `.wasm` file |
| `config` | `RunnerConfig` | Optional configuration (dotenv, type override) |

**Returns** `Promise<IWasmRunner>` — loaded runner ready for execution.

```typescript
const runner = await createRunner('./my-app.wasm');
await runner.cleanup();
```

#### `createRunnerFromBuffer`

Creates a fully loaded runner from an in-memory `Buffer`. Useful when you have already read the WASM binary (e.g. from a test fixture or download).

```typescript
function createRunnerFromBuffer(
  buffer: Buffer,
  config?: RunnerConfig
): Promise<IWasmRunner>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `buffer` | `Buffer` | WASM binary content |
| `config` | `RunnerConfig` | Optional configuration |

**Returns** `Promise<IWasmRunner>` — loaded runner ready for execution.

```typescript
import { readFile } from 'fs/promises';
const buffer = await readFile('./my-app.wasm');
const runner = await createRunnerFromBuffer(buffer, { runnerType: 'proxy-wasm' });
await runner.cleanup();
```

---

### `IWasmRunner` Interface

```typescript
interface IWasmRunner {
  load(bufferOrPath: Buffer | string, config?: RunnerConfig): Promise<void>;
  execute(request: HttpRequest): Promise<HttpResponse>;
  callHook(hookCall: HookCall): Promise<HookResult>;
  callFullFlow(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string,
    properties: Record<string, unknown>,
    enforceProductionPropertyRules: boolean
  ): Promise<FullFlowResult>;
  applyDotenv(enabled: boolean, path?: string): Promise<void>;
  cleanup(): Promise<void>;
  getType(): WasmType;
  setStateManager(stateManager: IStateManager): void;
}
```

---

#### `load`

Loads a WASM binary into the runner. Calling again replaces the current module and restarts any underlying process.

```typescript
load(bufferOrPath: Buffer | string, config?: RunnerConfig): Promise<void>
```

- **ProxyWasmRunner**: Compiles the module; loads dotenv files.
- **HttpWasmRunner**: Writes binary to temp file; spawns `fastedge-run` process.

**`httpPort` pinning (HTTP-WASM only).** When `config.httpPort` is set, the spawned `fastedge-run` process is bound to that specific port instead of allocating from the dynamic pool (8100–8199). If the port is already in use, `load()` throws:

```
fastedge-run port <N> is not available — release it or choose a different httpPort in fastedge-config.test.json
```

There is no fallback to dynamic allocation. Intended for Codespaces/Docker port-forwarding setups, live-preview URLs, or external tooling that requires a fixed target. For proxy-wasm runners, `httpPort` is ignored.

---

#### `execute` — HTTP-WASM only

Executes an HTTP request through the WASM module. Forwards the request to the locally spawned `fastedge-run` process and returns the response including captured logs.

```typescript
execute(request: HttpRequest): Promise<HttpResponse>
```

`request.path` is a path on the locally spawned `fastedge-run` server, not a full URL.

**Constraint**: Only available on `HttpWasmRunner`. Calling on `ProxyWasmRunner` throws.

**Redirects are not followed.** The underlying fetch uses `redirect: "manual"`, so 3xx responses reach the caller intact — status code and `Location` header — rather than being transparently followed. This matches FastEdge edge behavior, where redirects are returned to the client rather than followed server-side, and lets tests assert on redirect status and `Location`.

To follow a redirect, inspect `response.headers.location` and handle by `Location` shape:

- **Relative Location** (e.g. `/new-path`) — reuse directly as `request.path`.
- **Absolute same-host Location** (e.g. `http://localhost:8100/new-path`) — parse via `new URL()` and re-issue with `pathname + search` as `request.path`.
- **Absolute cross-host Location** (e.g. `https://other.example.com/`) — cannot be followed through the runner; the 3xx response is the terminal state for the test.

```typescript
import { createRunner } from '@gcoredev/fastedge-test';

const runner = await createRunner('./my-http-app.wasm');

// Relative Location: reuse directly as path
let response = await runner.execute({ path: '/moved', method: 'GET', headers: {} });
if (response.status >= 300 && response.status < 400 && response.headers['location']) {
  response = await runner.execute({
    path: response.headers['location'] as string, // e.g. "/new-location"
    method: 'GET',
    headers: {},
  });
}

await runner.cleanup();
```

---

#### `callHook` — Proxy-WASM only

Executes a single proxy-wasm hook in isolation. Creates a fresh WASM instance with the request/response state from `hookCall`, invokes the hook export, and returns the resulting state diff and logs.

```typescript
callHook(hookCall: HookCall): Promise<HookResult>
```

**Valid hook names**: `"onRequestHeaders"`, `"onRequestBody"`, `"onResponseHeaders"`, `"onResponseBody"`

**Constraint**: Only available on `ProxyWasmRunner`. Calling on `HttpWasmRunner` throws.

---

#### `callFullFlow` — Proxy-WASM only

Executes the complete CDN request/response lifecycle: runs all four hooks in sequence with a real HTTP fetch (or built-in responder) between request and response phases. The upstream response is generated at runtime — either by a real HTTP fetch against `url`, or by the built-in responder when `url === "built-in"`. There is no caller-provided mock response.

**Hook execution order**: `onRequestHeaders` → `onRequestBody` → *(real HTTP fetch or built-in responder)* → `onResponseHeaders` → `onResponseBody`

```typescript
callFullFlow(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string,
  properties: Record<string, unknown>,
  enforceProductionPropertyRules: boolean
): Promise<FullFlowResult>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | `string` | Full request URL (e.g. `https://example.com/path`), or `BUILTIN_SHORTHAND` (`"built-in"`) to use the built-in responder instead of a real origin fetch |
| `method` | `string` | HTTP method |
| `headers` | `Record<string, string>` | Request headers |
| `body` | `string` | Request body |
| `properties` | `Record<string, unknown>` | Shared properties passed to all hooks |
| `enforceProductionPropertyRules` | `boolean` | When `true`, restricts property access to match CDN production behavior |

**Local response short-circuit**: If a WASM module calls `proxy_send_local_response` in any hook and returns `StopIteration` (return code `1`), the runner short-circuits immediately. For request-phase hooks (`onRequestHeaders`, `onRequestBody`), this skips the remaining request hooks, the origin fetch, and all response hooks. For response-phase hooks (`onResponseHeaders`, `onResponseBody`), this skips any remaining response hooks. In all cases, `finalResponse` is built from the locally-sent status, headers, and body — matching CDN production behavior. This is how redirect modules (e.g., geo-redirect) and early error responses work.

**Constraint**: Only available on `ProxyWasmRunner`. Calling on `HttpWasmRunner` throws.

---

#### `applyDotenv`

Updates dotenv settings on a loaded runner without reloading the WASM binary.

```typescript
applyDotenv(enabled: boolean, path?: string): Promise<void>
```

- **ProxyWasmRunner**: Resets `SecretStore` and `Dictionary` to empty; re-reads dotenv files from `path` (or current path if omitted). WASM module is not recompiled.
- **HttpWasmRunner**: Kills `fastedge-run` and restarts with updated `--dotenv` flag.

---

#### `cleanup`

Releases all resources held by the runner. Always call in test teardown.

```typescript
cleanup(): Promise<void>
```

- **ProxyWasmRunner**: No-op. State resets on next `load()`.
- **HttpWasmRunner**: Kills `fastedge-run` process, releases the allocated port, deletes the temporary WASM file.

---

#### `getType`

Returns the WASM type this runner handles.

```typescript
getType(): WasmType  // "http-wasm" | "proxy-wasm"
```

---

#### `setStateManager`

Attaches a state manager for lifecycle event emission. Called internally by the server; in headless use, pass `new NullStateManager()` or omit entirely (defaults to no-op behavior).

```typescript
setStateManager(stateManager: IStateManager): void
```

---

### Built-in Responder

When testing proxy-wasm modules without a real origin server, pass `BUILTIN_SHORTHAND` (the string `"built-in"`) as the `url` argument to `callFullFlow`. The runner generates a response locally instead of making a network request.

```typescript
import { createRunner, BUILTIN_SHORTHAND } from '@gcoredev/fastedge-test';

const runner = await createRunner('./my-cdn-app.wasm');
const result = await runner.callFullFlow(
  BUILTIN_SHORTHAND, // no origin fetch
  'GET',
  { 'accept': 'application/json' },
  '',
  {},   // properties
  true, // enforceProductionPropertyRules
);
```

**Built-in responder behavior** — controlled by request headers set before the origin phase:

| Header | Effect |
|--------|--------|
| `x-debugger-status` | HTTP status code for the generated response (default: `200`) |
| `x-debugger-content` | Response body mode: `"body-only"`, `"status-only"`, or full JSON echo (default) |

When `x-debugger-content` is omitted, the built-in responder returns a JSON echo of the request method, headers, body, and URL. Both control headers are stripped before response hooks execute so they do not appear in hook input state.

`BUILTIN_URL` (`"http://fastedge-builtin.debug"`) is the canonical URL the runner substitutes internally when `BUILTIN_SHORTHAND` is passed. It appears in `calculatedProperties` (e.g. `request.host`) and in the JSON echo body.

---

## Type Definitions

### `RunnerConfig`

```typescript
interface RunnerConfig {
  dotenv?: {
    enabled?: boolean;
    path?: string;
  };
  enforceProductionPropertyRules?: boolean;
  runnerType?: WasmType;
  httpPort?: number;
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dotenv.enabled` | `boolean` | `false` | Whether to load `.env` files |
| `dotenv.path` | `string` | `undefined` | Directory to load dotenv files from. When omitted, `fastedge-run` uses the process CWD — correct for most npm package users whose `.env` files live at the project root. Only set when dotenv files are in a non-standard location (e.g. test fixture directories). |
| `enforceProductionPropertyRules` | `boolean` | `true` | Restrict property access to match CDN production behavior |
| `runnerType` | `WasmType` | auto-detected | Override WASM type detection |
| `httpPort` | `number` | `undefined` | HTTP-WASM only. Pin the spawned `fastedge-run` subprocess to a specific port instead of allocating from the dynamic pool (8100–8199). `load()` throws if the port is busy — there is no fallback to dynamic allocation. Intended for Codespaces/Docker port-forwarding or external tooling requiring a fixed address. Ignored for proxy-wasm runners. |

---

### `HttpRequest` and `HttpResponse`

```typescript
interface HttpRequest {
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

interface HttpResponse {
  status: number;
  statusText: string;
  // Node's IncomingHttpHeaders (from "node:http"):
  //   known single-valued headers (content-type, location, etag, …) are typed as string
  //   set-cookie is always string[] when present
  //   unknown headers are string | string[] | undefined
  headers: IncomingHttpHeaders;
  body: string;
  contentType: string | null;
  isBase64?: boolean;
  logs: Array<{ level: number; message: string }>;
}
```

Used exclusively with `execute()` on `HttpWasmRunner`.

`isBase64` is `true` when the response body is binary content (images, audio, video, PDF, ZIP) encoded as base64.

`HttpResponse.logs` contains log entries captured from the `fastedge-run` process stdout/stderr during the request.

**Multi-valued headers.** `Set-Cookie` is preserved as a `string[]` — each `Set-Cookie` header emitted by the WASM app (or an upstream origin) becomes a separate array entry. This matches RFC 6265 §3 and Node's fetch behavior.

```typescript
const response = await runner.execute({ path: '/login', method: 'POST', headers: {} });
const cookies = response.headers['set-cookie']; // string[] | undefined
for (const cookie of cookies ?? []) {
  console.log(cookie);
}
```

Single-valued headers read as plain strings with no narrowing needed:

```typescript
const location = response.headers['location'];        // string | undefined
const contentType = response.headers['content-type']; // string | undefined
```

---

### `HookCall`

```typescript
type HookCall = {
  hook: string;
  request: {
    headers: HeaderRecord;
    body: string;
    method?: string;
    path?: string;
    scheme?: string;
  };
  response?: {
    headers: HeaderRecord;
    body: string;
    status?: number;
    statusText?: string;
  };
  properties: Record<string, unknown>;
  dotenvEnabled?: boolean;
  enforceProductionPropertyRules?: boolean;
};
```

| Field | Description |
|-------|-------------|
| `hook` | Hook name: `"onRequestHeaders"`, `"onRequestBody"`, `"onResponseHeaders"`, `"onResponseBody"` |
| `request` | Request state passed to the hook |
| `response` | Seed state for response hooks called via `callHook()`. Ignored by `callFullFlow()` and by request hooks — the full-flow path generates the upstream response at runtime. Optional. |
| `properties` | Shared properties (e.g. `request.path`, `vm_config`, `plugin_config`) |
| `dotenvEnabled` | Optional per-call dotenv override. Use `applyDotenv()` for persistent changes. |
| `enforceProductionPropertyRules` | Defaults to `true`. Set to `false` to allow property reads blocked on production CDN. |

`HeaderRecord` is `Record<string, string | string[]>` — multi-valued headers (e.g. multiple `Set-Cookie`) are represented as `string[]`.

---

### `HookResult`

```typescript
type HookResult = {
  returnCode: number | null;
  logs: { level: number; message: string }[];
  input: {
    request: { headers: HeaderRecord; body: string };
    response: { headers: HeaderRecord; body: string };
    properties?: Record<string, unknown>;
  };
  output: {
    request: { headers: HeaderRecord; body: string };
    response: { headers: HeaderRecord; body: string };
    properties?: Record<string, unknown>;
  };
  properties: Record<string, unknown>;
};
```

| Field | Description |
|-------|-------------|
| `returnCode` | Numeric value returned by the WASM hook export, or `null` if export not found |
| `logs` | Log entries emitted via `proxy_log` during hook execution |
| `input` | Request/response state as seen by the hook before execution |
| `output` | Request/response state after hook execution (reflects WASM mutations) |
| `properties` | All shared properties after hook execution |

---

### `FullFlowResult`

```typescript
type FullFlowResult = {
  hookResults: Record<string, HookResult>;
  finalResponse: {
    status: number;
    statusText: string;
    headers: HeaderRecord;
    body: string;
    contentType: string;
    isBase64?: boolean;
  };
  calculatedProperties?: Record<string, unknown>;
};
```

| Field | Description |
|-------|-------------|
| `hookResults` | Record keyed by hook name (`"onRequestHeaders"`, `"onRequestBody"`, `"onResponseHeaders"`, `"onResponseBody"`), each containing a `HookResult` |
| `finalResponse` | Final response after all hooks executed, or the local response if a hook short-circuited (see `callFullFlow`). `body` is base64-encoded when `isBase64` is `true`. |
| `calculatedProperties` | Runtime properties computed from the request URL (e.g. `request.path`, `request.host`) |

---

### Supporting Types

```typescript
type WasmType = 'http-wasm' | 'proxy-wasm';

// Single-valued headers only — used as callFullFlow input parameters
type HeaderMap = Record<string, string>;

// Single- or multi-valued headers — used in HookCall, HookResult, and FullFlowResult
type HeaderRecord = Record<string, string | string[]>;

type LogEntry = {
  level: number;
  message: string;
};

enum ProxyStatus {
  Ok          = 0,
  NotFound    = 1,
  BadArgument = 2,
}
```

**Log levels** (proxy-wasm convention): `0` = Trace, `1` = Debug, `2` = Info, `3` = Warn, `4` = Error.

`ProxyStatus` represents return values from proxy-wasm host function calls.

---

## `IStateManager`

Event emission interface used by runners to broadcast lifecycle events. In headless use, pass `new NullStateManager()` (no-op) or omit `setStateManager` entirely.

```typescript
type EventSource = 'ui' | 'ai_agent' | 'api' | 'system';

interface IStateManager {
  emitRequestStarted(
    url: string,
    method: string,
    headers: Record<string, string | string[]>,
    source?: EventSource,
  ): void;

  emitHookExecuted(
    hook: string,
    returnCode: number | null,
    logCount: number,
    input: {
      request: { headers: Record<string, string | string[]>; body: string };
      response: { headers: Record<string, string | string[]>; body: string };
    },
    output: {
      request: { headers: Record<string, string | string[]>; body: string };
      response: { headers: Record<string, string | string[]>; body: string };
    },
    source?: EventSource,
  ): void;

  emitRequestCompleted(
    hookResults: Record<string, unknown>,
    finalResponse: {
      status: number;
      statusText: string;
      headers: Record<string, string | string[]>;
      body: string;
      contentType: string;
      isBase64?: boolean;
    },
    calculatedProperties?: Record<string, unknown>,
    source?: EventSource,
  ): void;

  emitRequestFailed(error: string, details?: string, source?: EventSource): void;

  emitWasmLoaded(filename: string, size: number, source?: EventSource): void;

  emitPropertiesUpdated(
    properties: Record<string, string>,
    source?: EventSource,
  ): void;

  emitHttpWasmRequestCompleted(
    response: {
      status: number;
      statusText: string;
      headers: Record<string, string | string[] | undefined>;
      body: string;
      contentType: string | null;
      isBase64?: boolean;
    },
    source?: EventSource,
  ): void;

  emitHttpWasmLog(log: { level: number; message: string }, source?: EventSource): void;

  emitReloadWorkspaceWasm(path: string, source?: EventSource): void;
}
```

---

## Complete Examples

### Proxy-WASM: Full CDN Lifecycle

```typescript
import { createRunner } from '@gcoredev/fastedge-test';
import type { FullFlowResult, HookResult } from '@gcoredev/fastedge-test';

async function testCdnApp() {
  const runner = await createRunner('./my-cdn-app.wasm', {
    dotenv: { enabled: true },
    enforceProductionPropertyRules: true,
  });

  try {
    const result: FullFlowResult = await runner.callFullFlow(
      'https://example.com/api/data',
      'GET',
      { 'accept': 'application/json' },
      '',
      {
        'request.path': '/api/data',
        'request.host': 'example.com',
      },
      true,
    );

    const requestHeaders: HookResult = result.hookResults['onRequestHeaders'];
    console.log('onRequestHeaders returnCode:', requestHeaders.returnCode);
    console.log('Final status:', result.finalResponse.status);
    console.log('Calculated properties:', result.calculatedProperties);

    // Single hook in isolation
    const hookResult = await runner.callHook({
      hook: 'onRequestHeaders',
      request: {
        headers: { 'x-custom': 'value' },
        body: '',
        method: 'POST',
        path: '/api/submit',
        scheme: 'https',
      },
      response: {
        headers: {},
        body: '',
        status: 200,
        statusText: 'OK',
      },
      properties: { 'request.host': 'example.com' },
      enforceProductionPropertyRules: false,
    });

    console.log('Hook output headers:', hookResult.output.request.headers);
  } finally {
    await runner.cleanup();
  }
}
```

### Proxy-WASM with Built-in Responder

```typescript
import { createRunner, BUILTIN_SHORTHAND } from '@gcoredev/fastedge-test';
import type { FullFlowResult } from '@gcoredev/fastedge-test';

async function testCdnAppOffline() {
  const runner = await createRunner('./my-cdn-app.wasm');

  try {
    const result: FullFlowResult = await runner.callFullFlow(
      BUILTIN_SHORTHAND,
      'GET',
      { 'accept': 'application/json' },
      '',
      {},   // properties
      true, // enforceProductionPropertyRules
    );

    console.log('Final status:', result.finalResponse.status);
    console.log('Final body:', result.finalResponse.body);
  } finally {
    await runner.cleanup();
  }
}
```

### HTTP-WASM: Standard HTTP Application

```typescript
import { createRunner } from '@gcoredev/fastedge-test';
import type { HttpResponse } from '@gcoredev/fastedge-test';

async function testHttpApp() {
  const runner = await createRunner('./my-http-app.wasm', {
    dotenv: { enabled: true },
  });

  try {
    const response: HttpResponse = await runner.execute({
      path: '/api/hello',
      method: 'GET',
      headers: { 'accept': 'application/json', 'x-request-id': 'test-123' },
    });

    console.log('Status:', response.status, response.statusText);
    console.log('Body:', response.body);
    console.log('Logs:', response.logs);

    const postResponse = await runner.execute({
      path: '/api/data',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'test' }),
    });

    console.log('POST status:', postResponse.status);
  } finally {
    await runner.cleanup();
  }
}
```

### Buffer Loading with Type Detection

```typescript
import { createRunnerFromBuffer } from '@gcoredev/fastedge-test';
import { readFile } from 'fs/promises';

async function runFromBuffer() {
  const buffer = await readFile('./app.wasm');
  const runner = await createRunnerFromBuffer(buffer);
  console.log('Detected type:', runner.getType()); // "proxy-wasm" or "http-wasm"
  await runner.cleanup();
}
```

---

## See Also

- test-framework reference — High-level test framework (`defineTestSuite`, `runAndExit`, assertions) built on top of this runner API
- server-api reference — REST endpoints for running tests via HTTP
- vscode-debugger reference — Debugger server and WebSocket protocol
