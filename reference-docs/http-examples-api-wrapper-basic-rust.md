<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 6347a7c2fda0d03e66f1214db5eec041c16801b7
      updated: 2026-06-16
-->

# examples-api-wrapper-basic-rust

**Type:** HTTP example — basic (sync, `wasm32-wasip1`)
**Language:** Rust
**App type:** HTTP
**Capabilities:** outbound HTTP, env vars, JSON parsing, authentication, redirect handling

---

## Overview

Demonstrates how to orchestrate multiple outbound HTTP calls within a single FastEdge edge function. The example integrates with the SmartThings API to read a smart-switch device state and toggle it. Uses the legacy synchronous `#[fastedge::http]` handler.

> **Handler note:** This example uses `#[fastedge::http]` (sync, `wasm32-wasip1`). For new projects, prefer `#[wstd::http_server]` (async, `wasm32-wasip2`).

---

## Handler Signature

```rust
#[fastedge::http]
fn main(req: Request<Body>) -> Result<Response<Body>, Error>
```

Entry point macro: `#[fastedge::http]`

---

## Dependencies

```toml
[dependencies]
fastedge = "0.4"
serde = "1"
serde_json = "1"
url = "2.5"
```

Crate type: `cdylib`
Target: `wasm32-wasip1`

---

## Environment Variables

| Name | Required | Description |
|---|---|---|
| `PASSWORD` | Yes | Expected password value — compared against the `Authorization` request header |
| `DEVICE` | Yes | SmartThings device ID |
| `TOKEN` | Yes | SmartThings API bearer token |

All three are read with `env::var("NAME")`. Missing any one returns `500 Internal Server Error` with body `Misconfigured app\n`.

---

## Request Format

**Accepted methods:** `GET`, `HEAD` only.

```
GET / HTTP/1.1
Authorization: <your-password>
```

Any other method returns `405 Method Not Allowed` with header `Allow: GET, HEAD`.

---

## App Flow

1. Validate HTTP method — only `GET` and `HEAD` accepted; `405` otherwise
2. Read `PASSWORD` env var — `500` if missing
3. Read `Authorization` header — `403` with body `No auth header\n` if absent
4. Validate `Authorization` header value can be converted to string — `500` on error
5. Compare provided password against `PASSWORD` — `403` with empty body if mismatch
6. Read `DEVICE` env var — `500` if missing
7. Read `TOKEN` env var — `500` if missing
8. Call `get_device_status(token, device)` — propagates upstream status on error
9. Determine toggle target: `"off"` → `"on"`, `"on"` → `"off"`, anything else → `404`
10. Call `send_device_command(token, device, wanted_status)`
11. Map result: `"ACCEPTED"` → `204 No Content`; other strings → `404`

---

## Outbound HTTP API

### `fastedge::send_request`

```rust
fastedge::send_request(req: Request<Body>) -> Result<Response<Body>, fastedge::Error>
```

Synchronous outbound HTTP call. Used for all SmartThings API interactions.

**Error variants:**

| Variant | Mapped status |
|---|---|
| `fastedge::Error::UnsupportedMethod(_)` | `405 Method Not Allowed` |
| `fastedge::Error::BindgenHttpError(_)` | `500 Internal Server Error` |
| `fastedge::Error::HttpError(_)` | `500 Internal Server Error` |
| `fastedge::Error::InvalidBody` | `400 Bad Request` |
| `fastedge::Error::InvalidStatusCode(_)` | `400 Bad Request` |

---

## Helper Functions

### `get_device_status`

```rust
fn get_device_status(token: &str, device: &str) -> Result<String, StatusCode>
```

Issues `GET https://api.smartthings.com/v1/devices/<device>/status` with headers:
- `Accept: application/json`
- `Authorization: Bearer <token>`
- `Pragma: no-cache`

Parses JSON response and extracts value at path `components.main.switch.switch.value`.

> **Gotcha:** The path has `switch` twice — this is the actual SmartThings JSON schema, not a typo.

