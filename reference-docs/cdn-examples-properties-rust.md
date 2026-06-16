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

**Note on `response.status`**: This property is a 2-byte big-endian `u16`, NOT a UTF-8 string. Decode with `u16::from_be_bytes([bytes[0], bytes[1]])`. Do NOT use `String::from_utf8` on it.

---

## Property-to-Header Mapping

| Property key | Response header |
|---|---|
| `request.url` | `request-uri` |
| `request.host` | `request-host` |
| `request.path` | `request-path` |
| `request.scheme` | `request-scheme` |
| `request.extension` | `request-extension` |
| `request.query` | `request-query` |
| `request.x_real_ip` | `request-x-real-ip` |
| `request.country` | `request-country` |
| `request.city` | `request-city` |
| `request.asn` | `request-asn` |
| `request.geo.long` | `request-long` |
| `request.geo.lat` | `request-lat` |
| `request.country.name` | `request-country-names` |
| `request.region` | `request-country-region` |
| `request.continent` | `request-continent` |

---

## Entry Point

```rust
proxy_wasm::main! {{
    proxy_wasm::set_log_level(LogLevel::Trace);
    proxy_wasm::set_root_context(|_| -> Box<dyn RootContext> { Box::new(PropertiesRoot) });
}}
```

The `proxy_wasm::main!` macro registers the root context factory. `PropertiesRoot` implements `RootContext` and creates `PropertiesContext` instances per request via `create_http_context`.

---

## Context Types

### `PropertiesRoot`

Implements `RootContext` and `Context`.

| Method | Return | Description |
|---|---|---|
| `create_http_context(&self, context_id: u32)` | `Option<Box<dyn HttpContext>>` | Returns a new `PropertiesContext` instance for each request |
| `get_type(&self)` | `Option<ContextType>` | Returns `Some(ContextType::HttpContext)` |

### `PropertiesContext`

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

### Reading extension (optional — no error on absence)

```rust
let extension = self
    .get_property(vec![REQUEST_EXTENSION])
    .unwrap_or_default();
println!(" extension = {} ", String::from_utf8_lossy(&extension));
self.add_http_response_header_bytes("request-extension", &extension);
```

`request.extension` uses `.unwrap_or_default()` instead of the `let Some(...) else` pattern because a URL path often has no file extension. Missing extension is not treated as an error.

### Reading query (optional — empty bytes on absence)

```rust
let query = match self.get_property(vec![REQUEST_QUERY]) {
    None => Bytes::new(),
    Some(query) => {
        println!(" query = {} ", String::from_utf8_lossy(&query));
        self.add_http_response_header_bytes("request-query", &query);
        query
    }
};
```

`request.query` returns empty bytes on absence rather than triggering a 55x error.

---

## Control Flow: `on_http_request_headers`

Signature: `fn on_http_request_headers(&mut self, _: usize, _: bool) -> Action`

Executes on every inbound request before forwarding.

1. Read `request.url` via `self.get_property(vec![REQUEST_URI])`. If `None`, send 551 and return `Action::Pause`.
2. Log decoded value with `println!`. Forward raw bytes as `request-uri` header.
3. Read `request.host`. If `None`, send 552 and return `Action::Pause`. Forward as `request-host`.
4. Read `request.path`. If `None`, send 553 and return `Action::Pause`. Forward as `request-path`.
5. Read `request.scheme`. If `None`, send 554 and return `Action::Pause`. Forward as `request-scheme`.
6. Read `request.extension`. If `None`, default to empty bytes (no error). Forward as `request-extension`.
7. Read `request.query`. If `None`, use empty bytes (no error). Forward as `request-query`.
8. Read `request.x_real_ip`. If `None`, send 557 and return `Action::Pause`. Forward as `request-x-real-ip`.
9. Read `request.country`. If `None`, send 558 and return `Action::Pause`. Forward as `request-country`.
10. Read `request.city`. If `None`, send 559 and return `Action::Pause`. Forward as `request-city`.
11. Read `request.asn`. If `None`, send 560 and return `Action::Pause`. Forward as `request-asn`.
12. Read `request.geo.long`. If `None`, send 561 and return `Action::Pause`. Forward as `request-long`.
13. Read `request.geo.lat`. If `None`, send 562 and return `Action::Pause`. Forward as `request-lat`.
14. Read `request.country.name`. If `None`, send 563 and return `Action::Pause`. Forward as `request-country-names`.
15. Read `request.region`. If `None`, send 564 and return `Action::Pause`. Forward as `request-country-region`.
16. Read `request.continent`. If `None`, send 565 and return `Action::Pause`. Forward as `request-continent`.
17. Parse the query string using `querystring::querify(std::str::from_utf8(&query).unwrap())`.
18. If a `url` query parameter is present (case-insensitive), rewrite: `self.set_property(vec![REQUEST_URI], Some(url.as_bytes()))`.
19. If a `host` query parameter is present (case-insensitive), rewrite: `self.set_property(vec![REQUEST_HOST], Some(host.as_bytes()))`.
20. If a `path` query parameter is present (case-insensitive), rewrite: `self.set_property(vec![REQUEST_PATH], Some(path.as_bytes()))`.
21. Set custom nginx log field: `self.set_property(vec!["nginx.log_field1"], Some(b"from_wasm nginx.log_field1"))`.
22. Return `Action::Continue`.

