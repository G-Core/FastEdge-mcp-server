<!--
  auto-updated: true
  sources:
    - id: proxy-wasm-sdk-as
      ref: master
      commit: 8e3bb621bc013a0aed7e52122066b417ad62a207
      updated: 2026-08-20
-->

---
type: example
app_type: cdn
languages: [assemblyscript]
capabilities: [headers, request-headers, response-headers, header-manipulation]
---

# CDN Headers Manipulation — AssemblyScript

Demonstrates adding, removing, replacing, and validating HTTP request and response headers using the proxy-wasm-sdk-as in both `onRequestHeaders` and `onResponseHeaders` lifecycle hooks. Also demonstrates cross-phase response header writes from the request phase.

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

| Method              | Signature                                       | Description                                                                                              |
| ------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `get(name)`         | `(name: string) => string`                      | Returns the value of the named header, or empty string if not present                                    |
| `add(name, value)`  | `(name: string, value: string) => void`          | Adds a header; multiple calls with the same name produce multiple values                                 |
| `replace(name, value)` | `(name: string, value: string) => void`      | Upserts the header value — creates the header if it does not exist (see Known Issues)                    |
| `remove(name)`      | `(name: string) => void`                        | Removes the header (see Known Issues)                                                                    |
| `get_headers()`     | `() => Headers` (alias: `HeaderPair[]`)         | Returns all headers as an array of `{ key: ArrayBuffer, value: ArrayBuffer }`                            |
| `set_headers(headers)` | `(headers: Headers) => void`                | Replaces the full header collection                                                                      |

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
5. Remove `new-header-01` — result is empty-string value, not deletion (see Known Issues)
6. Replace `new-header-02` value with `new-value-02`
7. Add a second value for `new-header-03` (`value-03-a`)
8. Write response headers from the request phase: `stream_context.headers.response.add("new-response-header", "value-01")` — this does not panic; headers written here appear alongside those set in `onResponseHeaders`
9. Conditionally blank `cache-control` response header using a guard: only calls `replace("cache-control", "")` if `get("cache-control").length > 0`, because `replace()` upserts and would create the header with an empty value if called unconditionally on an absent header
10. Attempt to read `new-response-header` via `stream_context.headers.response.get(...)` — **causes panic** (see Known Issues)
11. Validate that only expected headers are present using symmetric diff; return `552` error on mismatch
12. Return `FilterHeadersStatusValues.Continue`

Expected post-mutation request headers (new headers only):

| Header          | Value(s)                 |
| --------------- | ------------------------ |
| `new-header-01` | `` (empty string)        |
| `new-header-02` | `new-value-02`           |
| `new-header-03` | `value-03`, `value-03-a` |

## Response Phase — `onResponseHeaders`

**Signature**: `onResponseHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues`

Operations performed in order:

1. Collect all response headers with `stream_context.headers.response.get_headers()`
2. Return `550` error if no headers are present
3. Check `host` header; return `551` error if present but empty
4. Add `new-header-01`, `new-header-02`, `new-header-03`
5. Remove `new-header-01` — result is empty-string value, not deletion (see Known Issues)
6. Replace `new-header-02` value with `new-value-02`
7. Add a second value for `new-header-03` (`value-03-a`)
8. Validate that only expected headers are present using symmetric diff; return `552` error on mismatch
9. Return `FilterHeadersStatusValues.Continue`

Expected post-mutation response headers (new headers only):

| Header          | Value(s)                 |
| --------------- | ------------------------ |
| `new-header-01` | `` (empty string)        |
| `new-header-02` | `new-value-02`           |
| `new-header-03` | `value-03`, `value-03-a` |

## Header Validation Pattern

`validateHeaders` performs a symmetric diff scoped to headers with the `new-header-` prefix. It returns a `HeaderDiff` object with two sets: `missing` (expected but absent) and `extra` (present but not expected). Other headers are deliberately ignored.

