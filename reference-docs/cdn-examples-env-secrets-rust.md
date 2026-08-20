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
app_type: cdn
languages: [rust]
capabilities: [env-vars, secrets]
---

# Environment Variables and Secrets — CDN (Rust)

## Overview

Accesses deployment-time environment variables via `std::env::var` and platform-managed secrets via `fastedge::proxywasm::secret::get` from within a CDN proxy-wasm filter. Enables forwarding non-sensitive configuration and sensitive credentials as upstream request headers.

## Crate Dependencies

```toml
[dependencies]
proxy-wasm = "0.2"
fastedge = { version = "0.4", features = ["proxywasm"] }
```

Crate type must be `cdylib`.

## API Patterns

### `std::env::var(key: &str) -> Result<String, VarError>`

- **Use path**: `use std::env;` → `env::var("NAME")`
- **Returns**: `Result<String, VarError>` — `Ok(String)` if set, `Err(VarError::NotPresent)` if absent
- **Fallback**: `.unwrap_or_default()` returns `""` when not set
- **Use for**: non-sensitive configuration values set at deployment time (usernames, feature flags, region identifiers)
- **Lifecycle hook**: read in `on_http_request_headers`

### `fastedge::proxywasm::secret::get(key: &str) -> Result<Option<Vec<u8>>, u32>`

- **Use path**: `use fastedge::proxywasm::secret;` → `secret::get("NAME")`
- **Returns**: `Result<Option<Vec<u8>>, u32>`
  - `Ok(Some(Vec<u8>))` — secret exists and is readable
  - `Ok(None)` — secret name not found
  - `Err(u32)` — host-level error (raw status code)
- **Conversion to `String`**: `.ok().flatten().and_then(|v| String::from_utf8(v).ok()).unwrap_or_default()`
- **Use for**: sensitive values (passwords, API tokens, credentials) stored in the FastEdge platform secret store
- **Lifecycle hook**: read in `on_http_request_headers`

**Note**: The error type for `secret::get` is `u32` (raw host status code), not a typed `Error` enum.

## Common Patterns

### Read env var and secret, forward as request headers

```rust
use fastedge::proxywasm::secret;
use std::env;
use proxy_wasm::traits::*;
use proxy_wasm::types::*;

impl HttpContext for VariablesContext {
    fn on_http_request_headers(&mut self, _: usize, _: bool) -> Action {
        // Non-sensitive config from env var
        let username = env::var("USERNAME").unwrap_or_default();

        // Sensitive value from platform secret store
        let password = secret::get("PASSWORD")
            .ok()
            .flatten()
            .and_then(|v| String::from_utf8(v).ok())
            .unwrap_or_default();

        self.add_http_request_header("x-env-username", &username);
        self.add_http_request_header("x-env-password", &password);

        Action::Continue
    }
}
```

### Log retrieved values (debug only)

```rust
println!("USERNAME: {}", username);
println!("PASSWORD: {}", password);
```

Do not log secrets in production code — platform logs are visible to operators and may be persisted. This pattern is for demonstration only; remove secret logging in any real application.

### Entry point and root context setup

```rust
proxy_wasm::main! {{
    proxy_wasm::set_log_level(LogLevel::Info);
    proxy_wasm::set_root_context(|_| -> Box<dyn RootContext> { Box::new(VariablesRoot) });
}}

struct VariablesRoot;
impl Context for VariablesRoot {}
impl RootContext for VariablesRoot {
    fn get_type(&self) -> Option<ContextType> {
        Some(ContextType::HttpContext)
    }
    fn create_http_context(&self, _: u32) -> Option<Box<dyn HttpContext>> {
        Some(Box::new(VariablesContext))
    }
}
```

## Env Vars vs Secrets — Decision Guide

