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
app_type: cdn
languages:
  - rust
capabilities:
  - headers
  - request-headers
  - response-headers
  - header-manipulation
  - proxy-wasm
---

# Headers — CDN (Rust)

Validates and manipulates HTTP request and response headers using the proxy-wasm ABI. Demonstrates the full header manipulation API for both request and response phases, including read, add, replace, and remove operations with both string and byte variants.

## Crate

```
name: headers
edition: 2024
crate-type: ["cdylib"]
dependencies:
  proxy-wasm: "0.2"
```

## Structure

| Type | Role |
|---|---|
| `HttpHeadersRoot` | Root context; creates `HttpHeaders` per request |
| `HttpHeaders` | HTTP context; implements `on_http_request_headers` and `on_http_response_headers` |

## Entry Point

```rust
proxy_wasm::main! {
    proxy_wasm::set_log_level(LogLevel::Trace);
    proxy_wasm::set_root_context(|_| -> Box<dyn RootContext> { Box::new(HttpHeadersRoot) });
}
```

`HttpHeadersRoot::get_type()` returns `Some(ContextType::HttpContext)`.

---

## API Reference

### Read — All Headers

| Method | Phase | Return type | Description |
|---|---|---|---|
| `get_http_request_headers()` | request | `Vec<(String, String)>` | All request headers as string pairs |
| `get_http_request_headers_bytes()` | request | `Vec<(String, Bytes)>` | All request headers with byte values |
| `get_http_response_headers()` | response | `Vec<(String, String)>` | All response headers as string pairs |
| `get_http_response_headers_bytes()` | response | `Vec<(String, Bytes)>` | All response headers with byte values |

### Read — Single Header

| Method | Phase | Return type | Description |
|---|---|---|---|
| `get_http_request_header(name: &str)` | request | `Option<String>` | Single request header by name |
| `get_http_request_header_bytes(name: &str)` | request | `Option<Bytes>` | Single request header by name, byte value |
| `get_http_response_header(name: &str)` | request or response | `Option<String>` | Single response header by name |
| `get_http_response_header_bytes(name: &str)` | request or response | `Option<Bytes>` | Single response header by name, byte value |

### Write — Add (Append)

| Method | Phase | Description |
|---|---|---|
| `add_http_request_header(name: &str, value: &str)` | request | Appends a request header; allows duplicate names |
| `add_http_request_header_bytes(name: &str, value: &[u8])` | request | Appends a request header with byte value; allows duplicates |
| `add_http_response_header(name: &str, value: &str)` | request or response | Appends a response header; allows duplicate names |
| `add_http_response_header_bytes(name: &str, value: &[u8])` | request or response | Appends a response header with byte value; allows duplicates |

### Write — Set (Replace or Remove)

| Method | Phase | `value` | Effect |
|---|---|---|---|
| `set_http_request_header(name, Some(value))` | request | `Some(&str)` | Replaces existing request header value |
| `set_http_request_header(name, None)` | request | `None` | Removes request header (sets to empty string — see Gotchas) |
| `set_http_request_header_bytes(name, Some(value))` | request | `Some(&[u8])` | Replaces existing request header value as bytes |
| `set_http_request_header_bytes(name, None)` | request | `None` | Removes request header (sets to empty bytes — see Gotchas) |
| `set_http_response_header(name, Some(value))` | request or response | `Some(&str)` | Replaces existing response header value |
| `set_http_response_header(name, None)` | request or response | `None` | Removes response header (sets to empty string — see Gotchas) |
| `set_http_response_header_bytes(name, Some(value))` | request or response | `Some(&[u8])` | Replaces existing response header value as bytes |
| `set_http_response_header_bytes(name, None)` | request or response | `None` | Removes response header (sets to empty bytes — see Gotchas) |

---

## Lifecycle Hooks

### `on_http_request_headers`

Called when request headers are received.

