<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: v0.4.5
      commit: e7f446a4b40b791b932ab36b2c7a0c85fd24104d
      updated: 2026-10-19
-->

# CDN Cache — Rust Example

## Overview

CDN app demonstrating cache operations via the proxy-wasm ABI. All operations are scoped to the calling application and addressed by key alone — there are no named stores or handles (unlike the KV store). Values are local to the PoP where the write occurs; writes in one PoP are not visible in another.

Operations are dispatched via query parameters on the incoming request. Responses are always JSON. Errors return HTTP 500 with `{"error": "<message>"}`.

**Important**: This cache is unrelated to CDN HTTP caching. To control edge caching of HTTP responses, use `Cache-Control` headers (see the CDN cache-control example).

## App Type

- **Interface**: proxy-wasm (`fastedge::proxywasm::cache`)
- **App type**: CDN
- **Language**: Rust

## Request Interface

All operations are specified via query parameters. The `action` parameter selects the operation; `action=get` is the default when omitted.

| Query string | Operation |
|---|---|
| `?action=get&key=<key>` | Read a cached value. `response` is `null` when the key is absent. |
| `?action=set&key=<key>&value=<value>[&ttl=<ms>]` | Store a value. Omitting `ttl` uses the host's default TTL. |
| `?action=delete&key=<key>` | Delete a key. No-op when the key is absent. |
| `?action=exists&key=<key>` | Test key membership. |
| `?action=incr&key=<key>&delta=<i64>` | Atomic increment. `delta` may be negative. A missing key starts at `0`. |
| `?action=expire&key=<key>&ttl=<ms>` | Set or update a key's TTL. `response` is `false` when the key is absent. |
| `?action=purge` | Delete every key owned by this app. Returns count of deleted keys. |
| `?action=purgePrefix&prefix=<prefix>` | Delete app-owned keys starting with `prefix`. Returns count deleted. |

## API Reference

All functions are in `fastedge::proxywasm::cache`. Keys are app-scoped automatically — no prefix is needed to avoid collisions with other apps.

### `cache::get`

```rust
pub fn get(key: &str) -> Result<Option<Vec<u8>>, Error>
```

Retrieve cached bytes by key.

- **Parameters**: `key` — cache key string
- **Returns**: `Ok(Some(Vec<u8>))` if the key exists, `Ok(None)` if absent, `Err` on failure
- **Note**: Values are `Vec<u8>` and must be decoded. Use `String::from_utf8_lossy(&value)` for string values. A missing key returning `Ok(None)` is not an error.

**JSON response shape:**
```json
{ "action": "get", "key": "<key>", "response": "<value>" }
{ "action": "get", "key": "<key>", "response": null }
```

**Example:**
```rust
match cache::get(key) {
    Ok(Some(value)) => {
        let value_str = String::from_utf8_lossy(&value);
        // use value_str
    }
    Ok(None) => { /* key absent */ }
    Err(e) => { /* handle error */ }
}
```

---

### `cache::set`

```rust
pub fn set(key: &str, value: &[u8], ttl_ms: Option<u64>) -> Result<(), Error>
```

Store bytes under a key with an optional TTL. Overwrites an existing value.

- **Parameters**:
  - `key` — cache key string
  - `value` — byte slice to store
  - `ttl_ms` — TTL in milliseconds; `None` applies the host's default TTL (not "no expiry"); `Some(0)` behaves the same as `None` and also applies the host default
- **Returns**: `Ok(())` on success, `Err` on failure
- **Constraint**: `ttl_ms` must be a positive integer when provided as `Some`; invalid values produce an error response
- **TTL ceiling**: The host silently clamps every `set` TTL to a deployment ceiling (4 days by default). No entry outlives approximately 4 days regardless of the TTL supplied. There is no way to read a key's current TTL.

**JSON response shape:**
```json
{ "action": "set", "key": "<key>", "value": "<value>", "ttlMs": <ms>|null, "response": true }
```

**Example:**
```rust
use serde_json::json;

// ttlMs serialises as null when None
Ok(json!({
    "action": "set",
    "key": key,
    "value": value,
    "ttlMs": ttl_ms,
    "response": true
}).to_string())
```

