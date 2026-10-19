<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: v0.4.5
      commit: e7f446a4b40b791b932ab36b2c7a0c85fd24104d
      updated: 2026-10-19
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

1. Read `BASE` env var; strip trailing `/` via `base.trim_end_matches('/')`.
2. Validate request path is non-empty and not `/`.
3. Construct outbound `GET` request: `BASE + path`, `User-Agent: fastedge`.
4. Call `fastedge::send_request` via internal `request()` helper.
5. Follow redirects up to `MAX_REDIRECTS = 5` hops via `request_inner(req, depth)`.
6. Decode response body as UTF-8 via `String::from_utf8(rsp.body().to_vec())`; failure → `500`.
7. Parse Markdown with `Parser::new_ext(md.as_str(), Options::ENABLE_TABLES | Options::ENABLE_FOOTNOTES)`.
8. Render HTML with `pulldown_cmark::html::push_html(&mut html, parser)`.
9. Wrap in `<!DOCTYPE html><html><body>...</body></html>`; optionally inject `HEAD` env var into `<head>`.
10. Return `200 OK`, `Content-Type: text/html`.

---

## APIs Used

### `fastedge::send_request`

```rust
fastedge::send_request(req: Request<Body>) -> Result<Response<Body>, fastedge::Error>
```

Makes an outbound HTTP request. Errors are mapped to `StatusCode`:

| `fastedge::Error` variant      | Mapped `StatusCode`         |
|-------------------------------|------------------------------|
| `UnsupportedMethod(_)`        | `405 METHOD_NOT_ALLOWED`     |
| `BindgenHttpError(_)`         | `500 INTERNAL_SERVER_ERROR`  |
| `HttpError(_)`                | `500 INTERNAL_SERVER_ERROR`  |
| `InvalidBody`                 | `400 BAD_REQUEST`            |
| `InvalidStatusCode(_)`        | `400 BAD_REQUEST`            |

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
- `request_inner` only returns `Ok(rsp)` for `200 OK` responses; all other non-redirect status codes are returned as `Err(status)` and forwarded as empty-body responses.

---

## See Also

- fastedge-sdk-rust HTTP examples overview
- platform-overview (FastEdge runtime, env var model)
- sdk-reference-rust (full API surface for `fastedge` crate)
- host-services-rust (`fastedge::send_request` host service details)
- best-practices (outbound fetch patterns, error handling)

## Source Material

### FILE: examples/http/basic/markdown_render/src/lib.rs

```rust
/*
Example app to demonstrate how to remder Markdown docs to HTML
App needs following env vars to be set:
BASE - origin server URL. Whateven passed in URL path for this app is concatenanted to BASE
*/

use fastedge::{
    body::Body,
    http::{header, Error, Method, Request, Response, StatusCode},
};
use pulldown_cmark::{Options, Parser};
use std::env;
use url::Url;

#[fastedge::http]
fn main(req: Request<Body>) -> Result<Response<Body>, Error> {
    match req.method() {
        &Method::GET | &Method::HEAD => (),
        _ => {
            return Response::builder()
                .status(StatusCode::METHOD_NOT_ALLOWED)
                .header(header::ALLOW, "GET, HEAD")
                .body(Body::from("This method is not allowed\n"))
        }
    };

    let Ok(base) = env::var("BASE") else {
        return Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Body::from("Misconfigured app\n"));
    };
    let base = base.trim_end_matches('/').to_string();

    let path = req.uri().path();
    if path.is_empty() || path == "/" {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(Body::from("Missing file path\n"));
    }

    let Ok(sub_req) = Request::builder()
        .method(Method::GET)
        .header(header::USER_AGENT, "fastedge")
        .uri(base + path)
        .body(Body::empty())
    else {
        return Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Body::empty());
    };

    let rsp = match request(sub_req) {
        Err(status) => return Response::builder().status(status).body(Body::empty()),
        Ok(s) => s,
    };
    let Ok(md) = String::from_utf8(rsp.body().to_vec()) else {
        return Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Body::empty());
    };

    let parser = Parser::new_ext(
        md.as_str(),
        Options::ENABLE_TABLES | Options::ENABLE_FOOTNOTES,
    );

    let mut html = String::new();
    html.push_str("<!DOCTYPE html><html>");
    match env::var("HEAD").ok() {
        None => {}
        Some(h) => {
            html.push_str("<head>");
            html.push_str(h.as_str());
            html.push_str("</head>");
        }
    }

    html.push_str("<body>");
    pulldown_cmark::html::push_html(&mut html, parser);
    html.push_str("</body></html>");

    let rsp = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime::TEXT_HTML.to_string())
        .body(Body::from(html))?;

    Ok(rsp)
}

const MAX_REDIRECTS: u8 = 5;

fn request(req: Request<Body>) -> Result<Response<Body>, StatusCode> {
    request_inner(req, 0)
}

fn request_inner(req: Request<Body>, depth: u8) -> Result<Response<Body>, StatusCode> {
    let rsp = match fastedge::send_request(req) {
        Err(error) => {
            let status_code = match error {
                fastedge::Error::UnsupportedMethod(_) => StatusCode::METHOD_NOT_ALLOWED,
                fastedge::Error::BindgenHttpError(_) => StatusCode::INTERNAL_SERVER_ERROR,
                fastedge::Error::HttpError(_) => StatusCode::INTERNAL_SERVER_ERROR,
                fastedge::Error::InvalidBody => StatusCode::BAD_REQUEST,
                fastedge::Error::InvalidStatusCode(_) => StatusCode::BAD_REQUEST,
            };
            return Err(status_code);
        }
        Ok(r) => r,
    };

    let status = rsp.status();
    if is_redirect(status) && depth < MAX_REDIRECTS {
        if let Some(location) = rsp.headers().get(header::LOCATION) {
            let new_url = Url::parse(
                location
                    .to_str()
                    .or(Err(StatusCode::INTERNAL_SERVER_ERROR))?,
            )
            .or(Err(StatusCode::INTERNAL_SERVER_ERROR))?;

            let sub_req = Request::builder()
                .method(Method::GET)
                .uri(new_url.as_str())
                .body(Body::empty())
                .or(Err(StatusCode::INTERNAL_SERVER_ERROR))?;

            return request_inner(sub_req, depth + 1);
        }
    }
    if status == StatusCode::OK {
        return Ok(rsp);
    }

    Err(status)
}

// List of acceptable 300-series redirect codes.
const REDIRECT_CODES: &[StatusCode] = &[
    StatusCode::MOVED_PERMANENTLY,
    StatusCode::FOUND,
    StatusCode::SEE_OTHER,
    StatusCode::TEMPORARY_REDIRECT,
    StatusCode::PERMANENT_REDIRECT,
];

fn is_redirect(status_code: StatusCode) -> bool {
    return REDIRECT_CODES.contains(&status_code);
}
```