Operations performed (in order):
1. Read all request headers via `get_http_request_headers()` and `get_http_request_headers_bytes()` into `HashSet` snapshots.
2. Assert headers are non-empty; send `550` and pause if empty.
3. Check `host` header presence via `get_http_request_header("host")` and `get_http_request_header_bytes("host")`; send `551` and pause if absent.
4. Add three new request headers using `add_http_request_header` / `add_http_request_header_bytes`.
5. Remove `new-header-01` / `new-header-bytes-01` via `set_...(name, None)`.
6. Replace `new-header-02` / `new-header-bytes-02` values via `set_...(name, Some(...))`.
7. Append duplicate `new-header-03` / `new-header-bytes-03` via `add_...`.
8. Pre-stage response headers in the request phase: `add_http_response_header("new-response-header", "value-01")`, `set_http_response_header("cache-control", None)`, `set_http_response_header("new-response-header", Some("value-02"))`.
9. Diff current headers against the original snapshot; assert only expected new headers are present; send `552` and pause if unexpected diff.
10. Assert `get_http_response_header("host")` and `get_http_response_header_bytes("host")` both return `None` (upstream response host is not available during request phase); send `553` and pause if either returns `Some`.
11. Assert `get_http_response_headers()` returns exactly one entry (`new-response-header: value-02`); send `555` and pause if count is not 1 or entry is not present; send `556` and pause if name or value does not match.
12. Return `Action::Continue`.

### `on_http_response_headers`

Called when response headers are received.

Operations performed (in order):
1. Read all response headers into `HashSet` snapshots via `get_http_response_headers()` and `get_http_response_headers_bytes()`.
2. Assert headers non-empty; send `550` and pause if empty.
3. Check `host` header presence via `get_http_response_header("host")` and `get_http_response_header_bytes("host")`; send `551` and pause if absent.
4. Add `new-header-01..03` (string and byte variants).
5. Remove `new-header-01` / `new-header-bytes-01`.
6. Replace `new-header-02` / `new-header-bytes-02`.
7. Append duplicate `new-header-03` / `new-header-bytes-03`.
8. Diff current response headers against original snapshot; assert diff equals expected set exactly; send `552` and pause on mismatch.
9. Return `Action::Continue`.

### `on_log`

```rust
fn on_log(&mut self) {
    println!("#{} completed.", self.context_id);
}
```

Logs completion for the context ID.

---

## Common Patterns

### Iterate all request headers

```rust
for (name, value) in self.get_http_request_headers() {
    println!("#{} -> {}: {}", self.context_id, name, value);
}
```

### Check header presence

```rust
if self.get_http_request_header("host").is_none() {
    self.send_http_response(551, vec![], None);
    return Action::Pause;
}
```

### Add a header (allows duplicates)

```rust
self.add_http_request_header("x-custom", "value");
self.add_http_request_header_bytes("x-custom-bytes", b"value");
```

### Replace a header value

```rust
self.set_http_request_header("x-custom", Some("new-value"));
self.set_http_request_header_bytes("x-custom-bytes", Some(b"new-value"));
```

### Remove a header

```rust
self.set_http_request_header("x-custom", None);
self.set_http_request_header_bytes("x-custom-bytes", None);
// Note: value becomes empty string/bytes, not truly absent — see Gotchas
```

### Snapshot headers for diffing

```rust
let original: HashSet<(String, String)> = self
    .get_http_request_headers()
    .into_iter()
    .collect();
```

---

## Error Codes

| Code | Phase | Condition |
|---|---|---|
| `550` | request or response | No headers returned from `get_http_*_headers()` |
| `551` | request or response | `host` header absent from `get_http_*_header("host")` |
| `552` | request or response | Header diff contains unexpected entries |
| `553` | request | `get_http_response_header("host")` or `get_http_response_header_bytes("host")` returns `Some` during request phase (upstream response host must not be available) |
| `555` | request | Response headers list count not exactly 1 (from `get_http_response_headers()`) |
| `556` | request | Response header name/value mismatch (expected `new-response-header: value-02`) |

All error paths return `Action::Pause`.

---

## Gotchas

