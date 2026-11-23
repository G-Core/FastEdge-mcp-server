<!--
  auto-updated: true
  sources:
    - id: fastedge-test
      ref: v0.3.1
      commit: ccc68985ba8dcb688c077c04f2a3762ee34f944d
      updated: 2026-11-23
-->

# Runner Internals — Low-Level Runner API

Low-level programmatic API for executing WASM binaries. Use when you need direct control over runner lifecycle, hook execution, or headless test automation outside the test framework.

---

## Runner Lifecycle

### Creation Sequence

1. Call `createRunner(wasmPath, config?)` or `createRunnerFromBuffer(buffer, config?)`.
2. Factory auto-detects WASM type by inspecting the binary's imports and exports (proxy-wasm ABI vs. wasi-http interface), unless `config.runnerType` overrides detection.
3. Factory allocates the appropriate concrete runner (`ProxyWasmRunner` or `HttpWasmRunner`) and calls `load()` internally.
4. Unless `config.stores` is `false`, the runner connects to the local storage service (cache and Edge KV). When `config.stores` is `true` or omitted, the runner holds its own lease on the service until `cleanup()` is called. When `config.stores` is a `TestStores` instance, the runner uses that instance and does not own it, so `cleanup()` does not release it.
5. If `load()` fails, the factory calls `cleanup()` (releasing any lease it owns) and rethrows the error.
6. `load()` behavior differs by type — see WASM Instance Management below.
7. The returned `IWasmRunner` is ready for execution immediately.
8. When done, call `cleanup()` to release resources.

### Calling `load()` Again

Calling `load()` on an already-loaded runner replaces the current module and restarts any underlying process. The runner remains usable after re-load. When `config.client` or `config.edge` is set, `load()` applies them as the runner's request context.

### Import

```typescript
import {
  createRunner,
  createRunnerFromBuffer,
  createResource,
  matchRule,
  createStores,
  ProxyWasmRunner,
  HttpWasmRunner,
  WasmRunnerFactory,
  NullStateManager,
  BUILTIN_URL,
  BUILTIN_SHORTHAND,
  CLIENT_PRESETS,
  EDGE_PRESETS,
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
  LocalResponse,
  StoreCall,
  Resource,
  ResourceRequest,
  ResourceResult,
  CreateResourceOptions,
  CdnHook,
  OriginResponse,
  TestStores,
  CreateStoresOptions,
  StoresSeed,
  ClientContext,
  EdgeContext,
  RequestContext,
  Preset,
} from '@gcoredev/fastedge-test';
```

`HeaderMap`, `HeaderRecord`, `HeaderTuples`, `HookBody`, `LogEntry`, `ProxyStatus`, `Origin`, and `EventSource` are described under Supporting Types and IStateManager. They are not exported from the package root.

`createStores()` builds an isolated in-memory store instance (`TestStores`) that can be passed as `RunnerConfig.stores`. Its options and seed types are `CreateStoresOptions` and `StoresSeed`. See `RunnerConfig` under Type Definitions for how a runner uses the instance.

`CLIENT_PRESETS`, `EDGE_PRESETS`, `ClientContext`, `EdgeContext`, `RequestContext`, and `Preset` describe the simulated client location and edge POP. See Request Context below.

`createResource`, `matchRule`, and the `Resource*` types run several apps on one request. See Resources below.

---

## WASM Instance Management

### ProxyWasmRunner (proxy-wasm)

- **On `load()`**: Compiles the WASM module once and loads dotenv files.
- **Per hook call**: Creates a fresh `WebAssembly.Instance` for each hook it runs, whether through `callHook()` or `callFullFlow()`, so hooks in one full flow do not share memory.
- **On `cleanup()`**: Terminates the runner's worker thread. The runner cannot be loaded again: create a new one.
- **On `applyDotenv()`**: Resets the secret and dictionary stores to empty; re-reads dotenv files. The compiled WASM module is not recompiled. Dictionary keys supplied by the edge request context are kept as defaults beneath the dotenv values.

### HttpWasmRunner (http-wasm)

- **On `load()`**: Writes the WASM binary to a temp file (when given a `Buffer`) or passes the path directly, then spawns a `fastedge-run` process.
- **Between requests**: The `fastedge-run` process is kept alive. Requests are forwarded to it via localhost.
- **On `cleanup()`**: Kills the `fastedge-run` process, releases the allocated port (a pinned `httpPort` is simply freed), and deletes any temporary WASM file written to disk. Always call `cleanup()` in test teardown.
- **On `applyDotenv()`**: Kills the current `fastedge-run` process and restarts it with the updated `--dotenv` flag. The returned promise resolves once the restarted process is listening.

