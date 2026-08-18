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
languages:
  - rust
capabilities:
  - cache
  - outbound-http
  - environment-variables
---

# Cache (WASI) — Rust HTTP Example

Cache-aside pattern with origin forwarding using `fastedge::cache`. Forwards incoming requests to an upstream origin, caches successful response bodies keyed by path and query string, and serves cached bytes directly on subsequent matching requests.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ORIGIN_HOST` | Yes | — | Base URL of the upstream origin (e.g. `https://api.example.com`). Handler errors immediately if unset. |
| `CACHE_TTL_MS` | No | `60000` | How long to cache responses in milliseconds. Falls back to `60000` (60 s) if absent or unparseable. |

`CACHE_TTL_MS` can also be overridden per-request via the `cache-ttl-ms` request header; the header takes precedence over the environment variable.

## Request Routing

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/purge` | Purge all cached keys; returns `204` with deleted count logged |
| `GET` | `/purge/<path_and_query>` | Purge keys whose cache key starts with `cache:/<path_and_query>`; returns `204` |
| `GET` | `/delete/<path_and_query>` | Delete a single cache key `cache:/<path_and_query>`; returns `204` |
| `GET` | `<any other path>` | Cache-aside lookup → origin forward → cache write on 2xx |

Purge and delete routes are handled before any cache lookup or origin call.

## Cache Key Format

```
cache:<path_and_query>
```

Example: request to `/data?id=1` uses key `cache:/data?id=1`.

## Request Flow

```
GET /data?id=1
  → cache::get("cache:/data?id=1")
      ├─ hit  → 200, body from cache, x-cache: hit, content-type: application/octet-stream
      └─ miss → forward to ORIGIN_HOST/data?id=1
                  → if 2xx: cache::set("cache:/data?id=1", body_bytes, Some(ttl_ms))
                  → 200, body from origin, x-cache: miss, original headers replayed
```

Only `2xx` responses from the origin are cached. Error responses pass through without being stored.

On cache hit, `content-type` is always `application/octet-stream` because the original content-type is not stored alongside the body bytes. On cache miss, all original response headers from the upstream are replayed.

## APIs Used

### `fastedge::cache::get`

```rust
pub fn get(key: &str) -> Result<Option<Vec<u8>>>
```

Retrieve cached bytes by key. Returns `Ok(None)` on cache miss, `Ok(Some(bytes))` on hit. Synchronous — no `.await` required.

**Parameters:**
- `key: &str` — cache key string

**Returns:** `Result<Option<Vec<u8>>>`

---

### `fastedge::cache::set`

```rust
pub fn set(key: &str, value: &[u8], ttl_ms: Option<u64>) -> Result<()>
```

Store bytes under the given key with an optional TTL. Synchronous — no `.await` required.

**Parameters:**
- `key: &str` — cache key string
- `value: &[u8]` — raw bytes to store
- `ttl_ms: Option<u64>` — TTL in milliseconds; `None` means no expiry

**Returns:** `Result<()>`

---

### `fastedge::cache::purge`

```rust
pub fn purge() -> Result<u64>
```

Purge all cached keys. Returns the number of deleted keys.

**Returns:** `Result<u64>`

---

### `fastedge::cache::purge_prefix`

```rust
pub fn purge_prefix(prefix: &str) -> Result<u64>
```

Purge all cached keys whose key starts with `prefix`. Returns the number of deleted keys.

**Parameters:**
- `prefix: &str` — key prefix to match (e.g. `"cache:/data"`)

**Returns:** `Result<u64>`

---

### `fastedge::cache::delete`

```rust
pub fn delete(key: &str) -> Result<()>
```

Delete a single cache entry by exact key.

**Parameters:**
- `key: &str` — exact cache key to delete

**Returns:** `Result<()>`

---

### `wstd::http::Client`

```rust
Client::new().send(req).await
```

Async outbound HTTP client used for origin forwarding. Requires `.await`. Used only on cache miss.

## Gotchas and Constraints

- `ORIGIN_HOST` must be set. The handler maps its absence to an immediate `Err`, resulting in a `500` response. There is no fallback.
- `CACHE_TTL_MS` fallback chain: request header `cache-ttl-ms` → env var `CACHE_TTL_MS` → hardcoded `60_000`. Both the header and env var are parsed with `.parse::<u64>()`; parse failures fall through to the next level.
- `fastedge::cache` functions are **synchronous**. Do not use `.await` on them, even though the surrounding handler is `async`.
- Body bytes must be fully read into a `Vec<u8>` via `body.contents().await?.to_vec()` before passing to `cache::set`. The async body must be awaited before the synchronous cache write.
- Cache-hit responses always use `content-type: application/octet-stream`. The original content-type from the upstream response is not stored in the cache alongside body bytes.
- The `?` operator is used throughout for error propagation. Cache API errors (`cache::get`, `cache::set`, `cache::purge`, `cache::purge_prefix`, `cache::delete`) propagate directly to the handler return, resulting in a `500` response.

## Cargo.toml

```toml
[package]
name = "cache_wasi"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wstd = "0.6"
fastedge = "0.4"
anyhow = "1"
```

## Build

```sh
cargo build --release
# Output: target/wasm32-wasip2/release/cache_wasi.wasm
```

## See Also

- fastedge::cache API reference (host-services-rust)
- HTTP outbound requests via wstd (sdk-reference-rust)
- Environment variable configuration (platform-overview)
- HTTP app deploy workflow (deploy skill)

## Source Material

### FILE: examples/http/wasi/cache/src/lib.rs

```rust
/*
 * Copyright 2025 G-Core Innovations SARL
 */
