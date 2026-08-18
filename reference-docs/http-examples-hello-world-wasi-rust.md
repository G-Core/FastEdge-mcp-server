<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 6347a7c2fda0d03e66f1214db5eec041c16801b7
      updated: 2026-08-17
-->

---
type: example
app_type: http
languages: [rust]
capabilities: [hello-world, wasi, async, uri-echo]
---

# Example: Hello World (WASI) — Rust

Simplest async FastEdge HTTP application using WASI. Echoes the full request URI in the response body. Demonstrates the `#[wstd::http_server]` entry-point macro and the async handler signature required by all WASI HTTP examples.

## Handler Signature

```rust
#[wstd::http_server]
async fn main(request: Request<Body>) -> anyhow::Result<Response<Body>>
```

- Entry-point macro: `#[wstd::http_server]`
- Handler is `async fn`
- Parameter: `request: Request<Body>` — `wstd::http::Request` wrapping `wstd::http::body::Body`
- Return type: `anyhow::Result<Response<Body>>` — `wstd::http::Response` wrapping `wstd::http::body::Body`

## Full Source

```rust
use wstd::http::body::Body;
use wstd::http::{Request, Response};

#[wstd::http_server]
async fn main(request: Request<Body>) -> anyhow::Result<Response<Body>> {
    let url = request.uri().to_string();

    Ok(Response::builder()
        .status(200)
        .header("content-type", "text/plain;charset=UTF-8")
        .body(Body::from(format!(
            "Hello, you made a wasi request to {url}"
        )))?)
}
```

## APIs Used

| API | Crate | Purpose |
|-----|-------|---------|
| `#[wstd::http_server]` | `wstd` | WASI HTTP entry-point macro |
| `wstd::http::Request` | `wstd` | Incoming HTTP request type |
| `wstd::http::Response` | `wstd` | Outgoing HTTP response type |
| `wstd::http::body::Body` | `wstd` | Request and response body type |
| `request.uri()` | `wstd` | Returns the full absolute request URI |
| `uri().to_string()` | std | Converts URI to owned `String` |
| `Response::builder()` | `wstd` | Builder for constructing HTTP responses |
| `.status(200)` | `wstd` | Sets HTTP status code |
| `.header(name, value)` | `wstd` | Sets a response header |
| `.body(Body::from(...))` | `wstd` | Sets the response body; returns `Result` |
| `Body::from(String)` | `wstd` | Constructs a body from a `String` or `&str` |

## Cargo.toml

```toml
[package]
name = "hello_world"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wstd = "0.6"
anyhow = "1"
```

- `crate-type = ["cdylib"]` is required for WASM output.
- `wstd = "0.6"` provides the WASI HTTP runtime and body types.
- `anyhow = "1"` provides the `anyhow::Result` / `anyhow::Error` error type used in the handler return.

## Build

```sh
cargo build --release
# Output: target/wasm32-wasip2/release/hello_world.wasm
```

Build target: `wasm32-wasip2`. This target is required for async WASI HTTP handlers. The synchronous `#[fastedge::http]` handler uses `wasm32-wasi` instead.

## Response Shape

```
HTTP/1.1 200 OK
content-type: text/plain;charset=UTF-8

Hello, you made a wasi request to http://<host>/<path>?<query>
```

## Behavioral Notes

- `request.uri().to_string()` returns the full absolute URI including scheme, host, path, and query string.
- The `?` operator on `.body(...)` propagates a builder error as `anyhow::Error`. Builder errors are rare but possible (e.g., invalid header values).
- `Body::from(string)` accepts `String` or `&str`; the `format!` macro produces an owned `String`.

## Constraints and Gotchas

- `Body` must be imported from `wstd::http::body`, not from any `fastedge::body` module. Using the wrong import causes a type mismatch.
- `uri().to_string()` allocates a heap `String`. Acceptable for response construction; avoid calling it in tight hot-path loops.
- The `async fn` signature is mandatory when using `#[wstd::http_server]`. A sync handler requires `#[fastedge::http]` and a different crate (`fastedge`), not `wstd`.
- `wasm32-wasip2` target must be installed: `rustup target add wasm32-wasip2`.

## Distinction from Non-WASI (Sync) Handler

| Aspect | WASI (`wstd`) | Non-WASI (`fastedge`) |
|--------|--------------|----------------------|
| Macro | `#[wstd::http_server]` | `#[fastedge::http]` |
| Handler | `async fn` | sync `fn` |
| Build target | `wasm32-wasip2` | `wasm32-wasi` |
| Body type | `wstd::http::body::Body` | `fastedge::body::Body` |
| Crate | `wstd` | `fastedge` |

## See Also

- fastedge-docs reference: platform-overview
- fastedge-docs reference: sdk-reference-rust
- fastedge-docs reference: best-practices
- fastedge-docs reference: error-codes
- Scaffold skill blueprints: http/base (Rust)

## Source Material

### FILE: examples/http/wasi/hello_world/src/lib.rs

```rust
use wstd::http::body::Body;
use wstd::http::{Request, Response};

#[wstd::http_server]
async fn main(request: Request<Body>) -> anyhow::Result<Response<Body>> {
    let url = request.uri().to_string();

    Ok(Response::builder()
        .status(200)
        .header("content-type", "text/plain;charset=UTF-8")
        .body(Body::from(format!(
            "Hello, you made a wasi request to {url}"
        )))?)
}
```

### FILE: examples/http/wasi/hello_world/Cargo.toml

```toml
[workspace]

[package]
name = "hello_world"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wstd = "0.6"
anyhow = "1"
```

### FILE: examples/http/wasi/hello_world/README.md

```
[← Back to examples](../../../README.md)

# Hello World (WASI)

The simplest possible async FastEdge application — echoes the full request URI in the response body.

Demonstrates the `#[wstd::http_server]` entry-point macro and the async handler signature used by all WASI HTTP examples.

## What it returns

```
HTTP/1.1 200 OK
content-type: text/plain;charset=UTF-8

Hello, you made a wasi request to http://<host>/<path>?<query>
```

## Build

```sh
cargo build --release
# Output: target/wasm32-wasip2/release/hello_world.wasm
```

## APIs used

- `#[wstd::http_server]` — WASI HTTP entry-point macro
- `wstd::http::{Request, Response}` — request/response types
- `wstd::http::body::Body` — response body construction
- `request.uri().to_string()` — full absolute request URI
```