`HttpWasmRunner` also exposes `getPort(): number | null`, which returns the port the `fastedge-run` server listens on (the pinned `httpPort` when set, otherwise the dynamically allocated port). This method is not part of `IWasmRunner`.

### Stores

With stores enabled (the default), the local storage service provides cache and Edge KV host calls. The stores root is the nearest git root, resolved from the app root (`FASTEDGE_APP_ROOT`, else `WORKSPACE_PATH`, else CWD); the `FASTEDGE_STORES_ROOT` environment variable overrides it. Runners with the same `dc` value share cache entries. Set `stores: false` to disable; cache and Edge KV calls from CDN apps then return `InternalFailure`. Pass a `TestStores` instance (from `createStores()`) to use isolated in-memory stores; runners given the same instance share them, and the runner does not own or release the instance.

### Auto-Detection

Both factory functions inspect the WASM binary's imports and exports to determine type. Override with `RunnerConfig.runnerType` if detection is incorrect. Any value other than `"http-wasm"` selects `ProxyWasmRunner`.

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
| `config` | `RunnerConfig` | Optional configuration (dotenv, stores, type override, context) |

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

#### `createResource`

Creates a `Resource`: several apps that handle one request, as on a CDN resource. See Resources below for the full definition.

```typescript
function createResource(
  fileOrObject: string | ResourceConfigInput,
  options?: CreateResourceOptions
): Promise<Resource>
```

#### `matchRule`

Returns the first rule whose `match` regular expression matches the path of `url`, or `null` when no rule matches (main applies).

```typescript
function matchRule(config: ResourceConfig, url: string): ResourceResult["rule"]
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
    enforceProductionPropertyRules: boolean,
    context?: RequestContext,
    origin?: Origin
  ): Promise<FullFlowResult>;
  applyDotenv(enabled: boolean, path?: string): Promise<void>;
  setRequestContext(context: RequestContext): Promise<void>;
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

- **ProxyWasmRunner**: Compiles the module; loads dotenv files. `httpPort` is ignored.
- **HttpWasmRunner**: A `Buffer` is written to a temporary file first; a path string is passed to `fastedge-run` directly. Spawns a `fastedge-run` process.

When `config.client` or `config.edge` is set, `load()` applies them as the runner's request context.

**`httpPort` pinning (HTTP-WASM only).** When `config.httpPort` is set, the spawned `fastedge-run` process is bound to that specific port instead of allocating from the dynamic pool (8100–8199). If the port is already in use, `load()` throws:

```
fastedge-run port <N> is not available — release it or choose a different httpPort in fastedge-config.test.json
```

There is no fallback to dynamic allocation. Intended for Codespaces/Docker port-forwarding setups, stable live-preview URLs, or external tooling that requires a fixed target.

---

#### `execute` — HTTP-WASM only

Executes an HTTP request through the WASM module. Forwards the request to the locally spawned `fastedge-run` process and returns the response including captured logs.

```typescript
execute(request: HttpRequest): Promise<HttpResponse>
```

`request.path` is a path on the locally spawned `fastedge-run` server, not a full URL.

**Constraint**: Only available on `HttpWasmRunner`. Calling on `ProxyWasmRunner` throws.

Requests time out after 30 seconds. Network or timeout failures reject with `HTTP request failed: <reason>`. Calling `execute()` before `load()` rejects with `HttpWasmRunner not loaded. Call load() first.`

If a request context is set (see Request Context), its headers are added to the request; headers in `request.headers` take precedence. A `request.context` applies to that request only and is used instead of the runner's context.

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

Executes a single proxy-wasm hook in isolation. Creates a fresh WASM instance with the request/response state from `hookCall`, invokes the hook export, and returns the resulting state (complete input and output) and logs.

```typescript
callHook(hookCall: HookCall): Promise<HookResult>
```

**Valid hook names**: `"onRequestHeaders"`, `"onRequestBody"`, `"onResponseHeaders"`, `"onResponseBody"`. Any other value throws.

**Constraint**: Only available on `ProxyWasmRunner`. Calling on `HttpWasmRunner` throws.

`hookCall.context` applies a client and edge to that call only; when omitted, the runner's context is used.

```typescript
import { createRunner } from '@gcoredev/fastedge-test';

const runner = await createRunner('./my-cdn-app.wasm');

