<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 6347a7c2fda0d03e66f1214db5eec041c16801b7
      updated: 2026-08-20
-->

---
type: example
app_type: cdn
languages: [rust]
capabilities: [auth, jwt, bearer-token, secrets]
---

# JWT Authentication — CDN App (Rust)

Validates a Bearer JWT on every incoming CDN request using the proxy-wasm filter model. Requests with missing, malformed, or expired tokens are rejected before reaching the origin.

---

## Dependencies

```toml
proxy-wasm = "0.2"
fastedge = { version = "0.4", features = ["proxywasm"] }
jsonwebtoken = "9"
serde = { version = "1", features = ["derive"] }
headers = "0.4"
```

Crate type must be `cdylib`. Edition `2024`.

---

## Crate-type Declaration

```toml
[lib]
crate-type = ["cdylib"]
```

---

## Entry Point

```rust
proxy_wasm::main! {{
    proxy_wasm::set_log_level(LogLevel::Trace);
    proxy_wasm::set_root_context(|_| -> Box<dyn RootContext> { Box::new(HttpHeadersRoot) });
}}
```

- `set_root_context` registers the root context factory.
- `set_log_level(LogLevel::Trace)` enables full trace logging.

---

## Context Hierarchy

| Type | Struct | Trait |
|---|---|---|
| Root context | `HttpHeadersRoot` | `RootContext` |
| Per-request context | `HttpHeaders` | `HttpContext` |

`HttpHeadersRoot::create_http_context` returns a new `HttpHeaders` instance for each request.

`HttpHeadersRoot` also implements `get_type`, returning `Some(ContextType::HttpContext)`.

---

## Claims Schema

```rust
#[derive(Debug, Deserialize, Default)]
struct Claims {
    exp: u64,  // Unix timestamp (seconds)
}
```

Only `exp` is extracted and validated. All other claims are ignored.

---

## Request Filter Logic

### Hook

```rust
fn on_http_request_headers(&mut self, _: usize, _: bool) -> Action
```

Called on every inbound CDN request. Returns `Action::Continue` on success or `Action::Pause` after sending an HTTP error response.

### Validation Steps (in order)

| Step | Failure condition | Response code | Body |
|---|---|---|---|
| 1. Fetch secret | `secret::get("secret")` returns `Err` or `None` | 500 | `App misconfigured` |
| 2. Get Authorization header | Header absent | 401 | `No Authorization header` |
| 3. Check header non-empty | Header value is empty string | 401 | `No Authorization header` |
| 4. Parse header as `HeaderValue` | Parse fails | 401 | `Invalid Authorization header` |
| 5. Decode Bearer scheme | `Bearer::decode` returns `None` | 403 | `Token not found` |
| 6. Decode JWT | `jsonwebtoken::decode` returns `Err` | 403 | `Could not decode token <token>: <error>` |
| 7. Check expiration | `now > claims.exp` | 403 | `Token expired` |

All rejection branches call `self.send_http_response(...)` and return `Action::Pause`. On success, logs `"Token ok"` and returns `Action::Continue`.

---

## Secret Management

```rust
use fastedge::proxywasm::secret;

let Ok(Some(secret)) = secret::get("secret") else { /* 500 */ };
```

- Secret name: `"secret"` — the HMAC signing key stored as a FastEdge secret.
- `secret::get` returns `Result<Option<Vec<u8>>, _>`.
- A missing or unset secret causes a 500 response; the app is considered misconfigured.
- Do NOT pass signing keys via environment variables for CDN apps — use the secrets API.

---

## Bearer Token Extraction

```rust
use headers::HeaderValue;
use headers::authorization::{Bearer, Credentials};

let Ok(header) = value.parse::<HeaderValue>() else { /* 401 */ };
let Some(bearer) = Bearer::decode(&header) else { /* 403 */ };
let token: &str = bearer.token();
```

Uses the `headers` crate (`0.4`) to parse and decode the `Authorization: Bearer <token>` header. `Bearer::decode` returns `Option<Bearer>`; `None` indicates the scheme is not `Bearer` or the header is malformed.

---

## JWT Decoding and Validation

```rust
use jsonwebtoken::{decode, DecodingKey, Validation};

let decoding_key = DecodingKey::from_secret(&secret);
let mut validation = Validation::default();
validation.set_required_spec_claims(&["exp"]);
validation.validate_aud = false;
validation.validate_nbf = false;
validation.validate_exp = false;  // expiration checked manually
```

- `DecodingKey::from_secret` — HMAC shared-secret key derived from the fetched secret bytes.
- `Validation::default()` uses HS256 by default.
- `validate_aud` and `validate_nbf` are disabled; `validate_exp` is disabled because expiration is checked manually using the system clock.
- Required claims: `["exp"]` — the decode call fails if `exp` is absent.

```rust
let token_data = match decode::<Claims>(token, &decoding_key, &validation) {
    Ok(token_data) => token_data,
    Err(error) => {
        self.send_http_response(FORBIDDEN, vec![], Some(format!("Could not decode token {}: {}", token, error).as_bytes()));
        return Action::Pause;
    }
};
let claims = token_data.claims;
```

---

## Manual Expiration Check

```rust
use std::time::{SystemTime, UNIX_EPOCH};

let now = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap()
    .as_secs();

if now > claims.exp {
    self.send_http_response(FORBIDDEN, vec![], Some(b"Token expired"));
    return Action::Pause;
}
```

- Clock source: `SystemTime::now()` — host-provided wall clock via WASM.
- Comparison is strict (`>`); tokens expiring at exactly `now` are accepted.
- No clock skew tolerance is implemented in this example.

---

## HTTP Status Constants

```rust
const UNAUTHORIZED: u32 = 401;
const FORBIDDEN: u32 = 403;
const INTERNAL_SERVER_ERROR: u32 = 500;
```

Passed as the first argument to `self.send_http_response(code, headers, body)`.

---

## Gotchas

- **Algorithm constraints**: `Validation::default()` uses HS256. To support RS256 or ES256, construct `Validation::new(Algorithm::RS256)` explicitly — not all algorithm/key combos are available in every WASM runtime.
- **No algorithm pinning in source**: `Validation::default()` implicitly accepts the algorithm declared in the JWT header. Pin the algorithm explicitly in production to prevent algorithm-substitution attacks.
- **Clock skew**: No leeway is applied. Add `validation.leeway = N` (seconds) if upstream clocks may drift.
- **Token size**: Large JWTs (many claims, RS256 public key metadata) may exceed proxy-wasm header buffer limits. Keep tokens small.
- **Secret rotation**: Rotating `"secret"` immediately invalidates all outstanding tokens signed with the previous key.

---

## See Also

- fastedge proxywasm secret API reference
- proxy-wasm HttpContext trait reference
- jsonwebtoken crate documentation
- FastEdge secrets management guide
- examples-auth-jwt-http-rust (HTTP variant of this pattern)
