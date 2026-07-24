<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 6347a7c2fda0d03e66f1214db5eec041c16801b7
      updated: 2026-07-23
-->

---
capabilities:
  - kv-store
  - key-value
  - sorted-set
  - bloom-filter
type: example
app_type: cdn
languages:
  - rust
---

# KV Store — CDN (Rust)

## Overview

Provides access to named KV stores from within FastEdge CDN (proxy-wasm) apps. Supports string key lookup, glob-pattern key scanning, sorted set range and scan queries, and bloom filter membership checks. Use when CDN edge logic needs to read data from platform-configured key-value stores at request time.

## API Patterns

### Import

```rust
use fastedge::proxywasm::key_value::Store;
```

### Open a store

```rust
Store::open(name: &str) -> Result<Store, Error>
```

Opens a named KV store configured in the FastEdge platform. Must be called before any store operations. Returns `Err` if the store name is not found or the host call fails.

### Operations

| Method | Signature | Notes |
|--------|-----------|-------|
| `get` | `store.get(key: &str) -> Result<Option<Vec<u8>>, Error>` | Returns `None` for missing keys — not an error |
| `scan` | `store.scan(pattern: &str) -> Result<Vec<String>, Error>` | Lists keys matching a glob pattern |
| `zrange_by_score` | `store.zrange_by_score(key: &str, min: f64, max: f64) -> Result<Vec<(Vec<u8>, f64)>, Error>` | Sorted set range query by score |
| `zscan` | `store.zscan(key: &str, pattern: &str) -> Result<Vec<(Vec<u8>, f64)>, Error>` | Sorted set members matching a pattern |
| `bf_exists` | `store.bf_exists(key: &str, item: &str) -> Result<bool, Error>` | Bloom filter membership check |

### Cargo.toml dependencies

```toml
[dependencies]
proxy-wasm = "0.2"
fastedge = { version = "0.4", features = ["proxywasm"] }
querystring = "1.1"
serde_json = "1"
```

### Proxy-wasm lifecycle hooks

- **`on_http_response_headers`** — set response `content-type` and remove `content-length` before replacing the body
- **`on_http_response_body`** — read request query parameters via `get_property(vec!["request", "query"])`, open the store, dispatch to operations, and replace the body via `set_http_response_body`

Query parameters are only available in `on_http_response_body` via `get_property` because request data is accessible throughout the response phase.

### Entry point

```rust
proxy_wasm::main! {{
    proxy_wasm::set_log_level(LogLevel::Info);
    proxy_wasm::set_root_context(|_| -> Box<dyn RootContext> { Box::new(KvStoreRoot) });
}}
```

`RootContext::get_type` must return `Some(ContextType::HttpContext)` and `create_http_context` must return the `HttpContext` implementation.

## Common Patterns

### Open store and get a value

```rust
fn on_http_response_body(&mut self, body_size: usize, end_of_stream: bool) -> Action {
    if !end_of_stream {
        return Action::Pause;
    }

    let store = Store::open("my-store").expect("store must be configured");

    match store.get("my-key") {
        Ok(Some(value)) => {
            let value_str = String::from_utf8_lossy(&value);
            // use value_str
        }
        Ok(None) => {
            // key not present — handle missing case
        }
        Err(e) => {
            // host error
        }
    }
    Action::Continue
}
```

### Scan keys by pattern

```rust
match store.scan("prefix:*") {
    Ok(keys) => {
        let body = serde_json::json!({ "keys": keys }).to_string();
        self.set_http_response_body(0, body_size, body.as_bytes()).ok();
    }
    Err(e) => { /* handle error */ }
}
```

### Sorted set range query and response body replacement

```rust
// In on_http_response_headers — prepare for body replacement
fn on_http_response_headers(&mut self, _: usize, _: bool) -> Action {
    self.set_http_response_header("content-length", None); // sets to empty string on FastEdge CDN platform
    self.set_http_response_header("content-type", Some("application/json"));
    self.set_http_response_header("transfer-encoding", Some("chunked"));
    Action::Continue
}

// In on_http_response_body — range query and replace body
match store.zrange_by_score("leaderboard", 0.0, 100.0) {
    Ok(entries) => {
        let entries_json: Vec<serde_json::Value> = entries
            .iter()
            .map(|(value, score)| {
                let value_str = String::from_utf8_lossy(value);
                serde_json::json!({"value": value_str.as_ref(), "score": score})
            })
            .collect();
        let body = serde_json::json!({ "entries": entries_json }).to_string();
        self.set_http_response_body(0, body_size, body.as_bytes()).ok();
    }
    Err(e) => { /* handle error */ }
}
```

