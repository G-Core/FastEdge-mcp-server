<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 6347a7c2fda0d03e66f1214db5eec041c16801b7
      updated: 2026-06-16
-->

---
type: example
app_type: http
languages: [rust]
capabilities: [outbound-fetch, json-parsing, json-shaping]
---

# Example: Outbound Fetch — Basic HTTP (Rust)

Demonstrates outbound HTTP from a FastEdge application using the legacy sync handler (`#[fastedge::http]`). Fetches user data from the JSONPlaceholder public API, slices the first 5 users, and returns a shaped JSON envelope.

**Target:** `wasm32-wasip1`
**Handler style:** Sync (`#[fastedge::http]`)
**Crate:** `outbound_fetch` v0.1.0

---

## Behavior

On any incoming request:

1. Constructs a GET request to `http://jsonplaceholder.typicode.com/users` using `Request::builder()`.
2. Sends the request via `fastedge::send_request`.
3. Reads the full response body into memory with `.body().to_vec()`.
4. Parses the byte slice as a `serde_json::Value` using `serde_json::from_slice`.
5. Slices the first 5 elements from the users array.
6. Constructs a JSON envelope with pagination metadata using the `json!({...})` macro.
7. Returns a `200 OK` response with `content-type: application/json`.

---

## APIs Used

| API | Signature | Purpose |
|---|---|---|
| `#[fastedge::http]` | proc macro | Sync request-response handler entry point |
| `fastedge::send_request` | `fn send_request(req: Request<Body>) -> Result<Response<Body>, fastedge::Error>` | Outbound HTTP request |
| `Request::builder()` | returns `http::request::Builder` | Constructs outbound request |
| `.uri(uri)` | `fn uri(self, uri: impl Into<Uri>) -> Builder` | Sets outbound request URI |
| `.body(Body::empty())` | `fn body(self, body: Body) -> Result<Request<Body>>` | Finalizes request with empty body |
| `Response<Body>.body()` | `fn body(&self) -> &Body` | Accesses response body |
| `Body::to_vec()` | `fn to_vec(&self) -> Vec<u8>` | Reads entire body into memory |
| `serde_json::from_slice` | `fn from_slice<T: DeserializeOwned>(v: &[u8]) -> Result<T>` | Parses bytes as JSON |
| `Value::as_array()` | `fn as_array(&self) -> Option<&Vec<Value>>` | Extracts JSON array |
| `.iter().take(n)` | standard iterator | Slices first N elements |
| `json!({...})` | macro from `serde_json` | Constructs a `serde_json::Value` from literal syntax |
| `Value::to_string()` | `fn to_string(&self) -> String` | Serializes JSON value to string |
| `Response::builder()` | returns `http::response::Builder` | Constructs outbound response |
| `.status(StatusCode::OK)` | sets HTTP status | |
| `.header(name, value)` | sets response header | |
| `.body(Body::from(String))` | finalizes response | |

---

## Dependencies

```toml
[dependencies]
fastedge = "0.4"
anyhow = "1"
serde_json = "1"
```

`crate-type = ["cdylib"]` is required for WASM compilation.

---

## Full Source

```rust
use anyhow::{Error, Result};
use fastedge::body::Body;
use fastedge::http::{Request, Response, StatusCode};
use serde_json::{json, Value};

#[fastedge::http]
fn main(_req: Request<Body>) -> Result<Response<Body>> {
    let upstream_req = Request::builder()
        .uri("http://jsonplaceholder.typicode.com/users")
        .body(Body::empty())?;

    let upstream_resp = fastedge::send_request(upstream_req).map_err(Error::msg)?;

    let body_bytes = upstream_resp.body().to_vec();
    let users: Value = serde_json::from_slice(&body_bytes)?;

    let sliced_users = match users.as_array() {
        Some(arr) => Value::Array(arr.iter().take(5).cloned().collect()),
        None => Value::Array(vec![]),
    };

    let result = json!({
        "users": sliced_users,
        "total": 5,
        "skip": 0,
        "limit": 30,
    });

    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "application/json")
        .body(Body::from(result.to_string()))
        .map_err(Into::into)
}
```

---

## JSON Shaping Pattern

```rust
// Parse upstream body bytes to serde_json::Value
let users: Value = serde_json::from_slice(&body_bytes)?;

// Slice first 5 from array; fallback to empty array if not an array
let sliced_users = match users.as_array() {
    Some(arr) => Value::Array(arr.iter().take(5).cloned().collect()),
    None => Value::Array(vec![]),
};

// Wrap in pagination envelope
let result = json!({
    "users": sliced_users,
    "total": 5,
    "skip": 0,
    "limit": 30,
});
```

---

## Expected Request/Response

| Request | Response Status | Content-Type | Body |
|---|---|---|---|
| `GET /` (any path) | `200 OK` | `application/json` | JSON object with `users` (array of ≤5 items), `total`, `skip`, `limit` |

Example response body:

```json
{
  "users": [
    { "id": 1, "name": "Leanne Graham" },
    ...
  ],
  "total": 5,
  "skip": 0,
  "limit": 30
}
```

---

## Build

```sh
cargo build --release
# Output: target/wasm32-wasip1/release/outbound_fetch.wasm
```

---

## Constraints and Gotchas

- **`fastedge::send_request` error mapping**: The error returned by `send_request` is converted to `anyhow::Error` via `.map_err(Error::msg)`. It is not returned as-is.
- **Full body buffering**: `upstream_resp.body().to_vec()` reads the entire upstream response body into memory. Not suitable for large payloads.
- **Hardcoded upstream URL**: The target URI `http://jsonplaceholder.typicode.com/users` is hardcoded. There is no dynamic routing or request-based URL selection.
- **No upstream error handling**: This example does not inspect the upstream response status code. A non-200 upstream response will still be parsed as JSON, which may cause a deserialization error.
- **Incoming request ignored**: The handler ignores the incoming `_req` entirely; all behavior is driven by the hardcoded upstream fetch.
- **Sync handler only**: Uses `#[fastedge::http]` (sync, `wasm32-wasip1`). For new applications, the async WASI handler is preferred — see the WASI HTTP examples reference.

---

## See Also

- examples-outbound-fetch-wasi-rust (async WASI variant of outbound fetch)
- sdk-reference-rust (full `fastedge` crate API reference)
- examples-basic-http-rust (minimal sync handler without outbound fetch)
- platform-overview (FastEdge execution model and WASM target context)
