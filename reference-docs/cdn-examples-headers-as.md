<!--
  auto-updated: true
  sources:
    - id: proxy-wasm-sdk-as
      ref: master
      commit: 20b31c05b39c5537fb1ac7cc8693d9d8ec314f25
      updated: 2026-04-15
-->

---
type: example
app_type: cdn
languages: [assemblyscript]
capabilities: [headers, request-headers, response-headers, header-manipulation]
---

# CDN Headers Manipulation — AssemblyScript

Demonstrates adding, removing, replacing, and validating HTTP request and response headers using the proxy-wasm-sdk-as in both `onRequestHeaders` and `onResponseHeaders` lifecycle hooks.

## Package

- **npm package name**: `fastedge-as-example-headers`
- **SDK dependency**: `@gcoredev/proxy-wasm-sdk-as`
- **Build tool**: AssemblyScript compiler (`asc`) via `assemblyscript ^0.28.9`

## Imports

```typescript
import {
  Context,
  FilterHeadersStatusValues,
  Headers,
  log,
  LogLevelValues,
  registerRootContext,
  RootContext,
  send_http_response,
  stream_context,
} from "@gcoredev/proxy-wasm-sdk-as/assembly";
import { setLogLevel } from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";
```

The top-level re-export is required:

```typescript
export * from "@gcoredev/proxy-wasm-sdk-as/assembly/proxy";
```

## Class Structure

| Class             | Extends       | Role                                               |
| ----------------- | ------------- | -------------------------------------------------- |
| `HttpHeadersRoot` | `RootContext` | Factory; sets log level; creates `HttpHeaders`     |
| `HttpHeaders`     | `Context`     | Implements `onRequestHeaders`, `onResponseHeaders` |

Registration:

```typescript
registerRootContext((context_id: u32) => {
  return new HttpHeadersRoot(context_id);
}, "httpheaders");
```

## Header API Reference

All header operations are accessed via `stream_context.headers.request` or `stream_context.headers.response`.

| Method                                  | Signature                                            | Description                                                              |
| --------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `get(name)`                             | `(name: string) => string`                           | Returns the value of the named header, or empty string if not present    |
| `add(name, value)`                      | `(name: string, value: string) => void`              | Adds a header; multiple calls with the same name produce multiple values |
| `replace(name, value)`                  | `(name: string, value: string) => void`              | Replaces the value of an existing header; no-op if header does not exist |
| `remove(name)`                          | `(name: string) => void`                             | Removes the header (see Known Issues)                                    |
| `get_headers()`                         | `() => Headers` (alias: `HeaderPair[]`)              | Returns all headers as an array of `{ key: ArrayBuffer, value: ArrayBuffer }` |
| `set_headers(headers)`                  | `(headers: Headers) => void`                         | Replaces the full header collection                                      |

### `Headers` / `HeaderPair` type

`get_headers()` returns `Headers`, which is an array of objects with `key: ArrayBuffer` and `value: ArrayBuffer`. Decode with `String.UTF8.decode`:

```typescript
const name  = String.UTF8.decode(headers[i].key);
const value = String.UTF8.decode(headers[i].value);
```

## Header Iteration Pattern

