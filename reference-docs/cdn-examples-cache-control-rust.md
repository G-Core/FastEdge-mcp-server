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
app_type: cdn
languages: [rust]
capabilities: [cache-control, content-type-aware-caching, response-headers, vary-headers, static-assets, cdn-caching]
---

# Cache Control — CDN App Example (Rust)

Content-type-aware Cache-Control header injection for CDN apps using the proxy-wasm Rust SDK. Sets `Cache-Control` (and `Vary`) response headers based on the detected content type and response status, providing fine-grained control over CDN caching behavior.

---

## Overview

- **App type**: CDN (proxy-wasm `HttpContext`)
- **Language**: Rust
- **Crate**: `proxy-wasm = "0.2"`
- **Crate type**: `cdylib` (WASM library target)
- **Edition**: 2024
- **Hook**: `on_http_response_headers`

---

## Environment Variables

| Variable | Required | Type | Default | Description |
|---|---|---|---|---|
| `STATIC_MAX_AGE` | No | `String` (numeric seconds) | `31536000` | `max-age` for static assets (images, fonts, JS, CSS, WASM) |
| `HTML_MAX_AGE` | No | `String` (numeric seconds) | `3600` | `max-age` for `text/html` responses |
| `API_MAX_AGE` | No | `String` (numeric seconds) | `0` | `max-age` for JSON/XML API responses; `0` means no-cache |

All three are read via `env::var(...).unwrap_or_else(|_| "<default>".to_string())` — no error on missing, defaults always apply.

---

## Response Property

| Property path | Type | Encoding | Description |
|---|---|---|---|
| `response.status` | `Vec<u8>` | 2-byte big-endian binary `u16` | HTTP response status code from origin |

Retrieved via `self.get_property(vec!["response.status"])`. Returns `None` if absent; defaults to `200` on `None` or malformed bytes.

**Decoding:**
```rust
let status_code = self
    .get_property(vec!["response.status"])
    .and_then(|bytes| {
        if bytes.len() == 2 {
            Some(u16::from_be_bytes([bytes[0], bytes[1]]))
        } else {
            None
        }
    })
    .unwrap_or(200);
```

---

## Entry Point

```rust
proxy_wasm::main! {{
    proxy_wasm::set_log_level(LogLevel::Info);
    proxy_wasm::set_root_context(|_| -> Box<dyn RootContext> { Box::new(CacheControlRoot) });
}}
```

The `proxy_wasm::main!` macro registers the root context factory. `CacheControlRoot` implements `RootContext` and creates `CacheControlContext` instances per request via `create_http_context`.

---

## Context Types

### `CacheControlRoot`

Implements `RootContext` and `Context`. Stateless.

| Method | Return | Description |
|---|---|---|
| `get_type(&self)` | `Option<ContextType>` | Returns `Some(ContextType::HttpContext)` |
| `create_http_context(&self, _: u32)` | `Option<Box<dyn HttpContext>>` | Returns a new `CacheControlContext` instance per request |

### `CacheControlContext`

Implements `HttpContext` and `Context`. Stateless — no fields.

---

## Caching Tiers

### Static Assets

**Trigger**: `is_static_asset(&content_type)` returns `true`

**`Cache-Control`**: `public, max-age=<STATIC_MAX_AGE>, immutable`

**Default**: `public, max-age=31536000, immutable`

No `Vary` header added.

### HTML

**Trigger**: `content_type.contains("text/html")`

**`Cache-Control`**: `public, max-age=<HTML_MAX_AGE>, must-revalidate`

**Default**: `public, max-age=3600, must-revalidate`

**`Vary` added**: `Accept-Encoding`

### JSON / XML APIs

**Trigger**: `content_type.contains("application/json") || content_type.contains("application/xml")`

**`Cache-Control`** (when `API_MAX_AGE == "0"`): `no-cache, no-store, must-revalidate`

**`Cache-Control`** (when `API_MAX_AGE != "0"`): `private, max-age=<API_MAX_AGE>, must-revalidate`

**Default** (`API_MAX_AGE = "0"`): `no-cache, no-store, must-revalidate`

**`Vary` added**: `Accept, Authorization`

### Error Responses

**Trigger**: `!(200..400).contains(&status_code)` — i.e. status is 4xx, 5xx, or outside 200–399

**`Cache-Control`**: `no-store`

Short-circuits immediately — no content-type inspection, no `Vary` headers, returns `Action::Continue`.

### Default (catch-all)

**Trigger**: Content type does not match any above category

**`Cache-Control`**: `public, max-age=600`

No `Vary` header added.

---

## `is_static_asset` Helper

```rust
fn is_static_asset(content_type: &str) -> bool {
    content_type.starts_with("image/")
        || content_type.starts_with("font/")
        || content_type.contains("application/javascript")
        || content_type.contains("text/css")
        || content_type.contains("text/javascript")
        || content_type.contains("application/wasm")
}
```

