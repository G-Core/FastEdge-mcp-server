<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 6347a7c2fda0d03e66f1214db5eec041c16801b7
      updated: 2026-08-20
-->

---
type: example
app_type: cdn
languages: [rust]
capabilities: [body-inspection, body-modification, request-body, response-body, cross-hook-state, property-store, chunked-encoding]
---

# CDN Body Inspection and Modification — Rust

## Overview

Demonstrates request and response body inspection and modification using the `proxy-wasm` CDN filter model. Shows the buffering pattern required to accumulate a complete body before inspection, header/body hook coordination, and cross-hook state via the property store.

## Crate Dependencies

```toml
[dependencies]
log = "0.4"
proxy-wasm = "0.2"
```

Crate type must be `cdylib`.

## Entry Point

```rust
proxy_wasm::main! {{
    proxy_wasm::set_log_level(LogLevel::Trace);
    proxy_wasm::set_root_context(|_| -> Box<dyn RootContext> { Box::new(HttpBodyRoot) });
}}
```

- `set_root_context` registers the factory.
- `get_type()` must return `Some(ContextType::HttpContext)` for HTTP/CDN filter use.
- `create_http_context` returns a new `HttpBody` instance per request.

## Request Body Handling

### Hook: `on_http_request_headers`

```rust
fn on_http_request_headers(&mut self, _: usize, _: bool) -> Action {
    self.set_http_request_header("content-length", None);
    Action::Continue
}
```

- Removes `content-length` before body buffering begins.
- **Required**: if `content-length` is present and the body is later modified to a different size, the header becomes incorrect. Remove it proactively.

### Hook: `on_http_request_body`

```rust
fn on_http_request_body(&mut self, body_size: usize, end_of_stream: bool) -> Action {
    if !end_of_stream {
        return Action::Pause;
    }
    if let Some(body_bytes) = self.get_http_request_body(0, body_size) {
        let body_str = String::from_utf8(body_bytes).unwrap();
        if body_str.contains("Client") {
            let new_body =
                format!("Client's original message body ({body_size} bytes) redacted.\n");
            self.set_http_request_body(0, body_size, &new_body.into_bytes());
        }
    }
    Action::Continue
}
```

**Buffering pattern**:
- Return `Action::Pause` until `end_of_stream == true`. The host buffers incoming chunks and re-invokes the hook when the full body is available.
- Do not attempt to read or modify a partial body — `get_http_request_body` may return incomplete data.

**`get_http_request_body(start: usize, max_bytes: usize) -> Option<Vec<u8>>`**:
- `start`: byte offset into buffered body.
- `max_bytes`: maximum bytes to retrieve; pass `body_size` to read the full buffer.
- Returns `None` if no body is buffered.

**`set_http_request_body(start: usize, size: usize, value: &[u8])`**:
- `start`: offset at which to begin replacement.
- `size`: number of bytes from the buffer to replace (use original `body_size` to replace the entire body).
- `value`: replacement bytes; length does not need to match `size`.

**Constraints**:
- UTF-8 conversion via `String::from_utf8` will panic on non-UTF-8 bodies. Use `from_utf8_lossy` or validate content-type before conversion in production code.
- Body buffering consumes host-side memory proportional to body size. Large bodies increase memory pressure.

## Response Body Handling

### Hook: `on_http_response_headers`

```rust
fn on_http_response_headers(&mut self, _: usize, _: bool) -> Action {
    self.set_http_response_header("content-length", None);
    self.set_http_response_header("transfer-encoding", Some("Chunked"));

    if let Some(content_type) = self.get_http_response_header("content-type") {
        self.set_property(vec!["response.content_type"], Some(content_type.as_bytes()));
    }

    Action::Continue
}
```

- Removes `content-length` (body size will change).
- Sets `transfer-encoding: Chunked` since the final body length is unknown at header time.
- Captures `content-type` into the property store for use in `on_http_response_body`. **This is the cross-hook state pattern** — response headers are not accessible from within the body hook directly.

### Hook: `on_http_response_body`

```rust
fn on_http_response_body(&mut self, body_size: usize, end_of_stream: bool) -> Action {
    if !end_of_stream {
        return Action::Pause;
    }

    let url = if let Some(value) = self.get_property(vec!["request.url"]) {
        let url = String::from_utf8_lossy(&value);
        info!("url={}", url);
        url.to_string()
    } else {
        "".to_string()
    };

    let content_type =
        if let Some(content_type) = self.get_property(vec!["response.content_type"]) {
            let content_type = String::from_utf8_lossy(&content_type);
            info!("content_type={}", content_type);
            content_type.to_string()
        } else {
            "NONE".to_string()
        };

    if let Some(body_bytes) = self.get_http_response_body(0, body_size) {
        let body_str = String::from_utf8(body_bytes).unwrap();
        if body_str.contains("Client") {
            let new_body =
                format!("Original message body ({body_size} bytes) redacted.\nURL: {url}\nContent-Type: {content_type}\n");
            self.set_http_response_body(0, body_size, &new_body.into_bytes());
        }
    }
    Action::Continue
}
```

Same buffering pattern as request body. Identical `Action::Pause` guard on `!end_of_stream`.

**`get_http_response_body(start: usize, max_bytes: usize) -> Option<Vec<u8>>`**:
- Same semantics as `get_http_request_body`.

**`set_http_response_body(start: usize, size: usize, value: &[u8])`**:
- Same semantics as `set_http_request_body`.

