<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 6347a7c2fda0d03e66f1214db5eec041c16801b7
      updated: 2026-06-16
-->

## Custom Error Pages — CDN (Rust)

### Overview

Intercepts 4xx and 5xx HTTP error responses at the CDN edge and replaces their bodies with branded HTML pages rendered via Handlebars templates. Use this pattern when you need consistent, styled error pages served from the edge regardless of what the origin returns.

---

### API Patterns

All logic runs inside a `proxy_wasm::traits::HttpContext` implementation. Two lifecycle hooks are used:

| Hook | Signature | Purpose |
|------|-----------|---------|
| `on_http_response_headers` | `fn on_http_response_headers(&mut self, _num_headers: usize, _end_of_stream: bool) -> Action` | Detect error status; prepare headers for body replacement |
| `on_http_response_body` | `fn on_http_response_body(&mut self, _body_size: usize, end_of_stream: bool) -> Action` | Buffer body until complete; render and replace with HTML |

**Status code retrieval — binary encoding, not a string:**

```rust
// response.status is a 2-byte big-endian u16, NOT a UTF-8 string
let status: Option<Vec<u8>> = self.get_property(vec!["response.status"]);
if let Some(bytes) = status {
    if bytes.len() == 2 {
        let status_code = u16::from_be_bytes([bytes[0], bytes[1]]);
        // use status_code
    }
}
```

**Header manipulation for body replacement:**

```rust
// Must remove Content-Length before replacing body (length will change)
self.set_http_response_header("Content-Length", None);
self.set_http_response_header("Transfer-Encoding", Some("Chunked"));
self.set_http_response_header("Content-Type", Some("text/html"));
```

> Note: On the FastEdge CDN platform, passing `None` to `set_http_response_header` sets the header value to an empty string rather than truly removing it. This is a FastEdge CDN platform limitation. When checking for header absence downstream, test for both a missing value and an empty string.

**Body replacement:**

```rust
// Replaces the entire response body starting at offset 0
// body_size is the usize parameter from on_http_response_body — use it, not body.len()
let body: &[u8] = html_string.as_bytes();
self.set_http_response_body(0, body_size, body);
```

**Compile-time resource embedding:**

```rust
// Embed a text file (template or CSS) at compile time — no runtime filesystem
let error_template = include_str!("../templates/error_page.hbs");
let styles = include_str!("../public/styles.css");
```

**Build-script-generated maps via `include!`:**

```rust
// Maps generated in build.rs and written to OUT_DIR are included with include!
include!(concat!(env!("OUT_DIR"), "/image_map.rs"));
include!(concat!(env!("OUT_DIR"), "/message_map.rs"));
```

**Handlebars rendering — multi-stage (message/description, then full page):**

```rust
use handlebars::Handlebars;
use serde_json::json;

let mut handlebars = Handlebars::new();

// Stage 1: render message and description strings (may contain {{status}} themselves)
handlebars.register_template_string("message_template", message).unwrap();
handlebars.register_template_string("description_template", description).unwrap();
let msg_data = json!({ "status": status_code.to_string() });
let complete_message = handlebars.render("message_template", &msg_data).unwrap();
let complete_description = handlebars.render("description_template", &msg_data).unwrap();

// Stage 2: render full HTML page with all values
let error_template = include_str!("../templates/error_page.hbs");
handlebars.register_template_string("error_template", error_template).unwrap();
let styles = include_str!("../public/styles.css");
let page_data = json!({
    "styles": styles,
    "status": status_code.to_string(),
    "message": complete_message,
    "description": complete_description,
    "image": base64_image,
});
let html_body = handlebars.render("error_template", &page_data).unwrap();
```

---

### Common Patterns

**Pattern 1 — Detect error status and prepare headers in `on_http_response_headers`:**

```rust
fn on_http_response_headers(&mut self, _: usize, _: bool) -> Action {
    if let Some(status) = self.get_property(vec!["response.status"]) {
        if status.len() == 2 {
            let status_code = u16::from_be_bytes([status[0], status[1]]);
            if (400..600).contains(&status_code) {
                self.set_http_response_header("Content-Length", None);
                self.set_http_response_header("Transfer-Encoding", Some("Chunked"));
                self.set_http_response_header("Content-Type", Some("text/html"));
            }
        }
    }
    Action::Continue
}
```

**Pattern 2 — Buffer body until `end_of_stream`, then replace:**

```rust
fn on_http_response_body(&mut self, body_size: usize, end_of_stream: bool) -> Action {
    let Some(status) = self.get_property(vec!["response.status"]) else {
        return Action::Continue;
    };
    if status.len() != 2 {
        return Action::Continue;
    }
    let status_code = u16::from_be_bytes([status[0], status[1]]);
    if !(400..600).contains(&status_code) {
        return Action::Continue;
    }
    if !end_of_stream {
        // Pause to accumulate the full body before replacing
        return Action::Pause;
    }

    // ... render HTML into html_body ...
    let body = html_body.as_bytes();
    self.set_http_response_body(0, body_size, body);
    Action::Continue
}
```

