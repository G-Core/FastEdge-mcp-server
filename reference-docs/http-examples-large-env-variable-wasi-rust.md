<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 6347a7c2fda0d03e66f1214db5eec041c16801b7
      updated: 2026-08-20
-->

# Large Environment Variable (WASI) — Rust HTTP Example

## Overview

Demonstrates how to read environment variables that may exceed the 64KB WASI environment variable size limit using `fastedge::dictionary`. For normal-sized environment variables (under 64KB), `std::env::var()` is preferred.

- **App type**: HTTP
- **Runtime**: WASI (wstd)
- **Language**: Rust
- **Crate**: `large_env_variable`

---

## API Reference

### `fastedge::dictionary::get`

```rust
use fastedge::dictionary;

fn dictionary::get(name: &str) -> Option<String>
```

**Parameters**:
- `name: &str` — the environment variable name to look up (e.g. `"LARGE_CONFIG"`)

**Returns**: `Option<String>` — `Some(value)` if the variable exists, `None` if absent.

**Error handling**: Returns `Option`, not `Result`. Use `.unwrap_or_default()` or `.unwrap_or_else(|| ...)` to handle absence. No `?` propagation needed.

**Import path**: `use fastedge::dictionary;`

**Dependency requirement**: The `fastedge` crate must be declared explicitly in `Cargo.toml` (not provided transitively by `wstd`).

---

## When to Use `dictionary` vs `std::env`

| Method | Use when |
|--------|----------|
| `std::env::var("KEY")` | Variable value is under 64KB (most cases) |
| `fastedge::dictionary::get("KEY")` | Variable value may exceed the 64KB WASI env var size limit |

The WASI environment variable interface enforces a 64KB size limit per variable. Use `dictionary::get` for large payloads such as JSON configs, PEM certificates, or policy documents.

---

## Required Configuration

| Variable | Description |
|----------|-------------|
| `LARGE_CONFIG` | A large configuration payload (e.g. JSON, PEM certificate). Must be set as an environment variable on the FastEdge app. |

---

## Complete Example

### `src/lib.rs`

```rust
use fastedge::dictionary;
use wstd::http::body::Body;
use wstd::http::{Request, Response};

#[wstd::http_server]
async fn main(_request: Request<Body>) -> anyhow::Result<Response<Body>> {
    // Use dictionary::get for environment variables that may exceed 64KB.
    // For normal-sized env vars, use std::env::var() instead.
    let config = dictionary::get("LARGE_CONFIG").unwrap_or_default();

    let size = config.len();

    Ok(Response::builder()
        .status(200)
        .body(Body::from(format!(
            "LARGE_CONFIG loaded: {} bytes",
            size
        )))?)
}
```

### `Cargo.toml`

```toml
[workspace]

[package]
name = "large_env_variable"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wstd = "0.6"
fastedge = "0.4"
anyhow = "1"
```

---

## Common Patterns

**Read a large env var with fallback to empty string:**
```rust
let config = dictionary::get("LARGE_CONFIG").unwrap_or_default();
```

**Read a large env var with custom fallback:**
```rust
let config = dictionary::get("LARGE_CONFIG").unwrap_or_else(|| String::from("{}"));
```

**Check presence before using:**
```rust
match dictionary::get("LARGE_CONFIG") {
    Some(config) => { /* process config */ }
    None => { /* handle missing */ }
}
```

---

## Gotchas

- `dictionary::get` returns `Option<String>`, not `Result` — do not use `?` for propagation.
- The `fastedge` crate must be listed as an explicit dependency in `Cargo.toml`; `wstd` alone does not provide it.
- Use `dictionary::get` only when the value may exceed 64KB. For smaller values, `std::env::var()` is simpler and idiomatic.
- Variable name strings must match exactly what is configured on the FastEdge app (e.g. `"LARGE_CONFIG"`).

---

## See Also

- fastedge-sdk-rust SDK reference
- platform-overview (environment variable configuration)
- deploy skill reference (setting environment variables on FastEdge apps)
- examples for standard environment variable access using `std::env::var`
