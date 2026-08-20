<!--
  auto-updated: true
  sources:
    - id: proxy-wasm-sdk-as
      ref: master
      commit: 8e3bb621bc013a0aed7e52122066b417ad62a207
      updated: 2026-08-17
-->

---
type: example
app_type: cdn
languages: [assemblyscript]
capabilities: [geo-routing, header-manipulation, environment-variables, origin-selection]
---

# Geo Redirect — CDN (AssemblyScript)

Routes incoming requests to different upstream origin URLs based on the client's country code, using FastEdge runtime Geo-IP data.

---

## Overview

| Property | Value |
|----------|-------|
| Example name | `geoRedirect` |
| SDK | `@gcoredev/proxy-wasm-sdk-as` |
| App type | CDN |
| Language | AssemblyScript |
| Entry point | `assembly/index.ts` |
| Release binary | `build/geoRedirect.wasm` |
| Debug binary | `build/geoRedirect-debug.wasm` |

---

## Behaviour

Executed in `onRequestHeaders`. For each incoming request:

1. Reads the `DEFAULT` environment variable (required fallback origin). Returns `500` if absent or empty.
2. Reads `request.country` runtime property (ISO 3166-1 alpha-2 code). Returns `502` if missing or empty.
3. Decodes country code and looks up an environment variable keyed by that code (e.g. `DE`, `US`).
4. Reads `request.host` and logs it if present. Host is not used to modify headers.
5. Reads `request.path`. Returns `500` if missing or empty.
6. Constructs `requestUrl = cleanedOrigin + path` where `cleanedOrigin` is the selected origin with any trailing slash stripped.
7. Sets `request.url` to the constructed URL to route the request to the selected origin.

Distinct from geoblock pattern: geo redirect routes requests to a different origin; it does not reject requests.

---

## Class Structure

### `GeoRedirectRoot extends RootContext`

Root context. Creates one `GeoRedirect` instance per request context.

```typescript
class GeoRedirectRoot extends RootContext {
  createContext(context_id: u32): Context
}
```

Sets log level to `LogLevelValues.info` in `createContext`.

---

### `GeoRedirect extends Context`

Per-request context. Implements routing logic.

```typescript
class GeoRedirect extends Context {
  constructor(context_id: u32, root_context: GeoRedirectRoot)
  onRequestHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues
}
```

---

## Method: `onRequestHeaders`

**Signature:**
```typescript
onRequestHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues
```

**Logic:**

| Step | Operation | On failure |
|------|-----------|------------|
| 1 | `getEnv("DEFAULT")` — required fallback origin; falsy check (`!defaultOrigin`) | `send_http_response(500, ...)` → `StopIteration` |
| 2 | `get_property("request.country")` → `ArrayBuffer` | `send_http_response(502, ...)` → `StopIteration` |
| 3 | `String.UTF8.decode(countryArrBuf)` → country code; `getEnv(countryCode)` → country-specific origin | — |
| 4 | `get_property("request.host")` → if non-empty, log the host value (no header mutation) | Skipped if empty |
| 5 | `get_property("request.path")` → request path | `send_http_response(500, ...)` → `StopIteration` |
| 6 | Select origin: country-specific if non-empty string, else `DEFAULT` | — |
| 7 | Strip trailing `/` from origin; construct `requestUrl = cleanedOrigin + path` | — |
| 8 | `set_property("request.url", String.UTF8.encode(requestUrl))` | — |

**Returns:** `FilterHeadersStatusValues.Continue` on success, `FilterHeadersStatusValues.StopIteration` on error.

---

## Runtime Properties Used

| Property | Type | Description |
|----------|------|-------------|
| `request.country` | `ArrayBuffer` | ISO 3166-1 alpha-2 country code from Geo-IP |
| `request.host` | `ArrayBuffer` | Incoming `Host` header value (read and logged only) |
| `request.path` | `ArrayBuffer` | Request path including query string |
| `request.url` | `ArrayBuffer` (write) | Full upstream URL; set to override request routing |

All properties return `ArrayBuffer`. Decode with `String.UTF8.decode(buf)` before use. Check `buf.byteLength > 0` before decoding to detect missing values.

---

## API Calls

