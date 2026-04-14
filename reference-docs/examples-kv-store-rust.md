<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 1205d9296bb39a024e2d07820f56a85e76d0eca9
      updated: 2026-04-09
-->

---
capabilities: [kv-store, http]
type: example
app_type: http
languages: [rust]
---

# KV Store — Rust (WASI HTTP)

Complete example demonstrating all KV Store operations in a FastEdge HTTP app using the WASI interface.

## Cargo.toml

```toml
[package]
name = "key_value_wasi"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wstd = "0.6"
fastedge = "0.3"
anyhow = "1"
querystring = "1.1"
```

## Imports

```rust
use fastedge::key_value::{Store, Error as StoreError};
use wstd::http::body::Body;
use wstd::http::{Request, Response};
```

## Entry Point

```rust
#[wstd::http_server]
async fn main(req: Request<Body>) -> anyhow::Result<Response<Body>> { ... }
```

The `#[wstd::http_server]` macro is required. The handler is `async` and returns `anyhow::Result<Response<Body>>`.

## Query Parameter Routing

The example dispatches on the `action` query parameter:

```
?store=<name>&action=get&key=<key>
?store=<name>&action=scan&match=<pattern>
?store=<name>&action=zrange&key=<key>&min=<f64>&max=<f64>
?store=<name>&action=zscan&key=<key>&match=<pattern>
?store=<name>&action=bfExists&key=<key>&item=<item>
```

`action` defaults to `get` if not specified. An unrecognized `action` returns HTTP 400.

## Store API

### `Store::open`

```rust
Store::open(store_name: &str) -> Result<Store, StoreError>
```

Opens a named KV store. Must be called before any read operations.

**Error variants:**
- `StoreError::AccessDenied` — the app does not have permission to access the named store; respond with HTTP 403
- Other `StoreError` variants — internal/configuration errors; respond with HTTP 500

**Pattern:**

```rust
let store = match Store::open(store_name) {
    Ok(s) => s,
    Err(StoreError::AccessDenied) => {
        return Ok(Response::builder()
            .status(403)
            .body(Body::from("access denied"))?);
    }
    Err(e) => {
        return Ok(Response::builder()
            .status(500)
            .body(Body::from(format!("store open error: {e}")))?);
    }
};
```

### `Store::get`

```rust
store.get(key: &str) -> Result<Option<Vec<u8>>, Error>
```

Retrieves the value for a key. Returns `Ok(None)` if the key does not exist. Value is raw bytes; use `String::from_utf8_lossy(&value)` to convert to string.

**Pattern:**

```rust
fn handle_get(store: &Store, params: &HashMap<&str, &str>) -> anyhow::Result<String> {
    let key = *params.get("key").ok_or(anyhow!("missing param 'key'"))?;
    match store.get(key) {
        Ok(Some(value)) => {
            let value_str = String::from_utf8_lossy(&value);
            Ok(format!(r#"{{"key":"{}","response":"{}"}}"#, key, value_str))
        }
        Ok(None) => Ok(format!(r#"{{"key":"{}","response":null}}"#, key)),
        Err(e) => Err(anyhow!("KV get error: {e}")),
    }
}
```

### `Store::scan`

```rust
store.scan(pattern: &str) -> Result<Vec<String>, Error>
```

Returns a list of keys matching the given pattern. Pattern syntax is store-defined (glob-style match string). Returns key names as `Vec<String>`, not values.

**Pattern:**

```rust
fn handle_scan(store: &Store, params: &HashMap<&str, &str>) -> anyhow::Result<String> {
    let pattern = *params.get("match").ok_or(anyhow!("missing param 'match'"))?;
    match store.scan(pattern) {
        Ok(keys) => {
            let keys_json: Vec<String> = keys.iter().map(|k| format!(r#""{}""#, k)).collect();
            Ok(format!(r#"{{"match":"{}","response":[{}]}}"#, pattern, keys_json.join(",")))
        }
        Err(e) => Err(anyhow!("KV scan error: {e}")),
    }
}
```

### `Store::zrange_by_score`

```rust
store.zrange_by_score(key: &str, min: f64, max: f64) -> Result<Vec<(Vec<u8>, f64)>, Error>
```

Returns sorted-set entries under `key` with scores in `[min, max]`. Each entry is a `(value: Vec<u8>, score: f64)` tuple. Values are raw bytes.

**Pattern:**

```rust
fn handle_zrange(store: &Store, params: &HashMap<&str, &str>) -> anyhow::Result<String> {
    let key = *params.get("key").ok_or(anyhow!("missing param 'key'"))?;
    let min: f64 = params.get("min").ok_or(anyhow!("missing param 'min'"))?
        .parse().map_err(|_| anyhow!("invalid 'min': must be a number"))?;
    let max: f64 = params.get("max").ok_or(anyhow!("missing param 'max'"))?
        .parse().map_err(|_| anyhow!("invalid 'max': must be a number"))?;
    match store.zrange_by_score(key, min, max) {
        Ok(entries) => {
            let entries_json: Vec<String> = entries.iter().map(|(value, score)| {
                let value_str = String::from_utf8_lossy(value);
                format!(r#"{{"value":"{}","score":{}}}"#, value_str, score)
            }).collect();
            Ok(format!(r#"{{"key":"{}","min":{},"max":{},"response":[{}]}}"#,
                key, min, max, entries_json.join(",")))
        }
        Err(e) => Err(anyhow!("KV zrange error: {e}")),
    }
}
```