- **Remove does not truly delete**: `set_http_request_header(name, None)` and `set_http_response_header(name, None)` set the header value to an empty string (or empty `Bytes`), not a true removal. When checking for header absence, test for both `None` return from `get_http_*_header` and an empty-string value.
- **`add_` allows duplicate names**: `add_http_request_header` and `add_http_response_header` append a new header entry regardless of whether a header with that name already exists. Use `set_` to replace.
- **`set_` replaces all**: `set_http_*_header(name, Some(value))` replaces the header value, collapsing any duplicates.
- **Response headers in request phase — limited availability**: `add_http_response_header` and `set_http_response_header` can be called during `on_http_request_headers` and the pre-staged values are readable via `get_http_response_headers()` in the same phase. However, `get_http_response_header("host")` returns `None` during the request phase — the upstream response host header is not accessible until `on_http_response_headers`.
- **`_bytes` variants are symmetric**: Every string header API has a `_bytes` counterpart accepting/returning `&[u8]` / `Bytes`. Behavior and constraints are identical.
- **Log level**: `LogLevel::Trace` is set at startup; all `println!` output appears in trace logs.

---

## See Also

- proxy-wasm HttpContext trait reference
- FastEdge CDN app scaffolding (scaffold skill, cdn blueprints)
- examples-body-cdn-rust (body manipulation API)
- examples-shared-data-cdn-rust (shared data API)
- host-services-rust reference (full ABI surface)

## Source Material

### FILE: examples/cdn/headers/src/lib.rs

