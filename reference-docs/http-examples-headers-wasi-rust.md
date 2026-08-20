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
capabilities: [headers, env-vars, response-building]
---

# HTTP Headers Example — WASI (Rust)

## Purpose

Echoes all incoming request headers back in the HTTP response and appends a custom response header (`x-my-custom-header`) whose value is sourced from an environment variable.

## Source Location

`examples/http/wasi/headers/`

## Package

| Field | Value |
|---|---|
| name | `headers` |
| edition | 2021 |
| crate-type | `cdylib` |
| wasm target | `wasm32-wasip2` |
| output | `target/wasm32-wasip2/release/headers.wasm` |

## Dependencies

| Crate | Version | Role |
|---|---|---|
| `wstd` | `0.6` | HTTP server macro, request/response types, body |
| `anyhow` | `1` | Error propagation |

## Entry Point

```rust
#[wstd::http_server]
async fn main(request: Request<Body>) -> anyhow::Result<Response<Body>>
```

- Decorated with `#[wstd::http_server]`.
- Receives the full incoming `Request<Body>`.
- Returns `anyhow::Result<Response<Body>>`.

## Behavior

1. Reads the optional environment variable `MY_CUSTOM_ENV_VAR`; defaults to an empty string if unset.
2. Constructs a `Response::builder()` with status `200`.
3. Iterates `request.headers()` — yields `(&HeaderName, &HeaderValue)` pairs — and chains each pair onto the builder with `.header(name.as_str(), value)`.
4. Appends `x-my-custom-header` with the env-var value after the copy loop, ensuring it cannot be overridden by a same-named request header.
5. Finalizes the response with `builder.body(Body::from("Returned all headers with a custom header added"))`.

## API Surface

### `request.headers()`

- Return type: `&HeaderMap`
- Iteration yields `(&HeaderName, &HeaderValue)` pairs.
- `name.as_str()` converts `&HeaderName` to `&str`.
- `value` is a `&HeaderValue` borrowed from the request for the duration of the loop.

### `Response::builder()`

- Returns a `http::response::Builder`.
- `.status(u16)` — sets HTTP status code.
- `.header(name: &str, value: &HeaderValue)` — appends a single header; called in a loop for each request header, then once more for the custom header. Accepts `(&str, &HeaderValue)` directly without requiring conversion to string.
- `.body(Body)` — consumes the builder and produces `Response<Body>`. Must be called last; the builder is moved at this point.

### `std::env::var`

```rust
env::var("MY_CUSTOM_ENV_VAR").unwrap_or_default()
```

- Returns `Ok(String)` if the variable is set, `Err(VarError)` if not.
- `.unwrap_or_default()` yields an empty `String` on error.

## Environment Variables

| Variable | Required | Type | Default | Description |
|---|---|---|---|---|
| `MY_CUSTOM_ENV_VAR` | No | String | `""` (empty) | Value placed in the `x-my-custom-header` response header. |

## Response Shape

```
HTTP/1.1 200 OK
x-my-custom-header: <MY_CUSTOM_ENV_VAR value>
<...all request headers echoed...>

Returned all headers with a custom header added
```

## Patterns Demonstrated

- **Mutable builder accumulation**: `builder` is declared `mut` and reassigned inside a `for` loop — `builder = builder.header(...)` — to chain an arbitrary number of headers before finalizing.
- **Optional env-var injection into headers**: `env::var("KEY").unwrap_or_default()` pattern for headers whose value may be absent without causing a runtime error.
- **Post-loop custom header**: appending the custom header after iterating request headers guarantees it appears last and cannot be shadowed by a request header with the same name.
- **Raw `&HeaderValue` passthrough**: passing `value` (a `&HeaderValue`) directly to `.header()` avoids the need to call `.to_str()`, which would fail on non-ASCII header values. If string manipulation is required, call `.to_str().unwrap().to_string()` or `.to_owned()` explicitly.

## Constraints and Gotchas

- `HeaderValue` is borrowed from the request for the duration of the iteration loop. Do not attempt to move it out of the loop without calling `.to_owned()`.
- `Response::builder()` takes ownership of itself at each chained call. After `.body(...)` is called the builder is consumed and cannot be reused.
- If a request header value contains non-ASCII bytes, `value.to_str()` returns `Err`. The example sidesteps this by passing `&HeaderValue` directly to `.header()`, which is only valid when the builder accepts that type without intermediate string conversion.
- The response body is a static `&str` wrapped in `Body::from(...)`.

## Build

```sh
cargo build --release
# Output: target/wasm32-wasip2/release/headers.wasm
```

## See Also

- platform-overview — FastEdge HTTP app lifecycle and request handling model
- sdk-reference-rust — full wstd API reference including Request, Response, HeaderMap, Body
- best-practices — header handling patterns and env-var configuration conventions
- error-codes — wstd and platform error conditions

## Source Material

### FILE: examples/http/wasi/headers/src/lib.rs

```rust
use std::env;
use wstd::http::body::Body;
use wstd::http::{Request, Response};

#[wstd::http_server]
async fn main(request: Request<Body>) -> anyhow::Result<Response<Body>> {
    let custom_env_var = env::var("MY_CUSTOM_ENV_VAR").unwrap_or_default();

    let mut builder = Response::builder().status(200);

    // Copy request headers to response
    for (name, value) in request.headers() {
        builder = builder.header(name.as_str(), value);
    }

    // Add custom header from env var
    builder = builder.header("x-my-custom-header", &custom_env_var);

    Ok(builder.body(Body::from(
        "Returned all headers with a custom header added",
    ))?)
}
```

### FILE: examples/http/wasi/headers/Cargo.toml

```toml
[workspace]

[package]
name = "headers"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wstd = "0.6"
anyhow = "1"
```

### FILE: examples/http/wasi/headers/README.md

```
[← Back to examples](../../../README.md)

# Headers (WASI)

Echoes all request headers back in the response and adds a custom `x-my-custom-header` whose value comes from an environment variable.

Demonstrates reading request headers via `request.headers()`, building a response with `Response::builder()`, and injecting environment-variable values into response headers.

## Configuration

| Env var | Required | Description |
|---|---|---|
| `MY_CUSTOM_ENV_VAR` | No | Value placed in the `x-my-custom-header` response header. Empty string if unset. |

## What it returns

All request headers are copied to the response, then `x-my-custom-header` is appended.

```
HTTP/1.1 200 OK
x-my-custom-header: <MY_CUSTOM_ENV_VAR value>
<...all other request headers echoed back...>

Returned all headers with a custom header added
```

## Build

```sh
cargo build --release
# Output: target/wasm32-wasip2/release/headers.wasm
```

## APIs used

- `request.headers()` — iterate over incoming request headers
- `Response::builder().header(name, value)` — build response with individual headers
- `std::env::var("KEY").unwrap_or_default()` — read optional env var
```