### `Store::zscan`

```rust
store.zscan(key: &str, pattern: &str) -> Result<Vec<(Vec<u8>, f64)>, Error>
```

Returns sorted-set entries under `key` whose value matches `pattern`. Each entry is a `(value: Vec<u8>, score: f64)` tuple. Values are raw bytes.

**Pattern:**

```rust
fn handle_zscan(store: &Store, params: &HashMap<&str, &str>) -> anyhow::Result<String> {
    let key = *params.get("key").ok_or(anyhow!("missing param 'key'"))?;
    let pattern = *params.get("match").ok_or(anyhow!("missing param 'match'"))?;
    match store.zscan(key, pattern) {
        Ok(entries) => {
            let entries_json: Vec<String> = entries.iter().map(|(value, score)| {
                let value_str = String::from_utf8_lossy(value);
                format!(r#"{{"value":"{}","score":{}}}"#, value_str, score)
            }).collect();
            Ok(format!(r#"{{"key":"{}","match":"{}","response":[{}]}}"#,
                key, pattern, entries_json.join(",")))
        }
        Err(e) => Err(anyhow!("KV zscan error: {e}")),
    }
}
```

### `Store::bf_exists`

```rust
store.bf_exists(key: &str, item: &str) -> Result<bool, Error>
```

Checks whether `item` exists in the Bloom filter stored at `key`. Returns `Ok(true)` or `Ok(false)`. Bloom filters may produce false positives; they never produce false negatives.

**Pattern:**

```rust
fn handle_bf_exists(store: &Store, params: &HashMap<&str, &str>) -> anyhow::Result<String> {
    let key = *params.get("key").ok_or(anyhow!("missing param 'key'"))?;
    let item = *params.get("item").ok_or(anyhow!("missing param 'item'"))?;
    match store.bf_exists(key, item) {
        Ok(exists) => Ok(format!(r#"{{"key":"{}","item":"{}","response":{}}}"#, key, item, exists)),
        Err(e) => Err(anyhow!("KV bfExists error: {e}")),
    }
}
```

## Supported Operations Summary

| Action      | Required params              | Optional params | Method                                  |
|-------------|------------------------------|-----------------|-----------------------------------------|
| `get`       | `store`, `key`               | —               | `store.get(key)`                        |
| `scan`      | `store`, `match`             | —               | `store.scan(pattern)`                   |
| `zrange`    | `store`, `key`, `min`, `max` | —               | `store.zrange_by_score(key, min, max)`  |
| `zscan`     | `store`, `key`, `match`      | —               | `store.zscan(key, pattern)`             |
| `bfExists`  | `store`, `key`, `item`       | —               | `store.bf_exists(key, item)`            |

## Error Handling Pattern

All store methods return `Result`. Use `?` to propagate or match explicitly for user-facing errors. `anyhow::anyhow!("message")` is used to wrap store errors into `anyhow::Error` for handler propagation.

```rust
match store.get(key) {
    Ok(Some(value)) => { /* found */ }
    Ok(None) => { /* key not present */ }
    Err(e) => return Err(anyhow!("KV get error: {e}")),
}
```

## Response Format

All operations return JSON with `content-type: application/json`:

```rust
Response::builder()
    .status(200)
    .header("content-type", "application/json")
    .body(Body::from(body))?
```

## Constraints and Notes

- `Store` is not `Clone` or `Send`. Open one store per handler invocation; do not share across async boundaries.
- `get` returns `Vec<u8>`, not `String`. UTF-8 decoding must be done explicitly (`String::from_utf8_lossy` or `String::from_utf8`).
- `zrange_by_score` and `zscan` return sorted-set entries as `Vec<(Vec<u8>, f64)>` — values are bytes, scores are `f64`.
- `scan` returns key names as `Vec<String>`, not values.
- `bf_exists` operates on a Bloom filter data structure, not a plain key. The `key` parameter identifies the filter; `item` is what is tested for membership.
- Store names must match stores configured and granted to the app at the platform level. Mismatched or unconfigured store names produce `AccessDenied` or open errors.
- `crate-type = ["cdylib"]` is required for WASM compilation.
- Query parameters are parsed via the `querystring` crate into a `HashMap<&str, &str>`. Missing required parameters return `anyhow::Error` which propagates as HTTP 500 from the handler.

## See Also

- fastedge key_value crate API reference
- platform-overview (store provisioning and access control)
- host-services-rust (other host service integrations)
- examples-kv-store-js (JavaScript equivalent)
