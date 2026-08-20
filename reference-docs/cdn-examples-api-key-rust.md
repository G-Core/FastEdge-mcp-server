<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 6347a7c2fda0d03e66f1214db5eec041c16801b7
      updated: 2026-08-17
-->

# API Key Validation — CDN (Rust)

## Overview

Validates incoming requests against a stored secret using the `X-API-Key` request header. Use this pattern when you need simple token-based authentication on a CDN app without the overhead of JWT claims or expiry logic.

## API Patterns

### Secret retrieval

```rust
use fastedge::proxywasm::secret;

secret::get(key: &str) -> Result<Option<Vec<u8>>, u32>
```

- `key`: name of the stored secret (e.g., `"API_KEY"`)
- Returns `Ok(Some(bytes))` when the secret exists, `Ok(None)` when not found, `Err(u32)` on host error
- Error type is `u32` (raw host status code), not a typed `Error` enum
- Bytes must be decoded to `String` via safe UTF-8 conversion (see Gotchas)

### Request header access (proxy-wasm trait)

```rust
// In HttpContext impl
self.get_http_request_header(name: &str) -> Option<String>
```

- Returns `Some(value)` when the header is present, `None` when absent
- Called inside `on_http_request_headers` lifecycle hook

### Response shortcircuit (proxy-wasm trait)

```rust
self.send_http_response(
    status_code: u32,
    headers: Vec<(&str, &str)>,
    body: Option<&[u8]>,
) -> ()
```

- Terminates the request immediately; must be followed by `return Action::Pause`
- Used for `401 Unauthorized` (missing key), `403 Forbidden` (invalid key), and `500 Internal Server Error` (misconfigured secret)

### Header removal before upstream forwarding

```rust
self.set_http_request_header(name: &str, value: Option<&str>) -> ()
```

- Passing `None` as `value` on the FastEdge CDN platform **sets the header to an empty string** rather than truly removing it — this is a FastEdge CDN platform limitation
- To check for header absence downstream, test for both a missing value and an empty string
- Called inside `on_http_request_headers`; after this call, return `Action::Continue`

## Common Patterns

### Full validation flow

```rust
impl HttpContext for ApiKeyContext {
    fn on_http_request_headers(&mut self, _: usize, _: bool) -> Action {
        // 1. Read expected key from secret store
        let expected_key = match secret::get("API_KEY") {
            Ok(Some(bytes)) => match String::from_utf8(bytes) {
                Ok(s) if !s.is_empty() => s,
                _ => {
                    self.send_http_response(500, vec![], Some(b"App misconfigured"));
                    return Action::Pause;
                }
            },
            _ => {
                self.send_http_response(500, vec![], Some(b"App misconfigured"));
                return Action::Pause;
            }
        };

        // 2. Extract provided key from request header
        let provided_key = match self.get_http_request_header("X-API-Key") {
            Some(k) if !k.is_empty() => k,
            _ => {
                self.send_http_response(
                    401,
                    vec![("WWW-Authenticate", "API-Key")],
                    Some(b"Missing X-API-Key header"),
                );
                return Action::Pause;
            }
        };

        // 3. Compare and reject if invalid
        if provided_key != expected_key {
            println!("API key validation failed");
            self.send_http_response(403, vec![], Some(b"Invalid API key"));
            return Action::Pause;
        }

        // 4. Strip key before forwarding to upstream
        self.set_http_request_header("X-API-Key", None);

        println!("API key validated successfully");
        Action::Continue
    }
}
```

### Safe secret decoding (alternative chaining form)

```rust
let key_str = secret::get("API_KEY")
    .ok()
    .flatten()
    .and_then(|v| String::from_utf8(v).ok());
```

- Use `.ok().flatten().and_then(|v| String::from_utf8(v).ok())` to safely collapse `Result<Option<Vec<u8>>, u32>` to `Option<String>`
- Returns `None` on host error, missing secret, or invalid UTF-8 — avoids panics

### 401 response with WWW-Authenticate header

```rust
self.send_http_response(
    401,
    vec![("WWW-Authenticate", "API-Key")],
    Some(b"Missing X-API-Key header"),
);
return Action::Pause;
```

- Include `WWW-Authenticate: API-Key` on 401 responses to signal the required auth scheme to clients

## Required Configuration

| Type   | Name      | Description                         |
|--------|-----------|-------------------------------------|
| Secret | `API_KEY` | The expected API key value to match |

## Gotchas

- **`secret::get` returns `Vec<u8>`, not `String`**: always decode with `.and_then(|v| String::from_utf8(v).ok())` — bare `.unwrap()` panics on invalid UTF-8 and must not be used
- **Empty key treated as missing**: a non-empty guard (`if !s.is_empty()`) must be applied after UTF-8 decoding; an empty secret is a misconfiguration, not a valid key
- **Header stripping limitation**: `set_http_request_header("X-API-Key", None)` sets the header to an empty string on the FastEdge CDN platform rather than truly removing it; downstream services must treat both absent and empty values as "no key present"
- **Credential leakage**: always strip `X-API-Key` before `Action::Continue` — forwarding the key to upstream exposes credentials to backend services
- **Action::Pause required after send_http_response**: calling `send_http_response` without returning `Action::Pause` results in undefined behaviour; the two must always appear together
- **`Result<Option<Vec<u8>>, u32>` error type**: the `u32` error variant is a raw host status code — do not match against typed error enums; treat any `Err(_)` or `Ok(None)` as a configuration failure
- **Proxy-wasm lifecycle**: all header access and modification must occur inside `on_http_request_headers`; calling these methods outside a valid HTTP context hook is unsupported
- **Simpler than JWT**: this pattern has no token expiry or claims validation — use JWT when those are required

## Related

- Host services reference — secrets API (`fastedge::proxywasm::secret`) and other CDN host services
- CDN apps reference — proxy-wasm app structure, `RootContext`/`HttpContext` setup, `Action` enum, and request property encodings
- SDK API reference — Rust CDN SDK traits and types