### FILE: examples/http/basic/markdown_render/Cargo.toml

```toml
[workspace]

[package]
name = "markdown_render"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
fastedge = "0.4"
mime = "0.3"
pulldown-cmark = "0.11"
url = "2.5"
```

### FILE: examples/http/basic/markdown_render/README.md

```
[← Back to examples](../../../README.md)

# Markdown Render

Demonstrates outbound HTTP fetch and content transformation: fetches a file from a configurable origin URL and renders it as an HTML page using [`pulldown-cmark`](https://github.com/raphlinus/pulldown-cmark). Uses the legacy synchronous `#[fastedge::http]` handler (`wasm32-wasip1`). For new apps, prefer the async [`#[wstd::http_server]`](../../wasi/) handler.

## What it teaches

- Making outbound HTTP requests from a FastEdge app with `fastedge::send_request`
- Following HTTP redirects manually (301, 302, 303, 307, 308)
- Transforming response bodies (Markdown → HTML)
- Reading environment variables at request time
- Method guard (405 for non-GET/HEAD)

## Configuration

| Variable | Required | Description |
|---|---|---|
| `BASE` | Yes | Origin base URL. The request path is appended: `BASE + path` |
| `HEAD` | No | Optional HTML injected into `<head>` (e.g. a `<link>` stylesheet tag) |

## Build

```sh
# From this directory:
cargo build --release

# WASM output:
# target/wasm32-wasip1/release/markdown_render.wasm
```

## Expected behaviour

| Condition | Response |
|---|---|
| `BASE` env var not set | 500 `Misconfigured app\n` |
| Method is not GET or HEAD | 405 `This method is not allowed\n`, `Allow: GET, HEAD` |
| Path is empty or `/` | 400 `Missing file path\n` |
| Origin returns non-200 | Forwards the upstream status, empty body |
| Origin returns a redirect | Follows the redirect (up to one level) and retries |
| Normal request | 200 HTML page with rendered Markdown, `Content-Type: text/html` |

## Example

```sh
# Set BASE to a server that serves Markdown files
BASE=https://raw.githubusercontent.com/example/repo/main

# Request /README.md -> fetches BASE/README.md -> renders as HTML
curl http://localhost:<port>/README.md
# Returns: <!DOCTYPE html><html><body><h1>...</h1>...</body></html>

# With a custom stylesheet injected into <head>
HEAD='<link rel="stylesheet" href="https://cdn.example.com/style.css">'
```

## APIs used

| API | Purpose |
|---|---|
| `fastedge::send_request(req)` | Outbound HTTP request to origin |
| `pulldown_cmark::Parser::new_ext` | Parse Markdown with tables and footnotes |
| `pulldown_cmark::html::push_html` | Render Markdown AST to HTML string |
| `std::env::var("BASE")` | Read required env var at request time |
| `url::Url::parse` | Validate redirect `Location` header |
```