Checks (in order):
1. `starts_with("image/")` — all image MIME types
2. `starts_with("font/")` — all font MIME types
3. `contains("application/javascript")`
4. `contains("text/css")`
5. `contains("text/javascript")`
6. `contains("application/wasm")`

---

## Control Flow: `on_http_response_headers`

Signature: `fn on_http_response_headers(&mut self, _: usize, _: bool) -> Action`

Executes on every response before it is forwarded to the client.

1. Read `response.status` via `self.get_property(vec!["response.status"])`. Decode as 2-byte big-endian `u16`. Default to `200` on `None` or length mismatch.
2. If status outside `200..400` → `self.set_http_response_header("Cache-Control", Some("no-store"))` → return `Action::Continue`.
3. Read `Content-Type` response header via `self.get_http_response_header("Content-Type")`. Default to empty string on `None`.
4. Read `STATIC_MAX_AGE`, `HTML_MAX_AGE`, `API_MAX_AGE` env vars with defaults.
5. Determine `cache_control` string by content-type category (see Caching Tiers above). Add `Vary` header where applicable via `self.add_http_response_header("Vary", &value)`.
6. Set `Cache-Control` via `self.set_http_response_header("Cache-Control", Some(&cache_control))`.
7. Log via `println!("Cache-Control: {} (content-type: {})", cache_control, content_type)`.
8. Return `Action::Continue`.

---

## Host API Usage

| Method | Usage |
|---|---|
| `self.get_property(vec!["response.status"])` | Read binary-encoded HTTP status code |
| `self.get_http_response_header("Content-Type")` | Read `Content-Type` from origin response |
| `self.set_http_response_header("Cache-Control", Some(&value))` | Set (overwrite) `Cache-Control` header |
| `self.add_http_response_header("Vary", &value)` | Append a `Vary` header to response |

---

## Dependency

```toml
[dependencies]
proxy-wasm = "0.2"
```

No other dependencies. Standard library `std::env` is used directly.

---

## Cargo.toml

```toml
[workspace]

[package]
name = "cache_control"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib"]

[dependencies]
proxy-wasm = "0.2"
```

---

## Gotchas

- **`response.status` is binary, not a string**: The property is a 2-byte big-endian `u16`, not a UTF-8 numeric string. Use `u16::from_be_bytes([bytes[0], bytes[1]])` — do not attempt string parsing.
- **Error responses short-circuit**: Status 4xx/5xx is intercepted before content-type inspection. `no-store` is set and the function returns immediately — no `Vary` header is ever added for error responses.
- **`Vary` header correctness**: `Vary: Accept-Encoding` is required for HTML to prevent serving gzip-compressed content to clients that do not support it. `Vary: Accept, Authorization` for JSON/XML prevents shared caches from serving authenticated responses to unauthenticated clients.
- **`immutable` flag**: Applied to all static assets. This tells CDN and browser caches the resource will never change at this URL — only safe for fingerprinted/versioned asset URLs. Do not use with mutable static paths.
- **`API_MAX_AGE = "0"` is the no-cache case**: The zero-value string is the sentinel for `no-cache, no-store, must-revalidate`. Any non-zero numeric string produces `private, max-age=<value>, must-revalidate`.
- **`add_http_response_header` vs `set_http_response_header`**: `add` appends a new header instance (used for `Vary`); `set` replaces any existing header (used for `Cache-Control`). Using `set` for `Vary` would overwrite CDN-injected `Vary` values already present.
- **Content-type matching is substring-based**: `contains("application/javascript")` matches `application/javascript; charset=utf-8`. Order of checks matters — static asset check runs first via `is_static_asset`, before HTML or JSON/XML checks.
- **Default catch-all is `public, max-age=600`**: Applies to any content type not explicitly matched (e.g. `text/plain`, `video/mp4`, binary streams). 600 seconds (10 minutes) is conservative.
- **Logging uses `println!`**: The source uses `println!` macro, not `proxy_wasm::hostcalls::log`. Output goes to platform stdout/log stream.

---

## See Also

- proxy-wasm Rust SDK reference (host API, `HttpContext` trait, `get_property`, `get_http_response_header`, `set_http_response_header`, `add_http_response_header`)
- FastEdge CDN app platform overview (response properties, caching model, Vary header semantics)
- FastEdge environment variable configuration (setting `STATIC_MAX_AGE`, `HTML_MAX_AGE`, `API_MAX_AGE` at deploy time)
- examples-auth-jwt-rust reference (similar CDN proxy-wasm response-phase pattern)
- examples-geoblock-rust reference (CDN proxy-wasm request-phase pattern for comparison)
