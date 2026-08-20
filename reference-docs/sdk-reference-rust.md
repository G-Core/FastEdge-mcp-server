<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 6347a7c2fda0d03e66f1214db5eec041c16801b7
      updated: 2026-08-17
-->

# Rust SDK Reference (`fastedge` crate + `fastedge-derive`)

---

## Quick Start

### Cargo.toml

Current crate version: `0.4.0`

For `#[wstd::http_server]` (recommended for new apps):

```toml
[dependencies]
wstd   = "0.6"
anyhow = "1"

[lib]
crate-type = ["cdylib"]
```

For `#[fastedge::http]` (basic/synchronous):

```toml
[dependencies]
fastedge = "0.4.0"
anyhow   = "1.0"

[lib]
crate-type = ["cdylib"]
```

### Build Target Configuration

For `#[wstd::http_server]`:

```toml
# .cargo/config.toml
[build]
target = "wasm32-wasip2"
```

```bash
rustup target add wasm32-wasip2
cargo build --target wasm32-wasip2 --release
```

For `#[fastedge::http]`:

```toml
# .cargo/config.toml
[build]
target = "wasm32-wasip1"
```

```bash
rustup target add wasm32-wasip1
cargo build --target wasm32-wasip1 --release
```

Output: `target/<target-triple>/release/<crate_name>.wasm`

### Minimal Handler (`#[wstd::http_server]`)

```rust
use wstd::http::body::Body;
use wstd::http::{Request, Response};

#[wstd::http_server]
async fn main(_request: Request<Body>) -> anyhow::Result<Response<Body>> {
    let response = Response::builder()
        .status(200)
        .body(Body::from("Hello, FastEdge!"))?;
    Ok(response)
}
```

### Minimal Handler (`#[fastedge::http]`)

```rust
use anyhow::Result;
use fastedge::body::Body;
use fastedge::http::{Request, Response, StatusCode};

#[fastedge::http]
fn main(_req: Request<Body>) -> Result<Response<Body>> {
    Response::builder()
        .status(StatusCode::OK)
        .body(Body::from("Hello, FastEdge!"))
        .map_err(Into::into)
}
```

---

## Handler Macros

### `#[wstd::http_server]` (Recommended)

Provided by the `wstd` crate. Registers an **async** function as the HTTP request handler using the standard WASI-HTTP interface. Preferred for all new FastEdge applications.

**Signature:**

```rust
async fn <name>(request: Request<Body>) -> anyhow::Result<Response<Body>>
```

- `Request<Body>` = `wstd::http::Request<wstd::http::body::Body>`
- `Response<Body>` = `wstd::http::Response<wstd::http::body::Body>`
- Must be declared `async`.
- Build target: `wasm32-wasip2`

**Example — echo handler:**

```rust
use wstd::http::body::Body;
use wstd::http::{Request, Response};

#[wstd::http_server]
async fn main(request: Request<Body>) -> anyhow::Result<Response<Body>> {
    let method = request.method().to_string();
    Ok(Response::builder()
        .status(200)
        .body(Body::from(format!("Method: {}", method)))?)
}
```

**Example — outbound HTTP:**

```rust
use wstd::http::body::Body;
use wstd::http::{Client, Request, Response};

#[wstd::http_server]
async fn main(_request: Request<Body>) -> anyhow::Result<Response<Body>> {
    let upstream = Request::get("https://api.example.com/data")
        .header("accept", "application/json")
        .body(Body::empty())?;

    let response = Client::new().send(upstream).await?;
    Ok(response)
}
```

---

### `#[fastedge::http]` (Basic)

Provided by the `fastedge` crate. Registers a **synchronous** function as the HTTP request handler using the FastEdge-specific WIT interface. Use for applications that require synchronous execution or the `fastedge::send_request` client. New projects should prefer `#[wstd::http_server]`.

**Signature:**

```rust
fn <name>(req: Request<Body>) -> Result<Response<Body>>
```

- `Request<Body>` = `fastedge::http::Request<fastedge::body::Body>`
- `Response<Body>` = `fastedge::http::Response<fastedge::body::Body>`
- Any `Result` whose error implements `Into<Box<dyn std::error::Error>>` (e.g., `anyhow::Result`) is accepted.
- Function name is not significant; `main` is conventional.
- If the function returns `Err(e)`, the macro converts it to an HTTP `500 Internal Server Error` with the error message as the body. No panic occurs.
- Build target: `wasm32-wasip1`

**Example — method dispatch:**

