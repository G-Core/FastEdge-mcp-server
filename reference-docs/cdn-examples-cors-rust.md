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
capabilities: [cors, preflight, response-headers, origin-validation, access-control]
---

# CORS — CDN App Example (Rust)

Handles Cross-Origin Resource Sharing (CORS) for CDN apps using the proxy-wasm Rust SDK. Validates the request `Origin` header against a configurable allow-list, short-circuits preflight `OPTIONS` requests with a `204` response, and injects CORS headers on normal responses.

---

## Overview

- **App type**: CDN (proxy-wasm `HttpContext`)
- **Language**: Rust
- **Crate**: `proxy-wasm = "0.2"`
- **Crate type**: `cdylib` (WASM library target)
- **Edition**: 2024

---

## Environment Variables

| Variable | Required | Type | Description |
|---|---|---|---|
| `ALLOWED_ORIGINS` | Yes | `String` | Comma-separated list of allowed origins, or `"*"` for wildcard. Empty string = deny all. |
| `ALLOWED_METHODS` | No | `String` | Methods returned in preflight `Access-Control-Allow-Methods`. Default: `"GET, POST, PUT, DELETE, OPTIONS"` |
| `MAX_AGE` | No | `String` | Seconds for `Access-Control-Max-Age` in preflight response. Default: `"86400"` |
| `EXPOSE_HEADERS` | No | `String` | Headers exposed to browser via `Access-Control-Expose-Headers`. Empty or unset = header not sent. |

`ALLOWED_ORIGINS` is optional but required for the filter to do anything — when unset or empty, `is_origin_allowed` returns `false` for every origin and the filter is dormant: requests pass through without CORS headers. Browsers will block cross-origin access, but the proxy does not reject or modify requests.

---

## Entry Point

```rust
proxy_wasm::main! {{
    proxy_wasm::set_log_level(LogLevel::Info);
    proxy_wasm::set_root_context(|_| -> Box<dyn RootContext> { Box::new(CorsRoot) });
}}
```

- `set_root_context` registers the root context factory.
- `set_log_level(LogLevel::Info)` enables info-level logging.

---

## Context Hierarchy

| Type | Struct | Trait |
|---|---|---|
| Root context | `CorsRoot` | `RootContext` |
| Per-request context | `CorsContext` | `HttpContext` |

`CorsRoot::create_http_context` returns a new `CorsContext` for each request. `CorsRoot::get_type` returns `Some(ContextType::HttpContext)`.

---

## Origin Validation

### Helper function

```rust
fn is_origin_allowed(origin: &str, allowed: &str) -> bool
```

| Condition | Return |
|---|---|
| `allowed` is empty | `false` (deny all) |
| `allowed == "*"` | `true` (allow all) |
| `origin` matches any comma-separated entry (after `trim()`) | `true` |
| No match | `false` |

Splitting is done via `allowed.split(',').any(|o| o.trim() == origin)`. Matching is exact (case-sensitive).

---

## Request Phase — `on_http_request_headers`

```rust
fn on_http_request_headers(&mut self, _: usize, _: bool) -> Action
```

Called on every inbound CDN request before forwarding to origin.

### Control Flow

1. Read `Origin` header via `self.get_http_request_header("Origin")`.
   - If absent or empty → return `Action::Continue` (no CORS handling).
2. Read `ALLOWED_ORIGINS` env var via `env::var("ALLOWED_ORIGINS")`. On error → empty string (`unwrap_or_default()`).
3. Call `is_origin_allowed(&origin, &allowed_origins)`.
   - If not allowed → return `Action::Continue` (no CORS headers added).
4. Read `:method` pseudo-header via `self.get_http_request_header(":method")`.
5. **If method is `OPTIONS`** (preflight):
   - Read `ALLOWED_METHODS` (default: `"GET, POST, PUT, DELETE, OPTIONS"`).
   - Read `Access-Control-Request-Headers` from request (default: `"Content-Type, Authorization"`).
   - Read `MAX_AGE` (default: `"86400"`).
   - Compute `effective_origin`: `"*"` if `allowed_origins == "*"`, else the exact origin value.
   - Build response headers:
     - `Access-Control-Allow-Origin`: `effective_origin`
     - `Access-Control-Allow-Methods`: `allow_methods`
     - `Access-Control-Allow-Headers`: mirrored from `Access-Control-Request-Headers`
     - `Access-Control-Max-Age`: `max_age`
     - `Content-Length`: `"0"`
     - `Vary: Origin` — only added when `effective_origin != "*"`
   - Call `self.send_http_response(204, headers, None)`.
   - Return `Action::Pause`.
6. **If method is not `OPTIONS`** → return `Action::Continue` (CORS headers added in response phase).

