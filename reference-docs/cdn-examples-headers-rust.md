<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 4f748b10fa04226e76218e88195b6b1f02fce032
      updated: 2026-04-20
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
3. Check `host` header presence via `get_http_request_header("host")`; send `551` and pause if absent.
4. Add three new request headers using `add_http_request_header` / `add_http_request_header_bytes`.
5. Remove `new-header-01` / `new-header-bytes-01` via `set_...(name, None)`.
6. Replace `new-header-02` / `new-header-bytes-02` values via `set_...(name, Some(...))`.
7. Append duplicate `new-header-03` / `new-header-bytes-03` via `add_...`.
8. Pre-stage response headers in the request phase: `add_http_response_header`, `set_http_response_header`.
9. Diff current headers against the original snapshot; assert only expected new headers are present; send `552` and pause if unexpected diff.
10. Read response headers via `get_http_response_header("host")`; assert value is present but empty (not truly absent); send `553`/`554` and pause on failure.
11. Assert response headers list has exactly one entry (`new-response-header: value-02`); send `555`/`556` and pause on failure.
12. Return `Action::Continue`.

### `on_http_response_headers`

Called when response headers are received.

Operations performed (in order):
1. Read all response headers into `HashSet` snapshots.
2. Assert headers non-empty; send `550` and pause if empty.
3. Check `host` header presence; send `551` and pause if absent.
4. Add `new-header-01..03` (string and byte variants).
5. Remove `new-header-01` / `new-header-bytes-01`.
6. Replace `new-header-02` / `new-header-bytes-02`.
7. Append duplicate `new-header-03` / `new-header-bytes-03`.
8. Diff current response headers against original snapshot; assert diff equals expected set exactly; send `552` and pause on mismatch.
9. Read `host` response header; assert value is present but empty; send `553`/`554` and pause on failure.
10. Assert response headers list is non-empty; send `555` and pause if empty.
11. Return `Action::Continue`.

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
| `553` | request | Response `host` header absent entirely |
| `554` | request | Response `host` header present but non-empty (should be empty) |
| `555` | request | Response headers list count not exactly 1 |
| `556` | request | Response header name/value mismatch (expected `new-response-header: value-02`) |
| `555` | response | Response headers list is empty |

All error paths return `Action::Pause`.

---

## Gotchas

- **Remove does not truly delete**: `set_http_request_header(name, None)` and `set_http_response_header(name, None)` set the header value to an empty string (or empty `Bytes`), not a true removal. When checking for header absence, test for both `None` return from `get_http_*_header` and an empty-string value.
- **`add_` allows duplicate names**: `add_http_request_header` and `add_http_response_header` append a new header entry regardless of whether a header with that name already exists. Use `set_` to replace.
- **`set_` replaces all**: `set_http_*_header(name, Some(value))` replaces the header value, collapsing any duplicates.
- **Response headers in request phase**: `add_http_response_header` and `set_http_response_header` can be called during `on_http_request_headers`. The pre-staged values are readable via `get_http_response_header` in the same phase, but the `host` response header will return a present-but-empty value rather than the actual upstream response host.
- **`_bytes` variants are symmetric**: Every string header API has a `_bytes` counterpart accepting/returning `&[u8]` / `Bytes`. Behavior and constraints are identical.
- **Log level**: `LogLevel::Trace` is set at startup; all `println!` output appears in trace logs.

---

## See Also

- proxy-wasm HttpContext trait reference
- FastEdge CDN app scaffolding (scaffold skill, cdn blueprints)
- examples-body-cdn-rust (body manipulation API)
- examples-shared-data-cdn-rust (shared data API)
- host-services-rust reference (full ABI surface)
