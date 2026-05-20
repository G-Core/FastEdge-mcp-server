<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 4f748b10fa04226e76218e88195b6b1f02fce032
      updated: 2026-04-20
-->

---
capabilities:
  - large-env-var
  - dictionary
type: example
app_type: cdn
languages:
  - rust
---

## Large Environment Variable — CDN (Rust)

### Overview

Demonstrates how to read environment variable values that may exceed the 64KB WASI environment variable size limit using `fastedge::proxywasm::dictionary::get`. For values under 64KB, use the standard `std::env::var()` instead.

---

### API Patterns

#### `fastedge::proxywasm::dictionary::get`

```rust
use fastedge::proxywasm::dictionary;

pub fn get(name: &str) -> Option<String>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `&str` | Environment variable name to read |

**Return type**: `Option<String>`
- `Some(value)` — variable exists and was read successfully
- `None` — variable is not set; `.unwrap_or_default()` returns an empty `String`

**Proxy-wasm hook**: `on_http_request_headers` (`HttpContext`)

**Key distinction from `secret::get`**: `dictionary::get` returns `Option<String>` directly, not `Result<Option<Vec<u8>>, u32>`. No UTF-8 conversion or error unpacking is needed.

#### When to use each API

| Method | Use when |
|--------|----------|
| `std::env::var("KEY")` | Variable value is under 64KB (most cases) |
| `fastedge::proxywasm::dictionary::get("KEY")` | Variable value may exceed the 64KB WASI env var size limit |

---

### Common Patterns

#### Read large config and forward size as a request header

```rust
use fastedge::proxywasm::dictionary;
use proxy_wasm::traits::*;
use proxy_wasm::types::*;

impl HttpContext for LargeEnvContext {
    fn on_http_request_headers(&mut self, _: usize, _: bool) -> Action {
        let config = dictionary::get("LARGE_CONFIG").unwrap_or_default();

        let size = config.len();
        proxy_wasm::hostcalls::log(
            LogLevel::Info,
            &format!("LARGE_CONFIG size: {} bytes", size),
        )
        .ok();

        self.add_http_request_header("x-config-size", &size.to_string());

        Action::Continue
    }
}
```

#### Using `unwrap_or_default` for missing values

```rust
// Returns empty String if variable is not set — no error, no panic
let config: String = dictionary::get("LARGE_CONFIG").unwrap_or_default();
```

#### Logging with `.ok()` to ignore log errors

```rust
proxy_wasm::hostcalls::log(LogLevel::Info, &format!("value len: {}", value.len())).ok();
```

The `.ok()` discards the `Result` from `hostcalls::log` — logging failures do not abort request processing.

---

### Gotchas

- **`dictionary::get` returns `Option<String>`, not `Result`**: there is no error variant; a missing key yields `None` (not an error). This differs from `secret::get` which returns `Result<Option<Vec<u8>>, u32>`.
- **Empty string on missing key**: `.unwrap_or_default()` on `None` produces an empty `String`. Code consuming the value must distinguish between "not set" and "set to empty" if that distinction matters.
- **No UTF-8 conversion required**: the return type is already `String`, not `Vec<u8>`. Do not apply `String::from_utf8` chains.
- **64KB limit is per-variable on the WASI env interface**: this limit applies only to `std::env::var()`. The `dictionary` API bypasses it. For values under 64KB, `std::env::var()` is simpler and more idiomatic.
- **Only available in CDN (proxy-wasm) apps**: `fastedge::proxywasm::dictionary` is specific to the proxy-wasm runtime. HTTP Component Model apps use `std::env::var()` only.

---

### Required configuration

- **Environment variable**: `LARGE_CONFIG` — a large configuration payload (e.g. JSON, PEM certificate, policy document)

---

### Related

- Host services reference — secret, dictionary, and key-value store APIs for CDN (proxy-wasm) apps
- CDN apps reference — proxy-wasm lifecycle hooks, context setup, and request/response header manipulation
- SDK API reference (Rust) — `fastedge` crate features and HTTP vs CDN runtime differences
