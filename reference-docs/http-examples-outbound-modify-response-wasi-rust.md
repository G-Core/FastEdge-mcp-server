<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 6347a7c2fda0d03e66f1214db5eec041c16801b7
      updated: 2026-08-20
-->

---
type: example
app_type: http
languages: [rust]
capabilities: [outbound-fetch, json-transform, response-building]
---

# Example: Outbound Modify Response (WASI, Rust)

Fetch JSON from an upstream HTTP origin, parse and reshape the body, and return a new response with an explicit `content-type: application/json` header. Extends the outbound_fetch pattern by consuming and transforming the upstream body rather than passing it through unchanged.

## Source Location

`examples/http/wasi/outbound_modify_response/`

## Cargo.toml

```toml
[package]
name = "outbound_modify_response_wasi"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wstd = "0.6"
anyhow = "1"
serde_json = "1"
```

`serde_json` must be declared explicitly. `wstd` provides the HTTP client and body types.

## Entry Point

```rust
#[wstd::http_server]
async fn main(_request: Request<Body>) -> anyhow::Result<Response<Body>>
```

- Macro: `#[wstd::http_server]`
- Input: `Request<Body>` — incoming request (unused in this example)
- Return: `anyhow::Result<Response<Body>>`

## Imports

```rust
use anyhow::anyhow;
use serde_json::{Value, json};
use wstd::http::body::Body;
use wstd::http::{Client, Request, Response};
```

## Step-by-Step Behavior

### 1. Build the upstream request

```rust
let upstream_req = Request::get("http://jsonplaceholder.typicode.com/users")
    .body(Body::empty())
    .map_err(|e| anyhow!("failed to build request: {e}"))?;
```

- `Request::get(url)` — constructs a GET request builder
- `.body(Body::empty())` — no request body
- `.map_err(...)` — maps `http::Error` to `anyhow::Error`

### 2. Send the request

```rust
let upstream_resp = Client::new()
    .send(upstream_req)
    .await
    .map_err(|e| anyhow!("outbound request failed: {e}"))?;
```

- `Client::new()` — creates a new HTTP client
- `.send(req).await` — async outbound request; returns `Response<Body>` on success

### 3. Destructure and read the body

```rust
let (_, mut body) = upstream_resp.into_parts();
let body_bytes = body.contents().await?;
```

- `into_parts()` — consumes the response, returning `(Parts, Body)`; headers are inaccessible after this call
- `body.contents().await?` — returns `&[u8]`; buffers the **entire** upstream body in WASM linear memory

**Constraint**: `body.contents().await?` is unsuitable for very large payloads because it buffers fully in memory before returning.

### 4. Parse JSON

```rust
let users: Value = serde_json::from_slice(body_bytes)?;
```

- `serde_json::from_slice::<Value>(&[u8])` — deserializes bytes to `serde_json::Value`
- Returns `serde_json::Error` on invalid JSON (propagated via `?`)

### 5. Slice the array

```rust
let sliced_users = match users.as_array() {
    Some(arr) => Value::Array(arr.iter().take(5).cloned().collect()),
    None => Value::Array(vec![]),
};
```

- `Value::as_array()` — returns `Option<&Vec<Value>>`; handle `None` explicitly
- `.take(5)` — limits iteration to first 5 elements
- `.cloned()` — clones each `&Value` to produce owned `Value`

### 6. Compose the output JSON

```rust
let result = json!({
    "users": sliced_users,
    "total": 5,
    "skip": 0,
    "limit": 30,
});
```

- `serde_json::json!` macro — constructs a `Value` from a JSON literal
- Fields: `users` (array), `total` (number), `skip` (number), `limit` (number)

### 7. Build and return the response

```rust
Ok(Response::builder()
    .status(200)
    .header("content-type", "application/json")
    .body(Body::from(result.to_string()))?)
```

- `Response::builder()` — starts an HTTP response builder
- `.status(200)` — sets HTTP status
- `.header("content-type", "application/json")` — sets explicit content type
- `Body::from(String)` — wraps the serialized JSON string as the response body
- `result.to_string()` — serializes `Value` to a JSON string

