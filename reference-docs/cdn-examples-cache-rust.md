<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 6eedcca9d5c0ddd4ff79ca475965393891da2d75
      updated: 2026-09-22
-->

# CDN Cache — Rust Example

## Overview

CDN app demonstrating cache operations via the proxy-wasm ABI. All operations are scoped to the calling application and addressed by key alone — there are no named stores or handles (unlike the KV store).

Operations are dispatched via query parameters on the incoming request. Responses are always JSON. Errors return HTTP 500 with `{"error": "<message>"}`.

## App Type

- **Interface**: proxy-wasm (`fastedge::proxywasm::cache`)
- **App type**: CDN
- **Language**: Rust

## Request Interface

All operations are specified via query parameters. The `action` parameter selects the operation; `action=get` is the default when omitted.

| Query string | Operation |
|---|---|
| `?action=get&key=<key>` | Read a cached value. `response` is `null` when the key is absent. |
| `?action=set&key=<key>&value=<value>[&ttl=<ms>]` | Store a value. Omitting `ttl` stores with no expiry. |
| `?action=delete&key=<key>` | Delete a key. No-op when the key is absent. |
| `?action=exists&key=<key>` | Test key membership. |
| `?action=incr&key=<key>&delta=<i64>` | Atomic increment. `delta` may be negative. A missing key starts at `0`. |
| `?action=expire&key=<key>&ttl=<ms>` | Set or update a key's TTL. `response` is `false` when the key is absent. |
| `?action=purge` | Delete every key owned by this app. Returns count of deleted keys. |
| `?action=purgePrefix&prefix=<prefix>` | Delete app-owned keys starting with `prefix`. Returns count deleted. |

## API Reference

All functions are in `fastedge::proxywasm::cache`.

### `cache::get`

```rust
pub fn get(key: &str) -> Result<Option<Vec<u8>>, _>
```

Retrieve cached bytes by key.

- **Parameters**: `key` — cache key string
- **Returns**: `Ok(Some(Vec<u8>))` if the key exists, `Ok(None)` if absent, `Err` on failure

**JSON response shape:**
```json
{ "action": "get", "key": "<key>", "response": "<value>" }
{ "action": "get", "key": "<key>", "response": null }
```

---

### `cache::set`

```rust
pub fn set(key: &str, value: &[u8], ttl_ms: Option<u64>) -> Result<(), _>
```

Store bytes under a key with an optional TTL.

- **Parameters**:
  - `key` — cache key string
  - `value` — byte slice to store
  - `ttl_ms` — TTL in milliseconds; `None` means no expiry
- **Returns**: `Ok(())` on success, `Err` on failure
- **Constraint**: `ttl_ms` must be a positive integer when provided; invalid values produce an error response

**JSON response shape:**
```json
{ "action": "set", "key": "<key>", "value": "<value>", "ttlMs": <ms>|null, "response": true }
```

---

### `cache::delete`

```rust
pub fn delete(key: &str) -> Result<(), _>
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
pub fn exists(key: &str) -> Result<bool, _>
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
pub fn incr(key: &str, delta: i64) -> Result<i64, _>
```

Atomically increment (or decrement) a cached counter. If the key does not exist, it is treated as `0` before applying the delta.

- **Parameters**:
  - `key` — cache key string
  - `delta` — signed 64-bit integer; may be negative for decrements
- **Returns**: `Ok(new_value)` — the value after increment, `Err` on failure

**JSON response shape:**
```json
{ "action": "incr", "key": "<key>", "delta": <i64>, "response": <new_value> }
```

---

### `cache::expire`

```rust
pub fn expire(key: &str, ttl_ms: u64) -> Result<bool, _>
```

Set or update the TTL on an existing key.

- **Parameters**:
  - `key` — cache key string
  - `ttl_ms` — TTL in milliseconds; must be a positive integer
- **Returns**: `Ok(true)` if the key existed and was updated, `Ok(false)` if the key was absent, `Err` on failure

**JSON response shape:**
```json
{ "action": "expire", "key": "<key>", "ttlMs": <ms>, "response": true|false }
```

---

### `cache::purge`

```rust
pub fn purge() -> Result<u32, _>
```

Delete all keys owned by the calling application.

- **Parameters**: none
- **Returns**: `Ok(count)` — number of keys deleted, `Err` on failure

**JSON response shape:**
```json
{ "action": "purge", "response": <count> }
```

---

### `cache::purge_prefix`

```rust
pub fn purge_prefix(prefix: &str) -> Result<u32, _>
```

Delete all app-owned keys whose names start with the given prefix.

- **Parameters**: `prefix` — key prefix string
- **Returns**: `Ok(count)` — number of keys deleted, `Err` on failure

**JSON response shape:**
```json
{ "action": "purgePrefix", "prefix": "<prefix>", "response": <count> }
```

---

## Error Handling

- All errors return HTTP 500 with body `{"error": "<message>"}`.
- Missing required query parameters produce descriptive error messages, e.g. `"Missing required param 'key' for 'get' action"`.
- Invalid parameter values (e.g. non-integer `ttl`, non-integer `delta`) produce descriptive parse error messages.
- Unknown `action` values produce an error listing all supported actions.

## Dependencies

```toml
proxy-wasm = "0.2"
fastedge = { path = "...", features = ["proxywasm"] }
querystring = "1.1"
serde_json = "1"
```

## Build

```sh
cargo build --release
# Output: target/wasm32-wasip1/release/cache.wasm
```

## Lifecycle Notes

- The app uses the proxy-wasm `RootContext` + `HttpContext` pattern.
- Logic executes in `on_http_response_body` (waits for `end_of_stream`).
- `on_http_response_headers` strips `content-length`, sets `content-type: application/json`, and sets `transfer-encoding: chunked` before body processing.
- Query string is read from `request.query` via `get_property`.

## Key Constraints

- Cache operations are scoped to the calling application — keys from one app are not accessible to another.
- There are no named stores or handles; the key is the sole address.
- `ttl` values are always in **milliseconds**.
- `delta` for `incr` is a signed 64-bit integer (`i64`); a missing key is treated as `0`.

## See Also

- fastedge-sdk-rust CDN key_value example (named KV store with handles, contrast to this cache API)
- fastedge-sdk-rust CDN examples overview
- proxy-wasm `HttpContext` and `RootContext` trait documentation