---

## Response Phase — `on_http_response_headers`

```rust
fn on_http_response_headers(&mut self, _: usize, _: bool) -> Action
```

Called when response headers arrive from origin, before sending to client.

### Control Flow

1. Read `Origin` header from the **request** via `self.get_http_request_header("Origin")`.
   - If absent or empty → return `Action::Continue`.
2. Read `ALLOWED_ORIGINS` env var via `env::var("ALLOWED_ORIGINS").unwrap_or_default()`. On error → empty string.
3. Call `is_origin_allowed(&origin, &allowed_origins)`.
   - If not allowed → return `Action::Continue`.
4. Compute `effective_origin`: `"*"` if `allowed_origins == "*"`, else the exact origin value.
5. Add `Access-Control-Allow-Origin: <effective_origin>` via `self.add_http_response_header`.
6. If `effective_origin != "*"` → add `Vary: Origin`.
7. If `EXPOSE_HEADERS` env var is set and non-empty → add `Access-Control-Expose-Headers: <value>`.
8. Return `Action::Continue`.

---

## Preflight Response Headers

| Header | Value | Condition |
|---|---|---|
| `Access-Control-Allow-Origin` | `effective_origin` | Always (preflight) |
| `Access-Control-Allow-Methods` | `ALLOWED_METHODS` env var or default | Always (preflight) |
| `Access-Control-Allow-Headers` | Mirrored from `Access-Control-Request-Headers` | Always (preflight) |
| `Access-Control-Max-Age` | `MAX_AGE` env var or `"86400"` | Always (preflight) |
| `Content-Length` | `"0"` | Always (preflight) |
| `Vary` | `"Origin"` | Only when `effective_origin != "*"` |

HTTP status for preflight response: `204`.

---

## Normal Response Headers (added by response phase)

| Header | Value | Condition |
|---|---|---|
| `Access-Control-Allow-Origin` | `effective_origin` | Always (when origin allowed) |
| `Vary` | `"Origin"` | Only when `effective_origin != "*"` |
| `Access-Control-Expose-Headers` | `EXPOSE_HEADERS` env var value | Only when env var is set and non-empty |

---

## Dependencies

```toml
[dependencies]
proxy-wasm = "0.2"
```

No additional dependencies. Uses `std::env` from the standard library.

---

## Cargo.toml

```toml
[workspace]

[package]
name = "cors"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib"]

[dependencies]
proxy-wasm = "0.2"
```

---

## Gotchas

- **`ALLOWED_ORIGINS` is optional but required for CORS to work**: When unset or empty, `is_origin_allowed` returns `false` for every origin — all requests pass through without CORS headers added. The filter is dormant. Browsers will block cross-origin access, but the proxy does not issue a `403` or modify requests. This is a silent passthrough, not an explicit rejection.
- **`Access-Control-Request-Headers` mirroring**: The preflight handler mirrors the client's `Access-Control-Request-Headers` back in `Access-Control-Allow-Headers`. If the header is absent, it falls back to `"Content-Type, Authorization"`. Ensure this default matches your application's actual headers.
- **`Vary: Origin` and shared caches**: When not using wildcard, `Vary: Origin` is added to both preflight and normal responses. This tells shared CDN caches that the response differs by `Origin` — omitting it can cause incorrect cached responses to be served to different origins.
- **Wildcard `"*"` does not send `Vary: Origin`**: When `ALLOWED_ORIGINS == "*"`, `effective_origin` is `"*"` and `Vary: Origin` is skipped. The response is identical for all origins.
- **Case-sensitive origin matching**: `is_origin_allowed` uses `==` comparison after `trim()`. Origins are compared exactly — `https://example.com` and `https://Example.com` are different.
- **No `Access-Control-Allow-Credentials`**: This example does not set `Access-Control-Allow-Credentials`. Credentialed requests (cookies, `Authorization` headers) require this header with value `"true"` and `Access-Control-Allow-Origin` must not be `"*"`.
- **`send_http_response` + `Action::Pause`**: The preflight path calls `send_http_response` then returns `Action::Pause`. The request is terminated — it does not reach the origin.
- **Response phase reads request headers**: `on_http_response_headers` calls `self.get_http_request_header("Origin")` — reading from the request during the response phase. This is valid in proxy-wasm.

---

## See Also

- proxy-wasm Rust SDK reference (HttpContext trait, `get_http_request_header`, `add_http_response_header`, `send_http_response`)
- FastEdge CDN app platform overview (proxy-wasm filter lifecycle)
- FastEdge environment variable configuration
- examples-cors-as reference (equivalent AssemblyScript implementation)
- examples-headers-rust reference (general header manipulation pattern)