/*
Example app demonstrating response caching and cache purging via the cache interface.

The app reads ORIGIN_HOST from the environment, forwards the incoming request
to that origin, and caches the response body keyed by the request path.
On subsequent requests for the same path the cached body is returned directly
without hitting the origin.

Cache reads and writes use the synchronous `fastedge::cache` API; upstream
HTTP I/O still uses the async `wstd` client.

Special purge routes (handled before any origin call):
  GET /purge                  — purge all cached keys; returns 200 with deleted count
  GET /purge/<path_and_query> — purge keys whose cache key starts with cache:/<path_and_query>

Environment variables:
  ORIGIN_HOST   Base URL of the upstream origin, e.g. https://api.example.com
  CACHE_TTL_MS  How long to cache responses in milliseconds (default: 60000)

Build:
  cargo build --release
*/

use std::env;

use anyhow::anyhow;
use fastedge::cache;
use wstd::http::body::Body;
use wstd::http::{Client, Request, Response};

#[wstd::http_server]
async fn main(req: Request<Body>) -> anyhow::Result<Response<Body>> {
    let origin = env::var("ORIGIN_HOST")
        .map_err(|_| anyhow!("ORIGIN_HOST environment variable is not set"))?;

    let ttl_ms = req.headers().get("cache-ttl-ms").and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .unwrap_or_else(|| {
            env::var("CACHE_TTL_MS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(60_000)
        });

    // Build cache key from the request path (and query string if present)
    let path_and_query = req
        .uri()
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/");


    // Handle purge requests before any cache/origin logic
    if path_and_query == "/purge" {
        let deleted = cache::purge()?;
        println!("purge all: {deleted} keys removed");
        return Ok(Response::builder()
            .status(204)
            .body(Body::empty())?);
    }
    if let Some(prefix) = path_and_query.strip_prefix("/purge/") {
        let prefix = format!("cache:/{prefix}");
        let deleted = cache::purge_prefix(&prefix)?;
        println!("purge prefix '{prefix}': {deleted} keys removed");
        return Ok(Response::builder()
            .status(204)
            .body(Body::empty())?);
    }

    if let Some(prefix) = path_and_query.strip_prefix("/delete/") {
        let prefix = format!("cache:/{prefix}");
        cache::delete(&prefix)?;
        println!("prefix '{prefix}': removed");
        return Ok(Response::builder()
            .status(204)
            .body(Body::empty())?);
    }

    let cache_key = format!("cache:{path_and_query}");

    // Return cached response if available
    if let Some(cached) = cache::get(&cache_key)? {
        println!("cache hit: {cache_key}");
        return Ok(Response::builder()
            .status(200)
            .header("content-type", "application/octet-stream")
            .header("x-cache", "hit")
            .body(Body::from(cached))?);
    }

    // Cache miss — forward request to origin
    let upstream_url = format!("{}{}", origin.trim_end_matches('/'), path_and_query);
    println!("cache miss: {cache_key} → {upstream_url}");

    let upstream_req = Request::get(&upstream_url)
        .body(Body::empty())
        .map_err(|e| anyhow!("failed to build upstream request: {e}"))?;

    let upstream_resp = Client::new()
        .send(upstream_req)
        .await
        .map_err(|e| anyhow!("upstream request failed: {e}"))?;

    let status = upstream_resp.status();
    let headers: Vec<(String, String)> = upstream_resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    // Read body bytes
    let mut body = upstream_resp.into_body();
    let body_bytes = body.contents().await?.to_vec();

    // Only cache successful responses
    if status.is_success() {
        cache::set(&cache_key, &body_bytes, Some(ttl_ms))?;
    }

    // Replay original response
    let mut builder = Response::builder()
        .status(status)
        .header("x-cache", "miss");
    for (k, v) in &headers {
        builder = builder.header(k, v);
    }
    Ok(builder.body(Body::from(body_bytes))?)
}
```


### FILE: examples/http/wasi/cache/Cargo.toml

```toml
[workspace]

[package]
name = "cache_wasi"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wstd = "0.6"
fastedge = "0.4"
anyhow = "1"
```


### FILE: examples/http/wasi/cache/README.md

```
[← Back to examples](../../../README.md)

# Cache (WASI)

Demonstrates the cache-aside pattern with origin forwarding using `fastedge::cache`. Forwards incoming requests to `ORIGIN_HOST`, caches successful response bodies keyed by path and query string, and serves cached bytes directly on subsequent matching requests.

## Configuration

| Env var | Required | Description |
|---|---|---|
| `ORIGIN_HOST` | Yes | Base URL of the upstream origin (e.g. `https://api.example.com`). Returns 500 if unset. |
| `CACHE_TTL_MS` | No | How long to cache responses in milliseconds. Default: `60000` (60 s). |

## How it works

GET /data?id=1  →  cache miss  →  forward to ORIGIN_HOST/data?id=1  →  cache 2xx body  →  200 (x-cache: miss)
GET /data?id=1  →  cache hit   →  return cached body                                   →  200 (x-cache: hit)

Cache key is `cache:<path>?<query>`. Only 2xx responses from the origin are cached — error responses pass through without being stored. The origin's response headers are replayed on cache miss; cache-hit responses use `content-type: application/octet-stream` since the original content-type is not stored alongside the body bytes.

## Build

cargo build --release
# Output: target/wasm32-wasip2/release/cache_wasi.wasm

## APIs used

- `fastedge::cache::get(key)` — retrieve cached bytes by key; returns `Ok(Option<Vec<u8>>)`
- `fastedge::cache::set(key, bytes, ttl_ms)` — store bytes with optional TTL in milliseconds; `None` means no expiry
- `wstd::http::Client::new().send(req).await` — async outbound HTTP request to origin
```
