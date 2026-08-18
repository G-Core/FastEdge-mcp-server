<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 6347a7c2fda0d03e66f1214db5eec041c16801b7
      updated: 2026-08-17
-->

---
type: example
app_type: http
languages: [rust]
capabilities: [geo-redirect, headers, env-vars, redirect-response]
---

# Geo Redirect — WASI HTTP (Rust)

Redirects HTTP requests to country-specific origin URLs based on the `geoip-country-code` request header injected by the FastEdge platform. Falls back to a configured `BASE_ORIGIN` when no per-country mapping is found.

## Package

- **Crate name**: `geo_redirect_wasi`
- **Crate type**: `cdylib`
- **Edition**: 2021
- **WASM target**: `wasm32-wasip2`
- **Output binary**: `target/wasm32-wasip2/release/geo_redirect_wasi.wasm`

## Dependencies

| Crate | Version | Role |
|---|---|---|
| `wstd` | 0.6 | WASI HTTP runtime, `Request`, `Response`, `Body` |
| `anyhow` | 1 | Error propagation |

## Entry Point

```rust
#[wstd::http_server]
async fn main(req: Request<Body>) -> anyhow::Result<Response<Body>>
```

Single async handler. Registered via `#[wstd::http_server]` attribute macro.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `BASE_ORIGIN` | Yes | Fallback redirect URL. Returns HTTP 500 immediately if unset. |
| `<COUNTRY_CODE>` | No | Per-country redirect URL. Key is the ISO 3166-1 alpha-2 code (e.g. `US`, `DE`, `GB`). Falls back to `BASE_ORIGIN` if not set. |

## Request Headers Consumed

| Header | Source | Description |
|---|---|---|
| `geoip-country-code` | FastEdge platform-injected | Two-letter country code for the client's geographic location. Not present in local test requests unless explicitly set in the test fixture. |

## Control Flow

```
1. Read BASE_ORIGIN from env
   → missing: return 500 "BASE_ORIGIN is not set"

2. Read geoip-country-code header from request
   → present: use as country_code string
   → absent or invalid UTF-8: country_code = ""

3. Determine redirect_origin
   → country_code non-empty: attempt env::var(&country_code)
       → found: use country-specific URL
       → not found: fall back to BASE_ORIGIN
   → country_code empty: use BASE_ORIGIN

4. Return 302 redirect with Location: <redirect_origin>
```

## Response Behavior

| Condition | Status | Body | Headers |
|---|---|---|---|
| `BASE_ORIGIN` not set | 500 | `"BASE_ORIGIN is not set"` | — |
| Redirect (all other cases) | 302 | empty | `location: <redirect_origin>` |

## Key API Patterns

### Read platform-injected geo header

```rust
let country_code = req
    .headers()
    .get("geoip-country-code")
    .and_then(|v| v.to_str().ok())
    .unwrap_or("")
    .to_string();
```

- `get` returns `Option<&HeaderValue>`.
- `.and_then(|v| v.to_str().ok())` converts to `&str`, returning `None` on invalid UTF-8.
- `.unwrap_or("")` defaults to empty string when header is absent or non-UTF-8.

### Dynamic env var lookup by country code

```rust
let redirect_origin = if !country_code.is_empty() {
    env::var(&country_code).unwrap_or(base_origin)
} else {
    base_origin
};
```

- `env::var(&country_code)` uses the country code string directly as the variable name.
- `unwrap_or(base_origin)` consumes `base_origin` as the fallback (ownership transfer).

### Build redirect response

```rust
Response::builder()
    .status(302)
    .header("location", &redirect_origin)
    .body(Body::empty())?
```

- Uses `wstd::http::Response` builder pattern.
- `Body::empty()` — no response body for redirect.
- `?` propagates any builder error via `anyhow::Result`.

## Gotchas

