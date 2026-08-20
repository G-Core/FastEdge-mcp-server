<!--
  auto-updated: true
  sources:
    - id: proxy-wasm-sdk-as
      ref: master
      commit: 8e3bb621bc013a0aed7e52122066b417ad62a207
      updated: 2026-08-20
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
| `request.host` | `REQUEST_HOST` | Host header value | _(validated only)_ | 552 |
| `request.path` | `REQUEST_PATH` | URL path component | `request-path` | 553 |
| `request.scheme` | `REQUEST_SCHEME` | Protocol scheme (`http` / `https`) | `request-scheme` | 554 |
| `request.extension` | `REQUEST_EXTENSION` | File extension from path (optional) | `request-extension` | 555 _(never triggered)_ |
| `request.query` | `REQUEST_QUERY` | Raw query string (optional) | `request-query` | 556 _(never triggered)_ |
| `request.x_real_ip` | `REQUEST_X_REAL_IP` | Client IP address | `request-x-real-ip` | 557 |
| `request.country` | `REQUEST_COUNTRY` | Client country (geo) | `request-country` | 558 |
| `request.city` | `REQUEST_CITY` | Client city (geo) | `request-city` | 559 |

**Optional properties**: `request.extension` and `request.query` are fetched with `allowEmpty: true`. If absent, they are logged with an empty value and processing continues without adding a response header. Their error codes (555, 556) are never triggered.