```typescript
function collectHeaders(headers: Headers, logHeaders: bool = true): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < headers.length; i++) {
    const name  = String.UTF8.decode(headers[i].key);
    const value = String.UTF8.decode(headers[i].value);
    if (logHeaders) log(LogLevelValues.info, `#header -> ${name}: ${value}`);
    set.add(`${name}:${value}`);
  }
  return set;
}
```

## Request Phase — `onRequestHeaders`

**Signature**: `onRequestHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues`

Operations performed in order:

1. Collect all request headers with `stream_context.headers.request.get_headers()`
2. Return `550` error if no headers are present
3. Check `host` header with `stream_context.headers.request.get("host")`; return `551` error if present but empty
4. Add `new-header-01`, `new-header-02`, `new-header-03`
5. Remove `new-header-01` (see Known Issues)
6. Replace `new-header-02` value with `new-value-02`
7. Add a second value for `new-header-03` (`value-03-a`)
8. Attempt to add/read response headers — **causes panic** (see Known Issues)
9. Validate that only expected headers are present; return `552` error on mismatch
10. Return `FilterHeadersStatusValues.Continue`

Expected post-mutation request headers (new headers only):

| Header          | Value(s)                    |
| --------------- | --------------------------- |
| `new-header-02` | `new-value-02`              |
| `new-header-03` | `value-03`, `value-03-a`    |

## Response Phase — `onResponseHeaders`

**Signature**: `onResponseHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues`

Operations performed in order:

1. Collect all response headers with `stream_context.headers.response.get_headers()`
2. Return `550` error if no headers are present
3. Check `host` header; return `551` error if present but empty
4. Add `new-header-01`, `new-header-02`, `new-header-03`
5. Remove `new-header-01` (see Known Issues)
6. Replace `new-header-02` value with `new-value-02`
7. Add a second value for `new-header-03` (`value-03-a`)
8. Validate that only expected headers are present; return `552` error on mismatch
9. Return `FilterHeadersStatusValues.Continue`

Expected post-mutation response headers (new headers only):

| Header          | Value(s)                    |
| --------------- | --------------------------- |
| `new-header-02` | `new-value-02`              |
| `new-header-03` | `value-03`, `value-03-a`    |

## Header Validation Pattern

Used in both phases to assert that header mutations produced the exact expected set:

```typescript
function validateHeaders(headers: Headers, expectedHeaders: Set<string>): Set<string> {
  const headersArr = collectHeaders(headers, false).values();
  const diff = new Set<string>();
  for (let i = 0; i < headersArr.length; i++) {
    const header = headersArr[i];
    if (header.startsWith("new-header-")) {
      if (!expectedHeaders.has(header)) diff.add(header);
    }
  }
  return diff;
}
```

- Filters to only headers with prefix `new-header-` to scope validation
- Returns the set of unexpected headers found
- Caller sends `552` error response if `diff.size > 0`

## Error Response Codes Used

| Code | Meaning                           | Trigger                                    |
| ---- | --------------------------------- | ------------------------------------------ |
| 550  | No headers present                | `get_headers()` returns empty collection   |
| 551  | Host header present but empty     | `get("host")` returns `""`                 |
| 552  | Unexpected headers after mutation | `validateHeaders()` returns non-empty diff |

All errors use `send_http_response(code, "internal server error", body, [])`.

## Logging

Log level is set in `createContext`:

```typescript
setLogLevel(LogLevelValues.info);
```

Available log levels (lowest to highest verbosity): `debug`, `info`, `warn`, `error`, `critical`.

Log calls use:

```typescript
log(LogLevelValues.info, "message");
```

`onLog` lifecycle hook logs completion:

```typescript
onLog(): void {
  log(LogLevelValues.info, "onLog >> completed (contextId): " + this.context_id.toString());
}
```

## Known Issues

**`remove()` on nginx**: Calling `stream_context.headers.request.remove(name)` or `stream_context.headers.response.remove(name)` does not remove the header. Nginx sets the value to an empty string instead of removing the entry.

**Response headers in request phase**: Attempting to read or write `stream_context.headers.response` during `onRequestHeaders` causes a runtime panic. The runtime will panic because response headers are not available in the request phase. Example operations that panic:
- `stream_context.headers.response.add("new-response-header", "value-01")` — add does not panic
- `stream_context.headers.response.get("new-response-header")` — **panics** if called during request phase

**`replace()` on absent header**: `replace()` is a no-op if the named header does not exist. Check existence with `get()` and test `length > 0` before calling `replace()`.

## Build

```sh
pnpm install
pnpm run asbuild
```

| Output file                | Description                                    |
| -------------------------- | ---------------------------------------------- |
| `build/headers.wasm`       | Optimised release binary — deploy to FastEdge  |
| `build/headers-debug.wasm` | Debug binary with source maps                  |

Build scripts defined in `package.json`:

| Script              | Command                                    |
| ------------------- | ------------------------------------------ |
| `asbuild:debug`     | `asc assembly/index.ts --target debug`     |
| `asbuild:release`   | `asc assembly/index.ts --target release`   |
| `asbuild`           | Runs both debug and release builds         |

## Deployment

Upload `build/headers.wasm` to the FastEdge portal and attach it to a CDN application. No environment variables are required.

## See Also

- proxy-wasm-sdk-as API reference
- CDN platform overview
- FastEdge best practices
- CDN HTTP examples reference
