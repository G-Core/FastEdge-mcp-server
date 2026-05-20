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
languages: [rust]
capabilities: [request-properties, geo-data, url-rewrite, path-rewrite, host-rewrite, request-inspection, header-forwarding]
---

# Request Properties — CDN App Example (Rust)

Reads and manipulates request properties — URL, path, host, scheme, extension, query, client IP, and geo data — using the proxy-wasm ABI. Demonstrates reading all available `request.*` properties, forwarding them as response headers, and conditionally rewriting URL/path/host via query parameters.

---

## Overview

- **App type**: CDN (proxy-wasm `HttpContext`)
- **Language**: Rust
- **Crate**: `proxy-wasm = "0.2"`, `log = "0.4"`, `querystring = "1.1"`
- **Crate type**: `cdylib` (WASM library target)
- **Edition**: 2024

---

## Request Property Paths

All properties are retrieved via `self.get_property(vec![PROPERTY_PATH])` returning `Option<Vec<u8>>`. All values are plain UTF-8 strings except where noted. Decode with `.and_then(|b| String::from_utf8(b).ok()).unwrap_or_default()` or `String::from_utf8_lossy(&bytes)`.

| Constant | Property Path | Type | Description |
|---|---|---|---|
| `REQUEST_URI` | `"request.url"` | UTF-8 string | Full request URI |
| `REQUEST_HOST` | `"request.host"` | UTF-8 string | Request host |
| `REQUEST_PATH` | `"request.path"` | UTF-8 string | Request path |
| `REQUEST_SCHEME` | `"request.scheme"` | UTF-8 string | Request scheme (`http` or `https`) |
| `REQUEST_EXTENSION` | `"request.extension"` | UTF-8 string | File extension of the path |
| `REQUEST_QUERY` | `"request.query"` | UTF-8 string | Query string (without leading `?`) |
| `REQUEST_X_REAL_IP` | `"request.x_real_ip"` | UTF-8 string | Client IP address |
| `REQUEST_COUNTRY` | `"request.country"` | UTF-8 string | Two-letter ISO country code |
| `REQUEST_CITY` | `"request.city"` | UTF-8 string | Client city name |
| `REQUEST_ASN` | `"request.asn"` | UTF-8 string | Client ASN |
| `REQUEST_GEO_LAT` | `"request.geo.lat"` | UTF-8 string | Client latitude |
| `REQUEST_GEO_LONG` | `"request.geo.long"` | UTF-8 string | Client longitude |
| `REQUEST_REGION` | `"request.region"` | UTF-8 string | Client region |
| `REQUEST_CONTINENT` | `"request.continent"` | UTF-8 string | Client continent |
| `REQUEST_COUNTRY_NAME` | `"request.country.name"` | UTF-8 string | Full country name |

---

## Entry Point

```rust
proxy_wasm::main! {{
    proxy_wasm::set_log_level(LogLevel::Trace);
    proxy_wasm::set_root_context(|_| -> Box<dyn RootContext> { Box::new(HttpHeadersRoot) });
}}
```

The `proxy_wasm::main!` macro registers the root context factory. `HttpHeadersRoot` implements `RootContext` and creates `HttpHeaders` instances per request via `create_http_context`.

---

## Context Types

### `HttpHeadersRoot`

Implements `RootContext` and `Context`.

| Method | Return | Description |
|---|---|---|
| `create_http_context(&self, context_id: u32)` | `Option<Box<dyn HttpContext>>` | Returns a new `HttpHeaders` instance for each request |
| `get_type(&self)` | `Option<ContextType>` | Returns `Some(ContextType::HttpContext)` |

### `HttpHeaders`

Implements `HttpContext` and `Context`.

| Field | Type | Description |
|---|---|---|
| `context_id` | `u32` | Per-request context identifier |

---

## API Patterns

### Reading a property

