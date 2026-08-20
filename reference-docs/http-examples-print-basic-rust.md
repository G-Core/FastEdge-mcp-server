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
capabilities: [request-inspection, header-iteration, plain-text-response]
---

# Example: Print (HTTP Request Echo) — Rust

Echoes the incoming request's method, URL, and all headers back in the response body as plain text. Pure request inspection with no outbound calls.

## Handler signature

```rust
#[fastedge::http]
fn main(req: Request<Body>) -> Result<Response<Body>>
```

- Macro: `#[fastedge::http]` (sync handler, targets `wasm32-wasip1`)
- Input: `Request<Body>` — the incoming HTTP request
- Output: `Result<Response<Body>>` — returns `Ok(response)` or propagates error via `anyhow::Result`

> This example uses the legacy sync handler (`wasm32-wasip1`). For new apps, prefer the async `#[wstd::http_server]` handler targeting `wasm32-wasip2` — see the wasi examples reference.

## Crate dependencies

| Crate | Version | Purpose |
|-------|---------|---------|
| `fastedge` | `0.4` | HTTP types, body, and handler macro |
| `anyhow` | `1` | Error propagation via `Result` |

Crate type: `cdylib` (required for WASM output).

## API surface used

| API | Type | Notes |
|-----|------|-------|
| `req.method()` | `&Method` | Returns the HTTP method |
| `req.method().as_str()` | `&str` | Always valid UTF-8 |
| `req.uri()` | `&Uri` | Full request URI |
| `req.uri().to_string()` | `String` | May include scheme and host depending on incoming request format |
| `req.headers()` | `impl Iterator<Item = (&HeaderName, &HeaderValue)>` | Iterates all request headers |
| `HeaderName::as_str()` | `&str` | Always valid UTF-8 |
| `HeaderValue::to_str()` | `Result<&str, ToStrError>` | Fails for non-UTF-8 (binary) header values |
| `Response::builder()` | `Builder` | Starts response construction |
| `Response::builder().status(StatusCode::OK)` | `Builder` | Sets HTTP 200 status |
| `Response::builder().status(...).body(Body)` | `Result<Response<Body>, Error>` | Finalises the response |
| `Body::from(String)` | `Body` | Creates a response body from an owned `String` |

## Implementation pattern

```rust
use anyhow::Result;
use fastedge::body::Body;
use fastedge::http::{Request, Response, StatusCode};

#[fastedge::http]
fn main(req: Request<Body>) -> Result<Response<Body>> {
    let mut body: String = "Method: ".to_string();
    body.push_str(req.method().as_str());

    body.push_str("\nURL: ");
    body.push_str(req.uri().to_string().as_str());

    body.push_str("\nHeaders:");
    for (h, v) in req.headers() {
        body.push_str("\n    ");
        body.push_str(h.as_str());
        body.push_str(": ");
        match v.to_str() {
            Err(_) => body.push_str("not a valid text"),
            Ok(a) => body.push_str(a),
        }
    }
    let res = Response::builder()
        .status(StatusCode::OK)
        .body(Body::from(body))?;
    Ok(res)
}
```

## Key patterns

**Header iteration with non-UTF-8 handling:**
```rust
for (h, v) in req.headers() {
    body.push_str(h.as_str());       // HeaderName — always UTF-8, no match needed
    match v.to_str() {               // HeaderValue — may fail for binary values
        Err(_) => body.push_str("not a valid text"),
        Ok(a)  => body.push_str(a),
    }
}
```

- `h.as_str()` on `HeaderName` is always safe — no error handling required.
- `v.to_str()` on `HeaderValue` returns `Err` for binary (non-UTF-8) header values. The `Err` branch must always be handled; this example substitutes `"not a valid text"`.
- Body is accumulated via repeated `push_str` calls into a single `String`.

## Response characteristics

| Property | Value |
|----------|-------|
| Status | `200 OK` |
| Body format | Plain text |
| `content-type` | Not set explicitly; platform may add one |
| Header format | One header per line, indented with four spaces |
| Non-UTF-8 header values | Replaced with literal `"not a valid text"` |

