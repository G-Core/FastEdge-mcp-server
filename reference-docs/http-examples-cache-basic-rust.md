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