## Cross-Hook State via Property Store

The property store bridges data between hooks that execute at different pipeline phases.

**`set_property(path: Vec<&str>, value: Option<&[u8]>)`**:
- `path`: namespaced key as a string vector (e.g., `vec!["response.content_type"]`).
- `value`: raw bytes, or `None` to delete.
- Called from `on_http_response_headers` to store header values before headers become inaccessible.

**`get_property(path: Vec<&str>) -> Option<Vec<u8>>`**:
- Returns raw bytes; convert with `String::from_utf8_lossy` for string values.
- Returns `None` if the key was never set or was deleted.

**Built-in property**: `request.url` is a host-provided property accessible from the response body hook. No explicit set required.

## Hook Execution Order

```
on_http_request_headers   → remove content-length
on_http_request_body      → pause until end_of_stream; inspect/modify
on_http_response_headers  → remove content-length; set chunked; store content-type
on_http_response_body     → pause until end_of_stream; read stored properties; inspect/modify
```

## Gotchas

| Issue | Detail |
|---|---|
| Partial body reads | Always return `Action::Pause` until `end_of_stream == true`. Partial bodies are incomplete and unreliable. |
| `content-length` mismatch | Remove in the corresponding header hook before body modification. Failure causes downstream protocol errors. |
| UTF-8 assumption | `String::from_utf8(...).unwrap()` panics on binary bodies. Guard with content-type check or use `from_utf8_lossy`. |
| Memory pressure | Buffering pauses streaming; full body held in host memory. Avoid for very large bodies. |
| Property store key collisions | Use namespaced keys (e.g., `response.content_type`) to avoid conflicts with host-provided properties. |
| Chunked encoding | Must set `transfer-encoding: Chunked` in response headers when body size will change and `content-length` is removed. |

## See Also

- examples-headers-rust (CDN header manipulation patterns)
- examples-body-http-rust (HTTP context body modification)
- sdk-reference-rust (full proxy-wasm trait and type reference)
- host-services-rust (property store and built-in property reference)

## Source Material

### FILE: examples/cdn/body/src/lib.rs

```rust
use log::info;
use proxy_wasm::traits::*;
use proxy_wasm::types::*;

proxy_wasm::main! {{
    proxy_wasm::set_log_level(LogLevel::Trace);
    proxy_wasm::set_root_context(|_| -> Box<dyn RootContext> { Box::new(HttpBodyRoot) });
}}

struct HttpBodyRoot;

impl Context for HttpBodyRoot {}

impl RootContext for HttpBodyRoot {
    fn get_type(&self) -> Option<ContextType> {
        Some(ContextType::HttpContext)
    }

    fn create_http_context(&self, _: u32) -> Option<Box<dyn HttpContext>> {
        Some(Box::new(HttpBody))
    }
}

struct HttpBody;

impl Context for HttpBody {}

impl HttpContext for HttpBody {
    fn on_http_request_headers(&mut self, _: usize, _: bool) -> Action {
        self.set_http_request_header("content-length", None);
        Action::Continue
    }

    fn on_http_request_body(&mut self, body_size: usize, end_of_stream: bool) -> Action {
        if !end_of_stream {
            // Wait -- we'll be called again when the complete body is buffered
            // at the host side.
            return Action::Pause;
        }

        if let Some(body_bytes) = self.get_http_request_body(0, body_size) {
            let body_str = String::from_utf8(body_bytes).unwrap();
            if body_str.contains("Client") {
                let new_body =
                    format!("Client's original message body ({body_size} bytes) redacted.\n");
                self.set_http_request_body(0, body_size, &new_body.into_bytes());
            }
        }
        Action::Continue
    }

    fn on_http_response_headers(&mut self, _: usize, _: bool) -> Action {
        // remove content-length as we plan to change the body size
        self.set_http_response_header("content-length", None);
        // set transfer-encoding to chunked as we don't know body length
        self.set_http_response_header("transfer-encoding", Some("Chunked"));

        if let Some(content_type) = self.get_http_response_header("content-type") {
            self.set_property(vec!["response.content_type"], Some(content_type.as_bytes()));
        }

        Action::Continue
    }

    fn on_http_response_body(&mut self, body_size: usize, end_of_stream: bool) -> Action {
        if !end_of_stream {
            return Action::Pause;
        }

        let url = if let Some(value) = self.get_property(vec!["request.url"]) {
            let url = String::from_utf8_lossy(&value);
            info!("url={}", url);
            url.to_string()
        } else {
            "".to_string()
        };

        let content_type =
            if let Some(content_type) = self.get_property(vec!["response.content_type"]) {
                let content_type = String::from_utf8_lossy(&content_type);
                info!("content_type={}", content_type);
                content_type.to_string()
            } else {
                "NONE".to_string()
            };

        if let Some(body_bytes) = self.get_http_response_body(0, body_size) {
            let body_str = String::from_utf8(body_bytes).unwrap();
            if body_str.contains("Client") {
                let new_body =
                    format!("Original message body ({body_size} bytes) redacted.\nURL: {url}\nContent-Type: {content_type}\n");
                self.set_http_response_body(0, body_size, &new_body.into_bytes());
            }
        }
        Action::Continue
    }
}
```

### FILE: examples/cdn/body/Cargo.toml

```toml
[workspace]

[package]
name = "body"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib"]

[dependencies]
log = "0.4"
proxy-wasm = "0.2"
```
