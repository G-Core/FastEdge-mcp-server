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
capabilities: [outbound-http, query-params, url-decode, request-proxy]
---

# Example: Backend (URL Proxy) — Rust

## Purpose

Accepts a `?url=` query parameter, makes a blocking outbound GET request to that URL via `fastedge::send_request`, and returns a plain-text summary of the upstream response (body byte length and Content-Type header).

**Handler style:** Legacy sync handler (`#[fastedge::http]`). For new apps prefer the async WASI handler.

---

## Source Location

`examples/http/basic/backend/src/lib.rs`

---

## Cargo.toml

```toml
[package]
name = "backend"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
fastedge = "0.4"
anyhow = "1"
querystring = "1.1"
urlencoding = "2.1"
```

---

## Handler Signature

```rust
#[fastedge::http]
fn main(req: Request<Body>) -> Result<Response<Body>>
```

- **Macro:** `#[fastedge::http]` — registers the function as the sync HTTP entry point.
- **Input:** `Request<Body>` — the inbound edge request.
- **Output:** `Result<Response<Body>>` — returns `Ok(response)` on success or `Err` on failure (triggers HTTP 500).

---

## Key APIs Used

| API | Crate | Purpose |
|---|---|---|
| `#[fastedge::http]` | `fastedge` | Sync request-response handler macro |
| `req.into_parts()` | `fastedge::http` | Destructures `Request<Body>` into `(Parts, Body)` |
| `parts.uri.query()` | `http` | Extracts the raw query string from the URI; returns `Option<&str>` |
| `querystring::querify(query)` | `querystring` | Parses a raw query string into `Vec<(&str, &str)>` key-value pairs |
| `urlencoding::decode(s)` | `urlencoding` | Percent-decodes a string; returns `Result<Cow<str>, _>` |
| `Request::builder().uri(url).method(Method::GET).body(body)` | `fastedge::http` | Builds an outbound GET request |
| `fastedge::send_request(request)` | `fastedge` | Blocking outbound HTTP request; returns `Result<Response<Body>, fastedge::Error>` |
| `response.body().len()` | `fastedge::body` | Returns byte length of the upstream response body (reads full body into memory) |
| `response.headers().get("Content-Type")` | `http` | Retrieves the Content-Type header from the upstream response |
| `Response::builder().status(...).body(...)` | `fastedge::http` | Builds the outbound response |

---

## Control Flow

```
inbound request
  └─ req.into_parts() → (parts, body)
       └─ parts.uri.query() → raw query string
            └─ [missing] → Err("missing uri query parameter") → HTTP 500
            └─ querify(query) → Vec<(&str, &str)>
                 └─ find key == "url" → url_encoded_value
                      └─ [missing] → Err("missing url parameter") → HTTP 500
                      └─ urlencoding::decode(url_encoded_value) → decoded_url
                           └─ Request::builder().uri(decoded_url).method(GET).body(body)
                                └─ fastedge::send_request(request) → upstream Response
                                     └─ HTTP 200: "len = <N>, content-type = <value>"
```

---

## Request / Response Behavior

| Inbound request | Response status | Response body |
|---|---|---|
| `GET /?url=https%3A%2F%2Fexample.com%2F` | 200 | `len = <N>, content-type = Some("<mime>")` |
| `GET /?q=hello` (no `url` key) | 500 | `missing url parameter` |
| `GET /` (no query string) | 500 | `missing uri query parameter` |

Response body format (200):
```
len = <body-length>, content-type = <Content-Type as Rust Option<HeaderValue> debug>
```

Example: `len = 1270, content-type = Some("application/json")`

---

## Error Conditions

| Condition | Error message | Result |
|---|---|---|
| No query string on URI | `"missing uri query parameter"` | `Err` → HTTP 500 |
| Query string present but no `url` key | `"missing url parameter"` | `Err` → HTTP 500 |
| `urlencoding::decode` fails | propagated decode error | `Err` → HTTP 500 |
| `Request::builder().body()` fails | propagated build error | `Err` → HTTP 500 |
| `fastedge::send_request` fails | `fastedge::Error` converted via `.map_err(Error::msg)` | `Err` → HTTP 500 |

---

## Gotchas and Constraints

