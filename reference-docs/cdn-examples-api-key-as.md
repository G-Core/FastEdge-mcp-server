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
languages:
  - assemblyscript
capabilities:
  - api-key-auth
  - header-validation
  - secrets
  - header-stripping
---

# CDN Example: API Key Authentication (AssemblyScript)

Validates incoming requests by checking the `X-API-Key` request header against a stored secret. Requests with a missing or invalid key are rejected before reaching the upstream origin. On success the key header is stripped prior to forwarding.

---

## Entry Point

**File:** `assembly/index.ts`
**Root context name:** `"apiKey"`
**Hook:** `onRequestHeaders`

---

## Validation Flow

All logic executes in `ApiKeyContext.onRequestHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues`.

| Step | Condition | Action | Status returned |
|------|-----------|--------|-----------------|
| 1 | `getSecret("API_KEY") === ""` | `send_http_response(500, …)` | `StopIteration` |
| 2 | `stream_context.headers.request.get("X-API-Key") === ""` | `send_http_response(401, …)` with `WWW-Authenticate: API-Key` header | `StopIteration` |
| 3 | `providedKey !== expectedKey` | `send_http_response(403, …)` | `StopIteration` |
| 4 | Key matches | `stream_context.headers.request.remove("X-API-Key")` | `Continue` |

---

## API Reference

### `getSecret(name: string): string`

Retrieves the named secret from the FastEdge application configuration.

- **Parameter:** `name` — secret name, case-sensitive (`"API_KEY"`)
- **Returns:** Secret value as `string`. Returns `""` (empty string) when the secret is not configured. Never returns `null`.
- **Gotcha:** Always test for empty string (`=== ""`), not for null. A missing secret returns `""`, not a falsy/null value.

---

### `stream_context.headers.request.get(name: string): string`

Reads a request header value.

- **Parameter:** `name` — header name (e.g. `"X-API-Key"`)
- **Returns:** Header value as `string`, or `""` if the header is absent.

---

### `stream_context.headers.request.remove(name: string): void`

"Removes" a request header before forwarding to upstream.

- **Behavior (platform gotcha):** On the FastEdge CDN platform, `.remove()` sets the header value to `""` rather than deleting the header entirely. The upstream origin receives `X-API-Key:` with an empty value — the header is present but blank. Downstream code testing for header absence must check for both a missing header and an empty-string value.

---

### `send_http_response(status: u32, statusText: string, body: ArrayBuffer, headers: Array<HeaderPair>): void`

Sends an HTTP response and halts filter processing.

- **`status`** — HTTP status code (`u32`): `401`, `403`, `500`
- **`statusText`** — reason phrase string: `"unauthorized"`, `"forbidden"`, `"internal server error"`
- **`body`** — UTF-8 encoded body: `String.UTF8.encode("…")`
- **`headers`** — additional response headers (`Array<HeaderPair>`); pass `[]` for none
- **Must be followed by `return FilterHeadersStatusValues.StopIteration`** — AssemblyScript has no exceptions; every error branch must explicitly return `StopIteration` after calling `send_http_response`.

---

### `makeHeaderPair(name: string, value: string): HeaderPair`

Constructs a response header pair for use in `send_http_response`.

- Used to add `WWW-Authenticate: API-Key` on 401 responses.

---

### `FilterHeadersStatusValues`

| Value | Meaning |
|-------|---------|
| `StopIteration` | Halt filter chain; response already sent via `send_http_response` |
| `Continue` | Pass request to next filter / upstream origin |

---

### `log(level: LogLevelValues, message: string): void`

Emits a log entry. Log level is set to `LogLevelValues.info` during root context creation via `setLogLevel`.

| Level used | Condition |
|------------|-----------|
| `LogLevelValues.error` | Secret not configured |
| `LogLevelValues.info` | Key validation failed; key validated successfully |

---

## Configuration

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `API_KEY` | Secret | Yes | Expected API key value; must be set on the FastEdge application before deployment |

---

## Response Specifications

### 500 Internal Server Error — secret not configured

```
HTTP/1.1 500 internal server error
Body: App misconfigured
Headers: (none)
```

### 401 Unauthorized — missing X-API-Key header

```
HTTP/1.1 401 unauthorized
WWW-Authenticate: API-Key
Body: Missing X-API-Key header
```

### 403 Forbidden — key mismatch

```
HTTP/1.1 403 forbidden
Body: Invalid API key
Headers: (none)
```

### Pass-through — valid key

Header `X-API-Key` is set to `""` on the forwarded request (platform `.remove()` behavior). Returns `FilterHeadersStatusValues.Continue`.

---

## Security Notes

- The key comparison (`providedKey !== expectedKey`) is **not constant-time**. A high-volume attacker can exploit the timing side-channel. For production workloads, replace with a constant-time HMAC equality check or use the JWT example which includes cryptographic validation.
- This pattern is suitable as a simpler alternative to JWT when token expiry and claims are not required.

---

## Build

**Package manager:** `npm` (also compatible with `pnpm`)
**SDK dependency:** `@gcoredev/proxy-wasm-sdk-as ^1.2.3`

```sh
npm install
npm run asbuild
```

| Output file | Description |
|-------------|-------------|
| `build/apiKey.wasm` | Optimised release binary — upload to FastEdge |
| `build/apiKey-debug.wasm` | Debug binary with source maps |

Build scripts:

| Script | Command |
|--------|---------|
| `asbuild:debug` | `asc assembly/index.ts --target debug` |
| `asbuild:release` | `asc assembly/index.ts --target release` |
| `asbuild` | Runs both debug and release |

---

## Deployment

Upload `build/apiKey.wasm` to the FastEdge portal and attach it to a CDN application. Configure the `API_KEY` secret in the application settings.

---

## See Also

- jwt example (constant-time cryptographic key validation, token expiry, claims)
- proxy-wasm-sdk-as reference (full `Context`, `RootContext`, `FilterHeadersStatusValues` API)
- FastEdge secrets management (how to set and rotate application secrets)
- CDN app deployment guide

## Source Material

### FILE: examples/apiKey/assembly/index.ts

```ts
export * from "@gcoredev/proxy-wasm-sdk-as/assembly/proxy";
import {
  Context,
  FilterHeadersStatusValues,
  HeaderPair,
  log,
  LogLevelValues,
  makeHeaderPair,
  registerRootContext,
  RootContext,
  send_http_response,
  stream_context,
} from "@gcoredev/proxy-wasm-sdk-as/assembly";
import {
  getSecret,
  setLogLevel,
} from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";

const UNAUTHORIZED: u32 = 401;
const FORBIDDEN: u32 = 403;
const INTERNAL_SERVER_ERROR: u32 = 500;

class ApiKeyRoot extends RootContext {
  createContext(context_id: u32): Context {
    setLogLevel(LogLevelValues.info);
    return new ApiKeyContext(context_id, this);
  }
}

class ApiKeyContext extends Context {
  constructor(context_id: u32, root_context: ApiKeyRoot) {
    super(context_id, root_context);
  }

  onRequestHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues {
    const expectedKey = getSecret("API_KEY");
    if (expectedKey === "") {
      log(LogLevelValues.error, "API_KEY secret not configured");
      send_http_response(
        INTERNAL_SERVER_ERROR,
        "internal server error",
        String.UTF8.encode("App misconfigured"),
        [],
      );
      return FilterHeadersStatusValues.StopIteration;
    }

    const providedKey = stream_context.headers.request.get("X-API-Key");

    if (providedKey === "") {
      const authHeaders = new Array<HeaderPair>();
      authHeaders.push(makeHeaderPair("WWW-Authenticate", "API-Key"));
      send_http_response(
        UNAUTHORIZED,
        "unauthorized",
        String.UTF8.encode("Missing X-API-Key header"),
        authHeaders,
      );
      return FilterHeadersStatusValues.StopIteration;
    }

    if (providedKey !== expectedKey) {
      log(LogLevelValues.info, "API key validation failed");
      send_http_response(
        FORBIDDEN,
        "forbidden",
        String.UTF8.encode("Invalid API key"),
        [],
      );
      return FilterHeadersStatusValues.StopIteration;
    }

    // .remove() sets the header value to "" rather than deleting it entirely —
    // the upstream will see X-API-Key: "" rather than a missing header.
    stream_context.headers.request.remove("X-API-Key");

    log(LogLevelValues.info, "API key validated successfully");
    return FilterHeadersStatusValues.Continue;
  }
}

registerRootContext((context_id: u32) => {
  return new ApiKeyRoot(context_id);
}, "apiKey");
```


### FILE: examples/apiKey/package.json

```json
{
  "name": "fastedge-as-example-api-key",
  "version": "1.0.0",
  "description": "FastEdge AssemblyScript example: API Key — validate X-API-Key header against a secret",
  "scripts": {
    "asbuild:debug": "asc assembly/index.ts --target debug",
    "asbuild:release": "asc assembly/index.ts --target release",
    "asbuild": "npm run asbuild:debug && npm run asbuild:release"
  },
  "dependencies": {
    "@gcoredev/proxy-wasm-sdk-as": "^1.2.3"
  },
  "devDependencies": {
    "@assemblyscript/wasi-shim": "^0.1.0",
    "assemblyscript": "^0.28.9"
  }
}
```


### FILE: examples/apiKey/README.md

```
[← Back to examples](../README.md)

# API Key

This application validates requests using an `X-API-Key` header checked against a stored secret.

## What it does

In `onRequestHeaders`, the app:

1. Reads the expected API key from the `API_KEY` secret.
2. Checks the `X-API-Key` request header.
3. Returns `401 Unauthorized` if the header is missing.
4. Returns `403 Forbidden` if the key does not match.
5. On success, clears the `X-API-Key` header before forwarding to the upstream origin (proxy-wasm `.remove()` sets the header value to an empty string rather than deleting it).

This is a simpler alternative to JWT validation when you need basic API authentication without token expiry or claims.

> **Production note:** The key comparison (`providedKey !== expectedKey`) is not constant-time, which opens a timing side-channel for a high-volume attacker. For production use, replace the comparison with a constant-time HMAC equality check or use the `jwt` example which includes proper cryptographic validation.

## Configuration

Set the following on your FastEdge application:

| Name | Type | Description |
|------|------|-------------|
| `API_KEY` | Secret | The expected API key value |

## Build

```sh
pnpm install
pnpm run asbuild
```

Build output:

| File | Description |
|------|-------------|
| `build/apiKey.wasm` | Optimised release binary — upload this to FastEdge |
| `build/apiKey-debug.wasm` | Debug binary with source maps |

## Deploy

Upload `build/apiKey.wasm` to the FastEdge portal and attach it to your CDN application. Configure the `API_KEY` secret in the application settings.
```
