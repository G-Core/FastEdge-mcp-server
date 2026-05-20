<!--
  auto-updated: true
  sources:
    - id: proxy-wasm-sdk-as
      ref: master
      commit: 60f25c7bd35564e5bafb421be7f37aa4acf1bf81
      updated: 2026-05-20
-->

# AssemblyScript Proxy-Wasm SDK Reference

SDK: `@gcoredev/proxy-wasm-sdk-as` version 1.2.3. Enables writing CDN filter applications (proxy-wasm plugins) in AssemblyScript that compile to WebAssembly and run on the FastEdge platform. CDN-only SDK — all content relates to proxy-wasm CDN app development.

Two import paths:
- Core: `@gcoredev/proxy-wasm-sdk-as/assembly`
- FastEdge extensions: `@gcoredev/proxy-wasm-sdk-as/assembly/fastedge`

---

## Entry Point Pattern

Every FastEdge plugin requires three things in `assembly/index.ts`:

1. Re-export proxy entry points so the host runtime can call into the wasm module.
2. Extend `RootContext` and `Context` with filter logic.
3. Call `registerRootContext` at module scope to register the factory.

```typescript
import {
  RootContext,
  Context,
  FilterHeadersStatusValues,
  registerRootContext,
  stream_context,
  log,
  LogLevelValues,
} from "@gcoredev/proxy-wasm-sdk-as/assembly";

export * from "@gcoredev/proxy-wasm-sdk-as/assembly/proxy";

class MyRootContext extends RootContext {
  createContext(context_id: u32): Context {
    return new MyContext(context_id, this);
  }
}

class MyContext extends Context {
  constructor(context_id: u32, root_context: MyRootContext) {
    super(context_id, root_context);
  }

  onRequestHeaders(
    headers: u32,
    end_of_stream: bool,
  ): FilterHeadersStatusValues {
    const ua = stream_context.headers.request.get("user-agent");
    log(LogLevelValues.info, "User-Agent: " + ua);
    return FilterHeadersStatusValues.Continue;
  }
}

registerRootContext(
  (context_id: u32) => new MyRootContext(context_id),
  "my-filter",
);
```

---

## Build Configuration

`asconfig.json` must include the `abort` override. Without it, runtime errors in the wasm module will not be surfaced correctly.

```json
{
  "extends": "./node_modules/@assemblyscript/wasi-shim/asconfig.json",
  "targets": {
    "debug": {
      "sourceMap": true,
      "debug": true
    },
    "release": {
      "optimizeLevel": 3,
      "shrinkLevel": 0,
      "converge": false,
      "noAssert": false
    }
  },
  "options": {
    "bindings": "esm",
    "use": "abort=abort_proc_exit"
  }
}
```

`package.json` must declare the SDK as a dependency and include `@assemblyscript/wasi-shim` for logging support:

```json
{
  "dependencies": {
    "@gcoredev/proxy-wasm-sdk-as": "^1.2.3"
  },
  "devDependencies": {
    "assemblyscript": "^0.28.9",
    "@assemblyscript/wasi-shim": "^0.1.0"
  }
}
```

---

## Proxy-Wasm Lifecycle

### RootContext

Created once per VM instance (once per deployed plugin). Factory for `Context` instances.

**Import path**: `@gcoredev/proxy-wasm-sdk-as/assembly`

```typescript
class RootContext {
  constructor(context_id: u32)

  // Override to supply Context instances for each hook invocation
  createContext(context_id: u32): Context

  // Called when the VM starts — override to perform startup logic
  onStart(vm_configuration_size: usize): bool

  // Called when the VM is being torn down — return false to delay shutdown
  onDone(): bool

  // Make an outbound HTTP call; see "Outbound HTTP" section for full signature
  httpCall(...): WasmResultValues
}
```

`createContext` must be overridden to return a `Context` subclass. The default implementation logs an error.

**Lifecycle order:**

1. `onStart` — VM is initializing
2. `createContext` — called for each hook invocation
3. `onDone` — VM is shutting down

```typescript
class MyRootContext extends RootContext {
  createContext(context_id: u32): Context {
    return new MyContext(context_id, this);
  }

  onStart(vm_configuration_size: usize): bool {
    log(LogLevelValues.info, "Plugin starting");
    return true;
  }
}
```

### Context

Instantiated once per lifecycle hook invocation on the FastEdge platform — **not once per HTTP request**. The host creates a fresh `Context` instance for each hook phase. See Hook State Isolation for critical constraints.

**Import path**: `@gcoredev/proxy-wasm-sdk-as/assembly`

```typescript
class Context {
  root_context: RootContext;

  constructor(context_id: u32, root_context: RootContext);
}
```

### Lifecycle Hooks

Override on `Context` subclass to process requests and responses. All hooks have default no-op implementations that return `Continue`.

