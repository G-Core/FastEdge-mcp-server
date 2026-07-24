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