```typescript
import {
  get_property,
  set_property,
  send_http_response,
  log,
  LogLevelValues,
  FilterHeadersStatusValues,
  registerRootContext,
  Context,
  RootContext,
} from "@gcoredev/proxy-wasm-sdk-as/assembly";

import {
  getEnv,
  setLogLevel,
} from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";
```

| Call | Purpose |
|------|---------|
| `getEnv(name: string): string \| null` | Read environment variable by name |
| `get_property(path: string): ArrayBuffer` | Read runtime property |
| `set_property(path: string, value: ArrayBuffer): void` | Write runtime property (sets upstream URL) |
| `send_http_response(status: u32, description: string, body: ArrayBuffer, headers: string[]): void` | Return early HTTP response |
| `setLogLevel(level: LogLevelValues): void` | Set minimum log level |
| `log(level: LogLevelValues, message: string): void` | Emit log message |

---

## Environment Variables

| Variable | Required | Example | Description |
|----------|----------|---------|-------------|
| `DEFAULT` | Yes | `https://origin.example.com` | Fallback origin URL for all unmatched countries |
| `<COUNTRY_CODE>` | No | `DE=https://de.example.com` | Per-country origin URL; key is ISO 3166-1 alpha-2 code |

Country codes are matched case-sensitively against the value of `request.country`. One variable per country. Any number of country overrides may be set. Country-specific origin falls back to `DEFAULT` when `getEnv(countryCode)` returns `""`.

---

## Error Responses

| Condition | Status | Body |
|-----------|--------|------|
| `DEFAULT` env var not set or empty | `500 Internal Server Error` | `App misconfigured - DEFAULT must be set` |
| `request.country` property missing or empty | `502 Bad Gateway` | `Missing country information` |
| `request.path` property missing or empty | `500 Internal Server Error` | `Internal server error - no request path` |

---

## Registration

```typescript
registerRootContext((context_id: u32) => {
  return new GeoRedirectRoot(context_id);
}, "geoRedirect");
```

Root context name: `"geoRedirect"`.

---

## Build

```sh
pnpm install
pnpm run asbuild
```

Build scripts (from `package.json`):

| Script | Command |
|--------|---------|
| `asbuild:debug` | `asc assembly/index.ts --target debug` |
| `asbuild:release` | `asc assembly/index.ts --target release` |
| `asbuild` | Runs both debug and release |

---

## Key Patterns

**Country-based origin selection:**
```typescript
const countrySpecificOrigin = getEnv(countryCode); // "" if not set
const origin = countrySpecificOrigin === "" ? defaultOrigin : countrySpecificOrigin;
```

**Trailing slash normalisation before URL construction:**
```typescript
const cleanedOrigin = origin.endsWith("/") ? origin.slice(0, -1) : origin;
const requestUrl = `${cleanedOrigin}${path}`;
```

**ArrayBuffer presence check before decode:**
```typescript
const countryArrBuf = get_property("request.country");
if (countryArrBuf.byteLength === 0) { /* handle missing */ }
const countryCode = String.UTF8.decode(countryArrBuf);
```

**DEFAULT env var falsy check:**
```typescript
const defaultOrigin = getEnv("DEFAULT");
if (!defaultOrigin) { /* handles both null and empty string */ }
```

---

## Constraints and Gotchas

- `request.country` is provided by the CDN Geo-IP subsystem; it is absent if the CDN layer does not supply it (returns empty `ArrayBuffer`, not null).
- `request.host` is read and logged for observability only. It is not used to replace the `Host` request header or influence routing.
- `set_property("request.url", ...)` must be called with a UTF-8-encoded `ArrayBuffer`, not a raw string.
- Routing to the selected origin is achieved by writing `request.url` — no HTTP redirect response is sent to the client.
- Country code matching is case-sensitive and depends on the exact casing provided by `request.country` at runtime.
- `getEnv` returns `""` (empty string) when a country-code variable is not set; the `=== ""` check must be used for country-specific origin fallback (not a null check).
- The `DEFAULT` check uses `!defaultOrigin` (falsy), catching both null and empty string returns.

---

## See Also

- geoblock CDN example (AssemblyScript) — rejects requests by country rather than rerouting
- platform-overview — runtime property reference and CDN app lifecycle
- sdk-reference-js — `get_property`, `set_property`, `send_http_response` full signatures
- host-services reference — available runtime properties and their guarantees