**Import path**: `@gcoredev/proxy-wasm-sdk-as/assembly`

**Request-phase hooks:**

```typescript
onRequestHeaders(headers: u32, end_of_stream: bool): FilterHeadersStatusValues
onRequestBody(body_buffer_length: usize, end_of_stream: bool): FilterDataStatusValues
```

**Response-phase hooks:**

```typescript
onResponseHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues
onResponseBody(body_buffer_length: usize, end_of_stream: bool): FilterDataStatusValues
```

**Post-request hook:**

```typescript
onLog(): void
```

`onLog` is part of the proxy-wasm specification, and the SDK exports `proxy_on_log` for forward compatibility. **`onLog` is not dispatched on the FastEdge platform today** — neither the edge runtime nor the local test runner invokes it. Do not implement `onLog` in application code or rely on it for any logic.

**Hook parameter notes:**

- `headers` / `a` in header hooks: count of headers; rarely needed directly since `stream_context` provides header access.
- `body_buffer_length`: number of bytes buffered so far. Pass to `get_buffer_bytes` to read the body.
- `end_of_stream`: indicates whether this is the final chunk.

**Constraint**: Response headers (`stream_context.headers.response`) are only accessible during response-phase hooks (`onResponseHeaders`, `onResponseBody`). Accessing them during request-phase hooks will panic.

```typescript
class MyContext extends Context {
  onRequestHeaders(
    headers: u32,
    end_of_stream: bool,
  ): FilterHeadersStatusValues {
    const country = stream_context.headers.request.get("x-country-code");
    if (country == "XX") {
      send_http_response(
        403,
        "Forbidden",
        String.UTF8.encode("Access denied"),
        [makeHeaderPair("content-type", "text/plain")],
      );
      return FilterHeadersStatusValues.StopIteration;
    }
    return FilterHeadersStatusValues.Continue;
  }

  onRequestBody(
    body_buffer_length: usize,
    end_of_stream: bool,
  ): FilterDataStatusValues {
    if (!end_of_stream) {
      return FilterDataStatusValues.StopIterationAndBuffer;
    }
    const body = get_buffer_bytes(
      BufferTypeValues.HttpRequestBody,
      0,
      body_buffer_length as u32,
    );
    const text = String.UTF8.decode(body);
    log(LogLevelValues.info, "Request body: " + text);
    return FilterDataStatusValues.Continue;
  }

  onResponseHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues {
    stream_context.headers.response.add("x-processed-by", "my-filter");
    return FilterHeadersStatusValues.Continue;
  }
}
```

### Hook State Isolation

On the FastEdge CDN platform, a `Context` instance only exists for the duration of a single lifecycle hook invocation. It is re-created fresh for each hook. Different hooks may execute on entirely different servers: `onRequestHeaders` runs in nginx, while `onRequestBody`, `onResponseHeaders`, `onResponseBody`, and `onLog` run in core-proxy.

Consequences:

- Instance fields on `Context` subclasses are **not** available in subsequent hooks.
- `this.root_context` references are **not** shared across hooks.
- The `Context` constructor runs fresh for each hook invocation.

**Exception**: Instance fields on `Context` **do** persist across same-hook re-entry during an `httpCall` resume (see HTTP Call Resume Contract). This exception applies only to same-hook re-entry, not to transitions between different lifecycle hooks.

Do not use patterns like this — they will not work on FastEdge:

```typescript
class MyContext extends Context {
  private savedToken: string = ""; // NOT preserved between hooks on FastEdge

  onRequestHeaders(
    headers: u32,
    end_of_stream: bool,
  ): FilterHeadersStatusValues {
    this.savedToken = stream_context.headers.request.get("authorization");
    return FilterHeadersStatusValues.Continue;
  }

  onResponseHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues {
    // this.savedToken will be empty here — instance state is not preserved
    return FilterHeadersStatusValues.Continue;
  }
}
```

To pass data between hooks, use `set_property` and `get_property`:

```typescript
import {
  set_property,
  get_property,
  stream_context,
  FilterHeadersStatusValues,
} from "@gcoredev/proxy-wasm-sdk-as/assembly";

class MyContext extends Context {
  onRequestHeaders(
    headers: u32,
    end_of_stream: bool,
  ): FilterHeadersStatusValues {
    const token = stream_context.headers.request.get("authorization");
    set_property("saved_token", String.UTF8.encode(token));
    return FilterHeadersStatusValues.Continue;
  }

  onResponseHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues {
    const buf = get_property("saved_token");
    if (buf.byteLength > 0) {
      const token = String.UTF8.decode(buf);
      stream_context.headers.response.add("x-had-token", "true");
    }
    return FilterHeadersStatusValues.Continue;
  }
}
```

---

## Return Value Enums

### FilterHeadersStatusValues

Returned from `onRequestHeaders` and `onResponseHeaders`.

