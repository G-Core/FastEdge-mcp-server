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
capabilities: [geoblock, geo-filtering, country-detection, access-control]
---

# Geoblock — CDN App Example (AssemblyScript)

Country-based request blocking for CDN apps using the proxy-wasm AssemblyScript SDK. Reads the client country from a request property, checks it against a configurable blacklist, and blocks matching requests before they reach origin. Both blocked and allowed requests are logged at INFO level for audit purposes.

---

## Overview

- **App type**: CDN (proxy-wasm `Context`)
- **Language**: AssemblyScript
- **Package**: `@gcoredev/proxy-wasm-sdk-as`
- **Entry export**: `export * from "@gcoredev/proxy-wasm-sdk-as/assembly/proxy"`
- **Root context name**: `"geoBlock"` (passed to `registerRootContext`)

---

## Environment Variables

| Variable | Required | Type | Description |
|---|---|---|---|
| `BLACKLIST` | Yes | `string` | Comma-separated list of ISO 3166-1 alpha-2 country codes to block (e.g. `RU,CN,KP`) |

If `BLACKLIST` is absent or parses to zero entries, the app returns 500 and halts the request.

---

## Request Property

| Property path | Type | Description |
|---|---|---|
| `request.country` | `ArrayBuffer` (UTF-8 bytes) | Two-letter ISO country code injected by the CDN edge from Geo-IP data — no additional configuration required |

Retrieved via `get_property("request.country")`. Returns an `ArrayBuffer` with `byteLength === 0` if the property is absent.

Decode to string: `String.UTF8.decode(country)`.

---

## Context Types

### `GeoBlockRoot`

Extends `RootContext`.

| Method | Return | Description |
|---|---|---|
| `createContext(context_id: u32)` | `Context` | Sets log level to `LogLevelValues.info` via `setLogLevel`, then returns a new `GeoBlock` instance for each request |

### `GeoBlock`

Extends `Context`.

| Method | Signature | Description |
|---|---|---|
| `constructor` | `(context_id: u32, root_context: GeoBlockRoot)` | Calls `super(context_id, root_context)` |
| `onRequestHeaders` | `(a: u32, end_of_stream: bool): FilterHeadersStatusValues` | Main filter hook — all blocking logic executes here |

---

## Control Flow

### `onRequestHeaders`

Executes on every inbound request before forwarding to origin.

1. Read `BLACKLIST` env var via `getEnv("BLACKLIST")`. If falsy (null/empty) → send 500 `App misconfigured`, return `FilterHeadersStatusValues.StopIteration`.
2. Split blacklist on `","` → `Array<string>`. Map each entry through `.trim()`.
3. If parsed array length is 0 → send 500 `App misconfigured`, return `FilterHeadersStatusValues.StopIteration`.
4. Read `request.country` via `get_property("request.country")`. Returns `ArrayBuffer`. If `byteLength === 0` → send 502 `Missing country information`, return `FilterHeadersStatusValues.StopIteration`.
5. Decode country bytes: `String.UTF8.decode(country)` → `countryStr`.
6. If `blacklistedCountries.includes(countryStr)` → emit INFO log `"geoBlock: blocked request from " + countryStr`, send 403 `Request blacklisted`, return `FilterHeadersStatusValues.StopIteration`.
7. Otherwise → emit INFO log `"geoBlock: allowed request from " + countryStr`, return `FilterHeadersStatusValues.Continue`.

---

## Response Codes

| Condition | HTTP Status | Reason phrase | Body |
|---|---|---|---|
| `BLACKLIST` env var missing or falsy | 500 | `"internal server error"` | `App misconfigured` |
| `BLACKLIST` parses to zero entries | 500 | `"internal server error"` | `App misconfigured` |
| `request.country` property absent (`byteLength === 0`) | 502 | `"internal server error"` | `Missing country information` |
| Country code matches blacklist | 403 | `"forbidden"` | `Request blacklisted` |
| Country code not in blacklist | — | — | Request forwarded (`Continue`) |

`send_http_response` signature: `send_http_response(status: u32, reason: string, body: Uint8Array, headers: Array<...>)`. Body is encoded via `String.UTF8.encode(...)`.

---

## Constants

```typescript
const BAD_GATEWAY: u32 = 502;
const FORBIDDEN: u32 = 403;
const INTERNAL_SERVER_ERROR: u32 = 500;
```

---

## Registration

```typescript
registerRootContext((context_id: u32) => {
  return new GeoBlockRoot(context_id);
}, "geoBlock");
```

The second argument `"geoBlock"` is the filter name used by the proxy runtime.

---

## Build

```sh
npm install
npm run asbuild:release
```

| Script | Command |
|---|---|
| `asbuild:debug` | `asc assembly/index.ts --target debug` |
| `asbuild:release` | `asc assembly/index.ts --target release` |
| `asbuild` | Runs both debug and release |

Build outputs:

| File | Description |
|---|---|
| `build/geoBlock.wasm` | Optimised release binary — upload to FastEdge |
| `build/geoBlock-debug.wasm` | Debug binary with source maps |

---

## Dependencies

```json
{
  "dependencies": {
    "@gcoredev/proxy-wasm-sdk-as": "^1.2.3"
  },
  "devDependencies": {
    "@assemblyscript/wasi-shim": "^0.1.0",
    "assemblyscript": "^0.28.9"
  }
}
```

---

## Gotchas

- **Property type is `ArrayBuffer`**: `get_property("request.country")` returns an `ArrayBuffer`, not a string. Always check `byteLength === 0` for absence, then decode with `String.UTF8.decode(...)`.
- **Country code format**: The runtime injects a 2-letter ISO 3166-1 alpha-2 code from Geo-IP data (e.g. `RU`, `CN`). FastEdge always provides uppercase codes. Matching is case-sensitive — `includes()` does exact string comparison. Ensure blacklist entries use uppercase codes.
- **Whitespace trimming**: The blacklist parser calls `.trim()` on each split token, so `"RU, CN, KP"` is handled correctly. However, the decoded `countryStr` from the property is not trimmed — trailing bytes in the property would cause a mismatch.
- **`send_http_response` + `StopIteration`**: All blocking paths call `send_http_response` then return `StopIteration`. The request is halted and the synthetic response is sent to the client; origin is never contacted.
- **Log level initialization**: `setLogLevel(LogLevelValues.info)` is called in `createContext` (root context), not in `onRequestHeaders`. This sets the log level once per context lifecycle, not per request.
- **Audit logging**: Both blocked and allowed requests emit an INFO log entry. This provides a full audit trail of all geoblock decisions.
- **No time-window support**: Unlike the Rust geoblock example, this AssemblyScript implementation does not support time-bounded blocking. The blacklist applies unconditionally.

---

## See Also

- proxy-wasm-sdk-as SDK reference (AssemblyScript host API, `get_property`, `send_http_response`, `FilterHeadersStatusValues`, `getEnv`, `setLogLevel`)
- FastEdge CDN app platform overview (available request properties, country detection)
- FastEdge environment variable configuration (setting `BLACKLIST` at deploy time)
- examples-geoblock-rust reference (equivalent Rust implementation with time-window support)
- FastEdge error codes reference (530–533 runtime errors)