- **`geoip-country-code` is platform-injected**: This header is only present on live FastEdge requests. Local test requests must set it explicitly in the test fixture; otherwise `country_code` will be `""` and all requests fall back to `BASE_ORIGIN`.
- **Per-country variable naming collision**: Country code env vars use two-letter ISO 3166-1 alpha-2 codes as keys (`US`, `DE`, `GB`). These collide with any other two-letter env vars configured on the app. Avoid two-letter env var names for non-country purposes.
- **`BASE_ORIGIN` is mandatory**: The handler returns HTTP 500 immediately if `BASE_ORIGIN` is not set. This is a hard error, not a fallback.
- **Ownership of `base_origin`**: `base_origin` is moved into `redirect_origin` via `unwrap_or(base_origin)`. It cannot be reused after that call.

## Build

```sh
cargo build --release
# Output: target/wasm32-wasip2/release/geo_redirect_wasi.wasm
```

## See Also

- platform-overview — FastEdge platform-injected request headers, including `geoip-country-code`
- best-practices — environment variable configuration patterns
- host-services-rust — `wstd` HTTP types: `Request`, `Response`, `Body`
- examples-headers-wasi-rust — general header reading patterns
- examples-env-vars-wasi-rust — environment variable access patterns

## Source Material

### FILE: examples/http/wasi/geo_redirect/src/lib.rs

```rust
/*
* Copyright 2025 G-Core Innovations SARL
*/
/*
Example WASI-HTTP app demonstrating geo-based redirects.

Reads the country code from the geoip-country-code request header
and redirects to a country-specific origin URL. Falls back to
BASE_ORIGIN when no country-specific mapping is configured.

Required configuration:
  - Environment variable: BASE_ORIGIN (fallback origin URL)
  - Environment variable: <COUNTRY_CODE> (optional per-country origin URLs, e.g. US, DE, GB)
*/

use std::env;
use wstd::http::body::Body;
use wstd::http::{Request, Response};

#[wstd::http_server]
async fn main(req: Request<Body>) -> anyhow::Result<Response<Body>> {
    let base_origin = match env::var("BASE_ORIGIN") {
        Ok(origin) => origin,
        Err(_) => {
            return Ok(Response::builder()
                .status(500)
                .body(Body::from("BASE_ORIGIN is not set"))?);
        }
    };

    let country_code = req
        .headers()
        .get("geoip-country-code")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let redirect_origin = if !country_code.is_empty() {
        env::var(&country_code).unwrap_or(base_origin)
    } else {
        base_origin
    };

    Ok(Response::builder()
        .status(302)
        .header("location", &redirect_origin)
        .body(Body::empty())?)
}
```

### FILE: examples/http/wasi/geo_redirect/Cargo.toml

```toml
[workspace]

[package]
name = "geo_redirect_wasi"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wstd = "0.6"
anyhow = "1"
```

### FILE: examples/http/wasi/geo_redirect/README.md

```
[← Back to examples](../../../README.md)

# Geo Redirect (WASI)

Redirects requests to country-specific origins based on the `geoip-country-code` request header. Falls back to `BASE_ORIGIN` when no country-specific mapping is configured.

Demonstrates reading request headers, reading environment variables, and returning redirect responses.

## Configuration

| Env var | Required | Description |
|---|---|---|
| `BASE_ORIGIN` | Yes | Fallback redirect URL (e.g. `https://example.com`). Returns 500 if unset. |
| `<COUNTRY_CODE>` | No | Per-country redirect URL, keyed by 2-letter country code (e.g. `DE`, `US`, `GB`). Falls back to `BASE_ORIGIN` if not set. |

## How it works

```
geoip-country-code: DE  →  env var DE is set  →  302 to DE value
geoip-country-code: FR  →  env var FR not set  →  302 to BASE_ORIGIN
(no header)             →  302 to BASE_ORIGIN
BASE_ORIGIN not set     →  500
```

## Build

```sh
cargo build --release
# Output: target/wasm32-wasip2/release/geo_redirect_wasi.wasm
```

## APIs used

- `request.headers().get("geoip-country-code")` — read geo header injected by the FastEdge edge
- `std::env::var(country_code)` — dynamic env var lookup by country code
- `Response::builder().status(302).header("location", url)` — redirect response
```