**Import path**: `@gcoredev/proxy-wasm-sdk-as/assembly`

| Value                          | Integer | Description                                               |
| ------------------------------ | ------- | --------------------------------------------------------- |
| `Continue`                     | 0       | Pass headers downstream and continue processing.          |
| `StopIteration`                | 1       | Pause header processing.                                  |
| `ContinueAndEndStream`         | 2       | Continue processing and mark the stream as ended.         |
| `StopAllIterationAndBuffer`    | 3       | Stop all iteration and buffer the body.                   |
| `StopAllIterationAndWatermark` | 4       | Stop all iteration until the buffer watermark is reached. |

### FilterDataStatusValues

Returned from `onRequestBody` and `onResponseBody`.

**Import path**: `@gcoredev/proxy-wasm-sdk-as/assembly`

| Value                       | Integer | Description                                                         |
| --------------------------- | ------- | ------------------------------------------------------------------- |
| `Continue`                  | 0       | Pass the buffered body data downstream.                             |
| `StopIterationAndBuffer`    | 1       | Buffer more data; hook will be called again when more data arrives. |
| `StopIterationAndWatermark` | 2       | Buffer data until the watermark; hook called again at threshold.    |
| `StopIterationNoBuffer`     | 3       | Stop iteration without buffering; no further calls to this hook.    |

### LogLevelValues

Used with the `log` function and `setLogLevel`.

**Import path**: `@gcoredev/proxy-wasm-sdk-as/assembly` (also re-exported from `@gcoredev/proxy-wasm-sdk-as/assembly/fastedge`)

| Value      | Integer | Description                       |
| ---------- | ------- | --------------------------------- |
| `trace`    | 0       | Fine-grained diagnostic tracing.  |
| `debug`    | 1       | Debug-level information.          |
| `info`     | 2       | Informational messages (default). |
| `warn`     | 3       | Warning conditions.               |
| `error`    | 4       | Error conditions.                 |
| `critical` | 5       | Critical failures.                |

### WasmResultValues

Returned by many SDK functions to indicate success or a specific failure mode.

**Import path**: `@gcoredev/proxy-wasm-sdk-as/assembly`

| Value                  | Integer | Description                                                |
| ---------------------- | ------- | ---------------------------------------------------------- |
| `Ok`                   | 0       | Operation succeeded.                                       |
| `NotFound`             | 1       | The requested key or resource was not found.               |
| `BadArgument`          | 2       | An argument was out of range or malformed.                 |
| `SerializationFailure` | 3       | A value could not be serialized.                           |
| `ParseFailure`         | 4       | A value could not be parsed.                               |
| `BadExpression`        | 5       | A provided expression was illegal or unrecognized.         |
| `InvalidMemoryAccess`  | 6       | A provided memory range was not legal.                     |
| `Empty`                | 7       | Data was requested from an empty container.                |
| `CasMismatch`          | 8       | The provided CAS value did not match the stored value.     |
| `ResultMismatch`       | 9       | Returned result was unexpected (e.g., incorrect size).     |
| `InternalFailure`      | 10      | Internal host failure; check surrounding system logs.      |
| `BrokenConnection`     | 11      | The connection or stream was closed unexpectedly.          |
| `Unimplemented`        | 12      | The requested feature is not implemented on this platform. |

### BufferTypeValues

Used with `get_buffer_bytes` and `set_buffer_bytes`. Only these three values are usable on FastEdge.

**Import path**: `@gcoredev/proxy-wasm-sdk-as/assembly`

| Value                  | Integer | Description                                                     |
| ---------------------- | ------- | --------------------------------------------------------------- |
| `HttpRequestBody`      | 0       | The HTTP request body. Immutable in `onLog`.                    |
| `HttpResponseBody`     | 1       | The HTTP response body. Immutable in `onLog`.                   |
| `HttpCallResponseBody` | 4       | The body of a completed outbound HTTP call response. Immutable. |

---

## Request and Response Manipulation

### Header Manipulation (stream_context)

The global `stream_context` variable provides access to request and response headers for the current request.

**Import path**: `@gcoredev/proxy-wasm-sdk-as/assembly`

```typescript
declare var stream_context: {
  headers: {
    request:       HeaderStreamManipulator; // request headers
    response:      HeaderStreamManipulator; // response headers (response-phase hooks only)
    http_callback: HeaderStreamManipulator; // outbound HTTP call response headers
  };
};
```

Each manipulator exposes:

| Method                                       | Return Type | Description                                                                                                                                                        |
| -------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get(name: string): string`                  | `string`    | Get the value of a header by name.                                                                                                                                 |
| `add(name: string, value: string): void`     | `void`      | Add a header (does not replace existing).                                                                                                                          |
| `replace(name: string, value: string): void` | `void`      | Replace an existing header value.                                                                                                                                  |
| `remove(name: string): void`                 | `void`      | Remove a header. **Known limitation**: on the FastEdge CDN (nginx-based), `remove` sets the header value to an empty string rather than fully removing the header. |
| `get_headers(): Headers`                     | `Headers`   | Get all headers as an array of `HeaderPair`.                                                                                                                       |
| `set_headers(headers: Headers): void`        | `void`      | Replace all headers.                                                                                                                                               |

`Headers` type is `Array<HeaderPair>`. Use `makeHeaderPair` to construct entries.

**`HeaderPair` type:**

```typescript
class HeaderPair {
  key: ArrayBuffer;
  value: ArrayBuffer;

  constructor(header_key_data: ArrayBuffer, header_value_data: ArrayBuffer);
}

function makeHeaderPair(key: string, value: string): HeaderPair;
```

When reading `HeaderPair` fields from `get_headers()`, decode with `String.UTF8.decode()`:

```typescript
const pairs = stream_context.headers.request.get_headers();
for (let i = 0; i < pairs.length; i++) {
  const name = String.UTF8.decode(pairs[i].key);
  const value = String.UTF8.decode(pairs[i].value);
  log(LogLevelValues.info, name + ": " + value);
}
```

**Usage examples:**

```typescript
import {
  makeHeaderPair,
  stream_context,
  log,
  LogLevelValues,
} from "@gcoredev/proxy-wasm-sdk-as/assembly";

// Read a request header
const accept = stream_context.headers.request.get("accept");

// Add a response header (call from onResponseHeaders)
stream_context.headers.response.add("x-cache-status", "MISS");

// Replace all response headers
stream_context.headers.response.set_headers([
  makeHeaderPair("content-type", "application/json"),
  makeHeaderPair("x-powered-by", "fastedge"),
]);
```

### Body and Buffer Functions

**Import path**: `@gcoredev/proxy-wasm-sdk-as/assembly`

```typescript
function get_buffer_bytes(
  typ: BufferTypeValues,
  start: u32,
  length: u32,
): ArrayBuffer;

function set_buffer_bytes(
  typ: BufferTypeValues,
  start: u32,
  length: u32,
  value: ArrayBuffer,
): WasmResultValues;
```

`get_buffer_bytes`: reads a slice of the body or buffer starting at `start` for `length` bytes. Returns an empty `ArrayBuffer` (`byteLength == 0`) on failure or when the buffer is empty.

`set_buffer_bytes`: replaces the range `[start, start+length)` in the body or buffer with `value`. To replace the entire body, pass `start=0` and `length=body_buffer_length`.

**Reading and rewriting the request body:**

```typescript
import {
  FilterDataStatusValues,
  BufferTypeValues,
  get_buffer_bytes,
  set_buffer_bytes,
  log,
  LogLevelValues,
} from "@gcoredev/proxy-wasm-sdk-as/assembly";

onRequestBody(body_buffer_length: usize, end_of_stream: bool): FilterDataStatusValues {
  if (!end_of_stream) {
    return FilterDataStatusValues.StopIterationAndBuffer;
  }
  const body = get_buffer_bytes(
    BufferTypeValues.HttpRequestBody,
    0,
    body_buffer_length as u32,
  );
  const text = String.UTF8.decode(body);
  log(LogLevelValues.info, "Body: " + text);

  const modified = String.UTF8.encode('{"processed":true}');
  set_buffer_bytes(
    BufferTypeValues.HttpRequestBody,
    0,
    body_buffer_length as u32,
    modified,
  );
  return FilterDataStatusValues.Continue;
}
```

**Reading the outbound HTTP call response body:**

```typescript
const responseBody = get_buffer_bytes(
  BufferTypeValues.HttpCallResponseBody,
  0,
  body_size as u32,
);
```

### Request Properties

**Import path**: `@gcoredev/proxy-wasm-sdk-as/assembly`

```typescript
function get_property(path: string): ArrayBuffer;
function set_property(path: string, data: ArrayBuffer): WasmResultValues;
```

`get_property`: returns an empty `ArrayBuffer` (`byteLength == 0`) when the property is not found. Check `byteLength > 0` before decoding.

`set_property`: stores a custom property value accessible in later hooks via `get_property`. Does not modify the built-in properties listed below.

All properties below are UTF-8 encoded strings decoded with `String.UTF8.decode()`, except `response.status` which is a 2-byte big-endian unsigned 16-bit integer.

**Available properties on the FastEdge platform:**

| Property               | Encoding              | Description                                                             |
| ---------------------- | --------------------- | ----------------------------------------------------------------------- |
| `request.path`         | UTF-8 string          | URL path.                                                               |
| `request.query`        | UTF-8 string          | Query string.                                                           |
| `request.url`          | UTF-8 string          | Full request URL.                                                       |
| `request.host`         | UTF-8 string          | Domain; may have a `shield_` prefix on edge shield nodes.               |
| `request.scheme`       | UTF-8 string          | HTTP scheme derived from `X-Forwarded-Proto`.                           |
| `request.extension`    | UTF-8 string          | File extension of the request path.                                     |
| `request.x_real_ip`    | UTF-8 string          | Client IP address.                                                      |
| `request.country`      | UTF-8 string          | 2-letter ISO 3166-1 alpha-2 country code (geo-IP).                      |
| `request.country.name` | UTF-8 string          | Full country name.                                                      |
| `request.city`         | UTF-8 string          | City name.                                                              |
| `request.region`       | UTF-8 string          | Region or state name.                                                   |
| `request.continent`    | UTF-8 string          | Continent name.                                                         |
| `request.asn`          | UTF-8 string          | Autonomous System Number.                                               |
| `request.geo.lat`      | UTF-8 string          | Latitude of the client IP.                                              |
| `request.geo.long`     | UTF-8 string          | Longitude of the client IP.                                             |
| `response.status`      | 2-byte big-endian u16 | Response status code — **binary, not a UTF-8 string** (see note below). |

Geo properties (`request.country`, `request.country.name`, `request.city`, `request.region`, `request.continent`, `request.asn`, `request.geo.lat`, `request.geo.long`) are lazily computed from the client IP address.

**Reading a string property:**

```typescript
import {
  get_property,
  log,
  LogLevelValues,
} from "@gcoredev/proxy-wasm-sdk-as/assembly";

