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
capabilities: [outbound-fetch, header-read, async]
---

# Example: Simple Fetch (WASI HTTP, Rust)

Demonstrates outbound HTTP requests using the WASI-HTTP interface via the `wstd` crate. Reads a target URL from an incoming request header and proxies the response back to the caller.

## Crate and Handler

- **Crate**: `wstd = "0.6"`, `anyhow = "1"`
- **Build target**: `wasm32-wasip2` (WASI Component Model, p2)
- **Handler macro**: `#[wstd::http_server]`
- **Handler signature**: `async fn main(request: Request<Body>) -> anyhow::Result<Response<Body>>`
- **crate-type**: `["cdylib"]`
- **Cargo component package**: `component:simple_fetch`

## Request Headers

| Header | Required | Type | Default | Description |
|--------|----------|------|---------|-------------|
| `x-fetch-url` | No | String (fully-qualified URL) | `https://httpbin.org/get` | URL to fetch outbound |

## Behavior

1. Read `x-fetch-url` header from the incoming request; fall back to `https://httpbin.org/get` if absent or unparseable.
2. Build an outbound `GET` request to that URL with `accept: application/json` header.
3. Send via `Client::new().send(req).await`.
4. Return the upstream `Response<Body>` directly to the caller — no decomposition.

## Key API Patterns

### Reading a Header from the Incoming Request

```rust
let target_url = request
    .headers()
    .get("x-fetch-url")
    .and_then(|v| v.to_str().ok())
    .unwrap_or("https://httpbin.org/get")
    .to_string();
```

- `.get(name)` returns `Option<&HeaderValue>`
- `.to_str().ok()` converts to `Option<&str>`, silently discarding non-UTF-8 values
- `.unwrap_or(default)` provides a safe fallback
- `.to_string()` required — `Request::get` takes a `&str` or `String`; ensure the URL is owned before use

### Building an Outbound Request

```rust
use wstd::http::{Client, Request};
use wstd::http::body::Body;

let upstream_req = Request::get(&target_url)
    .header("accept", "application/json")
    .body(Body::empty())
    .map_err(|e| anyhow!("failed to build request: {e}"))?;
```

- `Request::get(url)` — starts a builder for a GET request; `url` must be a `&str` pointing to a fully-qualified URL
- `.header(key, value)` — adds a request header; chainable
- `.body(Body::empty())` — finalizes builder; returns `Result<Request<Body>, _>`
- `.map_err(|e| anyhow!("..."))` — maps builder error into `anyhow::Error`

### Sending the Request

```rust
let client = Client::new();
let response = client
    .send(upstream_req)
    .await
    .map_err(|e| anyhow!("request failed: {e}"))?;
```

- `Client::new()` — creates a new HTTP client instance; no configuration
- `.send(req)` — async; returns `Result<Response<Body>, _>`
- `response` is a `Response<Body>` that can be returned directly without decomposition

### Returning the Response

```rust
Ok(response)
```

The upstream `Response<Body>` is returned as-is. No need to extract status, headers, or body separately when proxying.

## Logging

```rust
println!("Fetching: {target_url}");
println!("Response status: {}", response.status());
```

- Use `println!` for logging — not `eprintln!`
- `response.status()` returns the HTTP status code of the upstream response

## Cargo.toml Requirements

```toml
[lib]
crate-type = ["cdylib"]

[dependencies]
wstd = "0.6"
anyhow = "1"

[package.metadata.component]
package = "component:simple_fetch"
```

- `cargo-component` is required to build (`cargo component build --release`)
- Output: `target/wasm32-wasip2/release/simple_fetch.wasm`

## WASI vs Basic HTTP Comparison

| Aspect | Basic HTTP (`fastedge` crate) | WASI HTTP (`wstd` crate) |
|--------|-------------------------------|--------------------------|
| Handler | `fn main(req)` — sync | `async fn main(req)` — async |
| Macro | `#[fastedge::http]` | `#[wstd::http_server]` |
| Outbound HTTP | `fastedge::send_request(req)` | `Client::new().send(req).await` |
| Build target | `wasm32-wasip1` | `wasm32-wasip2` |

## Gotchas

- The URL extracted from the header must be converted to an owned `String` with `.to_string()` before passing to `Request::get`.
- The header parsing chain (`.get` → `.to_str()` → `.ok()`) returns `Option` — always provide a fallback via `.unwrap_or`.
- Non-UTF-8 header values are silently discarded by `.to_str().ok()`.
- `anyhow` must be declared as a dependency to use the `anyhow!()` macro.
- All examples in `examples/http/wasi/` use the same `async fn main` + `#[wstd::http_server]` pattern.

## See Also

- fastedge-docs platform-overview
- sdk-reference-rust
- examples-simple-request-rust (basic sync HTTP handler, `fastedge` crate)
- host-services-rust (outbound fetch via host services)
