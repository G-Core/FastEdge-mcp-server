<!--
  auto-updated: true
  sources:
    - id: fastedge-test
      ref: v0.2.5
      commit: 61497eca6ead033ac810165bc1e20e1d6dd4678f
      updated: 2026-07-23
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
  mockOrigins,
  assertRequestHeader, assertNoRequestHeader, assertResponseHeader, assertNoResponseHeader,
  assertFinalStatus, assertFinalHeader, assertReturnCode,
  assertLog, assertNoLog, logsContain,
  assertPropertyAllowed, assertPropertyDenied, hasPropertyAccessViolation,
  assertHttpStatus, assertHttpHeader, assertHttpNoHeader,
  assertHttpBody, assertHttpBodyContains, assertHttpJson, assertHttpContentType,
  assertHttpLog, assertHttpNoLog,
} from '@gcoredev/fastedge-test/test';

import type {
  TestSuite, TestCase, TestResult, SuiteResult,
  FlowOptions, HttpRequestOptions, RunnerConfig,
  MockOriginsHandle, MockOriginsOptions,
} from '@gcoredev/fastedge-test/test';
```

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
| Origin mocking | `mockOrigins()` — default config works as-is | `mockOrigins({ allowNetConnect: [/localhost/] })` required |

---

## Core Functions

### `defineTestSuite(config): TestSuite`

Validates and returns a typed test suite definition. Throws if neither `wasmPath` nor `wasmBuffer` is provided, or if `tests` is empty.

```typescript
defineTestSuite({
  wasmPath: string;       // path to compiled .wasm — mutually exclusive with wasmBuffer
  // OR
  wasmBuffer: Buffer;     // pre-loaded WASM binary — mutually exclusive with wasmPath
  runnerConfig?: {
    dotenv?: {
      enabled?: boolean;                          // load .env into WASM before each test — see the DOTENV reference
      path?: string;                              // directory to load dotenv files from; defaults to process CWD
    };
    enforceProductionPropertyRules?: boolean;     // default true
    runnerType?: "http-wasm" | "proxy-wasm";      // override automatic WASM type detection
    httpPort?: number;                            // pin HTTP server to specific port (HTTP-WASM only; throws if in use)
  };
  tests: Array<{
    name: string;
    run: (runner: IWasmRunner) => Promise<void>;
  }>;
})
```

`wasmPath` and `wasmBuffer` are a discriminated union — providing both is a TypeScript compile-time error.

---

### `runAndExit(suite: TestSuite): Promise<never>`

Runs the suite, prints results to stdout, then calls `process.exit(0)` if all pass or `process.exit(1)` if any fail. Use for CI scripts.

Output format:
```
  ✓ adds x-request-id header (12ms)
  ✗ blocks requests without auth (5ms)
      Expected request header 'authorization' to be absent, but found 'Bearer token'

  1/2 passed in 17ms
```

---

### `runTestSuite(suite: TestSuite): Promise<SuiteResult>`

Executes all test cases sequentially. Each test receives a fresh runner instance. A thrown error marks that test failed; remaining tests still execute. Returns `SuiteResult` instead of exiting.

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

**CDN / proxy-wasm only.** Executes a complete request/response lifecycle through all hooks. Object-based wrapper around the runner's low-level `callFullFlow` method — callers do not need to construct pseudo-headers manually.

```typescript
interface FlowOptions {
  url: string;                                   // required; derives :path, :authority, :scheme pseudo-headers
                                                 // or "built-in" for the local responder
  method?: string;                               // default "GET"
  requestHeaders?: Record<string, string>;       // merged with auto-derived pseudo-headers; pseudo-headers here override
  requestBody?: string;                          // default ""
  properties?: Record<string, unknown>;          // CDN properties to inject, default {}
  enforceProductionPropertyRules?: boolean;      // default true
}
```

Returns `FullFlowResult`:

```typescript
type FullFlowResult = {
  hookResults: {
    onRequestHeaders:  HookResult;
    onRequestBody:     HookResult;
    onResponseHeaders: HookResult;
    onResponseBody:    HookResult;
  };
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

// HookResult shape:
hookResult.returnCode                   // number: 0 = Continue, 1 = Pause
hookResult.output.request.headers       // Record<string, string>
hookResult.output.response.headers      // Record<string, string>
hookResult.logs                         // LogEntry[]
```

The upstream response is generated at runtime by a real fetch against `url`, or by the built-in responder when `url === "built-in"`. Use `mockOrigins()` to control upstream responses in tests.

---

### `runHttpRequest(runner: IWasmRunner, options: HttpRequestOptions): Promise<HttpResponse>`

**HTTP-WASM only.** Object-based wrapper around the runner's `execute` method. Executes a single HTTP request against the WASM app.

**Redirects are not followed.** The underlying fetch uses `redirect: "manual"`, so a 3xx returned by the WASM is surfaced verbatim. To follow a redirect:
- **Relative location** (e.g. `/auth/complete`) — pass it directly as `path` in a second `runHttpRequest` call.
- **Absolute, same host** — extract `pathname + search` via `new URL()` and re-issue with that path.
- **Absolute, external host** — cannot be followed through the runner; assert on status and `Location` and stop.

```typescript
interface HttpRequestOptions {
  path: string;                          // request path, e.g. '/api/hello'
  method?: string;                       // default 'GET'
  headers?: Record<string, string>;      // default {}
  body?: string;                         // default ''
}
// Returns: HttpResponse — use assertHttp* helpers to inspect
```

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

Reads and validates a `fastedge-config.test.json` file. Throws with a descriptive error on validation failure. See the TEST_CONFIG reference for the full schema.

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
afterEach(async () => { await mocks?.close(); mocks = null; });

it("handles 503 from origin", async () => {
  mocks!.origin("https://origin.example.com")
    .intercept({ path: "/api/resource" })
    .reply(503, "upstream down");

  const result = await runFlow(runner, { url: "https://origin.example.com/api/resource" });
  assertFinalStatus(result, 503);
  mocks!.assertAllCalled();
});
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
| `assertFinalHeader(result, name, expected?)` | `FullFlowResult` | Named header exists in final response headers; `string` expected matches any value in multi-valued header; `string[]` requires exact array match |
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
| `assertHttpHeader(response, name, expected?)` | `HttpResponse` | Named header exists (case-insensitive); `string` expected matches any value in multi-valued header (e.g. `set-cookie`); `string[]` requires exact array match |
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

## See Also

- RUNNER — Low-level `IWasmRunner` interface, `RunnerConfig`, and `callFullFlow`
- TEST_CONFIG — `fastedge-config.test.json` schema and `loadConfigFile` config options
- DOTENV — `dotenvEnabled` option details: prefix scheme, file options, priority order
- DEBUGGER — Interactive debugger server for step-through WASM execution
- API — REST API for running tests via HTTP