const result = await runner.callHook({
  hook: 'onRequestHeaders',
  request: { headers: { 'x-custom': 'value' }, body: '', method: 'GET' },
  properties: {},
});
console.log(result.returnCode, result.output.request.headers);

await runner.cleanup();
```

---

#### `callFullFlow` — Proxy-WASM only

Executes the complete CDN request/response lifecycle: runs all four hooks in sequence with a real HTTP fetch (or built-in responder) between request and response phases. The upstream response is generated at runtime — either by a real HTTP fetch against `url`, or by the built-in responder when `url === "built-in"`. There is no caller-provided mock response (unlike `callHook()`, which takes response state in `hookCall`).

**Hook execution order**: `onRequestHeaders` → `onRequestBody` → *(real HTTP fetch or built-in responder)* → `onResponseHeaders` → `onResponseBody`

```typescript
callFullFlow(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string,
  properties: Record<string, unknown>,
  enforceProductionPropertyRules: boolean,
  context?: RequestContext,
  origin?: Origin
): Promise<FullFlowResult>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | `string` | Full request URL (e.g. `https://example.com/path`), or `BUILTIN_SHORTHAND` (`"built-in"`) to use the built-in responder instead of a real origin fetch. `BUILTIN_URL` (`"http://fastedge-builtin.debug"`) is also accepted directly, including with a query string or path. |
| `method` | `string` | HTTP method |
| `headers` | `Record<string, string>` | Request headers |
| `body` | `string` | Request body |
| `properties` | `Record<string, unknown>` | Shared properties passed to all hooks |
| `enforceProductionPropertyRules` | `boolean` | **Deprecated and ignored.** The production property rules always apply. Parameter kept for backward compatibility; will be removed in the next major version. |
| `context?` | `RequestContext` | Client and edge for this flow only |
| `origin?` | `Origin` | Where the response comes from instead of `url`. File paths inside `origin` must already be absolute. The `Origin` type is not exported by name from the package root. |

If a request context is set (see Request Context), its properties and headers are added to the call; the `properties` and `headers` arguments take precedence. When `context` is passed, it is used for this flow instead of the runner's context.

**Outbound request filtering.** The origin fetch and every `proxy_http_call` allow only `http:` and `https:`, and block cloud-metadata and link-local addresses (`169.254.0.0/16`, `100.100.100.200`, `fe80::/10`, `fc00::/7`, and IPv4-mapped forms of these). Every address a hostname resolves to is checked. Loopback and private LAN addresses are allowed, so local mock origins work. A blocked origin fetch ends the flow with `finalResponse.status` `0` and an `Egress blocked: …` message in the body. A blocked callout fails like any failed call: the app receives no response headers, and the logs show `[host] http_call failed … Egress blocked`. HTTP apps are not filtered: `fastedge-run` makes their requests itself.

**Local response short-circuit.** If a WASM module calls `proxy_send_local_response` in any hook and returns `StopIteration` (return code `1`), the runner short-circuits immediately. For request-phase hooks (`onRequestHeaders`, `onRequestBody`), this skips the remaining request hooks, the origin fetch, and all response hooks. For response-phase hooks (`onResponseHeaders`, `onResponseBody`), this skips any remaining response hooks. In all cases, `finalResponse` is built from the locally-sent status, headers, and body — matching CDN production behavior. The hook's `HookResult.localResponse` holds the same response. This is how redirect modules (e.g. geo-redirect) and early error responses work.

**Origin fetch failure.** If the origin fetch throws (DNS failure, connection refused, and similar), `callFullFlow` does not reject. It returns a `FullFlowResult` whose `finalResponse` has `status: 0`, `statusText: "Fetch Failed"`, and an error message in `body`.

**Hook failure.** If a hook traps, the error propagates and `callFullFlow` rejects.

The origin fetch does not follow redirects; a 3xx origin response is passed to the response hooks as-is.

**Constraint**: Only available on `ProxyWasmRunner`. Calling on `HttpWasmRunner` throws.

---

#### `applyDotenv`

Updates dotenv settings on a loaded runner without reloading the WASM binary.

```typescript
applyDotenv(enabled: boolean, path?: string): Promise<void>
```

- **ProxyWasmRunner**: Resets the secret and dictionary stores to empty; re-reads dotenv files from `path` (or the previously set path if omitted) when `enabled` is `true`. WASM module is not recompiled. Dictionary keys supplied by the edge request context are kept as defaults beneath the dotenv values.
- **HttpWasmRunner**: Kills `fastedge-run` and restarts with updated `--dotenv` flag. The returned promise resolves once the restarted process is listening. If no process is running, the settings apply on the next `load()`.