**Note**: This list does not cover all available properties. Consult the CDN Properties documentation for the full list.

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
const query = get_property(REQUEST_QUERY);
if (query.byteLength !== 0) {
  const queryString = String.UTF8.decode(query);
  log(LogLevelValues.info, "query=" + queryString);
  const params = queryString
    .split("&")
    .map<Array<string>>((pair) => pair.split("="));

  for (let i = 0; i < params.length; i++) {
    const param = params[i];
    if (param.length !== 2) {
      continue; // Skip invalid query parameters
    }
    const key = param[0];
    const value = param[1];
    if (key.toLowerCase() === "url") {
      log(LogLevelValues.info, `change url to: ${value}`);
      set_property(REQUEST_URI, String.UTF8.encode(value));
    } else if (key.toLowerCase() === "host") {
      log(LogLevelValues.info, `change host to: ${value}`);
      set_property(REQUEST_HOST, String.UTF8.encode(value));
    } else if (key.toLowerCase() === "path") {
      log(LogLevelValues.info, `change path to: ${value}`);
      set_property(REQUEST_PATH, String.UTF8.encode(value));
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
import {
  setLogLevel,
} from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";

const REQUEST_URI = "request.url";
const REQUEST_HOST = "request.host";
const REQUEST_PATH = "request.path";
const REQUEST_SCHEME = "request.scheme";
const REQUEST_EXTENSION = "request.extension";
const REQUEST_QUERY = "request.query";
const REQUEST_X_REAL_IP = "request.x_real_ip";
const REQUEST_COUNTRY = "request.country";
const REQUEST_CITY = "request.city";

class PropertiesRoot extends RootContext {
  createContext(context_id: u32): Context {
    setLogLevel(LogLevelValues.info);
    return new Properties(context_id, this);
  }
}

class Properties extends Context {
  constructor(context_id: u32, root_context: PropertiesRoot) {
    super(context_id, root_context);
  }

  onRequestHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues {
    // Error codes 551–559 identify the absent property via the HTTP response status:
    // 551=uri 552=host 553=path 554=scheme 555=extension 556=query 557=x_real_ip 558=country 559=city
    if (!this.handleProperty(REQUEST_URI, 551, "uri", "request-uri")) {
      return FilterHeadersStatusValues.StopIteration;
    }

    // host must be present for upstream routing; validated but not logged or exposed as a response header
    if (!this.handleProperty(REQUEST_HOST, 552)) {
      return FilterHeadersStatusValues.StopIteration;
    }

    if (!this.handleProperty(REQUEST_PATH, 553, "path", "request-path")) {
      return FilterHeadersStatusValues.StopIteration;
    }

    if (!this.handleProperty(REQUEST_SCHEME, 554, "scheme", "request-scheme")) {
      return FilterHeadersStatusValues.StopIteration;
    }

    if (!this.handleProperty(REQUEST_EXTENSION, 555, "extension", "request-extension", true)) {
      return FilterHeadersStatusValues.StopIteration;
    }

    if (!this.handleProperty(REQUEST_QUERY, 556, "query", "request-query", true)) {
      return FilterHeadersStatusValues.StopIteration;
    }

    if (!this.handleProperty(REQUEST_X_REAL_IP, 557, "client_ip", "request-x-real-ip")) {
      return FilterHeadersStatusValues.StopIteration;
    }

    if (!this.handleProperty(REQUEST_COUNTRY, 558, "country", "request-country")) {
      return FilterHeadersStatusValues.StopIteration;
    }

    if (!this.handleProperty(REQUEST_CITY, 559, "city", "request-city")) {
      return FilterHeadersStatusValues.StopIteration;
    }

    // Handle query parameters — override request.url, request.host, request.path via url=, host=, path= params
    const query = get_property(REQUEST_QUERY);
    if (query.byteLength !== 0) {
      const queryString = String.UTF8.decode(query);
      log(LogLevelValues.info, "query=" + queryString);
      const params = queryString
        .split("&")
        .map<Array<string>>((pair) => pair.split("="));

      for (let i = 0; i < params.length; i++) {
        const param = params[i];
        if (param.length !== 2) {
          continue;
        }
        const key = param[0];
        const value = param[1];
        if (key.toLowerCase() === "url") {
          log(LogLevelValues.info, `change url to: ${value}`);
          set_property(REQUEST_URI, String.UTF8.encode(value));
        } else if (key.toLowerCase() === "host") {
          log(LogLevelValues.info, `change host to: ${value}`);
          set_property(REQUEST_HOST, String.UTF8.encode(value));
        } else if (key.toLowerCase() === "path") {
          log(LogLevelValues.info, `change path to: ${value}`);
          set_property(REQUEST_PATH, String.UTF8.encode(value));
        }
      }
    }

    return FilterHeadersStatusValues.Continue;
  }

  onLog(): void {
    log(LogLevelValues.info, "onLog >> completed (contextId): " + this.context_id.toString());
  }

  // allowEmpty=true for properties that may legitimately be absent (e.g. request.extension
  // when the path has no file extension, request.query when there is no query string).
  // In that case the property is logged with an empty value and processing continues
  // without adding an empty response header.
  private handleProperty(
    propertyKey: string,
    errorCode: u32,
    propertyName: string = "",
    headerName: string = "",
    allowEmpty: boolean = false
  ): boolean {
    const valueArr = get_property(propertyKey);
    if (valueArr.byteLength === 0) {
      if (allowEmpty) {
        if (propertyName.length > 0) {
          log(LogLevelValues.info, "onRequestHeaders >> " + propertyName + ": ");
        }
        return true;
      }
      send_http_response(
        errorCode,
        "internal server error",
        String.UTF8.encode("Internal server error"),
        []
      );
      return false;
    }
    const value = String.UTF8.decode(valueArr);
    if (propertyName.length > 0) {
      log(LogLevelValues.info, "onRequestHeaders >> " + propertyName + ": " + value);
    }
    if (headerName.length > 0) {
      stream_context.headers.response.add(headerName, value);
    }
    return true;
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

Each required property read uses a dedicated numeric error code to identify which property was absent. Optional properties (`allowEmpty: true`) never trigger an error response:

| Status | Property | Optional |
|--------|----------|----------|
| 551 | `request.url` | No |
| 552 | `request.host` | No |
| 553 | `request.path` | No |
| 554 | `request.scheme` | No |
| 555 | `request.extension` | Yes — never triggered |
| 556 | `request.query` | Yes — never triggered |
| 557 | `request.x_real_ip` | No |
| 558 | `request.country` | No |
| 559 | `request.city` | No |

Caller pattern (required property):
```typescript
if (!this.handleProperty(REQUEST_PATH, 553, "path", "request-path")) {
  return FilterHeadersStatusValues.StopIteration;
}
```

Caller pattern (optional property):
```typescript
if (!this.handleProperty(REQUEST_EXTENSION, 555, "extension", "request-extension", true)) {
  return FilterHeadersStatusValues.StopIteration; // never reached for optional properties
}
```

---

## Expected Output

For a request to `/page.html?test=value` with geo properties populated, the app logs at INFO level:

```
onRequestHeaders >> uri: https://example.com/page.html?test=value
onRequestHeaders >> path: /page.html?test=value
onRequestHeaders >> scheme: https
onRequestHeaders >> extension: html
onRequestHeaders >> query: test=value
onRequestHeaders >> client_ip: 203.0.113.1
onRequestHeaders >> country: LU
onRequestHeaders >> city: Luxembourg
query=test=value
```

The corresponding `request-*` response headers are also set. Logs are visible in the FastEdge application logs.

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
- `@gcoredev/proxy-wasm-sdk-as` ^1.2.3
- `assemblyscript` ^0.28.9 (dev)
- `@assemblyscript/wasi-shim` ^0.1.0 (dev)

---

## Deploy

Upload `build/properties.wasm` to the FastEdge portal and attach to a CDN application. No environment variables required.

---

## Gotchas

- **`get_property` returns `ArrayBuffer`, never `null`**: Check `byteLength === 0` to detect a missing or unavailable property. Do not perform a null check.
- **`response.status` is binary, not a string**: It is a 2-byte big-endian `u16`. Decoding it with `String.UTF8.decode()` produces garbage. Read it with a `DataView` or typed array instead.
- **`request.extension` and `request.query` are optional**: They may legitimately be absent (no file extension in path, no query string). Use `allowEmpty: true` — log an empty value and continue without adding a response header.
- **`request.host` is validated but not exposed**: It must be non-empty for upstream routing to work correctly. It is not logged and not added as a response header.
- **`set_property` on request properties takes effect immediately** for subsequent property reads and downstream filter processing within the same request.
- **Query parameter override logs change**: When a query parameter overrides a property, the change is logged with a message of the form `` `change url to: ${value}` ``, `` `change host to: ${value}` ``, or `` `change path to: ${value}` ``.
- **Lifecycle constraint**: Request properties (`request.*`) are only meaningful during request processing phases. Attempting to read them outside `onRequestHeaders` or `onRequestBody` may yield empty buffers.
- **Query parameter parsing is manual**: The SDK provides no built-in query string parser. Split on `&`, then on `=`, and validate `param.length === 2` before accessing indices.
- **`setLogLevel` must be called in `createContext`**: Log level is set to `LogLevelValues.info` inside `PropertiesRoot.createContext`, not in the constructor of the `Properties` context class.

---

## See Also

- CDN Properties — full list of available property paths on the Gcore platform
- proxy-wasm-sdk-as API reference — `get_property`, `set_property`, `send_http_response`, `stream_context`, `setLogLevel` signatures
- examples-headers-as — request/response header manipulation patterns
- examples-redirect-as — redirect using `send_http_response`
