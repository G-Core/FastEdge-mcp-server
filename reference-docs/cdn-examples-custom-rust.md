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
capabilities: [request-headers, synthetic-response, path-parsing, delay]
---

# CDN Example: Custom — Rust

Returns HTTP status codes based on the request path, with optional delay support. Useful for testing and debugging CDN behaviour.

---

## Overview

This CDN filter reads the request path, parses it into ordered segments, and either:
- Returns a synthetic HTTP response with the specified status code and pauses the filter chain, or
- Passes the request through to origin.

An optional delay (milliseconds) may be specified as the second path segment.

---

## Crate Configuration

```toml
[package]
name = "custom"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib"]

[dependencies]
log = "0.4"
proxy-wasm = "0.2"
```

The crate must be compiled as a `cdylib` for WASM output.

---

## Entry Point

```rust
proxy_wasm::main! {{
    proxy_wasm::set_log_level(LogLevel::Trace);
    proxy_wasm::set_root_context(|_| -> Box<dyn RootContext> { Box::new(HttpHeadersRoot) });
}}
```

- Log level set to `Trace`.
- Root context factory returns `HttpHeadersRoot`.

---

## Structs and Trait Implementations

### `HttpHeadersRoot`

Implements `Context` and `RootContext`.

| Method | Signature | Returns | Notes |
|---|---|---|---|
| `create_http_context` | `(&self, _context_id: u32) -> Option<Box<dyn HttpContext>>` | `Some(Box::new(HttpHeaders))` | Creates one `HttpHeaders` instance per request |
| `get_type` | `(&self) -> Option<ContextType>` | `Some(ContextType::HttpContext)` | Declares this root as an HTTP context factory |

### `HttpHeaders`

Implements `Context` and `HttpContext`.

---

## Request Phase: `on_http_request_headers`

```rust
fn on_http_request_headers(&mut self, _: usize, _: bool) -> Action
```

Called on every incoming CDN request before forwarding to origin.

### Path Extraction

```rust
let Some(path) = self.get_property(vec!["request.path"]) else {
    self.send_http_response(BAD_REQUEST, vec![], Some(b"Malformed request - no path"));
    return Action::Pause;
};
```

- `get_property(vec!["request.path"])` returns `Option<Vec<u8>>`.
- If absent: sends 400 with body `"Malformed request - no path"`, returns `Action::Pause`.

### UTF-8 Decoding

```rust
let Ok(path) = std::str::from_utf8(&path) else {
    self.send_http_response(BAD_REQUEST, vec![], Some(b"Malformed request - not utf8 string"));
    return Action::Pause;
};
```

- If the path bytes are not valid UTF-8: sends 400 with body `"Malformed request - not utf8 string"`, returns `Action::Pause`.

### Leading Slash Trim

```rust
let path = if path.starts_with('/') { &path[1..] } else { path };
```

- `get_property(vec!["request.path"])` always includes the leading `/`. It must be trimmed before splitting.

### Segment Parsing

```rust
let mut segments = path.split('/');
let Some(status_code) = segments.next() else { return Action::Continue; };
```

- Path segments are extracted positionally via iterator `next()` — no indexing.
- **Segment 1** (required): status code string.
- **Segment 2** (optional): delay in milliseconds.

If no first segment is present: returns `Action::Continue` (pass-through).

### Optional Delay

```rust
if let Some(delay) = segments.next() {
    if let Ok(delay) = delay.parse::<u64>() {
        std::thread::sleep(Duration::from_millis(delay));
    }
}
```

- If the second segment exists and parses as `u64`: sleeps for that many milliseconds before continuing.
- Parse failure is silently ignored; no error response is sent.

### Status Code Dispatch

```rust
let Ok(status_code) = status_code.parse::<u32>() else {
    self.send_http_response(BAD_REQUEST, vec![], Some(b"Malformed request - invalid status code"));
    return Action::Pause;
};
```

- If the first segment does not parse as `u32`: sends 400 with body `"Malformed request - invalid status code"`, returns `Action::Pause`.

```rust
match status_code {
    0 | 200 => Action::Continue,
    code if code < 600 => {
        self.send_http_response(code, vec![], None);
        Action::Pause
    }
    _ => {
        self.send_http_response(BAD_REQUEST, vec![], None);
        Action::Pause
    }
}
```

| Condition | Behaviour |
|---|---|
| `0` or `200` | Returns `Action::Continue` — passes through to origin |
| `1–599` (excluding 200) | Calls `send_http_response(code, vec![], None)`, returns `Action::Pause` |
| `600` or greater | Sends 400 Bad Request (`BAD_REQUEST = 400`), returns `Action::Pause` |

---

## API Usage Summary

### `get_property`

```rust
self.get_property(vec!["request.path"]) -> Option<Vec<u8>>
```

- Property key: `"request.path"` — full request path including leading `/`.
- Returns raw bytes; decode with `std::str::from_utf8`.

### `send_http_response`

```rust
self.send_http_response(status_code: u32, headers: Vec<(&str, &str)>, body: Option<&[u8]>)
```

- Sends a synthetic response directly to the client.
- **Must** be followed by `return Action::Pause`. Returning `Action::Continue` after a synthetic response leads to undefined behavior.
- `headers` is empty (`vec![]`) in all usages in this example.
- `body` is `None` for status-only responses, `Some(b"...")` for error messages.

### `Action` Variants Used

| Variant | Meaning |
|---|---|
| `Action::Continue` | Pass request through to the next filter or origin |
| `Action::Pause` | Stop the filter chain; response has already been sent |

---

## Path Format

```
/<status_code>[/<delay_ms>][/...]
```

| Segment | Type | Required | Description |
|---|---|---|---|
| `status_code` | `u32` | Yes | HTTP status code to return (0 treated as pass-through) |
| `delay_ms` | `u64` | No | Sleep duration in milliseconds before response |

**Examples:**

| Path | Behaviour |
|---|---|
| `/200` | Pass through to origin |
| `/0` | Pass through to origin |
| `/404` | Return 404, pause chain |
| `/503/500` | Sleep 500 ms, return 503, pause chain |
| `/999` | Return 400 (out of range), pause chain |
| `/abc` | Return 400 (parse failure), pause chain |

---

## Gotchas

- `get_property(vec!["request.path"])` always includes the leading `/` — trim it before splitting on `/`.
- Status code `0` is treated as pass-through (same as 200), not as an error.
- `send_http_response` must always be paired with `return Action::Pause`. Never return `Action::Continue` after sending a synthetic response.
- Delay parse failure is silently swallowed — no error is surfaced if the second segment is not a valid `u64`.
- Status codes `600` and above map to `400 Bad Request`, not to the literal value passed in.

---

## See Also

- proxy-wasm SDK reference for Rust (see the sdk-reference-rust reference)
- CDN app pattern guide (see the _docs-pattern-cdn reference)
- Host services reference for Rust (see the host-services-rust reference)
- Platform overview (see the platform-overview reference)