---

#### `setRequestContext`

Changes the simulated client and edge POP of a loaded runner. The new context applies from the next request. A request that names its own context uses that instead. The cache bucket (`dc`) stays as it was when the runner was loaded.

```typescript
setRequestContext(context: RequestContext): Promise<void>
```

Available on both runner types. See Request Context for what each app type receives.

---

#### `cleanup`

Releases all resources held by the runner. Always call in test teardown.

```typescript
cleanup(): Promise<void>
```

- **ProxyWasmRunner**: Terminates the runner's worker thread. The runner cannot be loaded again: create a new one.
- **HttpWasmRunner**: Kills `fastedge-run` process, releases the allocated port (a pinned `httpPort` is simply freed), deletes any temporary WASM file written to disk.
- **Stores lease**: A runner created by `createRunner` or `createRunnerFromBuffer` with stores enabled (`stores` omitted or `true`) releases its lease on the storage service during cleanup. A runner given a `TestStores` instance does not own it and does not release it.

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
  true, // enforceProductionPropertyRules (ignored)
);
await runner.cleanup();
```

**Built-in responder behavior** — controlled by request headers present after the request hooks run:

| Header | Effect |
|--------|--------|
| `x-debugger-status` | HTTP status code for the generated response (default: `200`). A value that is not an integer between 100 and 599 produces status `400`. |
| `x-debugger-content` | Response body mode: `"body-only"`, `"status-only"`, or full JSON echo (default) |

When `x-debugger-content` is omitted, the built-in responder returns a JSON echo of the request method, headers, body, and URL. Both control headers are stripped before response hooks execute so they do not appear in hook input state.

`BUILTIN_URL` (`"http://fastedge-builtin.debug"`) is the canonical URL the runner substitutes internally when `BUILTIN_SHORTHAND` is passed. It appears in `calculatedProperties` (e.g. `request.host`) and in the JSON echo body. It is also accepted directly as the `url` argument, including with a query string or path.

---

## Request Context

A request context describes where the client is and which edge POP runs the app. Set through `RunnerConfig.client` and `RunnerConfig.edge` at load time, or through `setRequestContext()` afterwards. A single request can name its own context with `HttpRequest.context`, `HookCall.context`, or the `context` argument of `callFullFlow()`; that context is used for the request instead of the runner's.

- **`client`** (`ClientContext`): where the client is. Built from a preset (`de`, `nl`, or `us`) plus overrides.
- **`edge`** (`EdgeContext`): which edge POP runs the app. Built from a preset (`de` = `fr5`, `nl` = `am3`, `us` = `sv5`) plus overrides. The POP's `dc` is the cache bucket unless `RunnerConfig.dc` is set.

| App type | Client context supplies | Edge context supplies |
|----------|------------------------|----------------------|
| CDN (proxy-wasm) | `request.*` properties; `GeoIP-*` and `X-Real-IP` | Dictionary keys; `X-ID` header |
| HTTP (http-wasm) | `geoip-*` and `x-real-ip` headers | `dc` and `pop-*` headers |

Values set explicitly always win over the context: properties passed to `callFullFlow()` / `callHook()`, headers on the request, and dictionary keys from dotenv files.

`CLIENT_PRESETS` and `EDGE_PRESETS` are the preset definitions behind the preset names. `ClientContext`, `EdgeContext`, `RequestContext`, and `Preset` are the exported types; their full declarations ship in the package's type definitions.

---

## Resources

A resource runs several apps on one request, as a CDN resource does on the edge. Each CDN hook is assigned to one app. The origin is a URL, the built-in responder, or an HTTP app. Rules select different hooks or a different origin by request path.

```typescript
function createResource(
  fileOrObject: string | ResourceConfigInput,
  options?: CreateResourceOptions
): Promise<Resource>

