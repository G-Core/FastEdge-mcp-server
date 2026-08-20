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
app_type: http
languages: [rust]
capabilities: [static-assets, routing, embedded-files]
---

# Static Assets — WASI (Rust)

Embeds static files into the WASM binary at compile time and serves them by request path. The WASM runtime has no file system; all assets must be embedded at compile time via `include_str!` (text) or `include_bytes!` (binary).

## Crate Metadata

| Field | Value |
|---|---|
| Crate name | `static_assets_wasi` |
| Crate type | `cdylib` |
| Edition | 2021 |

## Dependencies

| Crate | Version | Purpose |
|---|---|---|
| `wstd` | `0.6` | HTTP types, `#[wstd::http_server]` entry-point macro, `Body` |
| `anyhow` | `1` | Error handling (`anyhow::Result`) |

## Key Types

### `Asset`

```rust
struct Asset {
    content_type: &'static str,
    body: &'static str,
}
```

Holds a single embedded asset. Both fields are `'static` because they reference compile-time embedded data.

For binary assets, `body` should instead be typed as `&'static [u8]`.

## Embedded Assets

Assets are declared as `static` constants. Each uses `include_str!` with a path relative to the source file (`src/lib.rs`), not the crate root.

```rust
static INDEX_HTML: Asset = Asset {
    content_type: "text/html; charset=utf-8",
    body: include_str!("../assets/index.html"),
};
static STYLE_CSS: Asset = Asset {
    content_type: "text/css; charset=utf-8",
    body: include_str!("../assets/style.css"),
};
static LOGO_SVG: Asset = Asset {
    content_type: "image/svg+xml",
    body: include_str!("../assets/logo.svg"),
};
```

Asset files are located in `assets/` relative to the crate root (i.e., `examples/http/wasi/static_assets/assets/`).

## Path Lookup

```rust
fn lookup(path: &str) -> Option<&'static Asset>
```

Maps request paths to asset constants using a `match` expression. Returns `None` for unmatched paths.

| Path | Asset returned |
|---|---|
| `/` | `&INDEX_HTML` |
| `/index.html` | `&INDEX_HTML` |
| `/style.css` | `&STYLE_CSS` |
| `/logo.svg` | `&LOGO_SVG` |
| anything else | `None` |

## Entry Point

```rust
#[wstd::http_server]
async fn main(req: Request<Body>) -> anyhow::Result<Response<Body>>
```

Extracts the path with `req.uri().path()`, calls `lookup()`, and branches:

- **Match**: returns `200 OK` with `content-type` header set from `asset.content_type` and body from `asset.body`.
- **No match**: returns `404 Not Found` with `content-type: text/plain; charset=utf-8` and body `"Not found: {path}\n"`.

## Response Construction

**Hit (200):**
```rust
Response::builder()
    .status(StatusCode::OK)
    .header("content-type", asset.content_type)
    .body(Body::from(asset.body))?
```

**Miss (404):**
```rust
Response::builder()
    .status(StatusCode::NOT_FOUND)
    .header("content-type", "text/plain; charset=utf-8")
    .body(Body::from(format!("Not found: {path}\n")))?
```

## Patterns

### Adding a text asset

1. Place the file in `assets/`.
2. Declare a `static` constant using `include_str!("../assets/<filename>")`.
3. Add a match arm in `lookup()` mapping the request path to the constant.

### Adding a binary asset

1. Place the file in `assets/`.
2. Change `Asset.body` field type to `&'static [u8]` (requires a separate struct or a new type).
3. Use `include_bytes!("../assets/<filename>")` in the static declaration.
4. Build the response body with `Body::from(bytes::Bytes::from_static(asset.body))`.

## Constraints and Gotchas

- **No runtime file system**: the WASM runtime provides no file system access. All assets must be embedded at compile time. Runtime file reads are not possible.
- **`include_str!` path is relative to the source file**, not the crate root. From `src/lib.rs`, the `assets/` directory is at `../assets/`.
- **`include_str!` requires valid UTF-8**. Binary files must use `include_bytes!` instead.
- **Binary response body**: for `include_bytes!`, wrap the `&'static [u8]` with `bytes::Bytes::from_static` before passing to `Body::from`.
- **Binary size**: every embedded asset adds to the WASM binary size, which increases cold-start latency. Avoid embedding large or unnecessary assets.
- **Static routing only**: the `lookup()` function uses a compile-time `match`. Dynamic path segments (e.g., `/files/:name`) are not supported without additional runtime logic.