### Dispatch to operations via query parameters

```rust
let query = self
    .get_property(vec!["request", "query"])
    .and_then(|bytes| String::from_utf8(bytes).ok())
    .unwrap_or_default();

let params: HashMap<&str, &str> = querystring::querify(&query).into_iter().collect();

let action = params.get("action").copied().unwrap_or("get");

let result = match action {
    "get"      => self.handle_get(&store, &params),
    "scan"     => self.handle_scan(&store, &params),
    "zrange"   => self.handle_zrange(&store, &params),
    "zscan"    => self.handle_zscan(&store, &params),
    "bfExists" => self.handle_bf_exists(&store, &params),
    _          => Err(format!("Invalid action '{}'", action)),
};
```

### Query parameter dispatch — full example

The complete example supports these query parameter combinations:

| Action | Required params | Optional params |
|--------|----------------|-----------------|
| `get` (default) | `store`, `key` | — |
| `scan` | `store`, `match` | — |
| `zrange` | `store`, `key`, `min`, `max` | — |
| `zscan` | `store`, `key`, `match` | — |
| `bfExists` | `store`, `key`, `item` | — |

`store` is always required. `action` defaults to `get` if omitted. An absent `store` param returns a 500 error before any store operations are attempted. If `query` is empty, a 500 error is returned immediately.

### Error response pattern

```rust
fn send_error(&self, msg: &str, body_size: usize) {
    println!("{}", msg);
    self.set_property(
        vec!["response", "status"],
        Some(b"500"),
    );
    let error_body = serde_json::json!({"error": msg}).to_string();
    self.set_http_response_body(0, body_size, error_body.as_bytes());
}
```

### JSON response shape per action

```rust
// get — value present
json!({ "store": store_name, "action": "get", "key": key, "response": value_str })
// get — value absent
json!({ "store": store_name, "action": "get", "key": key, "response": null })

// scan
json!({ "store": store_name, "action": "scan", "match": pattern, "response": keys })

// zrange
json!({ "store": store_name, "action": "zrange", "key": key, "min": min, "max": max, "response": entries_json })

// zscan
json!({ "store": store_name, "action": "zscan", "key": key, "match": pattern, "response": entries_json })

// bfExists
json!({ "store": store_name, "action": "bfExists", "key": key, "item": item, "response": exists })
```

Sorted set entries shape: `[{"value": "<string>", "score": <f64>}, ...]`

## Gotchas

- **`get` returns `None` for missing keys** — a missing key is `Ok(None)`, not an `Err`. Always match both `Some` and `None` cases; treating `None` as an error will produce incorrect behavior.
- **All values are `Vec<u8>`** — KV values are raw bytes. Decode with `String::from_utf8_lossy(&value)` (never bare `String::from_utf8(...).unwrap()` — that panics on invalid UTF-8).
- **Sorted set tuples are `(Vec<u8>, f64)`** — the value comes first, score second. Both `zrange_by_score` and `zscan` return `Vec<(Vec<u8>, f64)>`.
- **`Store::open` takes a platform-configured name** — the store name must match a KV store resource attached to the app in the FastEdge platform. Passing an unknown name returns `Err`.
- **`content-length` must be removed before body replacement** — when replacing the response body, always remove `content-length` in `on_http_response_headers` (set to `None`). Note: on the FastEdge CDN platform, passing `None` sets the header to an empty string rather than truly removing it; set `transfer-encoding: chunked` as a workaround.
- **`on_http_response_body` must wait for end of stream** — return `Action::Pause` until `end_of_stream` is `true` before reading query parameters or replacing the body.
- **`query` property is available in the response phase** — `get_property(vec!["request", "query"])` works in `on_http_response_body` because request metadata is accessible throughout the response lifecycle.
- **Error type is a typed `Error` enum** (not a raw `u32` as with secrets). Match on the `Err(e)` variant and format with `format!("{}", e)` for human-readable messages.
- **`store` query parameter is always required** — the example reads `store` from query params and passes it to `Store::open`. An absent `store` param returns a 500 error before any store operations are attempted.
- **Empty query string is rejected** — if no query parameters are provided at all, the app returns a 500 error with the message `"App must be called with query parameters"`.
- **`zrange` min/max must parse as `f64`** — invalid numeric values return an error string; validate or propagate the parse error rather than unwrapping.
- **`Store::open` is called after query parameter validation** — open the store only after validating required params (`store`, `action`) to avoid unnecessary host calls on invalid requests.

