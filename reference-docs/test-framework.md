<!--
  auto-updated: true
  sources:
    - id: fastedge-test
      ref: v0.3.1
      commit: ccc68985ba8dcb688c077c04f2a3762ee34f944d
      updated: 2026-11-23
-->

# FastEdge Test Framework API

Reference for `@gcoredev/fastedge-test` — the local WASM test runner for FastEdge apps.

---

## Installation

```bash
npm install --save-dev @gcoredev/fastedge-test
```

**Import paths:**

```typescript
import {
  defineTestSuite, runAndExit, runTestSuite, runFlow, runHttpRequest, loadConfigFile,
  mockOrigins, createStores, createResource,
  assertRequestHeader, assertNoRequestHeader, assertResponseHeader, assertNoResponseHeader,
  assertFinalStatus, assertFinalHeader, assertReturnCode,
  assertLog, assertNoLog, logsContain,
  assertPropertyAllowed, assertPropertyDenied, hasPropertyAccessViolation,
  assertHttpStatus, assertHttpHeader, assertHttpNoHeader,
  assertHttpBody, assertHttpBodyContains, assertHttpJson, assertHttpContentType,
  assertHttpLog, assertHttpNoLog,
} from '@gcoredev/fastedge-test/test';

import type {
  TestSuite, TestCase, ResourceTestSuite, ResourceTestCase,
  TestResult, SuiteResult,
  FlowOptions, HttpRequestOptions, RunnerConfig,
  MockOriginsHandle, MockOriginsOptions,
  TestStores, CreateStoresOptions,
  Resource, ResourceRequest, ResourceResult,
} from '@gcoredev/fastedge-test/test';
```

Vitest fixtures are exported from a separate sub-path: `@gcoredev/fastedge-test/vitest` (see Vitest Fixtures section below). The package root, `@gcoredev/fastedge-test`, exports the low-level runner API (see the runner internals reference).

---

## CDN vs HTTP-WASM

| Aspect | CDN / proxy-wasm | HTTP-WASM |
|--------|-----------------|-----------|
| App type | Header manipulation, geo-routing, edge middleware | HTTP handlers, API servers |
| Entry function | Hooks: `onRequestHeaders`, `onResponseHeaders`, etc. | Single HTTP handler |
| Test function | `runFlow(runner, options)` | `runHttpRequest(runner, options)` or `runner.execute(options)` |
| Result type | `FullFlowResult` | `HttpResponse` |
| Header assertions | `assertRequestHeader`, `assertResponseHeader` | `assertHttpHeader`, `assertHttpNoHeader` |
| Properties | Supported via `properties` field in `FlowOptions` | Not applicable |
| Hook return codes | `assertReturnCode(hookResult, 0)` | Not applicable |
| Origin mocking | `mockOrigins()` — default config works as-is | `mockOrigins({ allowNetConnect: [/^127\.0\.0\.1/, /^localhost/] })` required |

---

## Core Functions

### `defineTestSuite(config): TestSuite | ResourceTestSuite`

Validates and returns a typed suite definition. For a `TestSuite`, throws if neither `wasmPath` nor `wasmBuffer` is provided. For both suite kinds, throws if `tests` is empty.

```typescript
// Runner suite
defineTestSuite({
  wasmPath: string;       // path to compiled .wasm — mutually exclusive with wasmBuffer
  // OR
  wasmBuffer: Buffer;     // pre-loaded WASM binary — mutually exclusive with wasmPath
  runnerConfig?: RunnerConfig;
  tests: Array<{
    name: string;
    run: (runner: IWasmRunner, context: { stores: TestStores | null }) => Promise<void>;
  }>;
})

// Resource suite
defineTestSuite({
  resource: string | ResourceConfigInput;  // path to resource config or config object
  stores?: false | TestStores;
  tests: Array<{
    name: string;
    run: (resource: Resource, context: { stores: TestStores | null }) => Promise<void>;
  }>;
})
```

