<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 6347a7c2fda0d03e66f1214db5eec041c16801b7
      updated: 2026-06-16
-->

# Secret Access — Rust HTTP Example

Access encrypted secrets injected by the FastEdge platform using `secret::get()` and `secret::get_effective_at()`. Covers all error variants and the time-based secret versioning API.

## Metadata

| Field | Value |
|---|---|
| App type | HTTP |
| Language | Rust |
| SDK | `fastedge = "0.4"` |
| Example path | `examples/http/basic/secret/` |
| Handler macro | `#[fastedge::http]` |

## APIs Used

### `secret::get`

```rust
pub fn get(name: &str) -> Result<Option<Vec<u8>>, secret::Error>
```

Retrieves the current value of a named secret.

| Parameter | Type | Description |
|---|---|---|
| `name` | `&str` | The secret name as configured on the platform |

**Returns:** `Ok(Some(value))` if found, `Ok(None)` if the secret name is valid but not set, or `Err(secret::Error)` on failure.

---

### `secret::get_effective_at`

```rust
pub fn get_effective_at(name: &str, timestamp: u32) -> Result<Option<Vec<u8>>, secret::Error>
```

Retrieves the secret value that was effective at a specific Unix timestamp. Used for scheduled rotation and versioning — returns the version of the secret active at the given point in time.

| Parameter | Type | Description |
|---|---|---|
| `name` | `&str` | The secret name as configured on the platform |
| `timestamp` | `u32` | Unix timestamp (seconds); note this is `u32`, not `u64` |

**Returns:** Same as `secret::get` — `Ok(Some(value))`, `Ok(None)`, or `Err(secret::Error)`.

---

### `secret::Error` Variants

| Variant | Meaning |
|---|---|
| `AccessDenied` | App is not permitted to read this secret |
| `Other(String)` | Denial with a human-readable message |
| `DecryptError` | Secret exists but could not be decrypted |

Note: `secret::Error` is its own type, distinct from `anyhow::Error`. To use it with `Response::builder()`, convert with `.map_err(Error::msg)`.

## Error-to-Response Mapping

| Result | HTTP Status | Body |
|---|---|---|
| `Ok(Some(value))` | 200 | Secret value(s) in Debug format |
| `Ok(None)` | 404 | Empty |
| `Err(AccessDenied)` | 403 | Empty |
| `Err(Other(msg))` | 403 | `msg` as body |
| `Err(DecryptError)` | 500 | Empty |

## Handler Flow

```
request received
  │
  ├─ secret::get("SECRET")
  │     ├─ Err(AccessDenied)  → 403 empty
  │     ├─ Err(Other(msg))    → 403 with msg body
  │     ├─ Err(DecryptError)  → 500 empty
  │     ├─ Ok(None)           → 404 empty
  │     └─ Ok(Some(value))    → continue
  │
  ├─ SystemTime::now() → unix_ts as u32
  │
  ├─ secret::get_effective_at("SECRET", unix_ts)
  │     ├─ Err(AccessDenied)  → 403 empty
  │     ├─ Err(Other(msg))    → 403 with msg body
  │     ├─ Err(DecryptError)  → 500 empty
  │     ├─ Ok(None)           → 404 empty
  │     └─ Ok(Some(value))    → continue
  │
  └─ 200 with both values in body (Debug format)
```

## Complete Example

```rust
use anyhow::{Error, Result};
use std::time::SystemTime;

use fastedge::body::Body;
use fastedge::http::{Request, Response, StatusCode};
use fastedge::secret;

#[fastedge::http]
fn main(_req: Request<Body>) -> Result<Response<Body>> {
    let value = match secret::get("SECRET") {
        Ok(value) => value,
        Err(secret::Error::AccessDenied) => {
            return Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(Body::empty())
                .map_err(Error::msg);
        }
        Err(secret::Error::Other(msg)) => {
            return Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(Body::from(msg))
                .map_err(Error::msg);
        }
        Err(secret::Error::DecryptError) => {
            return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::empty())
                .map_err(Error::msg);
        }
    };

    if value.is_none() {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::empty())
            .map_err(Error::msg);
    }

    let ts = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .expect("Time went backwards")
        .as_secs();

    let effective_at_value = match secret::get_effective_at("SECRET", ts as u32) {
        Ok(value) => value,
        Err(secret::Error::AccessDenied) => {
            return Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(Body::empty())
                .map_err(Error::msg);
        }
        Err(secret::Error::Other(msg)) => {
            return Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(Body::from(msg))
                .map_err(Error::msg);
        }
        Err(secret::Error::DecryptError) => {
            return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::empty())
                .map_err(Error::msg);
        }
    };

    if effective_at_value.is_none() {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::empty())
            .map_err(Error::msg);
    }

    Response::builder()
        .status(StatusCode::OK)
        .body(Body::from(format!(
            "get={:?}\nget_efective_at={:?}\n",
            value, effective_at_value
        )))
        .map_err(Error::msg)
}
```

## Cargo.toml

```toml
[package]
name = "secret"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
fastedge = "0.4"
anyhow = "1"
```

## Build

```sh
cargo build --release
# Output: target/wasm32-wasip1/release/secret.wasm
```

## Gotchas

- `secret::get` returns `Option` — `Ok(None)` means the secret name is valid but no value is set. This is distinct from an error.
- `get_effective_at` takes a `u32` timestamp, not `u64`. Cast with `as u32` after calling `.as_secs()` on the `Duration`.
- `secret::Error` is not `anyhow::Error`. Use `.map_err(Error::msg)` to convert when returning from a function typed `Result<Response<Body>>`.
- Both `get` and `get_effective_at` must be independently error-handled — each can fail independently.
- The response body uses the Debug format (`{:?}`) for both secret values.
- Known cosmetic issue: the response body contains a typo — `get_efective_at` (one `f`) instead of `get_effective_at`. This matches the source exactly.

## Local Testing

Inject the secret via a `.env` file in your fixtures directory using the `FASTEDGE_VAR_SECRET_<NAME>` prefix:

```
# fixtures/.env
FASTEDGE_VAR_SECRET_SECRET=my-test-value
```

Run with the fixture validator:

```sh
node tools/fixture-validator/index.mjs \
  examples/http/basic/secret/ \
  --wasm examples/http/basic/secret/target/wasm32-wasip1/release/secret.wasm
```

## Expected Behavior

| Scenario | Secret `SECRET` | Response status | Response body |
|---|---|---|---|
| Happy path | `"my-value"` | 200 | `get=Some("my-value")\nget_efective_at=Some("my-value")\n` |
| Secret not set | (absent) | 404 | (empty) |
| Access denied | — | 403 | (empty) |
| Decrypt failure | — | 500 | (empty) |

## See Also

- fastedge-docs skill reference: platform-overview
- fastedge-docs skill reference: sdk-reference-rust
- fastedge-docs skill reference: error-codes
- manage skill: secret management subcommands (set, list, delete)