```rust
use proxy_wasm::traits::*;
use proxy_wasm::types::*;
use std::collections::HashSet;

proxy_wasm::main! {{
    proxy_wasm::set_log_level(LogLevel::Trace);
    proxy_wasm::set_root_context(|_| -> Box<dyn RootContext> { Box::new(HttpHeadersRoot) });
}}

struct HttpHeadersRoot;

impl Context for HttpHeadersRoot {}

impl RootContext for HttpHeadersRoot {
    fn create_http_context(&self, context_id: u32) -> Option<Box<dyn HttpContext>> {
        Some(Box::new(HttpHeaders { context_id }))
    }

    fn get_type(&self) -> Option<ContextType> {
        Some(ContextType::HttpContext)
    }
}

struct HttpHeaders {
    context_id: u32,
}

impl Context for HttpHeaders {}

impl HttpContext for HttpHeaders {
    fn on_http_request_headers(&mut self, _: usize, _: bool) -> Action {
        let mut original_headers = HashSet::new();
        let mut original_headers_bytes = HashSet::new();

        // iterate over the headers and print them
        for (name, value) in self.get_http_request_headers().into_iter() {
            println!("#{} -> {}: {}", self.context_id, name, value);
            original_headers.insert((name, value));
        }
        for (name, value) in self.get_http_request_headers_bytes().into_iter() {
            println!("#{} -> {}: {:?}", self.context_id, name, value);
            original_headers_bytes.insert((name, value));
        }
        if original_headers.is_empty() || original_headers_bytes.is_empty() {
            self.send_http_response(550, vec![], None);
            return Action::Pause;
        }

        // check if the host header is present
        if self.get_http_request_header("host").is_none() {
            self.send_http_response(551, vec![], None);
            return Action::Pause;
        }
        if self.get_http_request_header_bytes("host").is_none() {
            self.send_http_response(551, vec![], None);
            return Action::Pause;
        }

        // add new headers
        self.add_http_request_header("new-header-01", "value-01");
        self.add_http_request_header_bytes("new-header-bytes-01", b"value-bytes-01");

        self.add_http_request_header("new-header-02", "value-02");
        self.add_http_request_header_bytes("new-header-bytes-02", b"value-bytes-02");

        self.add_http_request_header("new-header-03", "value-03");
        self.add_http_request_header_bytes("new-header-bytes-03", b"value-bytes-03");

        //remove header new-headter-01, expected empty value
        self.set_http_request_header("new-header-01", None);
        self.set_http_request_header_bytes("new-header-bytes-01", None);

        // changing header value
        self.set_http_request_header("new-header-02", Some("new-value-02"));
        self.set_http_request_header_bytes("new-header-bytes-02", Some(b"new-value-bytes-02"));

        // add new header with existing name
        self.add_http_request_header("new-header-03", "value-03-a");
        self.add_http_request_header_bytes("new-header-bytes-03", b"value-bytes-03-a");

        // try to set/add response headers
        self.add_http_response_header("new-response-header", "value-01");
        self.set_http_response_header("cache-control", None);
        self.set_http_response_header("new-response-header", Some("value-02"));

        // get new headers
        let headers = self
            .get_http_request_headers()
            .into_iter()
            .collect::<HashSet<(String, String)>>();
        let headers_bytes = self
            .get_http_request_headers_bytes()
            .into_iter()
            .collect::<HashSet<(String, Bytes)>>();

        let expected = [
            ("new-header-01".to_string(), "".to_string()),
            ("new-header-bytes-01".to_string(), "".to_string()),
            ("new-header-02".to_string(), "new-value-02".to_string()),
            (
                "new-header-bytes-02".to_string(),
                "new-value-bytes-02".to_string(),
            ),
            ("new-header-03".to_string(), "value-03".to_string()),
            (
                "new-header-bytes-03".to_string(),
                "value-bytes-03".to_string(),
            ),
            ("new-header-03".to_string(), "value-03-a".to_string()),
            (
                "new-header-bytes-03".to_string(),
                "value-bytes-03-a".to_string(),
            ),
        ];

        let expected = expected.iter().collect::<HashSet<_>>();

        let expected_bytes = [
            ("new-header-01".to_string(), b"".to_vec()),
            ("new-header-bytes-01".to_string(), b"".to_vec()),
            ("new-header-02".to_string(), b"new-value-02".to_vec()),
            (
                "new-header-bytes-02".to_string(),
                b"new-value-bytes-02".to_vec(),
            ),
            ("new-header-03".to_string(), b"value-03".to_vec()),
            (
                "new-header-bytes-03".to_string(),
                b"value-bytes-03".to_vec(),
            ),
            ("new-header-03".to_string(), b"value-03-a".to_vec()),
            (
                "new-header-bytes-03".to_string(),
                b"value-bytes-03-a".to_vec(),
            ),
        ];

        let expected_bytes = expected_bytes.iter().collect::<HashSet<_>>();

        let diff = headers
            .difference(&original_headers)
            .collect::<HashSet<_>>();

        let diff_bytes = headers_bytes
            .difference(&original_headers_bytes)
            .collect::<HashSet<_>>();

        let diff = diff.difference(&expected).collect::<Vec<_>>();

        if !diff.is_empty() {
            println!("different headers: {:?}", diff);
            self.send_http_response(552, vec![], None);
            return Action::Pause;
        }

        let diff_bytes = diff_bytes.difference(&expected_bytes).collect::<Vec<_>>();
        if !diff_bytes.is_empty() {
            println!("different headers bytes: {:?}", diff_bytes);
            self.send_http_response(552, vec![], None);
            return Action::Pause;
        }

        // check if the response header is not returned
        if self.get_http_response_header("host").is_some() {
            self.send_http_response(553, vec![], None);
            return Action::Pause;
        };
        if self.get_http_response_header_bytes("host").is_some() {
            self.send_http_response(553, vec![], None);
            return Action::Pause;
        };

        let response_headers = self.get_http_response_headers();
        if response_headers.len() != 1 {
            self.send_http_response(555, vec![], None);
            return Action::Pause;
        }
        let Some((name, value)) = response_headers.into_iter().next() else {
            self.send_http_response(555, vec![], None);
            return Action::Pause;
        };
        if name != "new-response-header" || value != "value-02" {
            self.send_http_response(556, vec![], None);
            return Action::Pause;
        }

        Action::Continue
    }

    fn on_http_response_headers(&mut self, _: usize, _: bool) -> Action {
        let mut original_headers = HashSet::new();
        let mut original_headers_bytes = HashSet::new();

        // iterate over the headers and print them
        for (name, value) in self.get_http_response_headers().into_iter() {
            println!("#{} -> {}: {}", self.context_id, name, value);
            original_headers.insert((name, value));
        }
        for (name, value) in self.get_http_response_headers_bytes().into_iter() {
            println!("#{} -> {}: {:?}", self.context_id, name, value);
            original_headers_bytes.insert((name, value));
        }
        if original_headers.is_empty() || original_headers_bytes.is_empty() {
            self.send_http_response(550, vec![], None);
            return Action::Pause;
        }

        // check if the host header is present
        if self.get_http_response_header("host").is_none() {
            self.send_http_response(551, vec![], None);
            return Action::Pause;
        }
        if self.get_http_response_header_bytes("host").is_none() {
            self.send_http_response(551, vec![], None);
            return Action::Pause;
        }

        // add new headers
        self.add_http_response_header("new-header-01", "value-01");
        self.add_http_response_header_bytes("new-header-bytes-01", b"value-bytes-01");

        self.add_http_response_header("new-header-02", "value-02");
        self.add_http_response_header_bytes("new-header-bytes-02", b"value-bytes-02");

        self.add_http_response_header("new-header-03", "value-03");
        self.add_http_response_header_bytes("new-header-bytes-03", b"value-bytes-03");

        //remove header new-headter-01, expected empty value
        self.set_http_response_header("new-header-01", None);
        self.set_http_response_header_bytes("new-header-bytes-01", None);

        // changing header value
        self.set_http_response_header("new-header-02", Some("new-value-02"));
        self.set_http_response_header_bytes("new-header-bytes-02", Some(b"new-value-bytes-02"));

        // add new header with existing name
        self.add_http_response_header("new-header-03", "value-03-a");
        self.add_http_response_header_bytes("new-header-bytes-03", b"value-bytes-03-a");

        // get new headers
        let headers = self
            .get_http_response_headers()
            .into_iter()
            .collect::<HashSet<(String, String)>>();
        let headers_bytes = self
            .get_http_response_headers_bytes()
            .into_iter()
            .collect::<HashSet<(String, Bytes)>>();

        let expected = [
            ("new-header-01".to_string(), "".to_string()),
            ("new-header-bytes-01".to_string(), "".to_string()),
            ("new-header-02".to_string(), "new-value-02".to_string()),
            (
                "new-header-bytes-02".to_string(),
                "new-value-bytes-02".to_string(),
            ),
            ("new-header-03".to_string(), "value-03".to_string()),
            (
                "new-header-bytes-03".to_string(),
                "value-bytes-03".to_string(),
            ),
            ("new-header-03".to_string(), "value-03-a".to_string()),
            (
                "new-header-bytes-03".to_string(),
                "value-bytes-03-a".to_string(),
            ),
        ];

        let expected = expected.iter().collect::<HashSet<_>>();

        let expected_bytes = [
            ("new-header-01".to_string(), b"".to_vec()),
            ("new-header-bytes-01".to_string(), b"".to_vec()),
            ("new-header-02".to_string(), b"new-value-02".to_vec()),
            (
                "new-header-bytes-02".to_string(),
                b"new-value-bytes-02".to_vec(),
            ),
            ("new-header-03".to_string(), b"value-03".to_vec()),
            (
                "new-header-bytes-03".to_string(),
                b"value-bytes-03".to_vec(),
            ),
            ("new-header-03".to_string(), b"value-03-a".to_vec()),
            (
                "new-header-bytes-03".to_string(),
                b"value-bytes-03-a".to_vec(),
            ),
        ];

        let expected_bytes = expected_bytes.iter().collect::<HashSet<_>>();

        let diff = headers
            .difference(&original_headers)
            .collect::<HashSet<_>>();

        let diff_bytes = headers_bytes
            .difference(&original_headers_bytes)
            .collect::<HashSet<_>>();

        let diff = diff.difference(&expected).collect::<Vec<_>>();

        if !diff.is_empty() {
            println!("different headers: {:?}", diff);
            self.send_http_response(552, vec![], None);
            return Action::Pause;
        }

        let diff_bytes = diff_bytes.difference(&expected_bytes).collect::<Vec<_>>();
        if !diff_bytes.is_empty() {
            println!("different headers bytes: {:?}", diff_bytes);
            self.send_http_response(552, vec![], None);
            return Action::Pause;
        }

        Action::Continue
    }
}
```

### FILE: examples/cdn/headers/Cargo.toml

```toml
[workspace]

[package]
name = "headers"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib"]

[dependencies]
proxy-wasm = "0.2"
```

### FILE: examples/cdn/headers/README.md

```
[← Back to examples](../../README.md)

# Headers (CDN)

Validates and manipulates HTTP request and response headers using the proxy-wasm ABI.
```
