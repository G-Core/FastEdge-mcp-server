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
app_type: http
languages: [rust]
capabilities: [outbound-fetch, env-vars, content-transformation, redirect-following, markdown-rendering]
---

# HTTP Example: Markdown Render (Rust, Basic)

Fetches a Markdown file from a configurable origin URL and renders it as an HTML page. Demonstrates outbound HTTP requests, redirect following, body transformation, and environment variable configuration.

Handler type: `#[fastedge::http]` (synchronous, `wasm32-wasip1`). For new apps, prefer the async `#[wstd::http_server]` handler.

---

## Environment Variables

| Variable | Required | Type   | Description |
|----------|----------|--------|-------------|
| `BASE`   | Yes      | String | Origin base URL. Request path is appended: `BASE + path`. Trailing slash is stripped automatically. |
| `HEAD`   | No       | String | Raw HTML string injected inside `<head>...</head>` (e.g. a `<link>` stylesheet tag). Omit to skip `<head>` entirely. |

---

## Request Handling

### Method Guard

Only `GET` and `HEAD` are accepted.

- Any other method → `405 METHOD_NOT_ALLOWED`, `Allow: GET, HEAD` header, body: `This method is not allowed\n`

### Path Validation

- Empty path or `/` → `400 BAD_REQUEST`, body: `Missing file path\n`

### Env Var Validation

- `BASE` not set → `500 INTERNAL_SERVER_ERROR`, body: `Misconfigured app\n`

---

## Core Flow

1. Read `BASE` env var; strip trailing `/`.
2. Validate request path is non-empty and not `/`.
3. Construct outbound `GET` request: `BASE + path`, `User-Agent: fastedge`.
4. Call `fastedge::send_request` via internal `request()` helper.
5. Follow redirects up to `MAX_REDIRECTS = 5` hops.
6. Decode response body as UTF-8; failure → `500`.
7. Parse Markdown with `Parser::new_ext(md, Options::ENABLE_TABLES | Options::ENABLE_FOOTNOTES)`.
8. Render HTML with `pulldown_cmark::html::push_html`.
9. Wrap in `<!DOCTYPE html><html><body>...</body></html>`; optionally inject `HEAD` env var into `<head>`.
10. Return `200 OK`, `Content-Type: text/html`.

---

## APIs Used

### `fastedge::send_request`

```rust
fastedge::send_request(req: Request<Body>) -> Result<Response<Body>, fastedge::Error>
```

Makes an outbound HTTP request. Errors are mapped to `StatusCode`:

| `fastedge::Error` variant      | Mapped `StatusCode`     |
|-------------------------------|-------------------------|
| `UnsupportedMethod(_)`        | `405 METHOD_NOT_ALLOWED`|
| `BindgenHttpError(_)`         | `500 INTERNAL_SERVER_ERROR` |
| `HttpError(_)`                | `500 INTERNAL_SERVER_ERROR` |
| `InvalidBody`                 | `400 BAD_REQUEST`       |
| `InvalidStatusCode(_)`        | `400 BAD_REQUEST`       |

### `pulldown_cmark::Parser::new_ext`

```rust
Parser::new_ext(text: &str, options: Options) -> Parser<'_>
```

Parses Markdown with extensions. Options used:

- `Options::ENABLE_TABLES` — GFM-style tables
- `Options::ENABLE_FOOTNOTES` — footnote syntax

### `pulldown_cmark::html::push_html`

```rust
pulldown_cmark::html::push_html(s: &mut String, iter: impl Iterator<Item = Event<'_>>)
```

Renders parsed Markdown events into an HTML string appended to `s`.

### `std::env::var`

```rust
std::env::var(key: &str) -> Result<String, VarError>
```

Reads environment variables at request time. `BASE` is required; `HEAD` is optional via `.ok()`.

### `url::Url::parse`

```rust
url::Url::parse(input: &str) -> Result<Url, ParseError>
```

Used to validate and normalize `Location` header values on redirect responses.

---

## Redirect Handling

Internal `request_inner(req, depth)` follows redirects recursively.

**Accepted redirect status codes:**
- `301 MOVED_PERMANENTLY`
- `302 FOUND`
- `303 SEE_OTHER`
- `307 TEMPORARY_REDIRECT`
- `308 PERMANENT_REDIRECT`

**Limit:** `MAX_REDIRECTS = 5`. After 5 hops, the current response is returned as-is (no further following).

On redirect:
1. Read `Location` header.
2. Parse as absolute URL via `url::Url::parse`.
3. Issue new `GET` request to the new URL with empty body.

If `Location` is missing or unparseable → `500 INTERNAL_SERVER_ERROR`.

Non-200, non-redirect upstream responses are forwarded as the status code with an empty body.

---

## Response Behavior

| Condition | Status | Body / Headers |
|-----------|--------|----------------|
| `BASE` not set | 500 | `Misconfigured app\n` |
| Non-GET/HEAD method | 405 | `This method is not allowed\n`; `Allow: GET, HEAD` |
| Path empty or `/` | 400 | `Missing file path\n` |
| Outbound request error | Mapped status | Empty body |
| Upstream non-200 response | Upstream status | Empty body |
| Body not valid UTF-8 | 500 | Empty body |
| Normal request | 200 | Full HTML page; `Content-Type: text/html` |

---

## HTML Output Structure

Without `HEAD` env var:
```html
<!DOCTYPE html><html><body><!-- rendered markdown --></body></html>
```

With `HEAD` env var set to e.g. `<link rel="stylesheet" href="...">`:
```html
<!DOCTYPE html><html><head><link rel="stylesheet" href="..."></head><body><!-- rendered markdown --></body></html>
```

---

## Dependencies (`Cargo.toml`)

| Crate           | Version | Purpose |
|-----------------|---------|---------|
| `fastedge`      | `0.4`   | Runtime handler macro, `send_request`, HTTP types |
| `pulldown-cmark`| `0.11`  | Markdown parsing and HTML rendering |
| `mime`          | `0.3`   | `mime::TEXT_HTML` constant for `Content-Type` |
| `url`           | `2.5`   | Redirect `Location` URL parsing and validation |

Crate type: `cdylib` (required for WASM output).

Build target: `wasm32-wasip1`.

---

## Gotchas

- `base.trim_end_matches('/')` prevents a double-slash when concatenating `BASE` with the path (e.g. `https://example.com/` + `/README.md` → `https://example.com//README.md` without trim).
- Path must be non-empty and not `/` — the app has no index/directory listing behavior.
- `String::from_utf8(rsp.body().to_vec())` fails on binary responses (e.g. images) — returns `500`. Ensure `BASE` points to a text/Markdown origin.
- Redirect following is implemented manually; `fastedge::send_request` does not auto-follow redirects.
- `HEAD` env var content is injected as raw HTML — no escaping or validation. Only inject trusted content.

---

## See Also

- fastedge-sdk-rust HTTP examples overview
- platform-overview (FastEdge runtime, env var model)
- sdk-reference-rust (full API surface for `fastedge` crate)
- host-services-rust (`fastedge::send_request` host service details)
- best-practices (outbound fetch patterns, error handling)
