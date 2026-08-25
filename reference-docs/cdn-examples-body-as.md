<!--
  auto-updated: true
  sources:
    - id: proxy-wasm-sdk-as
      ref: master
      commit: 8e3bb621bc013a0aed7e52122066b417ad62a207
      updated: 2026-08-20
-->

---
title: Body Manipulation — AssemblyScript (CDN)
type: example
app_type: cdn
languages: [assemblyscript]
capabilities: [body-manipulation, request-body, response-body, header-modification, logging, properties]
---

# Body Manipulation — AssemblyScript (CDN)

Demonstrates full request and response body inspection and modification using the proxy-wasm lifecycle hooks. Shows the required coordination between header hooks and body hooks, and the buffering pattern needed to operate on complete bodies.

## Package

- **npm package name**: `fastedge-as-example-body`
- **SDK dependency**: `@gcoredev/proxy-wasm-sdk-as` (local file reference in example; use published version in production)
- **Build tool**: AssemblyScript compiler (`asc`) via `assemblyscript ^0.28.9`
- **Dev dependency**: `@assemblyscript/wasi-shim ^0.1.0`

## Build Outputs

| File | Description |
|---|---|
| `build/body.wasm` | Optimised release binary — upload this to FastEdge |
| `build/body-debug.wasm` | Debug binary with source maps |

Build commands:
- `npm run asbuild:release` — release binary
- `npm run asbuild:debug` — debug binary
- `npm run asbuild` — both

## Class Structure

```
HttpBodyRoot extends RootContext
  └── createContext(context_id: u32): Context → HttpBody

HttpBody extends Context
  ├── onRequestHeaders(headers: u32, end_of_stream: bool): FilterHeadersStatusValues
  ├── onRequestBody(body_buffer_length: usize, end_of_stream: bool): FilterDataStatusValues
  ├── onResponseHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues
  ├── onResponseBody(body_buffer_length: usize, end_of_stream: bool): FilterDataStatusValues
  └── onLog(): void
```

Root context registered with plugin name `"httpbody"`.

## Imports

```typescript
import {
  BufferTypeValues,
  Context,
  FilterDataStatusValues,
  FilterHeadersStatusValues,
  get_buffer_bytes,
  get_property,
  log,
  LogLevelValues,
  registerRootContext,
  RootContext,
  set_buffer_bytes,
  set_property,
  stream_context,
} from "@gcoredev/proxy-wasm-sdk-as/assembly";
import { setLogLevel } from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";
```

## Lifecycle Hook Signatures and Behaviour

### `onRequestHeaders(headers: u32, end_of_stream: bool): FilterHeadersStatusValues`

Runs before request body processing. Must remove `content-length` when the body will be modified — failure to do so causes downstream length mismatch errors.

**Actions performed:**
- `stream_context.headers.request.remove("content-length")`

**Return value:** `FilterHeadersStatusValues.Continue`

---

### `onRequestBody(body_buffer_length: usize, end_of_stream: bool): FilterDataStatusValues`

Processes the request body. Uses the buffering pattern: returns `StopIterationAndBuffer` until `end_of_stream` is `true`, at which point the complete body is available.

**Parameters:**
| Parameter | Type | Description |
|---|---|---|
| `body_buffer_length` | `usize` | Byte length of the currently buffered body |
| `end_of_stream` | `bool` | `true` when the full body has been received |

**Buffering pattern:**
```typescript
if (!end_of_stream) {
  return FilterDataStatusValues.StopIterationAndBuffer;
}
```

**Body read:**
```typescript
const bodyBytes = get_buffer_bytes(
  BufferTypeValues.HttpRequestBody,
  0,
  <u32>body_buffer_length
);
```

**Body replace (conditional):**
```typescript
set_buffer_bytes(
  BufferTypeValues.HttpRequestBody,
  0,
  <u32>body_buffer_length,
  String.UTF8.encode(newBody)
);
```

Replacement is conditional: only fires when the decoded body string includes `"Client"`. The replacement string is: `` `Original message body (${body_buffer_length.toString()} bytes) redacted.\n` ``

**Return values:**
| Condition | Return value |
|---|---|
| Body not yet complete | `FilterDataStatusValues.StopIterationAndBuffer` |
| Body complete | `FilterDataStatusValues.Continue` |

---

### `onResponseHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues`

Runs before response body processing. Must adjust headers when body size will change.

**Actions performed:**
1. `stream_context.headers.response.remove("content-length")` — required because body size will change
2. `stream_context.headers.response.replace("transfer-encoding", "Chunked")` — set chunked encoding
3. Read `content-type` from response headers and store as a runtime property:
   ```typescript
   const contentType = stream_context.headers.response.get("content-type");
   if (contentType.length > 0) {
     set_property("response.content_type", String.UTF8.encode(contentType));
   }
   ```

**Return value:** `FilterHeadersStatusValues.Continue`

---

### `onResponseBody(body_buffer_length: usize, end_of_stream: bool): FilterDataStatusValues`

Inspects the response body. Uses the same buffering pattern as `onRequestBody`.

**Parameters:**
| Parameter | Type | Description |
|---|---|---|
| `body_buffer_length` | `usize` | Byte length of the currently buffered body |
| `end_of_stream` | `bool` | `true` when full response body has been received |

**Buffering pattern:**
```typescript
if (!end_of_stream) {
  return FilterDataStatusValues.StopIterationAndBuffer;
}
```

**Property reads (after buffering complete):**
```typescript
const urlBytes = get_property("request.url");
const url = urlBytes.byteLength === 0 ? "" : String.UTF8.decode(urlBytes);

const contentTypeBytes = get_property("response.content_type");
const contentType =
  contentTypeBytes.byteLength === 0
    ? ""
    : String.UTF8.decode(contentTypeBytes);
```