function matchRule(config: ResourceConfig, url: string): ResourceResult["rule"]
```

`createResource` loads every app with `createRunner`, validates the config, and rejects when:
- a hook, rule, or origin names an app that is not in `apps`
- a rule's `match` is not a valid regular expression
- an app has no `wasm`, or its wasm file does not exist
- a hook is assigned to an HTTP app, or an app origin is a CDN app
- a referenced config is itself a resource (resources cannot be nested)

If loading any app fails, the apps already loaded are cleaned up before the error is rethrown.

Paths inside a config file are relative to that file. Paths inside a config object are relative to the current working directory, or to `options.root`.

### Resource Config

`ResourceConfigInput` is not exported by name. The accepted shape is:

```typescript
type ResourceConfigInput = {
  $schema?: string;
  description?: string;
  apps: Record<string, {
    config?: string;    // Another project's fastedge-config.test.json
    wasm?: string;      // Built wasm, relative to the resource config. Overrides referenced config's.
    dotenv?: { enabled?: boolean; path?: string };
  }>;
  main: {
    hooks?: ResourceHooks;
    origin: ResourceOrigin;
  };
  rules?: Array<{
    name?: string;
    match: string;      // Regular expression tested against the request path
    hooks?: ResourceHooks;
    origin?: ResourceOrigin;
  }>;
  properties?: Record<string, unknown>;
  stores?: boolean;
  dc?: string;
  client?: ClientContext;
  edge?: EdgeContext;
  request?: {
    method?: string;    // default: "GET"
    url: string;
    headers?: Record<string, string>;
    body?: string;
  };
};

type ResourceHooks = {
  [hook in CdnHook]?: string | { app: string; interruptOnError?: boolean };
};

type ResourceOrigin = { url: string } | { builtIn: BuiltInOrigin } | { app: string }; // BuiltInOrigin: see the test config reference

type CdnHook = "onRequestHeaders" | "onRequestBody" | "onResponseHeaders" | "onResponseBody";
```

A hook assigned as a string is the same as `{ app, interruptOnError: true }`. A hook with no app passes the request through unchanged. `stores`, `dc`, `client`, and `edge` behave as in `RunnerConfig` and apply to every app. First-match-wins for rules; a rule's `hooks` replace main's hooks completely, and its `origin` replaces main's origin.

### CreateResourceOptions

```typescript
type CreateResourceOptions = {
  stores?: boolean | TestStores;  // takes precedence over the config's `stores`
  root?: string;  // confines every file the resource reads to this folder
};
```

### Resource Interface

```typescript
interface Resource {
  readonly config: ResourceConfig;
  readonly apps: ReadonlyMap<string, IWasmRunner>;
  request(request?: ResourceRequest): Promise<ResourceResult>;
  cleanup(): Promise<void>;
}

type ResourceRequest = {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  properties?: Record<string, unknown>;
};
```

`request()` rejects with `resource.request: no url (set request.url in the config or pass one)` when neither the call nor the config provides a URL. Omitted `method`, `headers`, and `body` fall back to the config's `request`, then to `"GET"`, `{}`, and `""`. Properties merge in this order (later wins): the context's properties, the config's `properties`, the call's `properties`.

`cleanup()` cleans up every app. Call it in test teardown.

Before each `request()`, the resource checks the modification time of every app's wasm file. An app whose file changed since it was loaded is reloaded before the request runs. A failed reload fails that request; the next request tries again. Concurrent requests do not reload an app twice.

### ResourceResult

```typescript
type ResourceResult = {
  rule: { index: number; name?: string; match: string } | null;
  hooks: Partial<Record<CdnHook, { app: string; result: HookResult }>>;
  origin?: {
    kind: "url" | "built-in" | "app";
    app?: string;
    response: OriginResponse;
    storeCalls?: StoreCall[];
  };
  finalResponse: FullFlowResult["finalResponse"];
};

type OriginResponse = {
  status: number;
  statusText: string;
  headers: HeaderRecord;
  body: string;
  contentType: string;
  isBase64: boolean;
};
```

| Field | Description |
|-------|-------------|
| `rule` | The matching rule's index, `name`, and `match`; `null` when main handled the request |
| `hooks` | One entry per hook that ran, with the app name and its `HookResult` |
| `origin` | Present when the origin answered. `kind` is `"url"` for a fetch, `"built-in"` for the built-in responder, `"app"` for an HTTP app |
| `finalResponse` | Final response after all hooks, or the response a hook sent with `send_http_response` |

### Hook Errors in Resources

When a hook traps, `interruptOnError` decides the outcome:

| `interruptOnError` | Result |
|--------------------|--------|
| `true` (default) | The request ends. `finalResponse.status` is `531` with an empty body |
| `false` | The request continues as if the hook had not run |

In both cases the failed hook's entry in `hooks` has `returnCode: null` and a log entry `"<hook> failed: <reason>"`.

### State Between Hooks in Resources

As on the edge, every app sees the same request:
- Every hook starts with fresh memory, including two hooks that run on the same app.
- Request headers, request body, and properties pass from hook to hook.
- Custom properties set in `onRequestBody` or in a later hook reach later hooks, including hooks on another app.
- Custom properties set in `onRequestHeaders` never reach later hooks.
- Response headers added during the request phase carry into the response phase.
- The client and edge are the resource's (`client` and `edge` in the config) and apply once to the request.

**Difference from the edge**: Every app in a resource can open every fixture KV store. On the edge, an app opens only the stores attached to it.

### Resource Example

```typescript
import { createResource } from '@gcoredev/fastedge-test';

