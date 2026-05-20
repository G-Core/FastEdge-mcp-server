<!--
  auto-updated: true
  sources:
    - id: proxy-wasm-sdk-as
      ref: master
      commit: 20b31c05b39c5537fb1ac7cc8693d9d8ec314f25
      updated: 2026-04-15
-->

# CDN Runtime Properties — AssemblyScript

Language: AssemblyScript | SDK: `@gcoredev/proxy-wasm-sdk-as` | App type: CDN

## Overview

Demonstrates reading and mutating FastEdge CDN runtime properties using `get_property()` and `set_property()`. All known request properties are read in `onRequestHeaders`, logged, and exposed as response headers. Property override via query parameters is also shown.

---

## API Reference

### `get_property(path: string): ArrayBuffer`

Reads a runtime property by path. Returns an `ArrayBuffer`. A zero-length buffer (`byteLength === 0`) indicates the property is absent or unavailable in the current lifecycle phase.

**Parameters**
| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Dot-separated property path (see property catalog below) |

**Return value**: `ArrayBuffer` — raw bytes of the property value. Length zero means property is unavailable.

**Decoding**: Most properties are UTF-8 strings. Decode with `String.UTF8.decode(arrayBuffer)`. Exception: `response.status` is a 2-byte big-endian `u16` — NOT a UTF-8 string (see Gotchas).

---

### `set_property(path: string, value: ArrayBuffer): void`

Mutates a runtime property. Effective immediately within the current request context.

**Parameters**
| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Dot-separated property path to mutate |
| `value` | `ArrayBuffer` | New value as raw bytes. For string values, encode with `String.UTF8.encode(str)` |

**Writable properties** (confirmed from source): `request.url`, `request.host`, `request.path`

---

## Property Catalog

### Request Properties

Available in `onRequestHeaders`. All return UTF-8 encoded strings unless noted.

| Property path | Constant | Description | Response header (example) | Error code (example) |
|---|---|---|---|---|
| `request.url` | `REQUEST_URI` | Full request URL | `request-uri` | 551 |
| `request.host` | `REQUEST_HOST` | Host header value | _(logged only)_ | 552 |
| `request.path` | `REQUEST_PATH` | URL path component | `request-path` | 553 |
| `request.scheme` | `REQUEST_SCHEME` | Protocol scheme (`http` / `https`) | `request-scheme` | 554 |
| `request.extension` | `REQUEST_EXTENSION` | File extension from path | `request-extension` | 555 |
| `request.query` | `REQUEST_QUERY` | Raw query string | `request-query` | 556 |
| `request.x_real_ip` | `REQUEST_X_REAL_IP` | Client IP address | `request-x-real-ip` | 557 |
| `request.country` | `REQUEST_COUNTRY` | Client country (geo) | `request-country` | 558 |
| `request.city` | `REQUEST_CITY` | Client city (geo) | `request-city` | 559 |
| `request.var` | `REQUEST_VAR` | CDN variable | _(logged only)_ | 560 |

**Note**: The README notes this list does not cover all available properties. Consult the CDN Properties documentation for the full list.

---

## Lifecycle Phase Availability

| Property | `onRequestHeaders` | `onResponseHeaders` | `onLog` |
|---|---|---|---|
| `request.*` | Available | Available (read-only after routing) | Available |
| `response.status` | Not available | Available | Available |

`onLog` phase: Only logging is performed in this example (`this.context_id` access shown). Property reads are not demonstrated in `onLog`.

---

## Usage Patterns

### Read a string property

```typescript
const valueArr = get_property("request.path");
if (valueArr.byteLength === 0) {
  // Property unavailable — handle error
  send_http_response(553, "internal server error", String.UTF8.encode("Internal server error"), []);
  return FilterHeadersStatusValues.StopIteration;
}
const value = String.UTF8.decode(valueArr);
```

### Add property value as response header

```typescript
stream_context.headers.response.add("request-path", value);
```

### Mutate a request property

```typescript
set_property("request.url", String.UTF8.encode("https://example.com/new-path"));
set_property("request.host", String.UTF8.encode("example.com"));
set_property("request.path", String.UTF8.encode("/new-path"));
```

### Parse query string and conditionally override properties