const buf = get_property("request.country");
if (buf.byteLength > 0) {
  const country = String.UTF8.decode(buf);
  log(LogLevelValues.info, "Country: " + country);
}
```

**Reading `response.status` — binary u16, big-endian:**

`response.status` is not a UTF-8 string. It is a 2-byte big-endian representation of the HTTP status code. Calling `String.UTF8.decode()` on it will produce garbage. Decode with byte manipulation:

```typescript
import { get_property } from "@gcoredev/proxy-wasm-sdk-as/assembly";

// Call from onResponseHeaders or onResponseBody only
const buf = get_property("response.status");
if (buf.byteLength >= 2) {
  const bytes = Uint8Array.wrap(buf);
  const status: u32 = ((bytes[0] as u32) << 8) | (bytes[1] as u32);
  log(LogLevelValues.info, "Status: " + status.toString());
}
```

### Response Generation

Send a response directly to the client, bypassing the origin server. Call from request-phase hooks to short-circuit the request.

**Import path**: `@gcoredev/proxy-wasm-sdk-as/assembly`

```typescript
function send_http_response(
  response_code: u32,
  response_code_details: string,
  body: ArrayBuffer,
  additional_headers: Headers,
): WasmResultValues;

function send_local_response(
  response_code: u32,
  response_code_details: string,
  body: ArrayBuffer,
  additional_headers: Headers,
  grpc_status: i32,
): WasmResultValues;
```

`send_http_response` is the preferred function. It is equivalent to `send_local_response` with `grpc_status` set to `-1`.

After calling `send_http_response`, return `FilterHeadersStatusValues.StopIteration` from a header hook, or `FilterDataStatusValues.StopIterationNoBuffer` from a body hook, to stop further processing.

```typescript
import {
  send_http_response,
  makeHeaderPair,
  FilterHeadersStatusValues,
  stream_context,
} from "@gcoredev/proxy-wasm-sdk-as/assembly";