```rust
fn on_http_request_headers(&mut self, _: usize, _: bool) -> Action {
    let Some(uri) = self.get_property(vec![REQUEST_URI]) else {
        self.send_http_response(551, vec![], None);
        return Action::Pause;
    };
    // Decode for logging/printing
    println!(" uri = {} ", String::from_utf8_lossy(&uri));
    // Forward raw bytes as response header
    self.add_http_response_header_bytes("request-uri", &uri);
    Action::Continue
}
```

Signature: `fn get_property(&self, path: Vec<&str>) -> Option<Vec<u8>>`

Returns `None` if the property is unavailable. On `None`, the example sends a synthetic error response and pauses the request.

### Writing a property (URL rewrite)

```rust
self.set_property(vec![REQUEST_URI], Some(url.as_bytes()));
self.set_property(vec![REQUEST_HOST], Some(host.as_bytes()));
self.set_property(vec![REQUEST_PATH], Some(path.as_bytes()));
```

Signature: `fn set_property(&self, path: Vec<&str>, value: Option<&[u8]>)`

Pass `Some(bytes)` to set, `None` to clear.

### Forwarding property bytes as a header

```rust
self.add_http_response_header_bytes("request-uri", &uri);
```

Signature: `fn add_http_response_header_bytes(&self, name: &str, value: &[u8])`

Adds a response header with the raw property bytes as the value. No UTF-8 conversion is required.

---

## Control Flow: `on_http_request_headers`

Signature: `fn on_http_request_headers(&mut self, _: usize, _: bool) -> Action`

Executes on every inbound request before forwarding.

1. Read each property via `self.get_property(vec![CONSTANT])`. If `None`, call `self.send_http_response(error_code, vec![], None)` and return `Action::Pause`.
2. Log the decoded value with `println!`.
3. Forward the raw bytes as a response header via `self.add_http_response_header_bytes`.
4. After reading all properties, parse the query string using `querystring::querify(&query)`.
5. If a `url` query parameter is present (case-insensitive), rewrite the request URI: `self.set_property(vec![REQUEST_URI], Some(url.as_bytes()))`.
6. If a `host` query parameter is present (case-insensitive), rewrite the request host: `self.set_property(vec![REQUEST_HOST], Some(host.as_bytes()))`.
7. If a `path` query parameter is present (case-insensitive), rewrite the request path: `self.set_property(vec![REQUEST_PATH], Some(path.as_bytes()))`.
8. Set a custom nginx log field: `self.set_property(vec!["nginx.log_field1"], Some(b"from_wasm nginx.log_field1"))`.
9. Return `Action::Continue`.

---

## Response Codes

| Condition | HTTP Status |
|---|---|
| `request.url` absent | 551 |
| `request.host` absent | 552 |
| `request.path` absent | 553 |
| `request.scheme` absent | 554 |
| `request.extension` absent | 555 |
| `request.query` absent | 556 |
| `request.x_real_ip` absent | 557 |
| `request.country` absent | 558 |
| `request.city` absent | 559 |
| `request.asn` absent | 561 |
| `request.geo.long` absent | 561 |
| `request.geo.lat` absent | 562 |
| `request.country.name` absent | 563 |
| `request.region` absent | 564 |
| `request.continent` absent | 565 |
| All properties present | Request forwarded (`Action::Continue`) |

---

## Common Patterns

### Read a geo property for routing

```rust
let country = self
    .get_property(vec![REQUEST_COUNTRY])
    .and_then(|b| String::from_utf8(b).ok())
    .unwrap_or_default();
if country == "US" {
    // apply US-specific logic
}
```

### Rewrite URL from query parameter

```rust
let query = String::from_utf8_lossy(&query);
let params = querystring::querify(&query);
if let Some(url) = params.iter().find_map(|(k, v)| {
    if "url".eq_ignore_ascii_case(k) { Some(v) } else { None }
}) {
    self.set_property(vec![REQUEST_URI], Some(url.as_bytes()));
}
```

### Forward property as response header