---

### `cache::delete`

```rust
pub fn delete(key: &str) -> Result<(), Error>
```

Remove a key from the cache. No-op if the key does not exist.

- **Parameters**: `key` — cache key string
- **Returns**: `Ok(())` on success, `Err` on failure

**JSON response shape:**
```json
{ "action": "delete", "key": "<key>", "response": true }
```

---

### `cache::exists`

```rust
pub fn exists(key: &str) -> Result<bool, Error>
```

Test whether a key is present in the cache.

- **Parameters**: `key` — cache key string
- **Returns**: `Ok(true)` if present, `Ok(false)` if absent, `Err` on failure

**JSON response shape:**
```json
{ "action": "exists", "key": "<key>", "response": true|false }
```

---

### `cache::incr`

```rust
pub fn incr(key: &str, delta: i64) -> Result<i64, Error>
```

Atomically increment (or decrement) a cached counter. If the key does not exist, it is treated as `0` before applying the delta.

- **Parameters**:
  - `key` — cache key string
  - `delta` — signed 64-bit integer; may be negative for decrements
- **Returns**: `Ok(new_value)` — the value after increment, `Err` on failure
- **Constraint**: Errors if the stored value is not a valid integer.

**JSON response shape:**
```json
{ "action": "incr", "key": "<key>", "delta": <i64>, "response": <new_value> }
```

**Gotchas**:
- `incr` sets no TTL and does not index the key under the app's key set. `incr` keys escape both the default TTL and `purge`/`purge_prefix`. Every `incr` key must have an `expire` called on it separately to bound its lifetime.
- When to call `expire` depends on the key shape (fixed key vs. time-bucketed key). Refer to the FastEdge storage platform reference for the correct pattern. Do not call `expire` after every `incr` on a fixed key — that keeps pushing the deadline forward, so the window never resets under steady traffic.
- Counter values are per-PoP. A rate limit enforced with `incr` applies per PoP, not globally.

---

### `cache::expire`

```rust
pub fn expire(key: &str, ttl_ms: u64) -> Result<bool, Error>
```

Set or update the TTL on an existing key.

- **Parameters**:
  - `key` — cache key string
  - `ttl_ms` — TTL in milliseconds; must be a positive integer
- **Returns**: `Ok(true)` if the key existed and was updated, `Ok(false)` if the key was absent, `Err` on failure
- **Note**: `Ok(false)` (key absent) and `Err` (failure) are distinct conditions; do not treat them the same.

**JSON response shape:**
```json
{ "action": "expire", "key": "<key>", "ttlMs": <ms>, "response": true|false }
```

---

### `cache::purge`

```rust
pub fn purge() -> Result<u64, Error>
```

Delete all keys owned by the calling application.

- **Parameters**: none
- **Returns**: `Ok(count)` — number of keys deleted, `Err` on failure
- **Note**: `incr` keys are not indexed and are not included in the purge count.

**JSON response shape:**
```json
{ "action": "purge", "response": <count> }
```

---

### `cache::purge_prefix`

```rust
pub fn purge_prefix(prefix: &str) -> Result<u64, Error>
```

Delete all app-owned keys whose names start with the given prefix. Use this to invalidate a group of related keys.

- **Parameters**: `prefix` — key prefix string
- **Returns**: `Ok(count)` — number of keys deleted, `Err` on failure
- **Note**: `incr` keys are not indexed and are not included in the purge count.

**JSON response shape:**
```json
{ "action": "purgePrefix", "prefix": "<prefix>", "response": <count> }
```

---

## Error Handling

- All cache operations return a typed `Error` with variants: `AccessDenied`, `InternalError`, `Other(String)`.
- The demo app serialises errors as HTTP 500 with body `{"error": "<message>"}`.
- Missing required query parameters produce descriptive error messages, e.g. `"Missing required param 'key' for 'get' action"`.
- Invalid parameter values (e.g. non-integer `ttl`, non-integer `delta`) produce descriptive parse error messages.
- Unknown `action` values produce an error listing all supported actions.
- `response.status` is set in `on_http_response_body`, after the response headers have already been sent. It is advisory only; the JSON error body is the real error signal.