```typescript
class HeaderDiff {
  missing: Set<string>;
  extra: Set<string>;

  constructor() {
    this.missing = new Set<string>();
    this.extra = new Set<string>();
  }
}

function validateHeaders(headers: Headers, expectedHeaders: Set<string>): HeaderDiff {
  const result = new HeaderDiff();
  const headersArr = collectHeaders(headers, false).values();
  const actualNewHeaders = new Set<string>();

  for (let i = 0; i < headersArr.length; i++) {
    const header = headersArr[i];
    if (header.startsWith("new-header-")) {
      actualNewHeaders.add(header);
      if (!expectedHeaders.has(header)) result.extra.add(header);
    }
  }

  const expectedArr = expectedHeaders.values();
  for (let i = 0; i < expectedArr.length; i++) {
    const e = expectedArr[i];
    if (!actualNewHeaders.has(e)) result.missing.add(e);
  }

  return result;
}
```

Caller checks:

```typescript
if (diff.missing.size > 0 || diff.extra.size > 0) {
  log(LogLevelValues.warn,
    `Header mismatch | missing: ${diff.missing.values().join(", ")} | extra: ${diff.extra.values().join(", ")}`);
  send_http_response(552, "internal server error", String.UTF8.encode("Internal server error"), []);
  return FilterHeadersStatusValues.StopIteration;
}
```

## Multi-Value Headers

`new-header-03` is deliberately added twice — `add()` is called with the same name twice. This produces a multi-value header with two separate `new-header-03` entries. The validation pattern uses `Set<string>` of `"name:value"` pairs to assert both values are present.

## Cross-Phase Response Header Writes

`stream_context.headers.response.add(...)` can be called during `onRequestHeaders`. Headers written in the request phase appear in the final response alongside those set in `onResponseHeaders`. The distinction:

- `stream_context.headers.response.add("new-response-header", "value-01")` — **safe** in request phase
- `stream_context.headers.response.get("new-response-header")` — **panics** in request phase

## Error Response Codes Used

| Code | Meaning                        | Trigger                                                    |
| ---- | ------------------------------ | ---------------------------------------------------------- |
| 550  | No headers present             | `get_headers()` returns empty collection                   |
| 551  | Host header present but empty  | `get("host")` returns `""`                                 |
| 552  | Header mismatch after mutation | `validateHeaders()` returns non-empty `missing` or `extra` |

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

**`remove()` on nginx**: Calling `stream_context.headers.request.remove(name)` or `stream_context.headers.response.remove(name)` does not remove the header. Nginx sets the value to an empty string instead of removing the entry. When checking for header absence, test for both a missing key and an empty string value.

**`replace()` upserts on FastEdge**: `replace()` creates the header with the given value if the named header does not exist — it does not behave as a no-op on absent headers. Guard calls to `replace()` with a prior `get()` length check when you intend to update only an existing header.

**Response header reads during request phase**: Reading `stream_context.headers.response` (e.g. via `get()`) during `onRequestHeaders` causes a runtime panic because response headers are not available in the request phase. Writing response headers via `add()` during `onRequestHeaders` is safe and those headers appear in the final response.

## Build

```sh
pnpm install
pnpm run asbuild
```

| Output file                | Description                                   |
| -------------------------- | --------------------------------------------- |
| `build/headers.wasm`       | Optimised release binary — deploy to FastEdge |
| `build/headers-debug.wasm` | Debug binary with source maps                 |

Build scripts defined in `package.json`:

| Script            | Command                                  |
| ----------------- | ---------------------------------------- |
| `asbuild:debug`   | `asc assembly/index.ts --target debug`   |
| `asbuild:release` | `asc assembly/index.ts --target release` |
| `asbuild`         | Runs both debug and release builds       |

## Deployment

Upload `build/headers.wasm` to the FastEdge portal and attach it to a CDN application. No environment variables are required.

## See Also

- proxy-wasm-sdk-as API reference
- CDN platform overview
- FastEdge best practices
- CDN HTTP examples reference