## Related

- Host services reference — full KV store, secrets, and dictionary API documentation for CDN (proxy-wasm) apps
- CDN apps reference — proxy-wasm lifecycle hooks, request properties, header and body manipulation patterns
- SDK reference (Rust) — `fastedge` crate modules, feature flags, and component model vs. proxy-wasm differences

## Source Material

### FILE: examples/cdn/key_value/src/lib.rs

```rust
/*
* Copyright 2025 G-Core Innovations SARL
*/
/*
Example CDN app demonstrating KV Store operations via the proxy-wasm interface.

Supports all KV Store operations via query parameters:
  ?store=<name>&action=get&key=<key>
  ?store=<name>&action=scan&match=<pattern>
  ?store=<name>&action=zrange&key=<key>&min=<f64>&max=<f64>
  ?store=<name>&action=zscan&key=<key>&match=<pattern>
  ?store=<name>&action=bfExists&key=<key>&item=<item>

Defaults to action=get if not specified.
*/

use fastedge::proxywasm::key_value::Store;
use proxy_wasm::traits::*;
use proxy_wasm::types::*;
use serde_json::json;
use std::collections::HashMap;

proxy_wasm::main! {{
    proxy_wasm::set_log_level(LogLevel::Info);
    proxy_wasm::set_root_context(|_| -> Box<dyn RootContext> { Box::new(KvStoreRoot) });
}}

struct KvStoreRoot;

impl Context for KvStoreRoot {}

impl RootContext for KvStoreRoot {
    fn get_type(&self) -> Option<ContextType> {
        Some(ContextType::HttpContext)
    }

    fn create_http_context(&self, _: u32) -> Option<Box<dyn HttpContext>> {
        Some(Box::new(KvStoreContext))
    }
}

struct KvStoreContext;

impl Context for KvStoreContext {}

impl HttpContext for KvStoreContext {
    fn on_http_response_headers(&mut self, _: usize, _: bool) -> Action {
        // Remove content-length since we replace the body
        self.set_http_response_header("content-length", None);
        self.set_http_response_header("content-type", Some("application/json"));
        self.set_http_response_header("transfer-encoding", Some("chunked"));
        Action::Continue
    }

    fn on_http_response_body(&mut self, body_size: usize, end_of_stream: bool) -> Action {
        if !end_of_stream {
            return Action::Pause;
        }

        let query = self
            .get_property(vec!["request", "query"])
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .unwrap_or_default();

        if query.is_empty() {
            self.send_error("App must be called with query parameters", body_size);
            return Action::Continue;
        }

        let params: HashMap<&str, &str> = querystring::querify(&query).into_iter().collect();

        let Some(store_name) = params.get("store") else {
            self.send_error("Missing required param 'store'", body_size);
            return Action::Continue;
        };

        let action = params.get("action").copied().unwrap_or("get");

        let store = match Store::open(store_name) {
            Ok(s) => s,
            Err(e) => {
                self.send_error(&format!("Failed to open KvStore '{}': {}", store_name, e), body_size);
                return Action::Continue;
            }
        };

        let result = match action {
            "get" => self.handle_get(&store, &params),
            "scan" => self.handle_scan(&store, &params),
            "zrange" => self.handle_zrange(&store, &params),
            "zscan" => self.handle_zscan(&store, &params),
            "bfExists" => self.handle_bf_exists(&store, &params),
            _ => Err(format!(
                "Invalid action '{}'. Supported: get, scan, zrange, zscan, bfExists",
                action
            )),
        };

        let body = match result {
            Ok(json) => json,
            Err(msg) => {
                self.send_error(&msg, body_size);
                return Action::Continue;
            }
        };

        self.set_http_response_body(0, body_size, body.as_bytes());

        Action::Continue
    }
}

impl KvStoreContext {
    fn handle_get(&self, store: &Store, params: &HashMap<&str, &str>) -> Result<String, String> {
        let key = *params.get("key").ok_or("Missing required param 'key' for 'get' action")?;
        match store.get(key) {
            Ok(Some(value)) => {
                let value_str = String::from_utf8_lossy(&value);
                Ok(json!({
                    "store": params.get("store").unwrap_or(&""),
                    "action": "get",
                    "key": key,
                    "response": value_str.as_ref()
                }).to_string())
            }
            Ok(None) => Ok(json!({
                "store": params.get("store").unwrap_or(&""),
                "action": "get",
                "key": key,
                "response": null
            }).to_string()),
            Err(e) => Err(format!("KV get error: {}", e)),
        }
    }

    fn handle_scan(&self, store: &Store, params: &HashMap<&str, &str>) -> Result<String, String> {
        let pattern = *params.get("match").ok_or("Missing required param 'match' for 'scan' action")?;
        match store.scan(pattern) {
            Ok(keys) => Ok(json!({
                "store": params.get("store").unwrap_or(&""),
                "action": "scan",
                "match": pattern,
                "response": keys
            }).to_string()),
            Err(e) => Err(format!("KV scan error: {}", e)),
        }
    }

    fn handle_zrange(&self, store: &Store, params: &HashMap<&str, &str>) -> Result<String, String> {
        let key = *params.get("key").ok_or("Missing required param 'key' for 'zrange' action")?;
        let min: f64 = params
            .get("min")
            .ok_or("Missing required param 'min' for 'zrange' action")?
            .parse()
            .map_err(|_| "Invalid 'min' value: must be a number".to_string())?;
        let max: f64 = params
            .get("max")
            .ok_or("Missing required param 'max' for 'zrange' action")?
            .parse()
            .map_err(|_| "Invalid 'max' value: must be a number".to_string())?;

        match store.zrange_by_score(key, min, max) {
            Ok(entries) => {
                let entries_json: Vec<serde_json::Value> = entries
                    .iter()
                    .map(|(value, score)| {
                        let value_str = String::from_utf8_lossy(value);
                        json!({"value": value_str.as_ref(), "score": score})
                    })
                    .collect();
                Ok(json!({
                    "store": params.get("store").unwrap_or(&""),
                    "action": "zrange",
                    "key": key,
                    "min": min,
                    "max": max,
                    "response": entries_json
                }).to_string())
            }
            Err(e) => Err(format!("KV zrange error: {}", e)),
        }
    }

    fn handle_zscan(&self, store: &Store, params: &HashMap<&str, &str>) -> Result<String, String> {
        let key = *params.get("key").ok_or("Missing required param 'key' for 'zscan' action")?;
        let pattern = *params.get("match").ok_or("Missing required param 'match' for 'zscan' action")?;

        match store.zscan(key, pattern) {
            Ok(entries) => {
                let entries_json: Vec<serde_json::Value> = entries
                    .iter()
                    .map(|(value, score)| {
                        let value_str = String::from_utf8_lossy(value);
                        json!({"value": value_str.as_ref(), "score": score})
                    })
                    .collect();
                Ok(json!({
                    "store": params.get("store").unwrap_or(&""),
                    "action": "zscan",
                    "key": key,
                    "match": pattern,
                    "response": entries_json
                }).to_string())
            }
            Err(e) => Err(format!("KV zscan error: {}", e)),
        }
    }

    fn handle_bf_exists(&self, store: &Store, params: &HashMap<&str, &str>) -> Result<String, String> {
        let key = *params.get("key").ok_or("Missing required param 'key' for 'bfExists' action")?;
        let item = *params.get("item").ok_or("Missing required param 'item' for 'bfExists' action")?;

        match store.bf_exists(key, item) {
            Ok(exists) => Ok(json!({
                "store": params.get("store").unwrap_or(&""),
                "action": "bfExists",
                "key": key,
                "item": item,
                "response": exists
            }).to_string()),
            Err(e) => Err(format!("KV bfExists error: {}", e)),
        }
    }

    fn send_error(&self, msg: &str, body_size: usize) {
        println!("{}", msg);
        self.set_property(
            vec!["response", "status"],
            Some(b"500"),
        );
        let error_body = json!({"error": msg}).to_string();
        self.set_http_response_body(0, body_size, error_body.as_bytes());
    }
}
```


### FILE: examples/cdn/key_value/Cargo.toml

```toml
[workspace]

[package]
name = "key_value"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib"]

[dependencies]
proxy-wasm = "0.2"
fastedge = { version = "0.4", features = ["proxywasm"] }
querystring = "1.1"
serde_json = "1"
```


### FILE: examples/cdn/key_value/README.md

```
[← Back to examples](../../README.md)

# Key Value (CDN)

Implements KV store operations via query parameters — get, scan, zrange, zscan, and bfExists — using the proxy-wasm ABI.
```