```rust
let Some(city) = self.get_property(vec![REQUEST_CITY]) else {
    self.send_http_response(559, vec![], None);
    return Action::Pause;
};
self.add_http_response_header_bytes("request-city", &city);
```

---

## Deserializing `request.country.name`

The source includes a helper for null-delimited byte sequences, but the property doc pattern clarifies that all `request.*` properties are plain UTF-8 strings. The helper is provided as a utility in the source:

```rust
pub fn deserialize_country_names(bytes: &[u8]) -> Vec<Cow<'_, str>> {
    let mut path = Vec::new();
    if bytes.is_empty() {
        return path;
    }
    let mut p = 0;
    while p < bytes.len() {
        let s = p;
        while p < bytes.len() && bytes[p] != 0 {
            p += 1;
        }
        path.push(String::from_utf8_lossy(&bytes[s..p]));
        p += 1;
    }
    path
}
```

This splits a null-byte-delimited byte slice into a `Vec<Cow<str>>`. Use this if `request.country.name` returns multiple country names separated by null bytes.

---

## Custom Log Field

```rust
self.set_property(
    vec!["nginx.log_field1"],
    Some(b"from_wasm nginx.log_field1"),
);
```

The property path `nginx.log_field1` writes a custom value into the CDN access log. This is a write-only operation from within the Wasm filter.

---

## Lifecycle Hook: `on_log`

```rust
fn on_log(&mut self) {
    info!("#{} completed.", self.context_id);
}
```

Called after the request/response cycle completes. Uses the `log` crate (`log::info!`). Logs the context ID.

---

## Cargo.toml

```toml
[workspace]

[package]
name = "properties"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib"]

[dependencies]
log = "0.4"
proxy-wasm = "0.2"
querystring = "1.1"
```

---

## Gotchas

- **All properties return `Option<Vec<u8>>`**: A `None` result means the property is not available in the current request phase. Handle every `None` explicitly — the example sends a synthetic error response and returns `Action::Pause`.
- **Properties are not headers**: Do not use `get_http_request_header` to read these. They are accessed exclusively via `get_property`.
- **`String::from_utf8_lossy` vs `String::from_utf8`**: The example uses `String::from_utf8_lossy` for logging (infallible, replaces invalid bytes with U+FFFD). For strict UTF-8 enforcement use `String::from_utf8(b).ok()`. Never call `.unwrap()` on `String::from_utf8` — it panics on invalid UTF-8.
- **`request.country.name` encoding**: The source includes a null-byte deserializer for this property, suggesting it may return multiple values separated by null bytes. Verify against platform behavior before assuming plain UTF-8.
- **Query parsing**: `querystring::querify` does not trim whitespace from keys or values. A query parameter `url=foo` matches but ` url=foo` (with a leading space on the key) does not.
- **Case-insensitive parameter matching**: The example uses `.eq_ignore_ascii_case` to match query parameter keys (`url`, `host`, `path`). This is intentional — query parameter names are treated as case-insensitive.
- **`set_property` for URL rewrite**: Modifying `request.url`, `request.host`, or `request.path` rewrites the upstream request before it is forwarded. Changes take effect for the proxied request, not for the in-flight headers already sent.
- **`nginx.log_field1`**: Writing to this property injects a value into the CDN access log. It is write-only from the filter; reading it back is not guaranteed.
- **Error code collisions**: HTTP status 561 is used for both `request.asn` and `request.geo.long` absence — this is a quirk of the source, not a recommended pattern.

---

## See Also

- proxy-wasm Rust SDK reference (host API, context traits, `get_property`, `set_property`, `add_http_response_header_bytes`, `send_http_response`)
- FastEdge CDN app platform overview (available request properties, geo data accuracy, property availability by request phase)
- examples-geoblock-rust reference (reads `request.country` for access control)
- examples-geo-redirect reference (reads geo properties for routing)
- examples-headers-rust reference (header manipulation in CDN apps)
- cdn-apps-rust reference (request properties table, encoding rules)
