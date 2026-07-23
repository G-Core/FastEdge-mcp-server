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
capabilities: [hello-world, basic-handler, uri-echo]
---

# Hello World — Basic HTTP (Rust)

Simplest FastEdge HTTP application using the legacy sync handler macro `#[fastedge::http]`. Returns a plain-text greeting containing the full request URI.

> **Handler model**: sync (legacy). For new applications, prefer the async WASI handler. See the `examples-hello-world-wasi-rust` reference.

---

## Handler Signature

```rust
#[fastedge::http]
fn main(req: Request<Body>) -> Result<Response<Body>>
```

| Element | Type | Notes |
|---|---|---|
| Attribute macro | `#[fastedge::http]` | Marks the function as the sync HTTP entry point |
| Input | `fastedge::http::Request<fastedge::body::Body>` | Full HTTP request including URI, headers, body |
| Output | `anyhow::Result<fastedge::http::Response<fastedge::body::Body>>` | Returns `Ok(response)` or propagates error |

---

## APIs Used

### Macro

| Macro | Crate | Purpose |
|---|---|---|
| `#[fastedge::http]` | `fastedge` | Sync request-response handler entry point |

### Types

| Type | Import path | Purpose |
|---|---|---|
| `Request<Body>` | `fastedge::http::Request` | Incoming HTTP request |
| `Response<Body>` | `fastedge::http::Response` | Outgoing HTTP response |
| `StatusCode` | `fastedge::http::StatusCode` | HTTP status code constants; re-export of `http::StatusCode` |
| `Body` | `fastedge::body::Body` | Request/response body wrapper |

### Methods

| Method | Signature | Notes |
|---|---|---|
| `req.uri()` | `&Uri` | Returns the request URI |
| `Uri::to_string()` | `String` | Serializes full URI including path and query string |
| `Response::builder()` | `http::response::Builder` | Starts fluent response construction |
| `.status(StatusCode::OK)` | `Builder` | Sets HTTP 200 status |
| `.header(key, value)` | `Builder` | Adds a response header |
| `.body(Body)` | `Result<Response<Body>, http::Error>` | Finalizes the response; returns `Result` |
| `Body::from(String)` | `Body` | Constructs a body from a `String` or `&str` |
| `.map_err(Into::into)` | converts `http::Error` → `anyhow::Error` | Idiomatic error propagation; `http::Error` implements `Into<anyhow::Error>` |

---

## Complete Example

```rust
use anyhow::Result;
use fastedge::body::Body;
use fastedge::http::{Request, Response, StatusCode};

#[fastedge::http]
fn main(req: Request<Body>) -> Result<Response<Body>> {
    let url = req.uri().to_string();

    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "text/plain;charset=UTF-8")
        .body(Body::from(format!(
            "Hello, you made a basic request to {url}"
        )))
        .map_err(Into::into)
}
```

---

## Cargo.toml

```toml
[workspace]

[package]
name = "hello_world"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
fastedge = "0.4"
anyhow = "1"
```

**Required**:
- `crate-type = ["cdylib"]` — mandatory for WASM compilation
- `fastedge = "0.4"` — provides handler macro, HTTP types, and Body
- `anyhow = "1"` — provides `Result` and error conversion

---

## Build

```sh
cargo build --release
```

Output artifact: `target/wasm32-wasip1/release/hello_world.wasm`

**Target**: `wasm32-wasip1` (legacy sync handler target)

---

## Behavior

| Request | Response status | Response body |
|---|---|---|
| `GET /api/hello/world?name=FastEdge` | 200 | `Hello, you made a basic request to /api/hello/world?name=FastEdge` |
| `GET /` | 200 | `Hello, you made a basic request to /` |

Response always sets `content-type: text/plain;charset=UTF-8`.

---

## Patterns

### Read URI and include in response body

```rust
let url = req.uri().to_string();
Body::from(format!("Hello, you made a basic request to {url}"))
```

`req.uri()` returns the full URI including path and query string. `to_string()` serializes it.

### Propagate response builder error

```rust
.map_err(Into::into)
```

`Response::builder().body()` returns `Result<Response<Body>, http::Error>`. `.map_err(Into::into)` converts `http::Error` into `anyhow::Error`, satisfying the `Result<Response<Body>>` return type.

---

## Constraints

- Handler function name must be `main`.
- `crate-type` must be `["cdylib"]`; other crate types will not produce a valid WASM module.
- Sync handler (`#[fastedge::http]`) targets `wasm32-wasip1`. Async WASI handlers use a different macro and target.
- `fastedge::http::StatusCode` is a re-export of `http::StatusCode`; they are the same type.
- This handler model is **legacy**. Use it when targeting `wasm32-wasip1` with synchronous execution. For async or WASI-native patterns, see the WASI hello-world reference.

---

## See Also

- `examples-hello-world-wasi-rust` — async WASI handler equivalent
- `sdk-reference-rust` — full FastEdge Rust SDK API reference
- `platform-overview` — FastEdge execution model and handler lifecycle