**Body read:**
```typescript
const bodyBytes = get_buffer_bytes(
  BufferTypeValues.HttpResponseBody,
  0,
  <u32>body_buffer_length
);
```

**Return values:**
| Condition | Return value |
|---|---|
| Body not yet complete | `FilterDataStatusValues.StopIterationAndBuffer` |
| Body complete | `FilterDataStatusValues.Continue` |

---

### `onLog(): void`

Runs at end of request lifecycle. Logs context ID at `info` level.

```typescript
log(LogLevelValues.info, "onLog >> completed (contextId): " + this.context_id.toString());
```

## API Reference

### `get_buffer_bytes`

```typescript
get_buffer_bytes(
  type: BufferTypeValues,
  start: u32,
  length: u32
): ArrayBuffer
```

Reads bytes from the specified buffer. Returns an `ArrayBuffer`; check `byteLength > 0` before decoding.

**Relevant `BufferTypeValues`:**
| Value | Buffer |
|---|---|
| `BufferTypeValues.HttpRequestBody` | Request body |
| `BufferTypeValues.HttpResponseBody` | Response body |

---

### `set_buffer_bytes`

```typescript
set_buffer_bytes(
  type: BufferTypeValues,
  start: u32,
  size: u32,
  data: ArrayBuffer
): void
```

Replaces the contents of the specified buffer. `size` must be the original buffer length (from `body_buffer_length`). `data` is the replacement `ArrayBuffer`.

---

### `get_property`

```typescript
get_property(path: string): ArrayBuffer
```

Reads a named runtime property. Returns empty `ArrayBuffer` (`byteLength === 0`) when the property is not set. Decode with `String.UTF8.decode(bytes)`.

**Properties read in this example:**
| Property path | Description |
|---|---|
| `"request.url"` | Full request URL |
| `"response.content_type"` | Response content-type (stored via `set_property` in `onResponseHeaders`) |

---

### `set_property`

```typescript
set_property(path: string, value: ArrayBuffer): void
```

Stores a named runtime property. Properties set in one hook are accessible in later hooks within the same request lifecycle.

**Properties set in this example:**
| Property path | Source |
|---|---|
| `"response.content_type"` | Value of `content-type` response header, set in `onResponseHeaders` |

---

### `stream_context.headers.request` / `stream_context.headers.response`

Header manipulation API:

| Method | Signature | Description |
|---|---|---|
| `remove` | `remove(name: string): void` | Removes a header by name |
| `replace` | `replace(name: string, value: string): void` | Sets or replaces a header value |
| `get` | `get(name: string): string` | Reads a header value; returns empty string if absent |

---

### `log`

```typescript
log(level: LogLevelValues, message: string): void
```

**`LogLevelValues` used:**
| Level | Usage |
|---|---|
| `LogLevelValues.debug` | Hook entry tracing, body content logging |
| `LogLevelValues.info` | URL, content-type, body summary, onLog |

Log level is set in `createContext` via `setLogLevel(LogLevelValues.info)`. At `info` level, `debug` logs are suppressed.

## Buffering Pattern — Critical Details

- Body hooks (`onRequestBody`, `onResponseBody`) may fire multiple times for large or streaming bodies.
- Return `FilterDataStatusValues.StopIterationAndBuffer` until `end_of_stream === true` to ensure the full body is available.
- `body_buffer_length` reflects the accumulated buffer size at each invocation.
- Body hooks only fire when the request or response actually has a body. For requests without a body (e.g. GET), `onRequestBody` is not called.

## Header–Body Coordination — Required Steps

When modifying body content:
1. Remove `content-length` in the corresponding headers hook (`onRequestHeaders` or `onResponseHeaders`) before body processing occurs.
2. For response body changes, set `transfer-encoding: Chunked` in `onResponseHeaders`.
3. Header hooks always run before their corresponding body hooks within the same request lifecycle.

## Constraints and Gotchas

- **Body size**: Buffering the entire body into memory (`StopIterationAndBuffer`) holds the full request or response body in WASM memory. Large bodies increase memory usage proportionally. No explicit size limit is enforced in the SDK, but the FastEdge platform applies its own limits.
- **Streaming vs buffered**: Returning `StopIterationAndBuffer` prevents downstream processing until the full body is available. For pass-through (no modification needed), return `Continue` immediately to preserve streaming behaviour.
- **`content-length` mismatch**: If the body is replaced but `content-length` is not removed beforehand, the downstream may receive a length mismatch and reject or truncate the body.
- **`get_property` empty check**: Always check `byteLength === 0` before decoding a property value. Skipping this check causes a decode error on empty buffers.
- **`set_property` scope**: Properties are scoped to the current request lifecycle. They are not persisted across requests.
- **Log level filtering**: `setLogLevel` is called per-context in `createContext`. Set to `LogLevelValues.debug` to see all debug-level hook entry logs.
- **`content-type` property path**: The example stores `content-type` from the response headers under `"response.content_type"` in `onResponseHeaders` and reads it back under `"response.content_type"` in `onResponseBody`. Property paths are arbitrary strings — both the write path and read path must match exactly.

## Deployment

1. Build: `npm run asbuild:release`
2. Upload `build/body.wasm` to the FastEdge portal
3. Attach the binary to a CDN application

## See Also

- proxy-wasm-sdk-as API reference
- host-services-rust (for equivalent Rust patterns)
- platform-overview (CDN app lifecycle, hook execution order)
- examples-headers-as (header-only manipulation without body buffering)
