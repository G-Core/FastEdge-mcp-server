<!--
  auto-updated: true
  sources:
    - id: proxy-wasm-sdk-as
      ref: master
      commit: 8e3bb621bc013a0aed7e52122066b417ad62a207
      updated: 2026-08-17
-->

## Overview

`httpCall()` dispatches an asynchronous outbound HTTP request from a FastEdge CDN (proxy-wasm) app. Use it when your app needs to fetch data from an upstream service — an API, auth endpoint, or external enrichment source — before deciding how to handle or respond to the incoming request.

## API Patterns

### `RootContext.httpCall()`

Dispatches an async HTTP request. Must be called on the `RootContext` (or cast to it) — not directly on a `Context` instance.

```typescript
httpCall(
  upstream: string,
  headers: Array<HeaderPair>,
  body: ArrayBuffer,
  trailers: Array<HeaderPair>,
  timeoutMs: u32,
  ctx: BaseContext,
  callback: (ctx: BaseContext, hdrs: u32, bodySize: usize, trls: u32) => void,
): WasmResultValues
```

| Parameter | Type | Notes |
|-----------|------|-------|
| `upstream` | `string` | Cluster/host name (e.g. `"httpbin.org"`) |
| `headers` | `Array<HeaderPair>` | Request headers including pseudo-headers (`:scheme`, `:authority`, `:path`, `:method`) |
| `body` | `ArrayBuffer` | Request body; pass `new ArrayBuffer(0)` for no body |
| `trailers` | `Array<HeaderPair>` | Request trailers; pass `new Array<HeaderPair>()` for none |
| `timeoutMs` | `u32` | Timeout in milliseconds |
| `ctx` | `BaseContext` | Originating context — passed back to the callback |
| `callback` | `(ctx, hdrs, bodySize, trls) => void` | Fired when the response arrives |

Returns `WasmResultValues.Ok` on successful dispatch. Any other value means dispatch failed — check explicitly.

Import path: `@gcoredev/proxy-wasm-sdk-as/assembly`

---

### `makeHeaderPair()`

Constructs a `HeaderPair` for use in headers and trailers arrays.

```typescript
makeHeaderPair(key: string, value: string): HeaderPair
```

Import path: `@gcoredev/proxy-wasm-sdk-as/assembly`

---

### `get_buffer_bytes()` — read HTTP call response body

Reads the response body inside the callback.

```typescript
get_buffer_bytes(
  type: BufferTypeValues,
  start: u32,
  length: u32,
): ArrayBuffer
```

Use `BufferTypeValues.HttpCallResponseBody` as the type. `start` is `0` and `length` is `bodySize as u32` from the callback parameters.

Import path: `@gcoredev/proxy-wasm-sdk-as/assembly`

---

### `stream_context.headers.http_callback.get()`

Reads response headers inside the HTTP call callback.

```typescript
stream_context.headers.http_callback.get(name: string): string
```

Returns empty string if the header is not present. Import path: `@gcoredev/proxy-wasm-sdk-as/assembly`

---

### Callback signature

```typescript
(ctx: BaseContext, hdrs: u32, bodySize: usize, trls: u32): void
```

| Parameter | Notes |
|-----------|-------|
| `hdrs` | `0` indicates the call failed (timeout, DNS error, etc.); non-zero means the response was received |
| `bodySize` | Response body size in bytes; `0` means empty body |
| `trls` | Trailers count |

## Common Patterns

### Dispatch-from-root with re-dispatch latch

```typescript
export * from "@gcoredev/proxy-wasm-sdk-as/assembly/proxy";
import {
  BaseContext,
  BufferTypeValues,
  Context,
  FilterHeadersStatusValues,
  get_buffer_bytes,
  HeaderPair,
  log,
  LogLevelValues,
  makeHeaderPair,
  registerRootContext,
  RootContext,
  send_http_response,
  stream_context,
  WasmResultValues,
} from "@gcoredev/proxy-wasm-sdk-as/assembly";
import { setLogLevel } from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";

const INTERNAL_SERVER_ERROR: u32 = 500;

function handleHttpCallResponse(
  ctx: BaseContext,
  hdrs: u32,
  bodySize: usize,
  trls: u32,
): void {
  if (hdrs == 0) {
    log(LogLevelValues.error, "HTTP call failed — no response received");
    return;
  }

  const userAgent = stream_context.headers.http_callback.get("user-agent");
  if (userAgent !== "") {
    log(LogLevelValues.info, "User-Agent: " + userAgent);
  }

  if (bodySize > 0) {
    const bodyBytes = get_buffer_bytes(
      BufferTypeValues.HttpCallResponseBody,
      0,
      bodySize as u32,
    );
    const bodyStr = String.UTF8.decode(bodyBytes);
    log(
      LogLevelValues.info,
      "Response body (" + bodySize.toString() + " bytes): " + bodyStr,
    );
  } else {
    log(LogLevelValues.info, "Response body: empty");
  }
}

class HttpCallRoot extends RootContext {
  createContext(context_id: u32): Context {
    setLogLevel(LogLevelValues.info);
    return new HttpCallContext(context_id, this);
  }
}

class HttpCallContext extends Context {
  httpCallDispatched: bool = false;

  constructor(context_id: u32, root_context: HttpCallRoot) {
    super(context_id, root_context);
  }

  onRequestHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues {
    // FastEdge re-invokes this hook after the httpCall response is processed.
    // The latch gates re-dispatch so the second invocation returns Continue
    // instead of firing another HTTP call.
    if (this.httpCallDispatched) {
      log(
        LogLevelValues.info,
        "HTTP call response received, resuming request.",
      );
      return FilterHeadersStatusValues.Continue;
    }

    log(LogLevelValues.info, "onRequestHeaders >> dispatching HTTP call");

    const headers = new Array<HeaderPair>();
    headers.push(makeHeaderPair(":scheme", "https"));
    headers.push(makeHeaderPair(":authority", "httpbin.org"));
    headers.push(makeHeaderPair(":path", "/ip"));
    headers.push(makeHeaderPair(":method", "GET"));
    headers.push(makeHeaderPair("User-Agent", "fastedge"));

    // 3000ms accommodates cold DNS + variable network conditions; tune per upstream in production.
    const result = (this.root_context as HttpCallRoot).httpCall(
      "httpbin.org",
      headers,
      new ArrayBuffer(0),
      new Array<HeaderPair>(),
      3000,
      this,
      handleHttpCallResponse,
    );

    if (result != WasmResultValues.Ok) {
      log(
        LogLevelValues.error,
        "Failed to dispatch HTTP call: " + result.toString(),
      );
      send_http_response(
        INTERNAL_SERVER_ERROR,
        "internal server error",
        String.UTF8.encode("Failed to dispatch HTTP call"),
        [],
      );
      return FilterHeadersStatusValues.StopIteration;
    }

    this.httpCallDispatched = true;
    log(LogLevelValues.info, "HTTP call dispatched, pausing request");

    return FilterHeadersStatusValues.StopIteration;
  }
}

registerRootContext((context_id: u32) => {
  return new HttpCallRoot(context_id);
}, "httpCall");
```

