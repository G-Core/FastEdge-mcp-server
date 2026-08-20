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