| Characteristic | `std::env::var` | `secret::get` |
|---|---|---|
| Value sensitivity | Non-sensitive | Sensitive |
| Set at | Deployment time (not runtime-configurable) | Platform secret store |
| Return type | `Result<String, VarError>` | `Result<Option<Vec<u8>>, u32>` |
| Decoding needed | No — already `String` | Yes — `Vec<u8>` must be converted to `String` |
| Rotation support | No | Yes (via `secret::get_effective_at`) |
| Typical use | Config, usernames, feature flags | Passwords, API keys, tokens |

## Complete Example

**Source**: `examples/cdn/variables_and_secrets/src/lib.rs`

```rust
use fastedge::proxywasm::secret;
use std::env;
use proxy_wasm::traits::*;
use proxy_wasm::types::*;

proxy_wasm::main! {{
    proxy_wasm::set_log_level(LogLevel::Info);
    proxy_wasm::set_root_context(|_| -> Box<dyn RootContext> { Box::new(VariablesRoot) });
}}

struct VariablesRoot;

impl Context for VariablesRoot {}

impl RootContext for VariablesRoot {
    fn get_type(&self) -> Option<ContextType> {
        Some(ContextType::HttpContext)
    }

    fn create_http_context(&self, _: u32) -> Option<Box<dyn HttpContext>> {
        Some(Box::new(VariablesContext))
    }
}

struct VariablesContext;

impl Context for VariablesContext {}

impl HttpContext for VariablesContext {
    fn on_http_request_headers(&mut self, _: usize, _: bool) -> Action {
        let username = env::var("USERNAME").unwrap_or_default();
        let password = secret::get("PASSWORD")
            .ok()
            .flatten()
            .and_then(|v| String::from_utf8(v).ok())
            .unwrap_or_default();

        println!("USERNAME: {}", username);
        // WARNING: Secrets are stored and retrieved as plaintext. Never log secret values
        // in production code — platform logs are visible to operators and may be persisted.
        // This line is shown for demonstration only; remove it in any real application.
        println!("PASSWORD: {}", password);

        self.add_http_request_header("x-env-username", &username);
        // WARNING: Forwarding a secret in a request header exposes it to the upstream origin
        // and any intermediary that can inspect headers. Only do this when the upstream
        // channel is trusted and the header is required by the destination API.
        self.add_http_request_header("x-env-password", &password);

        Action::Continue
    }
}
```

## Build Configuration

**Package name**: `variables_and_secrets`

```toml
[workspace]

[package]
name = "variables_and_secrets"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib"]

[dependencies]
proxy-wasm = "0.2"
fastedge = { version = "0.4", features = ["proxywasm"] }
```

Build command:

```bash
cargo build --release --target wasm32-wasip1
```

Output: `target/wasm32-wasip1/release/variables_and_secrets.wasm`

## Gotchas

| Issue | Detail |
|---|---|
| Env vars are deployment-time only | `std::env::var` reads values baked in at deploy time. They cannot be changed at runtime without redeployment. |
| `secret::get` returns `Vec<u8>`, not `String` | Must convert: `.ok().flatten().and_then(|v| String::from_utf8(v).ok())`. Bare `.unwrap()` on `String::from_utf8` panics on invalid UTF-8. |
| `secret::get` error type is `u32` | Unlike KV store (typed `Error` enum), secret errors are raw host status codes. Use `.ok()` to discard and treat errors as missing. |
| Missing values silently become `""` | Both `unwrap_or_default()` on env var and the full secret chain produce an empty string on absence. If a missing value is an error condition, check explicitly before forwarding. |
| Logging secrets | Platform logs are visible to operators and may be persisted. Never log secret values in production — demonstration code only. |
| Forwarding secrets as headers | Adding a secret as a request header exposes it to the upstream origin and any intermediary that can inspect headers. Only do this when the upstream channel is trusted and the header is required by the destination API. |

## See Also

- sdk-reference-rust (full proxy-wasm trait and type reference)
- host-services-rust (FastEdge CDN host services including secret and dictionary APIs)
- examples-headers-cdn-rust (request/response header manipulation patterns)
- platform-overview (secret management, deployment configuration, and environment variable setup)
- best-practices (logging levels and secret handling guidelines)
