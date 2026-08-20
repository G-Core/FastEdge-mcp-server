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
capabilities: [env-vars, secrets]
---

# Variables and Secrets — WASI (Rust)

Demonstrates reading an environment variable and a secret from a FastEdge HTTP app, returning both values in the response body.

## Overview

- Reads `USERNAME` from environment variables via `std::env::var`
- Reads `PASSWORD` from encrypted secrets via `fastedge::secret::get`
- Returns both values in a plain-text `200 OK` response body

Environment variables are set in the FastEdge app configuration and are visible in the platform UI. Secrets are stored encrypted and are never exposed in logs or configuration UIs.

## Package

```toml
[package]
name = "variables_and_secrets"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wstd = "0.6"
fastedge = "0.4"
anyhow = "1"
```

## Entry Point

```rust
#[wstd::http_server]
async fn main(_request: Request<Body>) -> anyhow::Result<Response<Body>>
```

The request parameter is accepted but unused. The handler returns a fixed `200 OK` response regardless of the request content.

## APIs Used

### `std::env::var`

```rust
std::env::var(key: &str) -> Result<String, std::env::VarError>
```

- Reads an environment variable by name.
- `.unwrap_or_default()` returns an empty string if the variable is absent or invalid UTF-8.
- Environment variables are plain-text; set via FastEdge app configuration; visible in the platform UI.
- Available in WASI apps via the standard `std::env` module.

**Pattern used:**

```rust
let username = env::var("USERNAME").unwrap_or_default();
```

### `fastedge::secret::get`

```rust
fastedge::secret::get(name: &str) -> Result<Option<String>, ...>
```

- Reads an encrypted secret by name.
- Return type is `Result<Option<String>>` — both layers must be handled explicitly.
- `Ok(Some(value))` — secret exists and was retrieved successfully; `value` is the decrypted string.
- All other arms (`Ok(None)`, `Err(_)`) — secret is absent or retrieval failed; return a fallback.
- Secrets are never exposed in platform logs or configuration UIs.
- Requires the `fastedge` crate in `Cargo.toml` alongside `wstd`.

**Pattern used:**

```rust
let password = match secret::get("PASSWORD") {
    Ok(Some(value)) => value,
    _ => String::new(),
};
```

## Configuration

| Key | Type | Required | Description |
|---|---|---|---|
| `USERNAME` | Environment variable | No | Included in the response body. Empty string if unset. |
| `PASSWORD` | Secret | No | Included in the response body. Empty string if unset or retrieval fails. |

## Response

```
HTTP/1.1 200 OK

Username: <USERNAME value>, Password: <PASSWORD value>
```

## Build

```sh
cargo build --release
# Output: target/wasm32-wasip2/release/variables_and_secrets.wasm
```

## Gotchas

- `fastedge::secret::get` returns `Result<Option<String>>`, not `Option<String>`. The outer `Result` must be handled before the inner `Option`. Matching only on `Some(v)` without the outer `Ok(...)` is a type error.
- The `fastedge` crate must be declared in `Cargo.toml` explicitly; it is not included transitively via `wstd`.
- Environment variables are plain-text and visible in the FastEdge app configuration UI. Use secrets for any sensitive values.
- `std::env` is available in WASI apps. This differs from some other WASM targets where `std::env` is unavailable.

## See Also

- fastedge-sdk-rust secret API reference
- platform-overview (app configuration and secrets management)
- examples-hello-world-wasi-rust (minimal HTTP handler baseline)

## Source Material

### FILE: examples/http/wasi/variables_and_secrets/src/lib.rs

```rust
use fastedge::secret;
use std::env;
use wstd::http::body::Body;
use wstd::http::{Request, Response};

#[wstd::http_server]
async fn main(_request: Request<Body>) -> anyhow::Result<Response<Body>> {
    let username = env::var("USERNAME").unwrap_or_default();
    let password = match secret::get("PASSWORD") {
        Ok(Some(value)) => value,
        _ => String::new(),
    };

    Ok(Response::builder()
        .status(200)
        .body(Body::from(format!(
            "Username: {username}, Password: {password}"
        )))?)
}
```

### FILE: examples/http/wasi/variables_and_secrets/Cargo.toml

```toml
[workspace]

[package]
name = "variables_and_secrets"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wstd = "0.6"
fastedge = "0.4"
anyhow = "1"
```

### FILE: examples/http/wasi/variables_and_secrets/README.md

```
[← Back to examples](../../../README.md)

# Variables and Secrets (WASI)

Demonstrates reading an environment variable (`USERNAME`) and a secret (`PASSWORD`), returning both in the response body.

Environment variables are set via the FastEdge app configuration and accessed with `std::env::var`. Secrets are stored encrypted and accessed with `fastedge::secret::get` — they are never exposed in platform logs or configuration UIs.

## Configuration

| Key | Type | Required | Description |
|---|---|---|---|
| `USERNAME` | Environment variable | No | Username to include in response. Empty string if unset. |
| `PASSWORD` | Secret | No | Password to include in response. Empty string if unset or unavailable. |

## What it returns

```
HTTP/1.1 200 OK

Username: <USERNAME value>, Password: <PASSWORD value>
```

## Build

```sh
cargo build --release
# Output: target/wasm32-wasip2/release/variables_and_secrets.wasm
```

## APIs used

- `std::env::var("USERNAME").unwrap_or_default()` — read env var with fallback
- `fastedge::secret::get("PASSWORD")` — read secret by name; returns `Ok(Some(String))` on success
```