### Callback: check failure, read headers, read body

```typescript
function handleHttpCallResponse(
  ctx: BaseContext,
  hdrs: u32,
  bodySize: usize,
  trls: u32,
): void {
  // hdrs == 0 means the call failed (timeout, DNS failure, etc.)
  if (hdrs == 0) {
    log(LogLevelValues.error, "HTTP call failed");
    return;
  }

  // Read a response header
  const contentType = stream_context.headers.http_callback.get("content-type");

  // Read the response body
  if (bodySize > 0) {
    const bodyBytes = get_buffer_bytes(
      BufferTypeValues.HttpCallResponseBody,
      0,
      bodySize as u32,
    );
    const bodyStr = String.UTF8.decode(bodyBytes);
    log(LogLevelValues.info, "body: " + bodyStr);
  }
}
```

### Error response on dispatch failure

```typescript
const result = (this.root_context as HttpCallRoot).httpCall(
  "upstream-host",
  headers,
  new ArrayBuffer(0),
  new Array<HeaderPair>(),
  3000,
  this,
  myCallback,
);

if (result != WasmResultValues.Ok) {
  send_http_response(
    500,
    "internal server error",
    String.UTF8.encode("dispatch failed"),
    [],
  );
  return FilterHeadersStatusValues.StopIteration;
}
```

## Build

```sh
pnpm install
pnpm run asbuild
```

| File | Description |
|------|-------------|
| `build/httpCall.wasm` | Optimised release binary — upload this to FastEdge |
| `build/httpCall-debug.wasm` | Debug binary with source maps |

Dependencies (from `package.json`):

| Package | Role |
|---------|------|
| `@gcoredev/proxy-wasm-sdk-as` | SDK — required runtime dep (`^1.2.3`) |
| `assemblyscript` | AssemblyScript compiler (`^0.28.9`) |
| `@assemblyscript/wasi-shim` | WASI compatibility shim (`^0.1.0`) |

## Gotchas

- **No closures over mutable state.** AssemblyScript does not support closures that capture mutable variables. Capture state on the `Context` instance (instance fields) or use `set_property`/`get_property`. The `httpCallDispatched: bool` latch is an instance field for this reason.
- **FastEdge resume model differs from canonical proxy-wasm.** After the callback fires, the runtime **re-invokes `onRequestHeaders` on the same `Context` instance**. Do not call `continueRequest()` — it has no effect on FastEdge. Use a latch field to distinguish the second invocation.
- **`httpCall` must be called on `RootContext`.** Request-stream `Context` instances do not expose `httpCall` directly. Cast with `(this.root_context as HttpCallRoot).httpCall(...)`.
- **Instance state survives re-entry within the same context** but does not persist across the nginx→core-proxy hop. Do not rely on instance fields across separate request lifecycles.
- **Tune `timeoutMs` per upstream.** The example uses `3000` ms to accommodate cold DNS and variable network conditions. Set a tighter value for low-latency upstreams and a looser value for slow third-party services.
- **No try/catch.** AssemblyScript has no exception handling at runtime. Always check `WasmResultValues.Ok` explicitly after `httpCall()` returns.
- **Pseudo-headers are required.** Include `:scheme`, `:authority`, `:path`, and `:method` in the headers array. Missing pseudo-headers will cause dispatch to fail.
- **`hdrs == 0` means failure, not "no headers".** Inside the callback, `hdrs == 0` signals that the HTTP call itself failed (timeout, DNS error, invalid cluster). Do not skip this check.
- **Log the dispatch failure result.** When `result != WasmResultValues.Ok`, log `result.toString()` to surface the specific `WasmResultValues` variant for debugging.

## Related

- SDK API reference — full lifecycle hook signatures, `RootContext` and `Context` base class APIs, all enum values (`WasmResultValues`, `FilterHeadersStatusValues`, `BufferTypeValues`, `LogLevelValues`)
- Platform overview — FastEdge CDN execution model, context lifecycle, how the runtime re-enters hooks after async callbacks
- Best practices — timeout tuning, upstream cluster naming, error response patterns