onRequestHeaders(headers: u32, end_of_stream: bool): FilterHeadersStatusValues {
  const token = stream_context.headers.request.get("authorization");
  if (token.length == 0) {
    send_http_response(
      401,
      "Unauthorized",
      String.UTF8.encode("Missing Authorization header"),
      [
        makeHeaderPair("content-type", "text/plain"),
        makeHeaderPair("www-authenticate", "Bearer"),
      ],
    );
    return FilterHeadersStatusValues.StopIteration;
  }
  return FilterHeadersStatusValues.Continue;
}
```

---

## Outbound HTTP (httpCall)

Make an outbound HTTP call from the `RootContext`. The call is non-blocking: the host invokes the provided callback when the response arrives, then re-invokes the originating hook so processing can continue.

**Import path**: `@gcoredev/proxy-wasm-sdk-as/assembly` (method on `RootContext`)

```typescript
class RootContext {
  httpCall(
    cluster: string,
    headers: Headers,
    body: ArrayBuffer,
    trailers: Headers,
    timeout_milliseconds: u32,
    origin_context: BaseContext,
    cb: (
      origin_context: BaseContext,
      headers: u32,
      body_size: usize,
      trailers: u32,
    ) => void,
  ): WasmResultValues;
}
```

**Parameters:**

| Parameter              | Type                                                                                   | Description                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `cluster`              | `string`                                                                               | The upstream host to call. Must be a public host.                                                                        |
| `headers`              | `Headers`                                                                              | Request headers. Certain headers are automatically filtered by the host (`host`, `content-length`, `transfer-encoding`). |
| `body`                 | `ArrayBuffer`                                                                          | Request body. Pass `new ArrayBuffer(0)` for no body.                                                                     |
| `trailers`             | `Headers`                                                                              | Request trailers. Pass `[]` if none.                                                                                     |
| `timeout_milliseconds` | `u32`                                                                                  | Request timeout in milliseconds.                                                                                         |
| `origin_context`       | `BaseContext`                                                                          | The context to pass back to the callback. Pass `this` from within a `Context`.                                           |
| `cb`                   | `(origin_context: BaseContext, headers: u32, body_size: usize, trailers: u32) => void` | Callback invoked when the response is received.                                                                          |

In the callback, read response headers via `stream_context.headers.http_callback` and the body via `get_buffer_bytes(BufferTypeValues.HttpCallResponseBody, 0, body_size as u32)`. If `headers == 0`, the call failed (timeout or DNS failure).

### HTTP Call Resume Contract

The FastEdge runtime uses a host-driven resume model that differs from the generic proxy-wasm specification. When a lifecycle hook dispatches an outbound HTTP call and returns a pause value (`FilterHeadersStatusValues.StopIteration` or `StopAllIterationAndBuffer`), the runtime:

1. Awaits the HTTP response.
2. Invokes the `cb` callback. The SDK sets the effective context to `origin_context` before calling `cb`, so `stream_context.headers.http_callback` and `get_buffer_bytes(BufferTypeValues.HttpCallResponseBody, ...)` resolve against the originating request inside the callback.
3. **Re-invokes the same lifecycle hook** on the same `Context` instance. The hook must return `FilterHeadersStatusValues.Continue` to proceed, or dispatch another call and return a pause value again.

Because step 3 re-fires the hook, every hook that dispatches `httpCall` must gate re-dispatch with an instance-field latch. Without the latch, the hook dispatches a new HTTP call on every re-entry and the request loops until timeout.

Instance fields on `Context` do persist across the re-invocation in step 3. This is the one exception to the Hook State Isolation rule: it applies only to same-hook re-entry during an `httpCall` resume, not to transitions between different lifecycle hooks.

Use a **named module-level function** as the callback, not an anonymous arrow function. Named functions cannot close over mutable state and keep the dispatch call site readable:

```typescript
import {
  RootContext,
  Context,
  BaseContext,
  FilterHeadersStatusValues,
  WasmResultValues,
  BufferTypeValues,
  makeHeaderPair,
  get_buffer_bytes,
  stream_context,
  log,
  LogLevelValues,
  registerRootContext,
} from "@gcoredev/proxy-wasm-sdk-as/assembly";
export * from "@gcoredev/proxy-wasm-sdk-as/assembly/proxy";

function onUpstreamResponse(
  ctx: BaseContext,
  hdrs: u32,
  bodySize: usize,
  trls: u32,
): void {
  if (hdrs == 0) {
    log(LogLevelValues.warn, "HTTP call failed — timeout or DNS");
    return;
  }
  const body = get_buffer_bytes(
    BufferTypeValues.HttpCallResponseBody,
    0,
    bodySize as u32,
  );
  const self = ctx as MyContext;
  log(LogLevelValues.info, "Response: " + String.UTF8.decode(body));
}

class MyRootContext extends RootContext {
  createContext(context_id: u32): Context {
    return new MyContext(context_id, this);
  }
}

class MyContext extends Context {
  httpCallDispatched: bool = false;

  constructor(context_id: u32, root_context: MyRootContext) {
    super(context_id, root_context);
  }

  onRequestHeaders(
    headers: u32,
    end_of_stream: bool,
  ): FilterHeadersStatusValues {
    if (this.httpCallDispatched) {
      return FilterHeadersStatusValues.Continue;
    }

    const result = (this.root_context as MyRootContext).httpCall(
      "api.example.com",
      [
        makeHeaderPair(":method", "GET"),
        makeHeaderPair(":path", "/data"),
        makeHeaderPair(":scheme", "https"),
        makeHeaderPair(":authority", "api.example.com"),
        makeHeaderPair("accept", "application/json"),
      ],
      new ArrayBuffer(0),
      [],
      5000,
      this,
      onUpstreamResponse,
    );

    if (result != WasmResultValues.Ok) {
      log(LogLevelValues.error, "httpCall dispatch failed: " + result.toString());
      return FilterHeadersStatusValues.Continue;
    }

    this.httpCallDispatched = true;
    return FilterHeadersStatusValues.StopIteration;
  }
}