**`RunnerConfig` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `dotenv.enabled` | `boolean` | Enable dotenv loading before each test — see the dotenv configuration guide |
| `dotenv.path` | `string` | Directory to load dotenv files from; defaults to process CWD |
| `enforceProductionPropertyRules` | `boolean` | Deprecated and ignored: production property rules always apply |
| `runnerType` | `"http-wasm" \| "proxy-wasm"` | Override automatic WASM type detection |
| `httpPort` | `number` | Pin HTTP server to specific port (HTTP-WASM only; throws if in use) |
| `stores` | `boolean \| TestStores` | Local cache and Edge KV. Default `true`. `false` disables. A `TestStores` instance isolates or shares state |
| `dc` | `string` | Cache bucket (edge location); runners with same `dc` share cache entries. Default `"local"` |

`wasmPath` and `wasmBuffer` are a discriminated union — providing both is a TypeScript compile-time error.

`context.stores` in test `run` functions is a fresh `TestStores` per test (seeded from `fixtures/stores/`) or the instance given in `runnerConfig.stores`. It is `null` when `runnerConfig.stores` is `false`.

---

### `runAndExit(suite: TestSuite | ResourceTestSuite): Promise<never>`

Runs the suite, prints results to stdout, then calls `process.exit(0)` if all pass or `process.exit(1)` if any fail. Use for CI scripts.

Output format:
```
  ✓ adds x-request-id header (12ms)
  ✗ blocks requests without auth (5ms)
      Expected request header 'authorization' to be absent, but found 'Bearer token'

  1/2 passed in 17ms
```

---

### `runTestSuite(suite: TestSuite | ResourceTestSuite): Promise<SuiteResult>`

Executes all test cases sequentially. Each test receives a fresh runner instance (or fresh resource for `ResourceTestSuite`) and, by default, its own stores (`stores: false` disables them; a `TestStores` instance passed in is shared by every test). A thrown error marks that test failed; remaining tests still execute. Returns `SuiteResult` instead of exiting.

```typescript
interface SuiteResult {
  passed: number;
  failed: number;
  total: number;
  durationMs: number;
  results: TestResult[];
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;    // present when passed is false
  durationMs: number;
}
```

---

### `runFlow(runner: IWasmRunner, options: FlowOptions): Promise<FullFlowResult>`

**CDN / proxy-wasm only.** Executes a complete request/response lifecycle through all hooks. Object-based wrapper around the runner's low-level `callFullFlow` method.

```typescript
interface FlowOptions {
  url: string;                                   // required; full URL or "built-in" for local responder
  method?: string;                               // default "GET"
  requestHeaders?: Record<string, string>;       // merged with auto-derived pseudo-headers; pseudo-headers here override
  requestBody?: string;                          // default ""
  properties?: Record<string, unknown>;          // CDN properties to inject, default {}
  enforceProductionPropertyRules?: boolean;      // deprecated and ignored; always applies
  origin?: Origin;                               // response source instead of url; see TEST_CONFIG reference
}
```

Returns `FullFlowResult`:

```typescript
type FullFlowResult = {
  hookResults: Record<string, HookResult>;   // keyed by camelCase hook name
  finalResponse: {
    status: number;
    statusText: string;
    headers: Record<string, string | string[]>;
    body: string;
    contentType: string;
    isBase64?: boolean;
  };
  calculatedProperties?: Record<string, unknown>;
};

// Hook result keys:
// onRequestHeaders, onRequestBody, onResponseHeaders, onResponseBody

// HookResult shape:
hookResult.returnCode                   // number: 0 = Continue, 1 = Pause
hookResult.output.request.headers       // Record<string, string>
hookResult.output.response.headers      // Record<string, string>
hookResult.logs                         // LogEntry[]
```

Without `origin`, the upstream response comes from a real fetch against `url`, or from the built-in responder when `url === "built-in"`. With `origin`, the response comes from that origin and `url` is only what the client asked for. Use `mockOrigins()` to control upstream responses in tests.

---

### `runHttpRequest(runner: IWasmRunner, options: HttpRequestOptions): Promise<HttpResponse>`

**HTTP-WASM only.** Object-based wrapper around the runner's `execute` method.