const resource = await createResource({
  apps: {
    auth: { wasm: './auth/build/auth.wasm' },
    rewrite: { wasm: './rewrite/build/rewrite.wasm' },
    api: { wasm: './api/build/api.wasm' },
  },
  main: {
    hooks: {
      onRequestHeaders: 'auth',
      onResponseHeaders: { app: 'rewrite', interruptOnError: false },
    },
    origin: { url: 'built-in' },
  },
  rules: [
    {
      name: 'api',
      match: '^/api/',
      origin: { app: 'api' },
    },
  ],
  request: { url: 'http://example.com/', method: 'GET' },
});

try {
  const result = await resource.request({ url: 'http://example.com/api/users' });
  console.log(result.rule?.name);                    // "api"
  console.log(result.origin?.kind);                  // "app"
  console.log(result.hooks.onRequestHeaders?.app);   // "auth"
  console.log(result.finalResponse.status);
} finally {
  await resource.cleanup();
}
```

---

## Type Definitions

### `RunnerConfig`

```typescript
interface RunnerConfig {
  dotenv?: {
    enabled?: boolean;
    path?: string;
  };
  /** @deprecated Ignored: the production property rules always apply. Will be removed in the next major version. */
  enforceProductionPropertyRules?: boolean;
  runnerType?: WasmType;
  httpPort?: number;
  stores?: boolean | TestStores;
  dc?: string;
  client?: ClientContext;
  edge?: EdgeContext;
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dotenv.enabled` | `boolean` | `false` | Whether to load `.env` files |
| `dotenv.path` | `string` | `undefined` | Directory to load dotenv files from. When omitted, `fastedge-run` uses the process CWD. Only set when dotenv files are in a non-standard location. |
| `enforceProductionPropertyRules` | `boolean` | `undefined` | Deprecated and ignored. The production property rules always apply. Will be removed in the next major version. |
| `runnerType` | `WasmType` | auto-detected | Override WASM type detection. Any value other than `"http-wasm"` selects `ProxyWasmRunner`. |
| `httpPort` | `number` | `undefined` | HTTP-WASM only. Pin the spawned `fastedge-run` subprocess to a specific port instead of allocating from the dynamic pool (8100–8199). `load()` throws if the port is busy. Ignored for proxy-wasm runners. |
| `stores` | `boolean \| TestStores` | `true` | Storage service for cache and Edge KV. `false` = disabled (CDN apps' cache/KV calls return `InternalFailure`). A `TestStores` instance = isolated in-memory stores. |
| `dc` | `string` | `"local"` | Cache bucket. Runners with the same `dc` share cache entries. When omitted, falls back to the `dc` of `edge` if set, then the `dc` of the supplied `TestStores`, then `"local"`. |
| `client` | `ClientContext` | `undefined` | Where the client is (preset `de`/`nl`/`us` plus overrides). CDN apps get `request.*` properties and `GeoIP-*`/`X-Real-IP` headers; HTTP apps get `geoip-*`/`x-real-ip` headers. |
| `edge` | `EdgeContext` | `undefined` | Which edge POP runs the app (preset `de` = `fr5`, `nl` = `am3`, `us` = `sv5`, plus overrides). Sets default `dc`. CDN apps get dictionary keys and `X-ID`; HTTP apps get `dc`/`pop-*` headers. |

---

### `HttpRequest` and `HttpResponse`

```typescript
import type { IncomingHttpHeaders } from 'node:http';

interface HttpRequest {
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  /** Client and edge for this request only; default: the runner's (setRequestContext). */
  context?: RequestContext;
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
  /**
   * The cache / Edge KV calls the app made for this request, in order (stores on only).
   * Needs a fastedge-run that forwards to the storage service.
   */
  storeCalls?: StoreCall[];
}
```

Used exclusively with `execute()` on `HttpWasmRunner`.

`isBase64` is `true` when the response body is binary content (images, audio, video, PDF, ZIP, gzip, `application/octet-stream`) encoded as base64.

`HttpResponse.logs` contains log entries captured from the `fastedge-run` process stdout/stderr during the request.

`HttpResponse.storeCalls` is present only when the runner has stores enabled and the installed `fastedge-run` forwards storage calls to the storage service.

**Multi-valued headers.** `Set-Cookie` is preserved as a `string[]` — each `Set-Cookie` header emitted by the WASM app (or an upstream origin) becomes a separate array entry. This matches RFC 6265 §3.

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
  /** Client and edge for this call only; default: the runner's. */
  context?: RequestContext;
  request: {
    headers: HeaderRecord;
    body: string;
    /** `body` is base64 of raw bytes (a body that is not text, e.g. an image). */
    isBase64?: boolean;
    method?: string;
    path?: string;
    scheme?: string;
  };
  response?: {
    headers: HeaderRecord;
    body: string;
    /** `body` is base64 of raw bytes. */
    isBase64?: boolean;
    status?: number;
    statusText?: string;
  };
  properties: Record<string, unknown>;
  /** @deprecated Ignored: the production property rules always apply. Will be removed in the next major version. */
  enforceProductionPropertyRules?: boolean;
  /**
   * Custom properties an earlier hook of this request wrote (and later hooks may read),
   * when the hooks run on different apps.
   */
  customProperties?: string[];
  /**
   * Set when this call is one hook of a flow driven from outside the runner (a resource):
   * the request id shared by the flow's hooks.
   */
  requestId?: string;
};
```

| Field | Description |
|-------|-------------|
| `hook` | Hook name: `"onRequestHeaders"`, `"onRequestBody"`, `"onResponseHeaders"`, `"onResponseBody"` |
| `context` | Client and edge for this call only |
| `request` | Request state passed to the hook |
| `request.isBase64` | Set to `true` when `body` is base64 of raw bytes rather than text |
| `response` | Seed state for response hooks called via `callHook()`. Not consumed by `callFullFlow()` or by request hooks. |
| `response.isBase64` | Set to `true` when `body` is base64 of raw bytes |
| `properties` | Shared properties (e.g. `request.path`, `vm_config`, `plugin_config`) |
| `enforceProductionPropertyRules` | Deprecated and ignored. Will be removed in the next major version. |
| `customProperties` | Names of custom properties written by earlier hooks of the request, for cross-app flows |
| `requestId` | Request id shared by the hooks of a flow driven from outside the runner (set by Resources) |

`HeaderRecord` is `Record<string, string | string[]>` — multi-valued headers (e.g. multiple `Set-Cookie`) are represented as `string[]`.

`customProperties` and `requestId` are set by Resources when hooks of one request run on different apps. Calls made directly with `callHook()` do not need them.

---

### `HookResult`

```typescript
/** Headers and body of the request or response; `isBase64`: the body is base64 of raw bytes. */
type HookBody = { headers: HeaderRecord; body: string; isBase64?: boolean };

type HookResult = {
  returnCode: number | null;
  logs: { level: number; message: string }[];
  input: {
    request: HookBody;
    response: HookBody;
    properties?: Record<string, unknown>;
  };
  output: {
    request: HookBody;
    response: HookBody;
    properties?: Record<string, unknown>;
  };
  properties: Record<string, unknown>;
  /** The cache / Edge KV calls this hook made, in order (stores on only). */
  storeCalls?: StoreCall[];
  /** Set when the hook answered with send_http_response. */
  localResponse?: LocalResponse;
  /** Custom properties later hooks of this request may read (see HookCall.customProperties). */
  customProperties?: string[];
};
```

| Field | Description |
|-------|-------------|
| `returnCode` | Numeric value returned by the WASM hook export, or `null` if export not found |
| `logs` | Log entries emitted via `proxy_log` during hook execution |
| `input` | Request/response state as seen by the hook before execution |
| `output` | Request/response state after hook execution (reflects WASM mutations) |
| `properties` | All shared properties after hook execution |
| `storeCalls` | Cache and Edge KV calls made by the hook, in order. Present only when runner has stores enabled. |
| `localResponse` | The response the hook sent with `send_http_response`, if any |
| `customProperties` | Custom properties later hooks of the request may read |

`HookBody.isBase64` is `true` when the body is base64 — set when the call's body was base64, or when the bytes a hook wrote are not valid UTF-8 text.

---

### `LocalResponse`

```typescript
/** A response a hook sent with send_http_response. */
type LocalResponse = {
  statusCode: number;
  statusText: string;
  /** The additional headers passed as send_http_response's 4th argument. */
  headers: HeaderTuples;
  bodyBase64: string;
};
```

`bodyBase64` is the response body encoded as base64. `HeaderTuples` is `[string, string][]`.

---

### `StoreCall`

```typescript
type StoreCall = {
  app: "cdn" | "http";
  hook?: string;
  kind: "cache" | "kv";
  op: string;
  dc?: string;    // Cache bucket (cache calls)
  store?: string; // Edge KV store (KV calls)
  key?: string;
  pattern?: string;
  prefix?: string;
  result: string; // "ok", or the service's error (e.g. "wrong-type", "invalid-pattern")
  value?: string; // The result value: a count, a flag, or the size of a value or list
  at: number;     // Wall-clock time (ms since epoch)
};
```

Values are not recorded, only their size.

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
| `hookResults` | Record keyed by hook name (`"onRequestHeaders"`, `"onRequestBody"`, `"onResponseHeaders"`, `"onResponseBody"`), each containing a `HookResult`. Hooks that did not run are absent. |
| `finalResponse` | Final response after all hooks executed, or the local response if a hook short-circuited. `body` is base64-encoded when `isBase64` is `true`. |
| `calculatedProperties` | Runtime properties computed from the request URL (e.g. `request.path`, `request.host`) |

---

### Supporting Types

```typescript
type WasmType = 'http-wasm' | 'proxy-wasm';

// Single-valued headers only — used as callFullFlow input parameters
type HeaderMap = Record<string, string>;

// Wire/projection format for hook and full-flow results.
// Single-valued headers are a string; multi-valued (e.g. set-cookie) are a string[].
type HeaderRecord = Record<string, string | string[]>;

// Header tuples — used in LocalResponse
type HeaderTuples = [string, string][];

type LogEntry = {
  level: number;
  message: string;
};

enum ProxyStatus {
  Ok            = 0,
  NotFound      = 1,
  BadArgument   = 2,
  InternalFailure = 10,
  Unimplemented = 12,
}
```

Only `WasmType` is exported from the package root. `HeaderRecord` and `HeaderTuples` appear in the exported `HookCall`, `HookResult`, `LocalResponse`, and `FullFlowResult` types. `HeaderMap`, `LogEntry`, and `ProxyStatus` are not exported from the package root.

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
      true, // enforceProductionPropertyRules (ignored)
    );

    const requestHeaders: HookResult = result.hookResults['onRequestHeaders'];
    console.log('onRequestHeaders returnCode:', requestHeaders.returnCode);
    console.log('Store calls:', requestHeaders.storeCalls);
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
    });

    console.log('Hook output headers:', hookResult.output.request.headers);
    console.log('Local response:', hookResult.localResponse);
  } finally {
    await runner.cleanup();
  }
}