```typescript
const query = get_property("request.query");
if (query.byteLength !== 0) {
  const queryString = String.UTF8.decode(query);
  const params = queryString.split("&").map<Array<string>>((pair) => pair.split("="));
  for (let i = 0; i < params.length; i++) {
    const param = params[i];
    if (param.length !== 2) continue;
    const key = param[0];
    const value = param[1];
    if (key.toLowerCase() === "url") {
      set_property("request.url", String.UTF8.encode(value));
    } else if (key.toLowerCase() === "host") {
      set_property("request.host", String.UTF8.encode(value));
    } else if (key.toLowerCase() === "path") {
      set_property("request.path", String.UTF8.encode(value));
    }
  }
}
```

---

## Complete Example Structure

```typescript
import {
  Context,
  FilterHeadersStatusValues,
  get_property,
  log,
  LogLevelValues,
  registerRootContext,
  RootContext,
  send_http_response,
  set_property,
  stream_context,
} from "@gcoredev/proxy-wasm-sdk-as/assembly";

class PropertiesRoot extends RootContext {
  createContext(context_id: u32): Context {
    return new Properties(context_id, this);
  }
}

class Properties extends Context {
  constructor(context_id: u32, root_context: PropertiesRoot) {
    super(context_id, root_context);
  }

  onRequestHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues {
    // Read and expose all known properties as response headers
    // Return FilterHeadersStatusValues.StopIteration on any missing property
    // Return FilterHeadersStatusValues.Continue on success
  }

  onLog(): void {
    log(LogLevelValues.info, "onLog >> completed (contextId): " + this.context_id.toString());
  }
}

registerRootContext((context_id: u32) => {
  return new PropertiesRoot(context_id);
}, "properties");
```

**Entry point export** (required):
```typescript
export * from "@gcoredev/proxy-wasm-sdk-as/assembly/proxy";
```

---

## Error Handling Pattern

Each property read uses a dedicated numeric error code to identify which property was absent:

```typescript
function handleProperty(
  propertyKey: string,
  errorCode: u32,
  propertyName?: string,
  headerName?: string
): boolean {
  const valueArr = get_property(propertyKey);
  if (valueArr.byteLength === 0) {
    send_http_response(errorCode, "internal server error", String.UTF8.encode("Internal server error"), []);
    return false;
  }
  const value = String.UTF8.decode(valueArr);
  if (propertyName) {
    log(LogLevelValues.info, "onRequestHeaders >> " + propertyName + ": " + value);
  }
  if (headerName) {
    stream_context.headers.response.add(headerName, value);
  }
  return true;
}
```

Caller pattern:
```typescript
if (!handleProperty(REQUEST_PATH, 553, "path", "request-path")) {
  return FilterHeadersStatusValues.StopIteration;
}
```

---

## Build

```sh
pnpm install
pnpm run asbuild
```

| Output file | Description |
|---|---|
| `build/properties.wasm` | Release binary — upload to FastEdge |
| `build/properties-debug.wasm` | Debug binary with source maps |

**`package.json` scripts**:
- `asbuild:debug` — `asc assembly/index.ts --target debug`
- `asbuild:release` — `asc assembly/index.ts --target release`
- `asbuild` — runs both

**Dependencies**:
- `@gcoredev/proxy-wasm-sdk-as` (local workspace reference)
- `assemblyscript` ^0.28.9 (dev)
- `@assemblyscript/wasi-shim` ^0.1.0 (dev)

---

## Deploy

Upload `build/properties.wasm` to the FastEdge portal and attach to a CDN application. No environment variables required.

---

## Gotchas

- **`get_property` returns `ArrayBuffer`, never `null`**: Check `byteLength === 0` to detect a missing or unavailable property. Do not perform a null check.
- **`response.status` is binary, not a string**: It is a 2-byte big-endian `u16`. Decoding it with `String.UTF8.decode()` produces garbage. Read it with a `DataView` or typed array instead.
- **`request.var` has no documented sub-path in this example**: It is fetched and checked for availability but its value is not logged or added as a response header. Its semantics depend on CDN variable configuration.
- **`set_property` on request properties takes effect immediately** for subsequent property reads and downstream filter processing within the same request.
- **Lifecycle constraint**: Request properties (`request.*`) are only meaningful during request processing phases. Attempting to read them in isolation outside `onRequestHeaders` or `onRequestBody` may yield empty buffers.
- **Query parameter parsing is manual**: The SDK provides no built-in query string parser. Split on `&`, then on `=`, and validate `param.length === 2` before accessing indices.

---

## See Also

- CDN Properties — full list of available property paths on the Gcore platform
- proxy-wasm-sdk-as API reference — `get_property`, `set_property`, `send_http_response`, `stream_context` signatures
- examples-headers-as — request/response header manipulation patterns
- examples-redirect-as — redirect using `send_http_response`