```typescript
interface HttpRequestOptions {
  path: string;                          // request path, e.g. '/api/hello'
  method?: string;                       // default 'GET'
  headers?: Record<string, string>;      // default {}
  body?: string;                         // default ''
}
// Returns: HttpResponse — use assertHttp* helpers to inspect
```

**Redirects are not followed.** The underlying fetch uses `redirect: "manual"`, so a 3xx returned by the WASM is surfaced verbatim. To follow a redirect:
- **Relative location** (e.g. `/auth/complete`) — pass it directly as `path` in a second `runHttpRequest` call.
- **Absolute, same host** — extract `pathname + search` via `new URL()` and re-issue with that path.
- **Absolute, external host** — cannot be followed through the runner; assert on status and `Location` and stop.

---

### `runner.execute(options): Promise<{ status, headers, body, logs }>`

**HTTP-WASM only.** Low-level single HTTP request execution. `runHttpRequest` is the preferred wrapper.

```typescript
runner.execute({
  path: string;
  method?: string;                       // default 'GET'
  headers?: Record<string, string>;
  body?: string;                         // default ''
})
// Returns: { status: number, headers: Record<string, string>, body: string, logs: LogEntry[] }
```

---

### `loadConfigFile(configPath: string): Promise<TestConfig>`

Reads and validates a `fastedge-config.test.json` file. Throws with a descriptive error on validation failure. A relative `dotenv.path` in the file is resolved against the config file's directory, as are file paths of a proxy-wasm config's `origin`. See the TEST_CONFIG reference for the full schema.

```typescript
const config = await loadConfigFile('./fastedge-config.test.json');
// Use config.wasm.path, config.request.url, config.request.method, config.properties, etc.
```

---

### `mockOrigins(options?: MockOriginsOptions): MockOriginsHandle`

Installs an undici `MockAgent` as the global fetch dispatcher for the duration of a test. Every origin fetch and every `proxy_http_call` upstream the runner makes routes through it. Blocks unmocked requests by default.

```typescript
interface MockOriginsOptions {
  allowNetConnect?: boolean | (string | RegExp)[];  // default: false
}

interface MockOriginsHandle {
  origin(url: string): MockPool;          // get or create MockPool; chain .intercept().reply()
  readonly agent: MockAgent;              // raw MockAgent for .persist() / .times() / .delay()
  close(): Promise<void>;                 // restore previous dispatcher; idempotent
  assertAllCalled(): void;               // throw if any interceptor was never matched
}
```

**HTTP-WASM caveat:** `HttpWasmRunner.execute()` forwards requests to a local `fastedge-run` subprocess. Allow localhost through with:

```typescript
mocks = mockOrigins({ allowNetConnect: [/^127\.0\.0\.1/, /^localhost/] });
```

For CDN/proxy-wasm tests using `runFlow` only, the default config is correct — no `allowNetConnect` needed.

**Lifecycle pattern:**

```typescript
let mocks: MockOriginsHandle | null = null;

beforeEach(() => { mocks = mockOrigins(); });
afterEach(async () => {
  try {
    mocks?.assertAllCalled();
  } finally {
    await mocks?.close();
    mocks = null;
  }
});

it("handles 503 from origin", async () => {
  mocks!.origin("https://origin.example.com")
    .intercept({ path: "/api/resource" })
    .reply(503, "upstream down");

  const result = await runFlow(runner, { url: "https://origin.example.com/api/resource" });
  assertFinalStatus(result, 503);
});
```

---

### `createStores(options?: CreateStoresOptions): Promise<TestStores>`

Starts an isolated, in-memory storage service (local cache and Edge KV) seeded from `fixtures/stores/`. Pass the returned instance as `runnerConfig.stores` so runners share its data. `runTestSuite` creates one per test automatically; use `createStores` directly when composing runners outside a suite or when several runners must share state.