Returns the string value (e.g. `"on"` or `"off"`) with surrounding quotes trimmed via `trim_matches('"')`.

On any error (request failure, non-200, JSON parse error, missing path), returns `Err(StatusCode)`.

### `send_device_command`

```rust
fn send_device_command(token: &str, device: &str, command: &str) -> Result<String, StatusCode>
```

Issues `POST https://api.smartthings.com/v1/devices/<device>/commands` with headers:
- `Accept: application/json`
- `Content-Type: application/json`
- `Authorization: Bearer <token>`

Request body:
```json
{"commands": [{"capability": "switch", "command": "<command>"}]}
```

Parses JSON response and extracts `results[0].status` as a string. Returns it with quotes trimmed.

Caller maps `"ACCEPTED"` → `204 No Content`; any other value → `404`.

### `request` / `request_inner`

```rust
fn request(req: Request<Body>) -> Result<Response<Body>, StatusCode>
fn request_inner(req: Request<Body>, depth: u8) -> Result<Response<Body>, StatusCode>
```

Wraps `fastedge::send_request` with automatic redirect following.

**Redirect behaviour:**
- Follows HTTP 301, 302, 303, 307, 308
- Maximum redirects: `MAX_REDIRECTS = 5`
- On redirect: resets method to `GET`, reads `Location` header, constructs new request with `Host` derived from the redirect URL
- Depth tracked via `depth: u8` parameter; redirects beyond limit are not followed

Returns `Ok(response)` only when status is `200 OK`. Any non-redirect, non-200 status is returned as `Err(StatusCode)`.

---

## Response Summary

| Condition | Status | Body |
|---|---|---|
| Method not GET or HEAD | 405 | `This method is not allowed\n` |
| Missing `Authorization` header | 403 | `No auth header\n` |
| `Authorization` header not valid string | 500 | `cannot process auth header` |
| Wrong password | 403 | _(empty)_ |
| Missing `PASSWORD` env var | 500 | `Misconfigured app\n` |
| Missing `DEVICE` env var | 500 | `Misconfigured app\n` |
| Missing `TOKEN` env var | 500 | `Misconfigured app\n` |
| SmartThings API error | Reflects upstream status | _(empty)_ |
| Device status not `"on"` or `"off"` | 404 | `Unsupported device status\n` |
| Command result not `"ACCEPTED"` | 404 | _(empty)_ |
| Device toggled successfully | 204 | _(empty)_ |

---

## JSON Traversal Pattern

SmartThings device status response traversal using `serde_json::Value`:

```rust
let status = json
    .get(&"components")
    .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?
    .get(&"main")
    .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?
    .get(&"switch")
    .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?
    .get(&"switch")          // "switch" appears twice — this matches the actual schema
    .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?
    .get(&"value")
    .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?
    .to_string();
```

Pattern: chain `.get(&"key").ok_or(StatusCode::INTERNAL_SERVER_ERROR)?` for each path segment. Each missing key propagates a 500 error.

---

## Authorization Header Construction (Outbound)

Bearer token attached to outbound requests:

```rust
.header(header::AUTHORIZATION, "Bearer ".to_string() + token)
```

Inbound authentication uses the raw `Authorization` header value compared directly against the `PASSWORD` env var (no `Bearer` prefix required from caller).

---

## Build

```sh
cargo build --release
# Output: target/wasm32-wasip1/release/api_wrapper.wasm
```

---

## Key Constraints

- `fastedge::send_request` is synchronous — no async/await
- Redirect following resets the HTTP method to `GET` unconditionally
- Only `200 OK` is treated as success from outbound calls; all other non-redirect statuses propagate as errors
- `"ACCEPTED"` string (from SmartThings command result) maps to `StatusCode::NO_CONTENT` (204)

---

## See Also

- fastedge-sdk-rust outbound HTTP reference
- fastedge::Error enum reference
- platform-overview (env var configuration)
- sdk-reference-rust
