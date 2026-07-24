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
capabilities: [logging, timing, request-headers, response-headers]
---

# Log Time — CDN (Rust)

Logs request and response timestamps (hours since UNIX epoch) to the proxy log using the proxy-wasm ABI.

## What This Example Does

- Reads the current wall-clock time in both the request and response phases
- Converts `SystemTime` to hours since UNIX epoch using `duration_since(UNIX_EPOCH).as_secs() / 3600`
- Emits log entries via `log::info!` in both `on_http_request_headers` and `on_http_response_headers`
- Configures log verbosity to `LogLevel::Trace` at startup so all log levels are captured

## Key APIs

### `self.get_current_time() -> SystemTime`

Available on any type implementing `Context`. Returns the proxy host's wall-clock time as a `std::time::SystemTime`.

- Reflects the host's wall clock, not a high-resolution performance timer
- Always returns a value after `UNIX_EPOCH`, so `duration_since(UNIX_EPOCH).unwrap()` is safe
- Call in any hook method; each call reflects the time at invocation

### `proxy_wasm::set_log_level(level: LogLevel)`

Sets the minimum log level for the WASM module. Must be called in the `proxy_wasm::main!` block.

- `LogLevel::Trace` captures all log levels (Trace, Debug, Info, Warn, Error)
- `log::info!` output is suppressed unless `set_log_level` is set to `Info` or lower (e.g., `Trace` or `Debug`)

### `log::info!(format, args...)`

Emits an info-level log entry. Requires the `log` crate (`log = "0.4"` in Cargo.toml) and `use log::info;`.

## Context Struct Pattern

```rust
struct HttpHeaders {
    context_id: u32,
}
```

`context_id` is passed from `create_http_context` into the per-request struct. Use it to correlate log entries across request and response phases for the same request.

## Implementation

### `Cargo.toml`

```toml
[workspace]

[package]
name = "log_time"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib"]

[dependencies]
log = "0.4"
proxy-wasm = "0.2"
```

### `src/lib.rs`

```rust
use log::info;
use proxy_wasm::traits::*;
use proxy_wasm::types::*;
use std::time::SystemTime;

proxy_wasm::main! {{
    proxy_wasm::set_log_level(LogLevel::Trace);
    proxy_wasm::set_root_context(|_| -> Box<dyn RootContext> { Box::new(HttpHeadersRoot) });
}}

struct HttpHeadersRoot;

impl Context for HttpHeadersRoot {}

impl RootContext for HttpHeadersRoot {
    fn create_http_context(&self, context_id: u32) -> Option<Box<dyn HttpContext>> {
        Some(Box::new(HttpHeaders { context_id }))
    }

    fn get_type(&self) -> Option<ContextType> {
        Some(ContextType::HttpContext)
    }
}

struct HttpHeaders {
    context_id: u32,
}

impl Context for HttpHeaders {}

impl HttpContext for HttpHeaders {
    fn on_http_request_headers(&mut self, _: usize, _: bool) -> Action {
        let time = self.get_current_time();
        info!(
            "on_http_request_headers: {}",
            time.duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_secs()
                / 3600
        );
        Action::Continue
    }

    fn on_http_response_headers(&mut self, _: usize, _: bool) -> Action {
        let time = self.get_current_time();
        info!(
            "on_http_response_headers: {}",
            time.duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_secs()
                / 3600
        );
        Action::Continue
    }
}
```

## Hook Phases

| Hook | Purpose |
|---|---|
| `on_http_request_headers` | Reads time when request headers arrive; logs hours since epoch |
| `on_http_response_headers` | Reads time when response headers arrive; logs hours since epoch |

Both hooks return `Action::Continue` — the request/response is not paused or modified.

## Timing Precision

`as_secs() / 3600` produces hour-granularity timestamps. For finer granularity:

- Sub-second: `duration.subsec_millis()` or `duration.subsec_nanos()`
- Seconds: `as_secs()`
- Minutes: `as_secs() / 60`

## Gotchas

- `get_current_time()` is a wall-clock read from the proxy host — it is not suitable as a high-resolution timer for measuring elapsed time between hooks
- `log::info!` output will not appear unless `set_log_level` is called with a level at or below `Info`; `LogLevel::Trace` is the most permissive setting and enables all log output
- `duration_since(UNIX_EPOCH).unwrap()` is safe because the proxy host always provides a post-epoch timestamp

## See Also

- proxy-wasm HttpContext trait reference (on_http_request_headers, on_http_response_headers, Action)
- proxy-wasm Context trait reference (get_current_time)
- platform-overview (CDN app deployment and log access)
- host-services-rust (available host functions including time)