```typescript
type CreateStoresOptions = {
  fixtures?: string | false;   // where fixtures/stores/ is looked up; false = none
  dc?: string;                 // default cache bucket (default "local")
};

interface TestStores {
  readonly url: string;
  readonly token: string;
  readonly dc: string;
  readonly cache: {
    get(key: string, options?: { dc?: string }): string | null;
    set(key: string, value: string | Uint8Array, options?: { ttlMs?: number; dc?: string }): void;
    delete(key: string, options?: { dc?: string }): void;
  };
  seed(data: StoresSeed): void;         // add data; named KV stores replaced, cache keys overwritten
  advanceClock(ms: number): void;        // move service clock for cache expiry
  reset(): void;                         // return to fixtures: cache emptied, KV re-seeded
  close(): Promise<void>;               // stop the service; data is gone
}
```

---

### `createResource(resource, options?): Promise<Resource>`

Loads a resource: several apps handling one request, one app per hook. `resource` is a path to a resource config file (app paths resolved relative to it) or an equivalent config object. The returned `Resource` is released with `cleanup()`. `runTestSuite` creates and cleans up a resource per test of a `ResourceTestSuite`; call `createResource` directly when composing outside a suite.

```typescript
function createResource(
  resource: string | ResourceConfigInput,
  options?: { stores?: false | TestStores },
): Promise<Resource>
```

---

## Assertion Helpers

All helpers throw `Error` on failure. Compatible with any test framework or plain scripts.

### CDN / Hook Assertions

| Function | Applies to | Asserts |
|----------|-----------|---------|
| `assertRequestHeader(result, name, expected?)` | `HookResult` | Named header exists in output request headers; `string` expected matches any value in multi-valued header; `string[]` requires exact array match |
| `assertNoRequestHeader(result, name)` | `HookResult` | Named header absent from output request headers |
| `assertResponseHeader(result, name, expected?)` | `HookResult` | Named header exists in output response headers; same multi-value semantics as above |
| `assertNoResponseHeader(result, name)` | `HookResult` | Named header absent from output response headers |
| `assertReturnCode(result, expected)` | `HookResult` | Hook return code equals expected (0 = Continue, 1 = Pause) |
| `assertFinalStatus(result, expected)` | `FullFlowResult` | Final response status code equals expected |
| `assertFinalHeader(result, name, expected?)` | `FullFlowResult` | Named header exists in final response headers; `string` matches any value; `string[]` requires exact array match |
| `assertLog(result, substring)` | `HookResult` | At least one log entry contains substring |
| `assertNoLog(result, substring)` | `HookResult` | No log entry contains substring |
| `logsContain(result, substring)` | `HookResult` | Returns `boolean` — non-throwing predicate |
| `assertPropertyAllowed(result, propertyPath)` | `HookResult` | Named property was not denied |
| `assertPropertyDenied(result, propertyPath)` | `HookResult` | Named property was denied |
| `hasPropertyAccessViolation(result)` | `HookResult` | Returns `boolean` — true if any `"Property access denied"` log exists |

### HTTP-WASM Assertions

| Function | Applies to | Asserts |
|----------|-----------|---------|
| `assertHttpStatus(response, expected)` | `HttpResponse` | Response status code equals expected |
| `assertHttpHeader(response, name, expected?)` | `HttpResponse` | Named header exists (case-insensitive); `string` expected matches any value in multi-valued header; `string[]` requires exact array match |
| `assertHttpNoHeader(response, name)` | `HttpResponse` | Named header absent (case-insensitive) |
| `assertHttpBody(response, expected)` | `HttpResponse` | Response body matches exactly |
| `assertHttpBodyContains(response, substring)` | `HttpResponse` | Response body contains substring |
| `assertHttpJson<T>(response)` | `HttpResponse` | Parses body as JSON and returns `T`; throws on parse failure |
| `assertHttpContentType(response, expected)` | `HttpResponse` | `response.contentType` contains expected (case-insensitive) |
| `assertHttpLog(response, substring)` | `HttpResponse` | At least one log entry contains substring |
| `assertHttpNoLog(response, substring)` | `HttpResponse` | No log entry contains substring |

---

## CDN Minimal Example

