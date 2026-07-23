<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 6347a7c2fda0d03e66f1214db5eec041c16801b7
      updated: 2026-07-23
-->

---
type: example
app_type: cdn
languages: [rust]
capabilities: [geoblock, geo-filtering, country-detection, access-control, time-window]
---

# Geoblock — CDN App Example (Rust)

Country-based request blocking for CDN apps using the proxy-wasm Rust SDK. Reads the client country from a request property, checks it against a configurable blacklist, and optionally applies a time-window constraint before blocking.

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
| `BLACKLIST` | Yes | `String` | Comma-separated list of ISO country codes to block (e.g. `US,CN,RU`) |
| `BLACKLIST_TW_START` | No | `u64` (Unix timestamp) | Start of blocking time window (seconds since epoch) |
| `BLACKLIST_TW_END` | No | `u64` (Unix timestamp) | End of blocking time window (seconds since epoch) |

Both `BLACKLIST_TW_START` and `BLACKLIST_TW_END` must be set together. If only one is set, the time-window check is skipped and the request is blocked unconditionally.

---

## Request Property

| Property path | Type | Description |
|---|---|---|
| `request.country` | `Vec<u8>` (UTF-8 bytes) | Two-letter country code injected by the CDN edge |

Retrieved via `self.get_property(vec!["request.country"])`. Returns `None` if the property is absent.

---

## Entry Point

```rust
proxy_wasm::main! {{
    proxy_wasm::set_log_level(LogLevel::Trace);
    proxy_wasm::set_root_context(|_| -> Box<dyn RootContext> { Box::new(GeoblockRoot) });
}}
```

The `proxy_wasm::main!` macro registers the root context factory. `GeoblockRoot` implements `RootContext` and creates `GeoblockContext` instances per request via `create_http_context`.

---

## Context Types

### `GeoblockRoot`

Implements `RootContext` and `Context`.

| Method | Return | Description |
|---|---|---|
| `create_http_context(&self, _context_id: u32)` | `Option<Box<dyn HttpContext>>` | Returns a new `GeoblockContext` instance for each request |
| `get_type(&self)` | `Option<ContextType>` | Returns `Some(ContextType::HttpContext)` |

### `GeoblockContext`

Implements `HttpContext` and `Context`. Stateless — no fields.

---

## Control Flow

### `on_http_request_headers`

Signature: `fn on_http_request_headers(&mut self, _: usize, _: bool) -> Action`

Executes on every inbound request before forwarding.

1. Read `BLACKLIST` env var via `env::var("BLACKLIST")`. On error → send 500 `App misconfigured`, return `Action::Pause`.
2. Split blacklist on `,` → iterator of candidate country codes (no whitespace trimming).
3. Read `request.country` property via `self.get_property(vec!["request.country"])`. On `None` → send 502 `Malformed request - no country field`, return `Action::Pause`.
4. Decode country bytes as UTF-8 via `std::str::from_utf8`. On error → send 502 `Malformed request - country not utf8 string`, return `Action::Pause`.
5. Case-insensitive match via `eq_ignore_ascii_case`: check if decoded country appears in blacklist iterator.
6. If matched:
   - Read `BLACKLIST_TW_START` and `BLACKLIST_TW_END` via `env::var(...).ok()`.
   - If both are `Some` (via `.zip`):
     - Parse `tw_start` as `u64`. On error → send 500 `App misconfigured`, return `Action::Pause`.
     - Parse `tw_end` as `u64`. On error → send 500 `App misconfigured`, return `Action::Pause`.
     - Get current Unix timestamp via `SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()`.
     - If `now >= tw_start && now <= tw_end` → send 403 `Request blacklisted`, return `Action::Pause`.
     - Otherwise → fall through to `Action::Continue`.
   - If not both `Some` → send 403 `Request blacklisted`, return `Action::Pause`.
7. If not matched → return `Action::Continue`.

---

## Response Codes

| Condition | HTTP Status | Body |
|---|---|---|
| `BLACKLIST` env var missing or error | 500 | `App misconfigured` |
| `request.country` property absent | 502 | `Malformed request - no country field` |
| Country bytes not valid UTF-8 | 502 | `Malformed request - country not utf8 string` |
| `BLACKLIST_TW_START` not a valid `u64` | 500 | `App misconfigured` |
| `BLACKLIST_TW_END` not a valid `u64` | 500 | `App misconfigured` |
| Country matched, within block window (or no window) | 403 | `Request blacklisted` |
| Country not matched | — | Request forwarded (`Action::Continue`) |

---

## Constants

```rust
const BAD_GATEWAY: u32 = 502;
const FORBIDDEN: u32 = 403;
const INTERNAL_SERVER_ERROR: u32 = 500;
```

---

## Dependency

```toml
[dependencies]
proxy-wasm = "0.2"
```

No other dependencies. Standard library `std::env` and `std::time` are used directly.

---

## Cargo.toml

```toml
[workspace]

[package]
name = "geoblock"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib"]

[dependencies]
proxy-wasm = "0.2"
```

---

## Gotchas

- **Property availability**: `request.country` is injected by the CDN platform. It is only available during `on_http_request_headers`. It is not a header — do not use `get_http_request_header`.
- **Time-window logic**: The condition `now >= tw_start && now <= tw_end` is a standard inclusive range check (AND). Requests are blocked only when the current time falls within the window. Outside the window, matched countries are allowed through.
- **Case sensitivity**: Country matching uses `eq_ignore_ascii_case`, so `us`, `US`, and `Us` all match.
- **Partial time-window config**: If only one of `BLACKLIST_TW_START` / `BLACKLIST_TW_END` is set, `.zip` produces `None` and both are treated as absent — the request is blocked unconditionally with no error for partial config.
- **BLACKLIST parse**: The blacklist is split on `,` with no whitespace trimming. Entries with leading/trailing spaces (e.g. `US, CN`) will not match correctly.
- **`send_http_response` + `Action::Pause`**: All error and block paths call `send_http_response` then return `Action::Pause`. The action is `Pause`, not `Continue` — the request is halted and the synthetic response is sent.

---

## See Also

- proxy-wasm Rust SDK reference (host API, context traits, `get_property`, `send_http_response`)
- FastEdge CDN app platform overview (available request properties, country detection accuracy)
- FastEdge environment variable configuration (setting `BLACKLIST` and time-window vars at deploy time)
- examples-ab-testing-rust reference (similar CDN proxy-wasm pattern)
- examples-geoblock-js reference (equivalent JavaScript implementation)
