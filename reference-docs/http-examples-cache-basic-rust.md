<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 6eedcca9d5c0ddd4ff79ca475965393891da2d75
      updated: 2026-09-22
-->

---
type: example
app_type: http
languages: [rust]
capabilities: [cache]
---

# Cache Basic (Rust)

Demonstrates the cache-aside pattern using `fastedge::cache`. On each request the app checks the cache for a stored response body; on a hit it returns the cached bytes immediately; on a miss it generates the body, stores it with a TTL, then returns it.

## Crate

```
cache_basic  (cdylib)
fastedge = "0.4"
anyhow = "1"
```

## Entry Point

```rust
#[fastedge::http]
fn main(req: Request<Body>) -> anyhow::Result<Response<Body>>
```

## Environment Variables

| Variable | Required | Type | Default | Description |
|---|---|---|---|---|
| `CACHE_TTL_MS` | No | `u64` | `30000` | TTL for cached response bodies in milliseconds. |

Parsing pattern:
```rust
let ttl_ms: u64 = env::var("CACHE_TTL_MS")
    .ok()
    .and_then(|v| v.parse().ok())
    .unwrap_or(30_000);
```

## Cache API

### `fastedge::cache::get`

```rust
pub fn get(key: &str) -> anyhow::Result<Option<Vec<u8>>>
```

- Returns `Ok(Some(Vec<u8>))` on a cache hit — raw bytes of the stored value.
- Returns `Ok(None)` on a cache miss.
- Returns `Err(_)` on a cache subsystem error.

### `fastedge::cache::set`

```rust
pub fn set(key: &str, value: &[u8], ttl_ms: Option<u64>) -> anyhow::Result<()>
```

- `key` — string key identifying the cache entry.
- `value` — raw bytes to store.
- `ttl_ms` — `Some(ms)` sets expiry in milliseconds; `None` stores with no expiry.

## Cache Key Format

```
"page:{request_path}"
```

Each unique request path produces a distinct cache entry. Example: a request to `/api/data` uses key `page:/api/data`.

## Request/Response Flow

```
GET /any/path
  └─ cache::get("page:/any/path")
       ├─ Some(bytes)  →  200 OK  x-cache: hit   (returns cached bytes as body)
       └─ None
            └─ generate_body(&path)
                 └─ cache::set("page:/any/path", body.as_bytes(), Some(ttl_ms))
                      └─ 200 OK  x-cache: miss  (returns generated body)
```

## Response Headers

| Header | Value | Condition |
|---|---|---|
| `content-type` | `text/html` | Always |
| `x-cache` | `hit` | Cache hit |
| `x-cache` | `miss` | Cache miss |

HTTP status is `200 OK` in both cases.

## Generated Body

On a cache miss, `generate_body(path)` produces a minimal HTML page embedding the request path. This stands in for any expensive computation or template render. The returned `String` is stored via `cache::set` as `body.as_bytes()` and also returned as `Body::from(body)`.

## Key Constraints and Gotchas

- `cache::get` returns `Option<Vec<u8>>` — the value is raw bytes. Use `Body::from(cached)` to convert `Vec<u8>` directly into a response body.
- TTL is in **milliseconds**, not seconds. `30000` = 30 seconds.
- `cache::set` third argument is `Option<u64>`. Pass `Some(ttl_ms)` for expiry; `None` for no expiry.
- The cache key is constructed **after** reading the request URI path; the path string is cloned before the request is consumed.
- `println!` calls (`cache hit: {cache_key}` / `cache miss: {cache_key}`) emit to the FastEdge log stream for observability.

## Build

```sh
cargo build --release
# Output: target/wasm32-wasip1/release/cache_basic.wasm
```

## Imports Used

```rust
use std::env;
use fastedge::body::Body;
use fastedge::cache;
use fastedge::http::{Request, Response, StatusCode};
```

## See Also

- fastedge-sdk-rust cache module documentation
- examples-cache-basic-rust (this file) pairs with the HTTP app deploy reference for upload and wiring steps
- platform-overview for cache subsystem lifecycle and eviction behavior
- best-practices for cache key namespacing and TTL selection guidance

## Source Material

### FILE: examples/http/basic/cache/src/lib.rs

```rust
/*
 * Copyright 2025 G-Core Innovations SARL
 */
/*
Example app demonstrating cache-aside pattern via the cache interface.

On each request the app:
  1. Builds a cache key from the request path.
  2. Returns the cached body immediately on a hit (x-cache: hit).
  3. On a miss, generates a response body, stores it in the cache, and
     returns it (x-cache: miss).

Environment variables:
  CACHE_TTL_MS  How long to cache the generated body in milliseconds
                (default: 30000)

Build:
  cargo build --release
*/

use std::env;

use fastedge::body::Body;
use fastedge::cache;
use fastedge::http::{Request, Response, StatusCode};

#[fastedge::http]
fn main(req: Request<Body>) -> anyhow::Result<Response<Body>> {
    let ttl_ms: u64 = env::var("CACHE_TTL_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(30_000);

    let path = req.uri().path().to_string();
    let cache_key = format!("page:{path}");

    // Cache hit — return stored body
    if let Some(cached) = cache::get(&cache_key)? {
        println!("cache hit: {cache_key}");
        return Ok(Response::builder()
            .status(StatusCode::OK)
            .header("content-type", "text/html")
            .header("x-cache", "hit")
            .body(Body::from(cached))?);
    }

    // Cache miss — generate the response body
    println!("cache miss: {cache_key}");
    let body = generate_body(&path);

    // Store in cache with TTL
    cache::set(&cache_key, body.as_bytes(), Some(ttl_ms))?;

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "text/html")
        .header("x-cache", "miss")
        .body(Body::from(body))?)
}

/// Simulates an expensive computation or template render.
fn generate_body(path: &str) -> String {
    format!(
        "<!DOCTYPE html>\
        <html><head><title>FastEdge Cache Demo</title></head>\
        <body>\
          <h1>Hello from FastEdge</h1>\
          <p>Path: <code>{path}</code></p>\
          <p>This response was generated and is now cached.</p>\
        </body></html>"
    )
}
```


### FILE: examples/http/basic/cache/Cargo.toml

```toml
[workspace]

[package]
name = "cache_basic"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
fastedge = "0.4"
anyhow = "1"
```


### FILE: examples/http/basic/cache/README.md

```
[← Back to examples](../../../README.md)

# Cache (Basic)

Demonstrates the cache-aside pattern using `fastedge::cache` — store a generated response body with a TTL and serve it directly on subsequent requests without re-computing it.

## Configuration

| Env var | Required | Description |
|---|---|---|
| `CACHE_TTL_MS` | No | How long to cache each response in milliseconds. Default: `30000` (30 s). |

## How it works

```
GET /api/data  →  cache miss  →  generate body  →  store in cache  →  200 (x-cache: miss)
GET /api/data  →  cache hit   →  return cached body                →  200 (x-cache: hit)
```

The cache key is `page:<request-path>`. Each unique path gets its own cache entry. The response body is a simple HTML page that includes the request path — stand in for any expensive computation or template render.

## What it returns

```
HTTP/1.1 200 OK
content-type: text/html
x-cache: hit | miss

<!DOCTYPE html><html>...</html>
```

## Build

```sh
cargo build --release
# Output: target/wasm32-wasip1/release/cache_basic.wasm
```

## APIs used

- `fastedge::cache::get(key)` — retrieve cached bytes by key; returns `Ok(Option<Vec<u8>>)`
- `fastedge::cache::set(key, bytes, ttl_ms)` — store bytes with optional TTL in milliseconds; `None` means no expiry
```