testCdnApp();
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
      true, // enforceProductionPropertyRules (ignored)
    );

    console.log('Final status:', result.finalResponse.status);
    console.log('Final body:', result.finalResponse.body);
  } finally {
    await runner.cleanup();
  }
}

testCdnAppOffline();
```

### HTTP-WASM: Standard HTTP Application

```typescript
import { createRunner } from '@gcoredev/fastedge-test';
import type { HttpResponse } from '@gcoredev/fastedge-test';

async function testHttpApp() {
  const runner = await createRunner('./my-http-app.wasm', {
    dotenv: { enabled: true },
    httpPort: 8150, // optional: pin the fastedge-run port
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
    console.log('Store calls:', response.storeCalls);

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

testHttpApp();
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

runFromBuffer();
```

### Request Context

```typescript
import { createRunner } from '@gcoredev/fastedge-test';

// Set context at load time
const runner = await createRunner('./my-cdn-app.wasm', {
  client: { preset: 'de' },
  edge: { preset: 'nl' },
});

// Change context after load
await runner.setRequestContext({ client: { preset: 'us' }, edge: { preset: 'us' } });

// Per-request context override
const result = await runner.callFullFlow(
  'https://example.com/',
  'GET',
  {},
  '',
  {},
  true,
  { client: { preset: 'de' }, edge: { preset: 'de' } }, // context for this flow only
);

await runner.cleanup();
```

---

## See Also

- test-framework reference — High-level test framework (`defineTestSuite`, `runAndExit`, assertions) built on top of this runner API
- server-api reference — REST endpoints for running tests via HTTP
- vscode-debugger reference — Debugger server and WebSocket protocol
- test-config reference — `fastedge-config.test.json` schema and dotenv configuration