---

## Response Codes

| Condition | HTTP Status |
|---|---|
| `request.url` absent | 551 |
| `request.host` absent | 552 |
| `request.path` absent | 553 |
| `request.scheme` absent | 554 |
| `request.extension` absent | no error (empty default) |
| `request.query` absent | no error (empty default) |
| `request.x_real_ip` absent | 557 |
| `request.country` absent | 558 |
| `request.city` absent | 559 |
| `request.asn` absent | 560 |
| `request.geo.long` absent | 561 |
| `request.geo.lat` absent | 562 |
| `request.country.name` absent | 563 |
| `request.region` absent | 564 |
| `request.continent` absent | 565 |
| All required properties present | Request forwarded (`Action::Continue`) |

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
let query = std::str::from_utf8(&query).unwrap();
let params = querystring::querify(query);
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

### Decode `response.status` (2-byte big-endian u16)

```rust
let status_bytes = self.get_property(vec!["response.status"]).unwrap_or_default();
if status_bytes.len() >= 2 {
    let status = u16::from_be_bytes([status_bytes[0], status_bytes[1]]);
    // use status
}
```

Do NOT use `String::from_utf8` on `response.status` — it is a binary-encoded integer, not a UTF-8 string.

---

## Deserializing `request.country.name`

The source includes a helper for null-delimited byte sequences. The property doc pattern clarifies that all `request.*` properties are plain UTF-8 strings, but `request.country.name` may return multiple values separated by null bytes:

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

The property path `nginx.log_field1` writes a custom value into the CDN access log. This is a write-only operation from within the Wasm filter; reading it back is not guaranteed.

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

## Visual Debugger Notes

`fixtures/force-server-properties.json` is a visual-debugger configuration file (no `.test.json` extension), not a test fixture. It is used to seed server-side properties when running the app in the FastEdge visual debugger.

---

## Gotchas

- **All required properties return `Option<Vec<u8>>`**: A `None` result means the property is not available in the current request phase. Handle every `None` explicitly — the example sends a synthetic error response and returns `Action::Pause`.
- **`request.extension` and `request.query` are optional**: These two properties use fallback-to-empty patterns instead of error responses. A URL path often has no file extension; a request often has no query string.
- **Properties are not headers**: Do not use `get_http_request_header` to read these. They are accessed exclusively via `get_property`.
- **`response.status` is binary, not UTF-8**: Decode with `u16::from_be_bytes([bytes[0], bytes[1]])`. Never use `String::from_utf8` on it.
- **`String::from_utf8_lossy` vs `String::from_utf8`**: The example uses `String::from_utf8_lossy` for logging (infallible, replaces invalid bytes with U+FFFD). For strict UTF-8 enforcement use `String::from_utf8(b).ok()`. Never call `.unwrap()` on `String::from_utf8` — it panics on invalid UTF-8.
- **`request.country.name` encoding**: The source includes a null-byte deserializer for this property, suggesting it may return multiple values separated by null bytes. Verify against platform behavior before assuming plain UTF-8.
- **Query parsing**: `querystring::querify` does not trim whitespace from keys or values. A query parameter `url=foo` matches but ` url=foo` (with a leading space on the key) does not. The source calls `std::str::from_utf8(&query).unwrap()` — safe only because the query was already read as a valid property value.
- **Case-insensitive parameter matching**: The example uses `.eq_ignore_ascii_case` to match query parameter keys (`url`, `host`, `path`). Query parameter names are treated as case-insensitive.
- **`set_property` for URL rewrite**: Modifying `request.url`, `request.host`, or `request.path` rewrites the upstream request before it is forwarded. Changes take effect for the proxied request, not for in-flight headers already sent.
- **`nginx.log_field1`**: Writing to this property injects a value into the CDN access log. It is write-only from the filter; reading it back is not guaranteed.
- **Error code for `request.asn`**: The source uses status code 560 for `request.asn` absence (not 561 as stated in older documentation). Status 561 is reserved for `request.geo.long` absence.

---

## See Also

- proxy-wasm Rust SDK reference (host API, context traits, `get_property`, `set_property`, `add_http_response_header_bytes`, `send_http_response`)
- FastEdge CDN app platform overview (available request properties, geo data accuracy, property availability by request phase)
- examples-geoblock-rust reference (reads `request.country` for access control)
- examples-geo-redirect reference (reads geo properties for routing)
- examples-headers-rust reference (header manipulation in CDN apps)
- cdn-apps-rust reference (request properties table, encoding rules)