## Expected output format

```
Method: GET
URL: /some/path?query=value
Headers:
    host: example.com
    accept: */*
    ...
```

## Build

```sh
cargo build --release
# Output: target/wasm32-wasip1/release/print.wasm
```

## Constraints and gotchas

- `req.uri().to_string()` may include scheme and host (e.g. `https://example.com/path`) depending on how the platform forwards the request — do not assume path-only.
- No `content-type` header is set on the response; do not rely on a specific value being present.
- No outbound network calls are made — this is a pure request inspection handler.
- The handler is synchronous (`wasm32-wasip1`). It cannot be used with async APIs or `wasm32-wasip2` targets.
- `#[allow(dead_code)]` appears in source but is not required in production use — it suppresses warnings in the SDK example context only.

## See Also

- wasi HTTP examples (async handler, `wasm32-wasip2`)
- sdk-reference-rust (full API reference for `fastedge` crate)
- platform-overview (request lifecycle, header forwarding behaviour)
- best-practices (response building patterns)

## Source Material

### FILE: examples/http/basic/print/src/lib.rs

```rust
use anyhow::Result;
use fastedge::body::Body;
use fastedge::http::{Request, Response, StatusCode};

#[allow(dead_code)]
#[fastedge::http]
fn main(req: Request<Body>) -> Result<Response<Body>> {
    let mut body: String = "Method: ".to_string();
    body.push_str(req.method().as_str());

    body.push_str("\nURL: ");
    body.push_str(req.uri().to_string().as_str());

    body.push_str("\nHeaders:");
    for (h, v) in req.headers() {
        body.push_str("\n    ");
        body.push_str(h.as_str());
        body.push_str(": ");
        match v.to_str() {
            Err(_) => body.push_str("not a valid text"),
            Ok(a) => body.push_str(a),
        }
    }
    let res = Response::builder()
        .status(StatusCode::OK)
        .body(Body::from(body))?;
    Ok(res)
}
```

### FILE: examples/http/basic/print/Cargo.toml

```toml
[workspace]

[package]
name = "print"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
fastedge = "0.4"
anyhow = "1"
```

### FILE: examples/http/basic/print/README.md

```
[← Back to examples](../../../README.md)

# Print

Echoes the incoming request's method, URL, and all headers back in the response body as plain text. Useful for debugging and inspecting what a FastEdge app receives from clients and the platform.

> **Note:** This example uses the legacy `#[fastedge::http]` sync handler (`wasm32-wasip1`). For new apps, prefer `#[wstd::http_server]` (async, `wasm32-wasip2`) — see [`examples/http/wasi/`](../../wasi/).

## What it demonstrates

- Reading request method via `req.method().as_str()`
- Reading the request URI via `req.uri().to_string()`
- Iterating all request headers via `req.headers()`
- Handling non-UTF-8 header values gracefully with a `match` on `v.to_str()`
- Building a plain-text response with `Response::builder()` and `Body::from(...)`

## APIs used

| API | Purpose |
|-----|---------|
| `req.method().as_str()` | HTTP method as a string slice |
| `req.uri().to_string()` | Full request URI as a `String` |
| `req.headers()` | Iterator over `(HeaderName, HeaderValue)` pairs |
| `v.to_str()` | Decode a header value to `&str` (returns `Err` for non-UTF-8) |
| `Response::builder().status(...).body(...)` | Build the HTTP response |
| `Body::from(string)` | Create a response body from a `String` |

## Build

```sh
cargo build --release
# Output: target/wasm32-wasip1/release/print.wasm
```

## Expected behaviour

For any request, the response body is a plain-text dump of the request details:

```
Method: GET
URL: /some/path?query=value
Headers:
    host: example.com
    accept: */*
    ...
```

- Status: `200 OK`
- Content: plain text (no `content-type` header is set explicitly; the platform may add one)
- Each header appears on its own line, indented with four spaces
- Non-UTF-8 header values are replaced with `not a valid text`
```
