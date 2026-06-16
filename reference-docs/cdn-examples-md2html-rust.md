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
languages: [rust]
capabilities: [response-body-transform, request-path-rewrite, content-type-detection, cross-hook-state]
---

# CDN Example: Markdown to HTML (Rust)

Converts Markdown documents returned by the origin server to HTML. Uses three CDN hook phases: request headers, response headers, and response body.

## Overview

| Property | Value |
|---|---|
| Example | `examples/cdn/md2html` |
| Crate type | `cdylib` |
| Dependencies | `proxy-wasm = "0.2"`, `pulldown-cmark = "0.11"` |
| Edition | 2024 |

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `BASE` | Optional | URL prefix prepended to the incoming request path. Trailing slashes are trimmed before concatenation. If absent, path is not modified and a log line is emitted. |

## Hook Implementations

### `on_http_request_headers`

**Purpose**: Suppress compressed responses; optionally rewrite request path.

**Steps**:
1. Sets `Accept-Encoding` header to `None` (empty string on FastEdge CDN) to prevent origin from returning a gzip-encoded body. Without this, `String::from_utf8` on the response body will fail silently and raw compressed bytes are passed through as HTML.
2. Reads `BASE` from environment via `env::var("BASE")`. If absent, logs and returns `Action::Continue` with no path change.
3. Reads `request.path` via `self.get_property(vec!["request.path"])`. If missing (should not occur), defaults to `"/"`.
4. Constructs new path: `format!("{}{}", base.trim_end_matches('/'), url)`.
5. Writes new path via `self.set_property(vec!["request.path"], Some(new_url.as_bytes()))`.
6. Returns `Action::Continue`.

**Error handling**: If `request.path` bytes cannot be decoded as UTF-8, sends `400 Bad Request` via `self.send_http_response(400, vec![], None)` and returns `Action::Pause`.

**Key API calls**:
```rust
self.set_http_request_header("Accept-Encoding", None);
self.get_property(vec!["request.path"]) -> Option<Vec<u8>>
self.set_property(vec!["request.path"], Some(new_url.as_bytes()));
self.send_http_response(BAD_REQUEST, vec![], None);
```

---

### `on_http_response_headers`

**Purpose**: Detect Markdown content type; configure headers for chunked HTML output; set cross-hook processing flag.

**Steps**:
1. Reads `Content-Type` response header via `self.get_http_response_header("Content-Type")`.
2. Checks if value starts with `"text/plain"` or `"text/markdown"`. Both trigger Markdown conversion.
3. If matched:
   - Removes `Content-Length` by setting to `None` (required before body replacement to avoid length mismatch).
   - Sets `Transfer-Encoding` to `"Chunked"`.
   - Sets `Content-Type` to `"text/html"`.
   - Sets cross-hook flag: `self.set_property(vec!["response.markdown"], Some(b"true"))`.
4. Returns `Action::Continue` unconditionally.

**Key API calls**:
```rust
self.get_http_response_header("Content-Type") -> Option<String>
self.set_http_response_header("Content-Length", None);
self.set_http_response_header("Transfer-Encoding", Some("Chunked"));
self.set_http_response_header("Content-Type", Some("text/html"));
self.set_property(vec!["response.markdown"], Some(b"true"));
```

---

### `on_http_response_body`

**Purpose**: Buffer the full response body, parse Markdown, and replace with rendered HTML.

**Steps**:
1. Checks cross-hook flag: `self.get_property(vec!["response.markdown"])`. If `None`, returns `Action::Continue` immediately (non-Markdown response; no transformation).
2. If `end_of_stream` is false, returns `Action::Pause` to buffer additional chunks.
3. Retrieves full body: `self.get_http_response_body(0, body_size)`. If `None`, returns `Action::Continue`.
4. Decodes bytes to `String` via `String::from_utf8(body_bytes)`. On error, returns `Action::Continue` (best-effort transform; no 500 sent).
5. Parses Markdown using `pulldown_cmark::Parser::new_ext` with `Options::ENABLE_TABLES | Options::ENABLE_FOOTNOTES`.
6. Renders HTML into a `String`, wrapping output with `<!DOCTYPE html><html><body>` and `</body></html>`.
7. Writes back via `self.set_http_response_body(0, body_size, body)`.
8. Returns `Action::Continue`.

**Key API calls**:
```rust
self.get_property(vec!["response.markdown"]) -> Option<Vec<u8>>
self.get_http_response_body(0, body_size) -> Option<Vec<u8>>
self.set_http_response_body(0, body_size, body);
```

**Pulldown-cmark usage**:
```rust
let parser = Parser::new_ext(
    md.as_str(),
    Options::ENABLE_TABLES | Options::ENABLE_FOOTNOTES,
);
let mut html = String::new();
pulldown_cmark::html::push_html(&mut html, parser);
```

Note: `pulldown-cmark` implements CommonMark. GFM extensions (tables, footnotes) must be explicitly enabled via `Options` bitflags. Extensions not listed in `Options` are not parsed.

---

## Cross-Hook State

| Property key | Set in | Read in | Value |
|---|---|---|---|
| `response.markdown` | `on_http_response_headers` | `on_http_response_body` | `b"true"` — signals body hook to apply transformation |

State is passed via `set_property` / `get_property` on the per-request context. Presence of the key (not its value) is the signal; absence means skip.

---

## Struct Layout

```
proxy_wasm::main! {
    set_root_context -> HttpBodyRoot (RootContext)
        create_http_context -> HttpBody (HttpContext)
            on_http_request_headers
            on_http_response_headers
            on_http_response_body
}
```

`HttpBodyRoot` implements `RootContext` and returns `ContextType::HttpContext`.  
`HttpBody` implements `HttpContext` and holds no state (state crosses hooks via properties).

---

## Cargo.toml

```toml
[package]
name = "md2html"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib"]

[dependencies]
proxy-wasm = "0.2"
pulldown-cmark = "0.11"
```

---

## Gotchas and Constraints

| Gotcha | Detail |
|---|---|
| `Accept-Encoding` suppression | On FastEdge CDN, setting a header to `None` sets its value to empty string, not removes it. Origin must treat empty `Accept-Encoding` as "no encoding preferred". Omitting this step causes origin to return gzip; body decode fails silently. |
| `Content-Length` removal | Must be set to `None` before body replacement. If left in place, length mismatch corrupts the response. |
| UTF-8 decode failure | `String::from_utf8` fails silently on error — `Action::Continue` is returned, passing through raw bytes. This is intentional (best-effort transform). |
| `end_of_stream` buffering | `Action::Pause` is returned for every partial chunk until the stream ends. Transformation only runs once `end_of_stream == true`. |
| `pulldown-cmark` options | Tables and footnotes are not enabled by default. Must pass `Options::ENABLE_TABLES \| Options::ENABLE_FOOTNOTES` explicitly. |
| `BASE` trailing slash | `base.trim_end_matches('/')` prevents double slashes when `BASE` ends with `/`. |

---

## See Also

- CDN app type overview: see platform-overview reference
- proxy-wasm HttpContext trait: see sdk-reference-rust reference
- Other CDN examples: see the cdn examples references
- HOST services available in CDN hooks: see host-services-rust reference