registerRootContext(
  (context_id: u32) => new MyRootContext(context_id),
  "http-call-example",
);
```

If the response handler needs access to `Context` state, downcast `ctx` inside the handler: `const self = ctx as MyContext;`.

---

## Logging

**Import path**: `@gcoredev/proxy-wasm-sdk-as/assembly`

```typescript
function log(level: LogLevelValues, message: string): void;
```

`console.log` is not available in the WebAssembly environment. Use `log` to emit messages through the proxy-wasm host to standard output.

The minimum log level defaults to `LogLevelValues.info`. Messages with a level below the minimum are suppressed. Use `setLogLevel` (from `assembly/fastedge`) to change the minimum level at runtime.

```typescript
import { log, LogLevelValues } from "@gcoredev/proxy-wasm-sdk-as/assembly";

log(LogLevelValues.info, "Request received");
log(LogLevelValues.warn, "Unexpected header value: " + value);
log(LogLevelValues.error, "Failed to open KV store");
log(LogLevelValues.critical, "Aborting: " + message);
```

---

## Registration

**Import path**: `@gcoredev/proxy-wasm-sdk-as/assembly`

```typescript
function registerRootContext(
  context_factory: (context_id: u32) => RootContext,
  name: string,
): void;
```

Call exactly once at module scope, after class definitions. The `name` parameter is accepted for API compatibility with the proxy-wasm spec but is ignored by the FastEdge runtime. The value does not need to match any configuration — pass any descriptive string.

```typescript
registerRootContext(
  (context_id: u32) => new MyRootContext(context_id),
  "my-filter",
);
```

---

## FastEdge Host APIs

APIs specific to the FastEdge platform; not part of the core proxy-wasm specification.

**Import path for all FastEdge APIs**: `@gcoredev/proxy-wasm-sdk-as/assembly/fastedge`

### Environment Variables (getEnv)

Read environment variables configured at deployment time via the FastEdge platform. Uses the standard WASI environment interface (subject to a 64 KB per-variable size limit).

```typescript
function getEnv(name: string): string;
```

Returns the value of the environment variable, or an empty string if the variable is not set.

```typescript
import { getEnv } from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";
import { log, LogLevelValues } from "@gcoredev/proxy-wasm-sdk-as/assembly";

const blocklist = getEnv("BLOCKLIST");
if (blocklist.length == 0) {
  log(LogLevelValues.warn, "BLOCKLIST env var is not set");
}
```

### Dictionary (getDictionary)

Read dictionary values using the proxy-wasm `proxy_dictionary_get` host call. This bypasses the 64 KB WASI environment variable size limit and should be used when a value may be larger than 64 KB (e.g. large JSON configs, PEM certificates, policy documents).

```typescript
function getDictionary(name: string): string;
```

Returns the value, or an empty string if not found.

| Function              | Use when                                   |
| --------------------- | ------------------------------------------ |
| `getEnv(name)`        | Variable value is under 64 KB (most cases) |
| `getDictionary(name)` | Variable value may exceed 64 KB            |

```typescript
import { getDictionary } from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";
import { log, LogLevelValues } from "@gcoredev/proxy-wasm-sdk-as/assembly";

const config = getDictionary("LARGE_CONFIG");
log(LogLevelValues.info, "Config size: " + config.length.toString() + " bytes");
```

### Secrets (getSecret, getSecretEffectiveAt)

Read secret values stored in the FastEdge secrets store. Secrets are configured via the platform and are not visible in logs or configuration files.

```typescript
function getSecret(name: string): string;
function getSecretEffectiveAt(name: string, effectiveAt: u32): string;
```

`getSecret`: returns the current value of the named secret, or an empty string if not found.

`getSecretEffectiveAt`: reads a secret from a specific rotation slot. Slots are defined in the FastEdge UI and are always numeric (e.g., incremental integers, or timestamp-style values representing a point in time). Use this for secret rotation: pass the current Unix timestamp in seconds as `effectiveAt`. The host selects the slot where `effectiveAt >= secret_slots.slot`.

```typescript
import {
  getSecret,
  getSecretEffectiveAt,
  getCurrentTime,
} from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";

// Read the current secret value
const apiKey = getSecret("API_KEY");

