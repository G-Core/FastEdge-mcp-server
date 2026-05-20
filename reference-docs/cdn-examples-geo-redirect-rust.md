<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 4f748b10fa04226e76218e88195b6b1f02fce032
      updated: 2026-04-20
-->

---
type: example
app_type: cdn
languages:
  - rust
capabilities:
  - geo-routing
  - origin-rewrite
  - env-config
  - host-header-preservation
---

# Geo Redirect — CDN (Rust)

Routes CDN requests to country-specific origin URLs based on the request's geoIP country code. Falls back to a configurable default origin when no country-specific mapping is found.

## Use Case

- Route traffic from different countries to dedicated regional origins
- Preserve request path and Host header during origin rewrite
- Gracefully fall back to a default origin for unmapped countries

## Configuration

| Environment Variable | Required | Description |
|---|---|---|
| `DEFAULT` | Yes | Fallback origin URL used when no country-specific variable is set |
| `<COUNTRY_CODE>` | No | Per-country origin URL (e.g., `US`, `DE`, `GB`) — variable name is the ISO country code |

## Runtime Properties

| Property | Direction | Type | Description |
|---|---|---|---|
| `request.country` | Read | `Vec<u8>` (UTF-8 string) | GeoIP-derived country code for the incoming request |
| `request.path` | Read | `Vec<u8>` (UTF-8 string) | URL path of the incoming request |
| `request.host` | Read | `Vec<u8>` (UTF-8 string) | Host header value from the incoming request |
| `request.url` | Write | `&[u8]` | Rewritten origin URL (origin + path); setting this routes the request |

## Key API Calls

### Read a property

```rust
self.get_property(vec!["request.country"])
    .and_then(|bytes| String::from_utf8(bytes).ok())
    .unwrap_or_default()
```

`get_property` returns `Option<Vec<u8>>`. Always decode with `.and_then(|b| String::from_utf8(b).ok())` to avoid panics on invalid UTF-8. Use `.unwrap_or_default()` to get an empty string on missing or invalid values.

### Look up origin from environment

```rust
let origin = env::var(&country_code).unwrap_or(default_origin);
let origin = origin.trim_end_matches('/');
```

Uses `std::env::var` with the country code as the variable name. Falls back to `DEFAULT` when the country-specific variable is absent. Trailing slash is stripped to avoid double slashes when concatenating with path.

### Preserve Host header

```rust
if let Some(host) = self
    .get_property(vec!["request.host"])
    .and_then(|bytes| String::from_utf8(bytes).ok())
{
    self.set_http_request_header("Host", Some(&host));
}
```

Read the Host header from the incoming request and re-set it explicitly before the origin rewrite.

### Rewrite origin URL

```rust
let request_url = format!("{}{}", origin, path);
self.set_property(vec!["request.url"], Some(request_url.as_bytes()));
```

Constructs the full URL as `origin + path` and writes it to the `request.url` property to route the request to the resolved origin.

### Log the routing decision

```rust
proxy_wasm::hostcalls::log(LogLevel::Info, &format!("Redirecting to: {}", request_url)).ok();
```

## Control Flow

```
on_http_request_headers
  │
  ├─ env::var("DEFAULT") missing? → send_http_response(500, "App misconfigured") → Pause
  │
  ├─ get_property("request.country") → empty? → send_http_response(502, "Missing country information") → Pause
  │
  ├─ env::var(<country_code>) → found? use it : use DEFAULT
  │
  ├─ trim trailing slash from origin
  │
  ├─ get_property("request.path") → default "/"
  │
  ├─ get_property("request.host") → set_http_request_header("Host", ...) if present
  │
  ├─ set_property("request.url", origin + path)
  │
  └─ Action::Continue
```

## Error Responses

| Condition | Status | Body |
|---|---|---|
| `DEFAULT` env var not set | 500 | `App misconfigured - DEFAULT must be set` |
| `request.country` property is empty or missing | 502 | `Missing country information` |

## Cargo.toml

```toml
[package]
name = "geo_redirect"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib"]

[dependencies]
proxy-wasm = "0.2"
```

## Trait Implementation Summary

| Struct | Trait | Purpose |
|---|---|---|
| `GeoRedirectRoot` | `RootContext` | Creates HTTP context instances; declares `ContextType::HttpContext` |
| `GeoRedirectRoot` | `Context` | Required base trait |
| `GeoRedirectContext` | `HttpContext` | Implements `on_http_request_headers` for geo routing logic |
| `GeoRedirectContext` | `Context` | Required base trait |

## Constraints and Gotchas

- `DEFAULT` environment variable is mandatory; absence causes a 500 error on every request.
- Country code is derived from `request.country` property, not from a request header — this is platform-injected geoIP data.
- An empty country code (property missing or zero-length) is treated as a routing failure (502), not silently routed to default.
- Origin URLs must not have a trailing slash; the app strips one if present, but setting the variable without a trailing slash is safer.
- `request.path` falls back to `"/"` if the property is absent.
- Host header preservation is best-effort: if `request.host` is absent, no `Host` header is set and the platform default applies.
- `Action::Continue` is returned on success — the rewritten `request.url` property drives routing, not an HTTP redirect response.

## Contrast with Geoblock

Geo-redirect rewrites `request.url` to route to a different origin and returns `Action::Continue`. Geoblock calls `send_http_response` to reject the request entirely and returns `Action::Pause`. Both read `request.country` the same way.

## See Also

- examples-geoblock-cdn-rust (blocking by country vs. routing to different origins)
- examples-ab-test-cdn-rust (conditional origin routing based on other criteria)
- platform-overview (property model, environment variable injection)
- sdk-reference-rust (full proxy-wasm trait and hostcall reference)