- **Outbound method is always GET** regardless of the inbound request method. The inbound body is forwarded to the outbound request, but the method is hardcoded to `Method::GET`.
- **`response.body().len()` reads the full body into memory.** Large upstream responses will be fully buffered.
- **`fastedge::send_request` error type** is `fastedge::Error`, not `anyhow::Error`. Convert with `.map_err(Error::msg)`.
- **Query parameter extraction is positional:** uses `.find(|(k, _)| k == &"url")` on the `querify` output — takes the first `url` key if duplicates exist.
- **Percent-encoding:** the `?url=` value must be percent-encoded by the caller. `urlencoding::decode` handles the decoding.
- **`into_parts()` consumes the request.** After calling it, the original `Request<Body>` is no longer available — work with `parts` and `body` separately.

---

## Build

```sh
cargo build --release --target wasm32-wasip1
# Output: target/wasm32-wasip1/release/backend.wasm
```

---

## See Also

- fastedge-sdk-rust HTTP WASI hello_world example (async handler, preferred for new apps)
- platform-overview (FastEdge request lifecycle, outbound request capabilities)
- sdk-reference-rust (`fastedge::send_request`, `Body`, HTTP types)
- best-practices (body buffering considerations, error handling patterns)

## Source Material

### FILE: examples/http/basic/backend/src/lib.rs

```rust
use anyhow::{anyhow, Error, Result};
use fastedge::body::Body;
use fastedge::http::{Method, Request, Response, StatusCode};

#[allow(dead_code)]
#[fastedge::http]
fn main(req: Request<Body>) -> Result<Response<Body>> {
    let (parts, body) = req.into_parts();
    let query = parts
        .uri
        .query()
        .ok_or(anyhow!("missing uri query parameter"))?;
    let params = querystring::querify(query);
    let url = params
        .iter()
        .find(|(k, _)| k == &"url")
        .ok_or(anyhow!("missing url parameter"))?;
    let url = urlencoding::decode(url.1)?.to_string();
    println!("url = {:?}", url);
    let request = Request::builder().uri(url).method(Method::GET).body(body)?;

    let response = fastedge::send_request(request).map_err(Error::msg)?;

    Response::builder()
        .status(StatusCode::OK)
        .body(Body::from(format!(
            "len = {}, content-type = {:?}",
            response.body().len(),
            response.headers().get("Content-Type")
        )))
        .map_err(Error::msg)
}
```


### FILE: examples/http/basic/backend/Cargo.toml

```toml
[workspace]

[package]
name = "backend"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
fastedge = "0.4"
anyhow = "1"
querystring = "1.1"
urlencoding = "2.1"
```


### FILE: examples/http/basic/backend/README.md

```
[← Back to examples](../../../README.md)

# Backend (URL Proxy)

A FastEdge application that accepts a `?url=` query parameter, makes an outbound GET request to that URL via `fastedge::send_request`, and returns a summary of the upstream response (`len` and `content-type`) in the response body.

> **When to use this example:** When you want to see how to make outbound HTTP requests from a FastEdge edge function using the legacy sync handler (`#[fastedge::http]`). For new apps, prefer the async WASI handler — see [`examples/http/wasi/hello_world`](../../wasi/hello_world/README.md).

## What it does

1. Parses the `?url=` query parameter from the request URI (percent-decodes it via `urlencoding::decode`).
2. Builds an outbound `GET` request to that URL using `fastedge::send_request`.
3. Returns HTTP 200 with a plain-text body:
   ```
   len = <body-length>, content-type = <upstream-content-type>
   ```
4. Returns HTTP 500 with an error message if `?url=` is absent or the query string is missing.

## APIs used

| API | Purpose |
|---|---|
| `#[fastedge::http]` | Sync request-response handler macro |
| `fastedge::send_request(request)` | Blocking outbound HTTP request |
| `fastedge::http::{Request, Response, StatusCode, Method}` | HTTP types |
| `fastedge::body::Body` | Request and response bodies |
| `querystring::querify` | Parse query string into key-value pairs |
| `urlencoding::decode` | Percent-decode the `?url=` value |

## Build

```sh
cargo build --release
# Output: target/wasm32-wasip1/release/backend.wasm
```

## Expected behavior

| Request | Response status | Response body |
|---|---|---|
| `GET /?url=https%3A%2F%2Fhttpbin.org%2Fget` | 200 | `len = <N>, content-type = Some("<mime>")` |
| `GET /?q=hello` (no `url` key) | 500 | `missing url parameter` |
| `GET /` (no query string) | 500 | `missing uri query parameter` |

The `len` value is the byte length of the upstream response body. The `content-type` value is the `Content-Type` header returned by the upstream server, formatted as a Rust `Option<HeaderValue>` debug string (e.g. `Some("application/json")`).
```