## Lifecycle and Response Pattern

The app uses the proxy-wasm `RootContext` + `HttpContext` pattern:

1. `on_http_response_headers` — strips `content-length`, sets `content-type: application/json`, sets `transfer-encoding: chunked`.
2. `on_http_response_body` — pauses until `end_of_stream`, then reads `request.query` via `get_property(["request.query"])`, dispatches on `action`, and replaces the response body with `self.set_http_response_body(0, body_size, bytes)`.

Query string is parsed with `querystring::querify` into a `HashMap<&str, &str>`.

**JSON formatting**: Use `serde_json::json!` macro. `Option<u64>` serialises as `null` when `None`.

```rust
Ok(json!({
    "action": "set",
    "key": key,
    "value": value,
    "ttlMs": ttl_ms,   // null when None
    "response": true
}).to_string())
```

## Security Note

The demo dispatches any action from any client, including destructive operations such as `purge`. Real apps must gate mutating actions (`set`, `delete`, `incr`, `expire`, `purge`, `purgePrefix`) behind authorization or a trusted route.

## Common Patterns

### Counter with bounded window

Use `incr` for counters and rate limiting. Keys are per-PoP, so limits apply per PoP, not globally. Every `incr` key needs a corresponding `expire`. Refer to the FastEdge storage platform reference for the correct pattern based on key shape — do not call `expire` after every `incr` on a fixed key, as that keeps pushing the deadline forward and the window never resets under steady traffic.

```rust
let count = cache::incr("rate:user:123", 1)?;
// Call expire at the right time based on key shape — see storage platform reference
```

### Sliding expiry

Use `expire` to extend an existing key's expiry on access:

```rust
if let Ok(Some(value)) = cache::get(key) {
    let _ = cache::expire(key, 300_000); // reset to 5 minutes
    // use value
}
```

### Group invalidation

Use `purge_prefix` to invalidate a set of related keys:

```rust
cache::purge_prefix("session:user:123:")?;
```

## Dependencies

```toml
[dependencies]
proxy-wasm = "0.2"
fastedge = { version = "0.4", features = ["proxywasm"] }
querystring = "1.1"
serde_json = "1"
```

## Build

```sh
cargo build --release
# Output: target/wasm32-wasip1/release/cache.wasm
```

## Key Constraints

- Cache operations are scoped to the calling application automatically — no manual prefix needed.
- There are no named stores or handles; the key is the sole address.
- `ttl` values are always in **milliseconds**.
- `delta` for `incr` is a signed 64-bit integer (`i64`); a missing key is treated as `0`.
- Values are `Vec<u8>`; string conversion requires explicit decoding with `String::from_utf8_lossy`.
- All values are PoP-local — writes in one PoP are not visible in another.
- The host clamps TTLs to a deployment ceiling (~4 days by default), including when no TTL is passed. There is no way to read a key's TTL.
- `incr` keys are not indexed and are not purged by `purge` or `purge_prefix`; they require an explicit `expire`.
- `expire` returns `Ok(false)` when the key is absent and `Err` on failure; these are distinct — do not treat them the same.
- `incr` errors if the stored value is not a valid integer.
- Error variants: `AccessDenied`, `InternalError`, `Other(String)`.
- The TTL and `incr` behaviour described here was measured on HTTP apps. It has not yet been verified for CDN (proxy-wasm) apps; do not treat it as confirmed CDN behaviour.
- This cache is unrelated to CDN HTTP caching. To control edge caching of HTTP responses, use `Cache-Control` headers (see the CDN cache-control example).

## See Also

- fastedge-sdk-rust CDN key_value example (named KV store with handles, contrast to this cache API)
- fastedge-sdk-rust CDN cache-control example (for controlling CDN HTTP response caching via headers)
- FastEdge storage platform reference (TTL and incr expiry patterns by key shape)
- proxy-wasm HttpContext and RootContext trait documentation