// Read the secret effective at the current time (for rotation support)
const currentTimeMs = getCurrentTime();
const currentTimeSec = (currentTimeMs / 1000) as u32;
const rotatingKey = getSecretEffectiveAt("SIGNING_KEY", currentTimeSec);
```

### Key-Value Store (KvStore)

Query data from a FastEdge KV store. KV stores are configured and populated via the platform before deployment.

**Import path**: `@gcoredev/proxy-wasm-sdk-as/assembly/fastedge`

#### Opening a Store

```typescript
class KvStore {
  static open(storeName: string): KvStore | null;
}
```

Returns a `KvStore` instance, or `null` if the store cannot be opened (e.g., the store name is not configured for this plugin).

#### KvStore Methods

| Method                                                              | Return Type           | Description                                                            |
| ------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------- |
| `get(key: string): ArrayBuffer \| null`                             | `ArrayBuffer \| null` | Get the raw bytes for a key. `null` if not found.                      |
| `scan(pattern: string): string[]`                                   | `string[]`            | Glob-style key scan. Pattern must include a wildcard (e.g., `"foo*"`). |
| `zrangeByScore(key: string, min: f64, max: f64): ValueScoreTuple[]` | `ValueScoreTuple[]`   | Sorted set range query: returns entries where `min <= score <= max`.    |
| `zscan(key: string, pattern: string): ValueScoreTuple[]`            | `ValueScoreTuple[]`   | Sorted set pattern scan: matches values against the glob pattern.      |
| `bfExists(key: string, item: string): bool`                         | `bool`                | Bloom filter membership check. Returns `true` if item may exist.       |

`get` returns `ArrayBuffer | null` — the caller must decode the buffer.

#### ValueScoreTuple

`zrangeByScore` and `zscan` return arrays of `ValueScoreTuple`. The `value` field is raw bytes; decode with `String.UTF8.decode()`.

```typescript
class ValueScoreTuple {
  value: ArrayBuffer; // The stored value bytes
  score: f64;         // The associated score

  constructor(value: ArrayBuffer, score: f64);
}
```

**Usage examples:**

```typescript
import { KvStore } from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";
import { log, LogLevelValues } from "@gcoredev/proxy-wasm-sdk-as/assembly";

const store = KvStore.open("my-store");
if (store == null) {
  log(LogLevelValues.error, "Could not open KV store");
} else {
  // Simple key lookup
  const value = store.get("user:12345");
  if (value != null) {
    const text = String.UTF8.decode(value);
    log(LogLevelValues.info, "Got: " + text);
  }

  // Key prefix scan
  const keys = store.scan("session:*");
  for (let i = 0; i < keys.length; i++) {
    log(LogLevelValues.info, "Key: " + keys[i]);
  }
}
```

```typescript
import {
  KvStore,
  ValueScoreTuple,
} from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";
import { log, LogLevelValues } from "@gcoredev/proxy-wasm-sdk-as/assembly";

const store = KvStore.open("rate-limits");
if (store != null) {
  // Range query by score
  const entries = store.zrangeByScore("ip-scores", 0.0, 100.0);
  for (let i = 0; i < entries.length; i++) {
    const ip = String.UTF8.decode(entries[i].value);
    const score = entries[i].score;
    log(LogLevelValues.info, ip + " => " + score.toString());
  }

  // Pattern scan over sorted set values
  const matches = store.zscan("ip-scores", "192.168.*");
  for (let i = 0; i < matches.length; i++) {
    const ip = String.UTF8.decode(matches[i].value);
    log(LogLevelValues.info, "Matched IP: " + ip);
  }

  // Bloom filter membership test
  const isBlocked = store.bfExists("blocked-ips", "10.0.0.1");
  if (isBlocked) {
    log(LogLevelValues.warn, "IP may be in blocklist");
  }
}
```

### Runtime Utilities (getCurrentTime, setLogLevel)

**Import path**: `@gcoredev/proxy-wasm-sdk-as/assembly/fastedge`

```typescript
function getCurrentTime(): u64;
function setLogLevel(level: LogLevelValues): void;
```

`getCurrentTime`: returns the current time in **milliseconds** since the Unix epoch.

`setLogLevel`: sets the minimum log level for the `log` function. Messages below the minimum level are silently dropped. Default minimum level is `LogLevelValues.info`. Call from `onStart` to configure at startup.

**Constraint**: `setLogLevel` is exported from `assembly/fastedge`, not from `assembly`. Importing it from `@gcoredev/proxy-wasm-sdk-as/assembly` will not compile.

```typescript
import {
  getCurrentTime,
  setLogLevel,
  LogLevelValues,
} from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";

// Lower the minimum level during development
setLogLevel(LogLevelValues.debug);

// Get current time
const nowMs: u64 = getCurrentTime();
const nowSec: u32 = (nowMs / 1000) as u32;
```

---

## Deprecated Functions

Exported but must not be used in new code. Will be removed in a future version.

**Import path**: `@gcoredev/proxy-wasm-sdk-as/assembly/fastedge`

| Deprecated Function                                               | Replacement                               |
| ----------------------------------------------------------------- | ----------------------------------------- |
| `getEnvVar(name: string): string`                                 | `getEnv(name)`                            |
| `getSecretVar(name: string): string`                              | `getSecret(name)`                         |
| `getSecretVarEffectiveAt(name: string, effectiveAt: u32): string` | `getSecretEffectiveAt(name, effectiveAt)` |

---

## See Also

- FastEdge quickstart guide (step-by-step guide to creating your first FastEdge plugin)
- FastEdge CDN app examples (usage patterns for CDN filter applications)
- Platform overview (FastEdge platform architecture and deployment model)
- Best practices (performance, security, and reliability guidance for FastEdge plugins)
