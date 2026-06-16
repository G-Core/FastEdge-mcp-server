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
app_type: cdn
languages: [rust]
capabilities: [ab-testing, traffic-splitting, cookie, path-rewriting, experiment, variant-assignment]
---

# A/B Testing — CDN App Example (Rust)

Cookie-based A/B traffic splitting at the CDN layer. Assigns users to variant A or B using a persistent cookie, then rewrites the request path to route traffic to different origin paths. Variant assignment persists across requests via `Set-Cookie` on the response.

---

## Overview

- **App type**: CDN (proxy-wasm `HttpContext`)
- **Language**: Rust
- **Crate**: `proxy-wasm = "0.2"`
- **Crate type**: `cdylib` (WASM library target)
- **Edition**: 2024

---

## Environment Variables

| Variable | Required | Type | Description |
|---|---|---|---|
| `EXPERIMENT_NAME` | Yes | `String` | Name of the experiment; used to construct the cookie name (`fe_exp_<name>`) and upstream headers |
| `VARIANT_A_PATH` | Yes | `String` | Path prefix prepended to the request path for variant A traffic |
| `VARIANT_B_PATH` | Yes | `String` | Path prefix prepended to the request path for variant B traffic |

All three variables must be set. Missing any one causes a 500 response and `Action::Pause`.

---

## Entry Point

```rust
proxy_wasm::main! {{
    proxy_wasm::set_log_level(LogLevel::Info);
    proxy_wasm::set_root_context(|_| -> Box<dyn RootContext> { Box::new(AbTestingRoot) });
}}
```

The `proxy_wasm::main!` macro registers the root context factory. Log level is set to `Info`.

---

## Context Types

### `AbTestingRoot`

Implements `RootContext` and `Context`. Stateless unit struct.

| Method | Return | Description |
|---|---|---|
| `get_type(&self)` | `Option<ContextType>` | Returns `Some(ContextType::HttpContext)` |
| `create_http_context(&self, _: u32)` | `Option<Box<dyn HttpContext>>` | Returns a new `AbTestingContext` per request |

### `AbTestingContext`

Implements `HttpContext` and `Context`. Unit struct — **no fields**. Cross-hook state is carried via request headers (`X-Variant`, `X-Experiment`) set in the request hook and read back in the response hook, because instance state does not survive the nginx → core-proxy hop.

---

## Request Hook

### `on_http_request_headers`

Signature: `fn on_http_request_headers(&mut self, _: usize, _: bool) -> Action`

Executes on every inbound request before forwarding to origin.

**Step-by-step control flow:**

1. Read `EXPERIMENT_NAME` via `env::var("EXPERIMENT_NAME")`. On error → send 500 `App misconfigured - EXPERIMENT_NAME must be set`, return `Action::Pause`.
2. Read `VARIANT_A_PATH` via `env::var("VARIANT_A_PATH")`. On error → send 500 `App misconfigured - VARIANT_A_PATH must be set`, return `Action::Pause`.
3. Read `VARIANT_B_PATH` via `env::var("VARIANT_B_PATH")`. On error → send 500 `App misconfigured - VARIANT_B_PATH must be set`, return `Action::Pause`.
4. Construct cookie name: `format!("fe_exp_{}", experiment_name)`.
5. Read `Cookie` header via `self.get_http_request_header("Cookie")`, defaulting to empty string on `None`.
6. Parse existing variant assignment via `get_cookie_value(&cookie_header, &cookie_name)`.
7. If the cookie value is not `"A"` or `"B"` (new visitor or no cookie):
   - Get current time via `self.get_current_time().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis()`.
   - Assign `"A"` if `millis % 2 == 0`, else `"B"`.
8. Read current request path via `self.get_property(vec!["request.path"])`, decoded as UTF-8, defaulting to `"/"`.
9. Select path prefix: `variant_a_path` if `"A"`, `variant_b_path` if `"B"`.
10. Rewrite path: `format!("{}{}", variant_path, path)`.
11. Write rewritten path via `self.set_property(vec!["request.path"], Some(new_path.as_bytes()))`.
12. Add upstream headers (also used as cross-hook state carrier):
    - `self.add_http_request_header("X-Experiment", &experiment_name)`
    - `self.add_http_request_header("X-Variant", &assigned)`
13. Log at `Info` (via `println!`): `A/B test "<name>": variant <V>, path <new_path>`.
14. Return `Action::Continue`.

---

## Response Hook

### `on_http_response_headers`

Signature: `fn on_http_response_headers(&mut self, _: usize, _: bool) -> Action`

Executes after origin response headers arrive. Recovers variant state by reading back the request headers set in the request hook, because instance state does not survive the nginx → core-proxy hop.

**Control flow:**

1. Read `X-Variant` from request headers via `self.get_http_request_header("X-Variant")`. If `None` → return `Action::Continue` immediately.
2. Read `X-Experiment` from request headers via `self.get_http_request_header("X-Experiment")`. If `None` → return `Action::Continue` immediately.
3. Build `Set-Cookie` value:
   ```
   fe_exp_<experiment_name>=<variant>; Path=/; Max-Age=86400; SameSite=Lax
   ```
4. `self.add_http_response_header("Set-Cookie", &cookie)` — persists variant for 24 hours.
5. `self.add_http_response_header("X-Variant", &variant)` — variant visible to downstream clients.
6. Return `Action::Continue`.

---

## Cookie Parsing

### `get_cookie_value`

```rust
fn get_cookie_value(cookie_header: &str, name: &str) -> String
```

| Parameter | Type | Description |
|---|---|---|
| `cookie_header` | `&str` | Raw value of the `Cookie` request header |
| `name` | `&str` | Cookie name to look up |