**Pattern 3 — Fallback lookup in status-code map (image and message):**

```rust
// Try exact status code first, fall back to 4xx/5xx generic bucket
let base64_image = image_map
    .get(&status_code)
    .or_else(|| {
        if (400..500).contains(&status_code) {
            image_map.get(&4000)  // 4000 = generic 4xx key
        } else if (500..600).contains(&status_code) {
            image_map.get(&5000)  // 5000 = generic 5xx key
        } else {
            None
        }
    })
    .unwrap_or(&"");

// Same fallback logic for message map; message_map values are (title, description) tuples
let (message, description) = message_map
    .get(&status_code)
    .or_else(|| {
        if (400..500).contains(&status_code) {
            message_map.get(&4000)
        } else if (500..600).contains(&status_code) {
            message_map.get(&5000)
        } else {
            None
        }
    })
    .map(|(msg, desc)| (msg.to_string(), desc.to_string()))
    .unwrap_or_else(|| {
        (
            "Unexpected Error".to_string(),
            "The server responded with a {{status}} error.".to_string(),
        )
    });
```

---

### Dependencies (`Cargo.toml`)

```toml
[dependencies]
proxy-wasm = "0.2"
handlebars = "6.3"
serde_json = "1.0"
regex = "1.10"

[build-dependencies]
base64 = "0.22"
```

- `proxy-wasm`: CDN lifecycle hooks and context traits
- `handlebars`: template rendering for error pages and message strings
- `serde_json`: JSON data construction for template variables
- `regex`: available for pattern matching (used in build script or message processing)
- `base64` (build dependency only): encodes images into the generated map at compile time

---

### Adding a Custom Error Page

1. Add an image: `public/images/<status>.jpg`
2. Add a message file: `public/messages/<status>.hbs` (first line = title, second line = description)
3. Recompile and redeploy — the build script regenerates the embedded maps

---

### Gotchas

- **`response.status` is binary, not a string.** It is always a 2-byte big-endian `u16`. Always check `bytes.len() == 2` before calling `u16::from_be_bytes`. A length mismatch means an unexpected property format — return `Action::Continue` rather than panicking.
- **Remove `Content-Length` before replacing the body.** The replacement body will have a different length. If `Content-Length` is not cleared first, the response will be malformed. On FastEdge CDN, `set_http_response_header("Content-Length", None)` sets it to an empty string (platform limitation) rather than removing the header entirely.
- **Body replacement requires buffering until `end_of_stream`.** Return `Action::Pause` from `on_http_response_body` when `end_of_stream` is false. Replacing the body before the stream is complete produces incomplete output.
- **`set_http_response_body` second argument is `body_size` from the hook parameter, not `body.len()`.** The source uses `self.set_http_response_body(0, body_size, body)` where `body_size` is the `usize` parameter passed into `on_http_response_body`. Do not substitute `body.len()`.
- **`include_str!` and `include!` are compile-time only.** Templates, CSS, and build-generated maps are embedded into the WASM binary at build time. There is no runtime filesystem access in WASM. Any resource needed at runtime must be embedded this way.
- **`include!` with `OUT_DIR` requires a build script.** Maps generated in `build.rs` (e.g., image maps encoding files as Base64, message maps) are written to `env!("OUT_DIR")` and included with `include!(concat!(env!("OUT_DIR"), "/map.rs"))`. The generated file must define a function (e.g., `get_image_map()`, `get_message_map()`) that is callable from the main module.
- **Handlebars rendering is two-stage.** Message and description strings may themselves contain `{{status}}` placeholders. Render them first with `json!({ "status": ... })`, then pass the rendered strings into the final page template. Registering and rendering in a single pass will not expand variables inside message/description values.
- **`handlebars::Handlebars::render` panics on template registration failure if `.unwrap()` is used.** In production code, handle `register_template_string` and `render` errors explicitly unless the templates are known-valid at compile time.
- **`get_property` returns `Option<Vec<u8>>` in both hooks.** The property may be absent even for valid responses. Always handle the `None` case before attempting to decode.

---

### Related

- CDN apps reference — proxy-wasm lifecycle hooks (`on_http_response_headers`, `on_http_response_body`), `HttpContext` trait, `Action` enum, and `get_property` / `set_http_response_header` / `set_http_response_body` signatures
- Host services reference — KV store, secrets, and dictionary APIs available in CDN apps
- SDK API reference — full proxy-wasm trait and type documentation for FastEdge Rust apps
- Scaffold blueprints for CDN — project structure and `Cargo.toml` configuration for CDN WASM apps