```rust
use anyhow::{anyhow, Result};
use fastedge::body::Body;
use fastedge::http::{Method, Request, Response, StatusCode};

#[fastedge::http]
fn main(req: Request<Body>) -> Result<Response<Body>> {
    match req.method() {
        &Method::GET => Response::builder()
            .status(StatusCode::OK)
            .body(Body::from("GET OK"))
            .map_err(Into::into),
        _ => Err(anyhow!("method not allowed")),
    }
}
```

---

### Comparison

| Aspect             | `#[wstd::http_server]`   | `#[fastedge::http]`      |
| ------------------ | ------------------------ | ------------------------ |
| Execution model    | Async (`async fn`)       | Synchronous              |
| HTTP client        | `wstd::http::Client`     | `fastedge::send_request` |
| Body type          | `wstd::http::body::Body` | `fastedge::body::Body`   |
| Build target       | `wasm32-wasip2`          | `wasm32-wasip1`          |
| Interface standard | WASI-HTTP (standard)     | FastEdge-specific WIT    |
| Recommendation     | New applications         | Legacy / sync required   |

---

## Body Type

`fastedge::body::Body` wraps `bytes::Bytes` and carries a MIME content-type set at construction time. Content-type cannot be changed after creation. Implements `Deref<Target = bytes::Bytes>`, so all `Bytes` methods (`.len()`, `.is_empty()`, slicing, iteration) are available directly.

### Constructors

| Constructor                                | Content-Type                | Notes                                                              |
| ------------------------------------------ | --------------------------- | ------------------------------------------------------------------ |
| `Body::from(value: String)`                | `text/plain; charset=utf-8` |                                                                    |
| `Body::from(value: &'static str)`          | `text/plain; charset=utf-8` |                                                                    |
| `Body::from(value: Vec<u8>)`               | `application/octet-stream`  |                                                                    |
| `Body::from(value: &'static [u8])`         | `application/octet-stream`  |                                                                    |
| `Body::empty()`                            | `text/plain; charset=utf-8` | Zero-length body                                                   |
| `Body::try_from(value: serde_json::Value)` | `application/json`          | Requires `json` feature; returns `Result<Body, serde_json::Error>` |

### Methods

| Method                          | Return Type | Description                                         |
| ------------------------------- | ----------- | --------------------------------------------------- |
| `content_type(&self) -> String` | `String`    | Returns the MIME type set when the body was created |
| `empty() -> Self`               | `Body`      | Constructs a zero-length body                       |

All `bytes::Bytes` methods are available via `Deref`:

```rust
use fastedge::body::Body;

let body = Body::from("hello");
assert_eq!(body.len(), 5);
assert!(!body.is_empty());
let slice: &[u8] = &body[..];
```

### Content-Type Detection

| Input type          | Resulting content-type      |
| ------------------- | --------------------------- |
| `String` / `&str`   | `text/plain; charset=utf-8` |
| `Vec<u8>` / `&[u8]` | `application/octet-stream`  |
| `serde_json::Value` | `application/json`          |
| `Body::empty()`     | `text/plain; charset=utf-8` |

### Content-Type Override

To send a response with a content-type that does not match automatic detection, set `Content-Type` explicitly on the response builder:

```rust
use fastedge::body::Body;
use fastedge::http::{Response, StatusCode};

let response = Response::builder()
    .status(StatusCode::OK)
    .header("content-type", "text/html; charset=utf-8")
    .body(Body::from("<h1>Hello</h1>"))
    .unwrap();
```

### JSON Body (requires `json` feature)

```rust
use fastedge::body::Body;
use serde_json::json;

let body = Body::try_from(json!({"status": "ok"}))?;
assert_eq!(body.content_type(), "application/json");
```

---

## Outbound HTTP

### `fastedge::send_request`

```rust
pub fn send_request(req: http::Request<Body>) -> Result<http::Response<Body>, Error>
```

Sends a synchronous outbound HTTP request and returns the response. Use with `#[fastedge::http]`. For async outbound requests with `#[wstd::http_server]`, use `wstd::http::Client` instead.

**Supported methods:** `GET`, `POST`, `PUT`, `DELETE`, `HEAD`, `PATCH`, `OPTIONS`. Any other method returns `Err(Error::UnsupportedMethod)`.

**Errors:**

- `Error::UnsupportedMethod` — the request method is not in the supported set.
- `Error::BindgenHttpError` — the host runtime rejected or failed the request.
- `Error::InvalidBody` — the response body could not be decoded.

**Example — GET request:**

