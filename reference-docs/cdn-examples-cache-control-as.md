<!--
  auto-updated: true
  sources:
    - id: proxy-wasm-sdk-as
      ref: master
      commit: 60f25c7bd35564e5bafb421be7f37aa4acf1bf81
      updated: 2026-05-20
-->

---
type: example
app_type: cdn
languages: [assemblyscript]
capabilities: [cache-control, response-headers, content-type-routing, env-config]
---

# Cache Control — AssemblyScript (CDN)

Content-type-aware `Cache-Control` response header management for FastEdge CDN applications. Sets cache policy and `Vary` headers based on response status code and `Content-Type`.

## Lifecycle Hook

**`onResponseHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues`**

Inspects response status and `Content-Type` header; sets `Cache-Control` (and optionally `Vary`) on the response; returns `FilterHeadersStatusValues.Continue`.

## Response Status Decoding

Status is read as a 2-byte big-endian `u16` via `get_property("response.status")`. It is NOT a string.

```typescript
const statusBuf = get_property("response.status");
let statusCode: u32 = 200;
if (statusBuf.byteLength >= 2) {
  const bytes = Uint8Array.wrap(statusBuf);
  statusCode = (u32(bytes[0]) << 8) | u32(bytes[1]);
}
```

- `byteLength` must be checked before access
- Decode with `(bytes[0] << 8) | bytes[1]` (big-endian)
- Default to `200` if buffer is too short

## Cache Policy Decision Tree

Evaluated in this order:

### 1. Error responses (`statusCode < 200 || statusCode >= 400`)

```
Cache-Control: no-store
```

Immediately returns `Continue`. No further policy evaluation.

### 2. Static assets

Detected by `isStaticAsset(contentType)` — matches:
- `image/`
- `font/`
- `application/javascript`
- `text/css`
- `text/javascript`
- `application/wasm`

```
Cache-Control: public, max-age=<STATIC_MAX_AGE>, immutable
```

No `Vary` header added.

### 3. HTML (`text/html`)

```
Cache-Control: public, max-age=<HTML_MAX_AGE>, must-revalidate
Vary: Accept-Encoding
```

`Vary` is added (not replaced) via `stream_context.headers.response.add`.

### 4. API responses (`application/json` or `application/xml`)

When `API_MAX_AGE == "0"` (default):
```
Cache-Control: no-cache, no-store, must-revalidate
```

When `API_MAX_AGE` is set to a non-zero value:
```
Cache-Control: private, max-age=<API_MAX_AGE>, must-revalidate
```

In both cases:
```
Vary: Accept, Authorization
```

### 5. Default (all other content types)

```
Cache-Control: public, max-age=600
```

## Environment Variables

All are optional. Defaults applied via empty-string check (see Gotchas).

| Variable | Default | Description |
|---|---|---|
| `STATIC_MAX_AGE` | `31536000` | Max-age for static assets (seconds). 1 year. |
| `HTML_MAX_AGE` | `3600` | Max-age for HTML responses (seconds). 1 hour. |
| `API_MAX_AGE` | `0` | Max-age for API responses. `0` means no-cache. |

### Empty-string default pattern

```typescript
const rawStaticMaxAge = getEnv("STATIC_MAX_AGE");
const staticMaxAge = rawStaticMaxAge === "" ? "31536000" : rawStaticMaxAge;
```

`getEnv` returns an empty string (`""`) when the variable is unset — NOT `null`. Use explicit empty-string comparison. Do NOT use `||` — in AssemblyScript, a non-null empty string is pointer-truthy and `||` will not fall through to the default.

## API Usage

### Reading response status (binary)

```typescript
import { get_property } from "@gcoredev/proxy-wasm-sdk-as/assembly";

const statusBuf = get_property("response.status"); // ArrayBuffer, 2-byte big-endian u16
```

### Reading a response header

```typescript
const contentType = stream_context.headers.response.get("Content-Type"); // returns string
```

### Replacing a response header

```typescript
stream_context.headers.response.replace("Cache-Control", cacheControl);
```

Use `replace` (not `add`) for `Cache-Control` to overwrite any upstream-set value.

### Adding a response header

```typescript
stream_context.headers.response.add("Vary", "Accept-Encoding");
```

Use `add` for `Vary` to append alongside any existing values.

### Reading environment variables

```typescript
import { getEnv } from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";

const raw = getEnv("STATIC_MAX_AGE"); // returns "" if unset, never null
```

### Logging

```typescript
import { log, LogLevelValues } from "@gcoredev/proxy-wasm-sdk-as/assembly";

log(LogLevelValues.info, "Cache-Control: " + cacheControl + " (content-type: " + contentType + ")");
```

Log level is set in `createContext` via `setLogLevel(LogLevelValues.info)`.

## Class Structure

### `CacheControlRoot extends RootContext`

- `createContext(context_id: u32): Context` — sets log level to `info`; returns a new `CacheControlContext`

### `CacheControlContext extends Context`

- `constructor(context_id: u32, root_context: CacheControlRoot)` — calls `super`
- `onResponseHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues` — main policy logic
- `private isStaticAsset(contentType: string): bool` — returns `true` for image/, font/, application/javascript, text/css, text/javascript, application/wasm

### Root context registration

```typescript
registerRootContext((context_id: u32) => {
  return new CacheControlRoot(context_id);
}, "cacheControl");
```

## Build

Package name: `fastedge-as-example-cache-control`

```sh
pnpm install
pnpm run asbuild
```

Build targets:

| File | Description |
|---|---|
| `build/cacheControl.wasm` | Optimised release binary — deploy this |
| `build/cacheControl-debug.wasm` | Debug binary with source maps |

**Dependencies:**
- `@gcoredev/proxy-wasm-sdk-as` `^1.2.3`
- `assemblyscript` `^0.28.9` (dev)
- `@assemblyscript/wasi-shim` `^0.1.0` (dev)

## Gotchas

| Issue | Detail |
|---|---|
| Status is binary, not a string | `get_property("response.status")` returns a 2-byte `ArrayBuffer`. Decode as big-endian `u16` via `Uint8Array.wrap`. |
| `getEnv` returns `""` not `null` | Use `=== ""` for default checks. Do not use `\|\|` — empty string is pointer-truthy in AssemblyScript. |
| Use `replace` for `Cache-Control` | `add` would accumulate multiple `Cache-Control` headers. `replace` overwrites upstream values. |
| `isStaticAsset` must be a private class method | AssemblyScript does not support closures or standalone helper functions with default arguments inside methods. Content-type matching logic belongs on the context class. |
| `Vary` uses `add` not `replace` | Multiple `Vary` values are valid and composable; `add` is appropriate here. |
| `setLogLevel` placement | Must be called in `createContext`, not the constructor of the context class, to take effect before any log calls. |

## See Also

- proxy-wasm-sdk-as API reference (AssemblyScript)
- FastEdge CDN app scaffold reference
- platform-overview (CDN application lifecycle and hook execution model)
- best-practices (header mutation, environment variable patterns)