```typescript
import {
  defineTestSuite, runAndExit, runFlow,
  assertFinalStatus, assertRequestHeader, assertReturnCode,
} from '@gcoredev/fastedge-test/test';

await runAndExit(defineTestSuite({
  wasmPath: './build/cdn-filter.wasm',
  tests: [
    {
      name: 'injects x-country header from CDN property',
      async run(runner) {
        const result = await runFlow(runner, {
          url: 'https://example.com/',
          properties: { 'request.country': 'DE' },
        });
        assertReturnCode(result.hookResults.onRequestHeaders, 0);
        assertRequestHeader(result.hookResults.onRequestHeaders, 'x-country', 'DE');
        assertFinalStatus(result, 200);
      },
    },
  ],
}));
```

---

## HTTP-WASM Minimal Example

```typescript
import {
  defineTestSuite, runAndExit, runHttpRequest,
  assertHttpStatus, assertHttpContentType, assertHttpJson,
} from '@gcoredev/fastedge-test/test';

await runAndExit(defineTestSuite({
  wasmPath: './build/api-handler.wasm',
  tests: [
    {
      name: 'GET /hello returns 200 with JSON greeting',
      async run(runner) {
        const response = await runHttpRequest(runner, {
          path: '/hello',
          method: 'GET',
          headers: { accept: 'application/json' },
        });
        assertHttpStatus(response, 200);
        assertHttpContentType(response, 'application/json');
        const body = assertHttpJson<{ message: string }>(response);
        if (!body.message) throw new Error('Missing message in response body');
      },
    },
  ],
}));
```

---

## npm Scripts

```json
{
  "scripts": {
    "test": "node ./tests/app.test.mjs",
    "debug": "npx @gcoredev/fastedge-test"
  }
}
```

- `npm test` — run test suite once (CI entry point; exits 0/1)
- `npm run debug` — open visual debugger at `http://localhost:5179`

---

## Vitest Fixtures

The `@gcoredev/fastedge-test/vitest` sub-path exports a vitest `test` function extended with three fixtures: `stores`, `runner`, and `resource`. Use it when writing tests with vitest instead of `defineTestSuite`. `vitest` must be installed in the consuming project.

```typescript
import { test, createStores } from '@gcoredev/fastedge-test/vitest';
import type { FastEdgeFixtures, TestStores } from '@gcoredev/fastedge-test/vitest';

type FastEdgeFixtures = {
  stores: TestStores;
  runner: (wasm: string | Buffer, config?: RunnerConfig) => Promise<IWasmRunner>;
  resource: (config: string | ResourceConfigInput) => Promise<Resource>;
};
```

| Fixture | Type | Description |
|---------|------|-------------|
| `stores` | `TestStores` | This test's own in-memory cache and Edge KV, seeded from `fixtures/stores/`; closed when the test ends |
| `runner` | `(wasm: string \| Buffer, config?: RunnerConfig) => Promise<IWasmRunner>` | Loads a runner from a `.wasm` path or buffer on this test's `stores` (unless `config.stores` is set); cleaned up when the test ends |
| `resource` | `(config: string \| ResourceConfigInput) => Promise<Resource>` | Loads a resource (several apps, one per hook) on this test's `stores`; cleaned up when the test ends |

CDN and HTTP runners and resources created within one test share that test's stores. To share stores across several tests (an ordered journey), call `createStores()` in `beforeAll`, pass the instance as `RunnerConfig.stores`, and close it in `afterAll`.

```typescript
import { expect } from 'vitest';
import { test } from '@gcoredev/fastedge-test/vitest';
import { runFlow, assertFinalStatus } from '@gcoredev/fastedge-test/test';

test('counts requests', async ({ runner, stores }) => {
  const app = await runner('./build/cdn-filter.wasm');
  const result = await runFlow(app, { url: 'built-in' });
  assertFinalStatus(result, 200);
  expect(stores.cache.get('hits')).toBe('1');
});
```

---

## See Also

- RUNNER — Low-level `IWasmRunner` interface, `RunnerConfig`, and `callFullFlow`
- TEST_CONFIG — `fastedge-config.test.json` schema and `loadConfigFile` config options
- DOTENV — `runnerConfig.dotenv` option details: prefix scheme, file options, priority order
- DEBUGGER — Interactive debugger server for step-through WASM execution
- API — REST API for running tests via HTTP