```rust
use anyhow::Result;
use fastedge::body::Body;
use fastedge::http::{Method, Request, Response, StatusCode};

#[fastedge::http]
fn main(_req: Request<Body>) -> Result<Response<Body>> {
    let upstream = Request::builder()
        .method(Method::GET)
        .uri("https://api.example.com/data")
        .header("accept", "application/json")
        .body(Body::empty())?;

    let upstream_resp = fastedge::send_request(upstream)?;

    Response::builder()
        .status(StatusCode::OK)
        .body(upstream_resp.into_body())
        .map_err(Into::into)
}
```

**Example — POST request:**

```rust
use anyhow::Result;
use fastedge::body::Body;
use fastedge::http::{Method, Request, Response, StatusCode};

#[fastedge::http]
fn main(_req: Request<Body>) -> Result<Response<Body>> {
    let payload = Body::from(r#"{"event":"click"}"#);
    let upstream = Request::builder()
        .method(Method::POST)
        .uri("https://ingest.example.com/events")
        .header("content-type", "application/json")
        .body(payload)?;

    let _resp = fastedge::send_request(upstream)?;

    Response::builder()
        .status(StatusCode::ACCEPTED)
        .body(Body::empty())
        .map_err(Into::into)
}
```

---

## Error Enum

```rust
#[derive(thiserror::Error, Debug)]
pub enum Error {
    UnsupportedMethod(http::Method),
    BindgenHttpError(/* host HTTP error */),
    HttpError(http::Error),
    InvalidBody,
    InvalidStatusCode(u16),
}
```

| Variant                           | When it occurs                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| `UnsupportedMethod(http::Method)` | `send_request` called with a method other than GET, POST, PUT, DELETE, HEAD, PATCH, or OPTIONS      |
| `BindgenHttpError`                | The host runtime returned an error during request execution                                         |
| `HttpError(http::Error)`          | An error occurred constructing or parsing an HTTP message                                           |
| `InvalidBody`                     | The request or response body could not be encoded or decoded                                        |
| `InvalidStatusCode(u16)`          | A status code outside the range 100–599 was encountered                                             |

`Error` implements `std::error::Error` and `std::fmt::Display`. Compatible with `anyhow` and `?` propagation.

**Example — explicit error handling:**

```rust
use fastedge::{Error, send_request};
use fastedge::body::Body;
use fastedge::http::{Method, Request};

fn fetch(uri: &str) -> Result<String, Error> {
    let req = Request::builder()
        .method(Method::GET)
        .uri(uri)
        .body(Body::empty())
        .map_err(Error::HttpError)?;

    let resp = send_request(req)?;
    Ok(format!("status: {}", resp.status()))
}
```

---

## Feature Flags

| Flag        | Default  | Effect                                                                              |
| ----------- | -------- | ----------------------------------------------------------------------------------- |
| `proxywasm` | enabled  | Enables the `fastedge::proxywasm` module for ProxyWasm ABI compatibility            |
| `json`      | disabled | Enables `Body::try_from(serde_json::Value)` and adds `serde_json` as a dependency  |

Enable non-default features:

```toml
[dependencies]
fastedge = { version = "0.4.0", features = ["json"] }
```

Disable the default `proxywasm` feature:

```toml
[dependencies]
fastedge = { version = "0.4.0", default-features = false }
```

---

## Re-exports

`fastedge` re-exports the `http` crate as `fastedge::http`. All standard HTTP types are available through this path without adding `http` as a direct dependency.

```rust
use fastedge::http::{Method, Request, Response, StatusCode, HeaderMap, Uri};
```

**Supported HTTP methods** (complete set accepted by `send_request`):

| Constant          | Method    |
| ----------------- | --------- |
| `Method::GET`     | `GET`     |
| `Method::POST`    | `POST`    |
| `Method::PUT`     | `PUT`     |
| `Method::DELETE`  | `DELETE`  |
| `Method::HEAD`    | `HEAD`    |
| `Method::PATCH`   | `PATCH`   |
| `Method::OPTIONS` | `OPTIONS` |

---

## Logging

The FastEdge platform captures **stdout only**. Output written to `stderr` is silently discarded and will not appear in the platform's log viewer.

- Use `print!` / `println!` for all diagnostic output.
- Do not use `eprint!` / `eprintln!` — those produce no visible output on the platform.

```rust
use anyhow::Result;
use fastedge::body::Body;
use fastedge::http::{Request, Response, StatusCode};

#[fastedge::http]
fn main(req: Request<Body>) -> Result<Response<Body>> {
    println!("Received request: {} {}", req.method(), req.uri());

    Response::builder()
        .status(StatusCode::OK)
        .body(Body::empty())
        .map_err(Into::into)
}
```

---

## See Also

- host-services-rust — Key-value store, secrets, and dictionary APIs
- sdk-reference-js — JavaScript SDK reference
- platform-overview — FastEdge platform concepts and constraints
