<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 4f748b10fa04226e76218e88195b6b1f02fce032
      updated: 2026-04-20
-->

# HTTP Call — CDN (Rust)

Makes asynchronous HTTP calls to external services with timeout handling using the proxy-wasm ABI.

---

## Overview

- **Pattern**: Dispatch an async HTTP call in `on_http_request_headers`, pause the request with `Action::Pause`, handle the response in `on_http_call_response`, then resume or reset the original request.
- **App type**: CDN
- **Language**: Rust
- **Crate**: `proxy-wasm = "0.2"`

---

## Cargo.toml

```toml
[package]
name = "http_call"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib"]

[dependencies]
log = "0.4"
proxy-wasm = "0.2"
```

---

## Entry Point

```rust
proxy_wasm::main! {{
    proxy_wasm::set_log_level(LogLevel::Trace);
    proxy_wasm::set_root_context(|_| -> Box<dyn RootContext> { Box::new(HttpHeadersRoot) });
}}
```

---

## Context Hierarchy

| Struct | Traits | Role |
|---|---|---|
| `HttpHeadersRoot` | `Context`, `RootContext` | Factory — creates `HttpHeaders` per request |
| `HttpHeaders` | `Context`, `HttpContext` | Per-request handler — dispatches call, handles response |

`HttpHeadersRoot::get_type()` returns `Some(ContextType::HttpContext)`.

---

## State Tracking

```rust
struct HttpHeaders {
    state: u32,
}
```

- `state == 0`: HTTP call not yet completed
- `state == 1`: HTTP call response received successfully

State persists across hook invocations within the same request context. Used to distinguish first-time entry into `on_http_request_headers` (dispatch needed) from re-entry after resume.

---

## API: Dispatching an HTTP Call

### `dispatch_http_call`

```rust
fn dispatch_http_call(
    upstream: &str,
    headers: Vec<(&str, &str)>,
    body: Option<&[u8]>,
    trailers: Vec<(&str, &str)>,
    timeout: Duration,
) -> Result<u32, Status>
```

| Parameter | Type | Description |
|---|---|---|
| `upstream` | `&str` | Upstream cluster name (e.g. `"httpbin.org"`) |
| `headers` | `Vec<(&str, &str)>` | Request headers including required pseudo-headers |
| `body` | `Option<&[u8]>` | Optional request body |
| `trailers` | `Vec<(&str, &str)>` | Optional trailers (pass `vec![]` if none) |
| `timeout` | `Duration` | Call timeout — use `Duration::from_millis()` |

**Returns**: `Ok(token_id: u32)` on success; `Err(Status)` on failure.

The returned `token_id` correlates the dispatch to its `on_http_call_response` callback.

### Required Pseudo-Headers

The `headers` vec must include these pseudo-headers:

```rust
vec![
    (":scheme", "https"),
    (":authority", "httpbin.org"),
    (":path", "/ip"),
    ("User-Agent", "fastedge"),  // custom header example
]
```

| Pseudo-header | Required | Description |
|---|---|---|
| `:scheme` | Yes | Protocol (`"https"` or `"http"`) |
| `:authority` | Yes | Host (must match `upstream` argument) |
| `:path` | Yes | Request path |

---

## API: Handling the Response

### `on_http_call_response`

Implement on `Context` (not `HttpContext`):

```rust
fn on_http_call_response(
    &mut self,
    token_id: u32,
    num_headers: usize,
    body_size: usize,
    _num_trailers: usize,
)
```

| Parameter | Description |
|---|---|
| `token_id` | Matches the `u32` returned by `dispatch_http_call` |
| `num_headers` | Number of response headers; `0` indicates the call failed |
| `body_size` | Size of response body in bytes |
| `num_trailers` | Number of response trailers |

**Failure condition**: If `num_headers == 0`, the HTTP call failed (timeout, network error, etc.).

### Reading Response Data

```rust
// Single header by name
let value: Option<String> = self.get_http_call_response_header("user-agent");

// All headers as strings
let headers: Vec<(String, String)> = self.get_http_call_response_headers();

// All headers as raw bytes
let headers_bytes: Vec<(String, Vec<u8>)> = self.get_http_call_response_headers_bytes();

// Body slice
let body: Option<Vec<u8>> = self.get_http_call_response_body(0, body_size);
```

---

## API: Flow Control

### `resume_http_request`

```rust
self.resume_http_request();
```

Resumes the paused original HTTP request after the async call completes successfully. Call from within `on_http_call_response` when `num_headers != 0`.

Alternatively, use `self.resume_http_response()` if pausing during a response phase.

### `reset_http_request`

```rust
self.reset_http_request();
```

Resets (cancels) the original HTTP request. Call from within `on_http_call_response` when `num_headers == 0` (call failed).

---

## API: Sending an Error Response

```rust
self.send_http_response(
    status_code: u32,
    headers: Vec<(&str, &str)>,
    body: Option<&[u8]>,
);
```

Used in `on_http_request_headers` when `dispatch_http_call` returns `Err(status)`.

---

## Status to HTTP Status Code Mapping

```rust
fn to_status_code(status: Status) -> u32 {
    match status {
        Status::Ok               => 200,
        Status::NotFound         => 404,
        Status::BadArgument      => 400,
        Status::SerializationFailure => 500,
        Status::ParseFailure     => 400,
        Status::Empty            => 204,
        Status::CasMismatch      => 409,
        Status::InternalFailure  => 500,
        _                        => 500,
    }
}
```

---

## Complete Request Flow

```
on_http_request_headers
  └─ state == 0
       ├─ dispatch_http_call(...)
       │    ├─ Ok(token_id)  → return Action::Pause
       │    └─ Err(status)   → send_http_response(to_status_code(status), ...) → return Action::Pause
       └─ state == 1  → return Action::Continue

on_http_call_response(token_id, num_headers, body_size, _)
  ├─ num_headers != 0
  │    ├─ read headers / body
  │    ├─ state = 1
  │    └─ resume_http_request()
  └─ num_headers == 0
       └─ reset_http_request()
```

---

## Gotchas

- `Action::Pause` must be returned from `on_http_request_headers` after dispatching — failing to pause allows the request to proceed before the async response arrives.
- State must be tracked in struct fields (e.g. `state: u32`) because `on_http_call_response` and `on_http_request_headers` execute in separate hook invocations on the same context instance.
- `timeout` uses `Duration::from_millis()`; passing zero may cause immediate failure depending on runtime behavior.
- The callback `on_http_call_response` is defined on the `Context` trait, not `HttpContext` — implement it on the per-request struct, not the root context.
- `num_headers == 0` is the only reliable signal for call failure; do not rely on `body_size` or `token_id` for failure detection.
- `:authority` in headers must match the `upstream` argument passed to `dispatch_http_call`.

---

## See Also

- proxy-wasm Rust SDK reference (traits: Context, RootContext, HttpContext)
- CDN app scaffold blueprint
- FastEdge platform overview
- FastEdge error codes reference
