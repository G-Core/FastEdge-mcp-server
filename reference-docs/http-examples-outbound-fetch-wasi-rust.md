<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 6347a7c2fda0d03e66f1214db5eec041c16801b7
      updated: 2026-06-16
-->

# Outbound Fetch — WASI (Rust)

## Overview

Fetches data from an upstream HTTP origin and returns the response verbatim — status, headers, and body pass through unchanged. The body is never buffered, enabling streaming passthrough.

- **App type**: HTTP
- **Language**: Rust
- **Runtime**: WASI async (`wstd`)
- **Pattern**: Outbound HTTP proxy / passthrough

---

## Dependencies

```toml
[dependencies]
wstd = "0.6"
anyhow = "1"
```

Crate type must be `cdylib`:

```toml
[lib]
crate-type = ["cdylib"]
```

---

## API Reference

### `wstd::http::Client`

| Method | Signature | Description |
|--------|-----------|-------------|
| `new` | `Client::new() -> Client` | Creates a new HTTP client instance |
| `send` | `async fn send(&self, req: Request<Body>) -> Result<Response<Body>, ...>` | Sends an outbound HTTP request; returns upstream response or error |

### `wstd::http::Request`

| Method | Signature | Description |
|--------|-----------|-------------|
| `get` | `Request::get(url: &str) -> Builder` | Creates a GET request builder targeting the given URL |
| `body` | `Builder::body(body: Body) -> Result<Request<Body>, http::Error>` | Finalizes the request with a body; returns `Result` |

### `wstd::http::body::Body`

| Method | Signature | Description |
|--------|-----------|-------------|
| `empty` | `Body::empty() -> Body` | Creates an empty body; use for requests with no payload |

### `wstd::http::Response`

| Method | Signature | Description |
|--------|-----------|-------------|
| `into_parts` | `fn into_parts(self) -> (Parts, Body)` | Destructures response into head parts and body |
| `new` | `Response::new(body: Body) -> Response<Body>` | Constructs a new response from a body |
| `status_mut` | `fn status_mut(&mut self) -> &mut StatusCode` | Mutable reference to response status |
| `headers_mut` | `fn headers_mut(&mut self) -> &mut HeaderMap` | Mutable reference to response headers |

---

## Handler Signature

```rust
#[wstd::http_server]
async fn main(_request: Request<Body>) -> anyhow::Result<Response<Body>>
```

The macro `#[wstd::http_server]` registers the function as the WASI HTTP handler entry point. The function must be `async` and return `anyhow::Result<Response<Body>>`.

---

## Complete Example

```rust
use anyhow::anyhow;
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

    let (parts, body) = upstream_resp.into_parts();
    let mut response = Response::new(body);
    *response.status_mut() = parts.status;
    *response.headers_mut() = parts.headers;
    Ok(response)
}
```

---

## Patterns and Constraints

### Build outbound request

```rust
let req = Request::get("http://example.com/path")
    .body(Body::empty())
    .map_err(|e| anyhow!("failed to build request: {e}"))?;
```

- `Request::get(url)` returns an `http::request::Builder`.
- `.body(Body::empty())` finalizes the builder and returns `Result<Request<Body>, http::Error>`.
- Use `.map_err(|e| anyhow!(...))` to convert the error into `anyhow::Error`.

### Send outbound request

```rust
let resp = Client::new()
    .send(req)
    .await
    .map_err(|e| anyhow!("outbound request failed: {e}"))?;
```

- `Client::new()` is lightweight — no connection pooling configuration exposed.
- `.send()` is `async`; must be `.await`ed.
- Returns `Result<Response<Body>, ...>`; map error with `anyhow!`.

### Reconstruct response preserving upstream metadata

```rust
let (parts, body) = resp.into_parts();
let mut response = Response::new(body);
*response.status_mut() = parts.status;
*response.headers_mut() = parts.headers;
```

- `into_parts()` separates the head (`Parts`: status, headers, version) from the streaming body.
- `Response::new(body)` starts with a default 200 status; overwrite it explicitly.
- Both status and headers must be set via the mutable references returned by `status_mut()` and `headers_mut()`.

---

## Streaming Behavior

**Do not call `.contents()` on the upstream body.** Passing the `Body` directly into `Response::new(body)` enables streaming: upstream chunks are forwarded to the client as they arrive without buffering in memory.

Calling `.contents().await` would materialize the entire body into memory before responding — avoid this in passthrough scenarios.

---

## Error Handling

| Error site | Pattern |
|------------|---------|
| Request builder failure | `.map_err(\|e\| anyhow!("failed to build request: {e}"))` |
| Outbound send failure | `.map_err(\|e\| anyhow!("outbound request failed: {e}"))` |

Both errors propagate via `?` and are returned as `anyhow::Error`, which the runtime converts to an appropriate HTTP error response.

---

## Constraints and Gotchas

- `wstd::http::Client` is only available in WASI async apps (requires `#[wstd::http_server]`).
- `anyhow` crate is required for error mapping; `wstd` does not expose its own error type publicly.
- The incoming `_request` parameter is intentionally ignored in this example; access it for request-conditional logic.
- This example only issues a GET request. For POST or other methods, use `Request::builder().method("POST")...`.

---

## Related Examples

See also (by name):
- `outbound_modify_response` (Rust, WASI) — same outbound fetch pattern but reads and reshapes the body into a new JSON response
- `streaming` (Rust, WASI) — handler that generates its own streaming response body without an upstream origin
- `outbound-fetch` (JavaScript) — mirror of this example in the FastEdge SDK JS repository
