<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 6347a7c2fda0d03e66f1214db5eec041c16801b7
      updated: 2026-07-23
-->

---
type: example
app_type: http
languages: [rust]
capabilities: [outbound-http, env-vars, json-parsing, redirect-following, auth, chained-api-calls]
---

# Example: Smart Switch (Basic HTTP, Rust)

Demonstrates outbound HTTP composition on the edge: a single inbound GET triggers two sequential SmartThings API calls (status fetch + toggle command) and returns the result. Uses the legacy sync handler (`#[fastedge::http]`, `wasm32-wasip1`).

---

## Handler Registration

```rust
#[fastedge::http]
fn main(req: Request<Body>) -> Result<Response<Body>, Error>
```

- Macro: `#[fastedge::http]` (sync, `wasm32-wasip1` target)
- Input: `Request<Body>`
- Output: `Result<Response<Body>, Error>`

---

## Request Flow

1. Reject non-GET/HEAD with `405 Method Not Allowed` + `Allow: GET, HEAD` header.
2. Read `PASSWORD` env var; return `500` if missing.
3. Read `Authorization` request header; return `403 No auth header` if absent; return `500` if header is not valid UTF-8.
4. Compare header value to `PASSWORD`; return `403` (empty body) if mismatch.
5. Read `DEVICE` and `TOKEN` env vars; return `500` if either is missing.
6. Call `get_device_status(token, device)` → return upstream error status on failure.
7. Invert status: `"off"` → `"on"`, `"on"` → `"off"`; return `404 Unsupported device status` for any other value.
8. Call `send_device_command(token, device, wanted_status)` → return upstream error status on failure.
9. Map command result: `"ACCEPTED"` → `204 No Content`; anything else → `404`.
10. Return final status with empty body.

---

## Environment Variables

| Variable   | Purpose                                                          | Required |
|------------|------------------------------------------------------------------|----------|
| `PASSWORD` | Value checked against the `Authorization` request header         | Yes      |
| `DEVICE`   | SmartThings device ID                                            | Yes      |
| `TOKEN`    | SmartThings API bearer token                                     | Yes      |

Read at request time via `std::env::var()`. Missing any variable returns `500 Internal Server Error`.

---

## Outbound API Functions

### `get_device_status`

```rust
fn get_device_status(token: &str, device: &str) -> Result<String, StatusCode>
```

- Sends `GET https://api.smartthings.com/v1/devices/{device}/status`
- Headers: `Accept: application/json`, `Authorization: Bearer {token}`, `Pragma: no-cache`
- Parses response JSON; extracts `components.main.switch.switch.value`
  - **Note**: `switch` appears twice in the path — this is correct per the SmartThings API schema.
- Returns the trimmed string value (e.g. `"on"` or `"off"`) on success.
- Returns `StatusCode` on any error (request failure, UTF-8 decode failure, JSON parse failure, missing path).

### `send_device_command`

```rust
fn send_device_command(token: &str, device: &str, command: &str) -> Result<String, StatusCode>
```

- Sends `POST https://api.smartthings.com/v1/devices/{device}/commands`
- Headers: `Accept: application/json`, `Content-Type: application/json`, `Authorization: Bearer {token}`
- Body: `{"commands": [{"capability": "switch", "command": "<command>"}]}`
- Parses response JSON; extracts `results[0].status`
- Returns the trimmed status string (e.g. `"ACCEPTED"`) on success.
- Returns `StatusCode` on any error.

---

## Outbound HTTP Helper

### `request`

```rust
fn request(req: Request<Body>) -> Result<Response<Body>, StatusCode>
```

Entry point; delegates to `request_inner(req, 0)`.

### `request_inner`

```rust
fn request_inner(req: Request<Body>, depth: u8) -> Result<Response<Body>, StatusCode>
```