## Key API Reference

| API | Type | Notes |
|---|---|---|
| `Client::new().send(req).await` | `async` → `Result<Response<Body>>` | Outbound HTTP |
| `Response::into_parts()` | Consumes `Response<Body>` → `(Parts, Body)` | Headers inaccessible after |
| `body.contents().await?` | `async` → `&[u8]` | Full body buffer in WASM memory |
| `serde_json::from_slice(&[u8])` | `Result<T, serde_json::Error>` | Deserialize bytes to `Value` |
| `Value::as_array()` | `Option<&Vec<Value>>` | Must handle `None` |
| `Iterator::take(n)` | `Take<I>` | Slice to first `n` elements |
| `serde_json::json!({...})` | `Value` | JSON literal constructor macro |
| `Body::from(String)` | `Body` | String to response body |

## Gotchas

- `into_parts()` consumes the response — any header reads must occur before this call
- `body.contents().await?` buffers the full body in WASM linear memory — avoid for large upstream responses
- `serde_json` must be added to `Cargo.toml`; it is not re-exported by `wstd`
- `Value::as_array()` returns `Option<&Vec<Value>>` — the `None` case (non-array JSON) must be handled explicitly

## Relationship to Other Examples

- outbound_fetch (WASI, Rust) — simpler variant; passes the upstream response through without body transformation
- Mirror of the FastEdge-sdk-js `outbound-modify-response` example

## See Also

- outbound_fetch example (WASI, Rust)
- outbound_fetch example (WASI, JS)
- outbound-modify-response example (JS)
- wstd HTTP client documentation
- serde_json crate documentation

## Full Source

### FILE: examples/http/wasi/outbound_modify_response/src/lib.rs

```rust
/*
 * Copyright 2025 G-Core Innovations SARL
 */
/*
Outbound fetch with response transformation.

Fetches JSON from an upstream origin, reads and parses the body, reshapes it
into a new JSON object (first 5 users with pagination metadata), and returns
it with a fresh `content-type: application/json` header.

This is the stepping-stone beyond `outbound_fetch/` which just passes the
upstream response through unchanged.

Mirror of the FastEdge-sdk-js `outbound-modify-response` example.
*/

use anyhow::anyhow;
use serde_json::{Value, json};
use wstd::http::body::Body;
use wstd::http::{Client, Request, Response};

#[wstd::http_server]
async fn main(_request: Request<Body>) -> anyhow::Result<Response<Body>> {
    let upstream_req = Request::get("http://jsonplaceholder.typicode.com/users")
        .body(Body::empty())
        .map_err(|e| anyhow!("failed to build request: {e}"))?;

    let upstream_resp = Client::new()
        .send(upstream_req)
        .await
        .map_err(|e| anyhow!("outbound request failed: {e}"))?;

    let (_, mut body) = upstream_resp.into_parts();
    let body_bytes = body.contents().await?;
    let users: Value = serde_json::from_slice(body_bytes)?;

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

    Ok(Response::builder()
        .status(200)
        .header("content-type", "application/json")
        .body(Body::from(result.to_string()))?)
}
```

### FILE: examples/http/wasi/outbound_modify_response/Cargo.toml

```toml
[workspace]

[package]
name = "outbound_modify_response_wasi"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wstd = "0.6"
anyhow = "1"
serde_json = "1"
```

### FILE: examples/http/wasi/outbound_modify_response/README.md

```
[← Back to examples](../../../README.md)

# Outbound Modify Response (WASI)

Fetch data from an outbound HTTP origin, transform the JSON response (slice to first 5
users), and return it with a fresh `content-type: application/json` header.

Demonstrates reading the upstream body with `body.contents().await`, parsing JSON with
`serde_json`, and composing a new response from scratch.

## Related

- [outbound_fetch](../outbound_fetch/) — the simpler variant that just passes the upstream
  response through unchanged.
- Mirror of `FastEdge-sdk-js/examples/outbound-modify-response/`.
```