## File Layout

```
examples/http/wasi/static_assets/
├── Cargo.toml
├── assets/
│   ├── index.html
│   ├── style.css
│   └── logo.svg
└── src/
    └── lib.rs
```

## See Also

- examples-static-assets-js (JavaScript equivalent using Hono and `fastedge-assets` compile-time manifest)
- sdk-reference-rust (full `wstd` API reference)
- platform-overview (WASM runtime constraints and capabilities)
- best-practices (binary size and cold-start guidance)

## Source Material

### FILE: examples/http/wasi/static_assets/src/lib.rs

```rust
/*
 * Copyright 2025 G-Core Innovations SARL
 */
/*
Static assets example.

Embeds three files (`index.html`, `style.css`, `logo.svg`) into the wasm binary
at compile time via `include_str!` and serves them by path at request time. The
wasm runtime has no file system, so all assets must be embedded this way.

For binary assets, use `include_bytes!` and wrap the result in
`bytes::Bytes::from_static` when constructing the response body.

Mirror of the FastEdge-sdk-js `static-assets` example.
*/

use wstd::http::body::Body;
use wstd::http::{Request, Response, StatusCode};

struct Asset {
    content_type: &'static str,
    body: &'static str,
}

static INDEX_HTML: Asset = Asset {
    content_type: "text/html; charset=utf-8",
    body: include_str!("../assets/index.html"),
};
static STYLE_CSS: Asset = Asset {
    content_type: "text/css; charset=utf-8",
    body: include_str!("../assets/style.css"),
};
static LOGO_SVG: Asset = Asset {
    content_type: "image/svg+xml",
    body: include_str!("../assets/logo.svg"),
};

fn lookup(path: &str) -> Option<&'static Asset> {
    match path {
        "/" | "/index.html" => Some(&INDEX_HTML),
        "/style.css" => Some(&STYLE_CSS),
        "/logo.svg" => Some(&LOGO_SVG),
        _ => None,
    }
}

#[wstd::http_server]
async fn main(req: Request<Body>) -> anyhow::Result<Response<Body>> {
    let path = req.uri().path();
    match lookup(path) {
        Some(asset) => Ok(Response::builder()
            .status(StatusCode::OK)
            .header("content-type", asset.content_type)
            .body(Body::from(asset.body))?),
        None => Ok(Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header("content-type", "text/plain; charset=utf-8")
            .body(Body::from(format!("Not found: {path}\n")))?),
    }
}
```

### FILE: examples/http/wasi/static_assets/Cargo.toml

```toml
[workspace]

[package]
name = "static_assets_wasi"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wstd = "0.6"
anyhow = "1"
```

### FILE: examples/http/wasi/static_assets/README.md

```
[← Back to examples](../../../README.md)

# Static Assets (WASI)

Embeds three files (`index.html`, `style.css`, `logo.svg`) into the wasm binary at compile
time using `include_str!`, and serves them by path at request time. The wasm runtime has no
file system, so all assets must be embedded this way.

Visit `/` for the landing page. `/style.css` and `/logo.svg` are referenced from the HTML
and served by the same handler. Any other path returns 404.

## Adding a new asset

1. Drop the file into `assets/`.
2. Add a `static` entry at the top of `src/lib.rs` pointing at it via `include_str!`
   (text) or `include_bytes!` (binary).
3. Add a match arm in `lookup()` mapping the request path to the new asset.

For binary assets, change the `Asset.body` field to `&'static [u8]` and build the response
body with `Body::from(bytes::Bytes::from_static(asset.body))`.

## Related

Mirror of `FastEdge-sdk-js/examples/static-assets/` (the JS version uses Hono + a compile-
time asset manifest generated by `fastedge-assets`; the Rust version does the same thing
with plain stdlib macros).
```