**Returns**: The cookie value as `String`, or empty `String` if not found or if `cookie_header` is empty.

**Algorithm:**
1. If `cookie_header` is empty → return `String::new()`.
2. Construct prefix `format!("{}=", name)`.
3. Split `cookie_header` on `';'`, trim whitespace from each pair.
4. For each pair: if it starts with the prefix → return the remainder after the prefix via `strip_prefix`.
5. If no match found → return `String::new()`.

---

## Variant Assignment Logic

| Condition | Assigned Variant |
|---|---|
| Cookie `fe_exp_<name>` equals `"A"` | `"A"` (existing assignment honored) |
| Cookie `fe_exp_<name>` equals `"B"` | `"B"` (existing assignment honored) |
| Cookie absent or any other value | `"A"` if `current_time_millis % 2 == 0`, else `"B"` |

- Clock source: `self.get_current_time()` (proxy-wasm host clock), converted via `duration_since(UNIX_EPOCH).as_millis()`.
- Split is 50/50 over time due to millisecond parity. Not cryptographically random.

---

## Path Rewriting

| API | Description |
|---|---|
| `self.get_property(vec!["request.path"])` | Reads current request path as `Vec<u8>`; decoded as UTF-8 via `.and_then(\|bytes\| String::from_utf8(bytes).ok())`; defaults to `"/"` on absent/error |
| `self.set_property(vec!["request.path"], Some(bytes))` | Overwrites the request path before forwarding to origin |

Rewritten path format: `<variant_path><original_path>`

Example: `VARIANT_A_PATH=/experiments/a`, original path `/product/123` → new path `/experiments/a/product/123`.

---

## Headers Set

### On Request (forwarded to origin; also used as cross-hook state)

| Header | Value | Description |
|---|---|---|
| `X-Experiment` | `experiment_name` | Identifies the active experiment; read back in response hook |
| `X-Variant` | `"A"` or `"B"` | Assigned variant for this request; read back in response hook |

### On Response (returned to client)

| Header | Value | Description |
|---|---|---|
| `Set-Cookie` | `fe_exp_<name>=<variant>; Path=/; Max-Age=86400; SameSite=Lax` | Persists variant assignment for 24 hours |
| `X-Variant` | `"A"` or `"B"` | Variant visible in response |

---

## Response Codes

| Condition | HTTP Status | Body |
|---|---|---|
| `EXPERIMENT_NAME` env var missing | 500 | `App misconfigured - EXPERIMENT_NAME must be set` |
| `VARIANT_A_PATH` env var missing | 500 | `App misconfigured - VARIANT_A_PATH must be set` |
| `VARIANT_B_PATH` env var missing | 500 | `App misconfigured - VARIANT_B_PATH must be set` |
| All env vars set, valid cookie or new visitor | — | Request forwarded (`Action::Continue`) |

All error paths return `Action::Pause` after `send_http_response`.

---

## Cargo.toml

```toml
[workspace]

[package]
name = "ab_testing"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib"]

[dependencies]
proxy-wasm = "0.2"
```

No additional dependencies. Uses `std::env` and `std::time::UNIX_EPOCH` from the standard library.

---

## Gotchas

- **Cookie name convention**: Cookie is always named `fe_exp_<experiment_name>`. The experiment name must not contain characters that are invalid in cookie names (e.g. spaces, `=`, `;`).
- **Cross-hook state via request headers, not struct fields**: `AbTestingContext` is a unit struct with no fields. The assigned variant and experiment name are stored in the upstream request headers (`X-Variant`, `X-Experiment`) during `on_http_request_headers` and recovered by reading those same request headers in `on_http_response_headers`. Instance state does not survive the nginx → core-proxy hop.
- **`get_current_time()` returns `SystemTime`**: Requires `.duration_since(UNIX_EPOCH)` before arithmetic. `unwrap_or_default()` is used — a zero duration produces variant `"A"` (0 % 2 == 0).
- **Not cryptographically random**: Millisecond parity is a deterministic, time-based split. Do not use this for security-sensitive experiments. Users hitting the edge at the same millisecond receive the same variant.
- **Path rewriting via `set_property`**: Uses `self.set_property(vec!["request.path"], ...)` directly rather than URL rewriting to avoid ambiguous behavior with query strings and fragments.
- **`SameSite=Lax`**: Cookie uses `SameSite=Lax` for basic CSRF protection. Upgrade to `SameSite=Strict` if the experiment does not require cross-site navigation.
- **`Max-Age=86400`**: Cookie expires after 24 hours. Adjust `Max-Age` to control how long variant assignments persist.
- **Missing header guard in response hook**: If `X-Variant` or `X-Experiment` request headers are absent (e.g. request hook aborted early due to missing env vars), the response hook returns `Action::Continue` immediately without setting `Set-Cookie`.
- **No whitespace trimming on cookie value**: `strip_prefix` matches exactly — the `trim()` call on each `split(';')` pair handles leading/trailing whitespace around the name=value pair itself, but values with embedded spaces are not trimmed.

---

## See Also

- proxy-wasm Rust SDK reference (HttpContext trait, `get_property`, `set_property`, `add_http_request_header`, `add_http_response_header`, `get_http_request_header`, `get_current_time`)
- FastEdge CDN app platform overview (request properties, proxy-wasm filter lifecycle)
- FastEdge environment variable configuration (setting `EXPERIMENT_NAME`, `VARIANT_A_PATH`, `VARIANT_B_PATH` at deploy time)
- examples-geoblock-rust reference (similar CDN proxy-wasm filter structure)
- examples-auth-jwt-rust reference (CDN Rust example with cross-hook state pattern)