- Calls `fastedge::send_request(req)`.
- On `fastedge::Error`, maps to `StatusCode`:

  | `fastedge::Error` variant     | Mapped `StatusCode`          |
  |-------------------------------|------------------------------|
  | `UnsupportedMethod(_)`        | `405 Method Not Allowed`     |
  | `BindgenHttpError(_)`         | `500 Internal Server Error`  |
  | `HttpError(_)`                | `500 Internal Server Error`  |
  | `InvalidBody`                 | `400 Bad Request`            |
  | `InvalidStatusCode(_)`        | `400 Bad Request`            |

- On redirect status (see below) and `depth < MAX_REDIRECTS` (5):
  - Reads `Location` header; parses with `url::Url`.
  - Builds new `GET` request with parsed URL and extracted `Host` header.
  - Recurses with `depth + 1`.
- Returns `Ok(rsp)` only if final status is `200 OK`.
- Returns `Err(status)` for all other non-redirect statuses.

**Redirect codes followed** (`REDIRECT_CODES`):
- `301 Moved Permanently`
- `302 Found`
- `303 See Other`
- `307 Temporary Redirect`
- `308 Permanent Redirect`

**Maximum redirect depth**: `MAX_REDIRECTS = 5`

---

## Response Behavior

| Condition                               | Status Code           | Body                            |
|-----------------------------------------|-----------------------|---------------------------------|
| Non-GET/HEAD method                     | `405`                 | `This method is not allowed\n` + `Allow: GET, HEAD` header |
| `PASSWORD` env var missing              | `500`                 | `Misconfigured app\n`           |
| `Authorization` header absent           | `403`                 | `No auth header\n`              |
| `Authorization` header not valid UTF-8  | `500`                 | `cannot process auth header`    |
| Wrong password                          | `403`                 | empty                           |
| `DEVICE` env var missing                | `500`                 | `Misconfigured app\n`           |
| `TOKEN` env var missing                 | `500`                 | `Misconfigured app\n`           |
| `get_device_status` fails               | upstream `StatusCode` | empty                           |
| Device status not `"on"` or `"off"`    | `404`                 | `Unsupported device status\n`   |
| `send_device_command` fails             | upstream `StatusCode` | empty                           |
| Command result is `"ACCEPTED"`          | `204`                 | empty                           |
| Command result is anything else         | `404`                 | empty                           |

---

## Dependencies

```toml
[dependencies]
fastedge = "0.4"
serde = "1.0"
serde_json = "1.0"
url = "2.5"
```

| Crate        | Usage                                                                         |
|--------------|-------------------------------------------------------------------------------|
| `fastedge`   | `#[fastedge::http]`, `fastedge::send_request`, HTTP types                    |
| `serde_json` | Parse SmartThings JSON responses (`Value`, `from_str`, chained `get()`)       |
| `url`        | Parse and extract host from redirect `Location` headers                       |

Crate type: `cdylib`
Build target: `wasm32-wasip1`
Build output: `target/wasm32-wasip1/release/smart_switch.wasm`

---

## Key Gotchas

- **Double `switch` in JSON path**: `components.main.switch.switch.value` — `switch` appears twice. This is correct per the SmartThings API schema, not a typo.
- **Redirect resets to GET**: `request_inner` always builds a new `GET` request when following redirects, discarding the original method.
- **`fastedge::send_request` errors map to `StatusCode`**: These are not `anyhow::Error` or `std::error::Error`; match on `fastedge::Error` variants explicitly.
- **`"ACCEPTED"` string determines success**: The command result is compared as a string; only `"ACCEPTED"` maps to `204`. Any other value maps to `404`.
- **Auth is a plain header match**: `Authorization` header value is compared directly to `PASSWORD` env var — no bearer prefix stripping, no hashing.

---

## Build

```sh
cargo build --release --target wasm32-wasip1
# Output: target/wasm32-wasip1/release/smart_switch.wasm
```

---

## See Also

- api_wrapper example (HTTP) — earlier version of the same outbound HTTP composition pattern
- fastedge-docs reference: sdk-reference-rust — `fastedge::send_request`, `Request::builder`, `fastedge::Error` variants
- fastedge-docs reference: best-practices — env var access patterns, error mapping conventions
- fastedge-docs reference: platform-overview — sync vs async handler distinction, `wasm32-wasip1` target
