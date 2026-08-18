<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 6347a7c2fda0d03e66f1214db5eec041c16801b7
      updated: 2026-08-17
-->

# Rust Host Services Reference

Host-provided service modules for key-value storage, secret management, configuration dictionaries, and diagnostic utilities.

All modules documented here (`fastedge::key_value`, `fastedge::secret`, `fastedge::dictionary`, `fastedge::utils`) are part of the standard `fastedge` crate. No additional `Cargo.toml` changes are needed beyond the standard `fastedge` dependency.

CDN apps use `fastedge::proxywasm::*` variants of these modules. See the CDN Apps reference for the ProxyWasm API surface.

---

## Key-Value Storage

Module: `fastedge::key_value`

Provides persistent storage with support for simple key-value pairs, glob-style key scanning, sorted sets, and bloom filters. Data is organized into named stores; access must be granted via platform configuration.

### Store API

| Method | Signature | Description |
|--------|-----------|-------------|
| `new` | `pub fn new() -> Result<Self, Error>` | Opens the default store. Returns `Err(Error::NoSuchStore)` if no default store is configured, `Err(Error::AccessDenied)` if unauthorized. |
| `open` | `pub fn open(name: &str) -> Result<Self, Error>` | Opens a named store. Returns `Err(Error::NoSuchStore)` if the label is unrecognized, `Err(Error::AccessDenied)` if unauthorized. |
| `get` | `pub fn get(&self, key: &str) -> Result<Option<Vec<u8>>, Error>` | Returns `Ok(Some(bytes))` if the key exists, `Ok(None)` if it does not. Return type is raw bytes, not `String`. |
| `scan` | `pub fn scan(&self, pattern: &str) -> Result<Vec<String>, Error>` | Returns keys matching a glob-style pattern. Returns empty `Vec` if no keys match. |
| `zrange_by_score` | `pub fn zrange_by_score(&self, key: &str, min: f64, max: f64) -> Result<Vec<(Vec<u8>, f64)>, Error>` | Returns sorted set members whose score falls in the inclusive range `[min, max]`. Use `f64::NEG_INFINITY` / `f64::INFINITY` for unbounded ranges. Returns empty `Vec` if key does not exist or no members match. |
| `zscan` | `pub fn zscan(&self, key: &str, pattern: &str) -> Result<Vec<(Vec<u8>, f64)>, Error>` | Returns sorted set members whose member value matches the glob-style pattern. Returns empty `Vec` if key does not exist or no members match. |
| `bf_exists` | `pub fn bf_exists(&self, key: &str, item: &str) -> Result<bool, Error>` | Tests whether `item` is probably a member of the bloom filter at `key`. Returns `true` if probably added (subject to false-positive rate), `false` if key does not exist or item was definitely not added. Cannot produce false negatives. |

### Glob Pattern Syntax (scan / zscan)

| Pattern | Matches |
|---------|---------|
| `*` | Any sequence of characters within a segment |
| `?` | Any single character |
| `[abc]` | Any character in the set |

### Error Type

All `Store` methods return `Result<_, Error>`.

| Variant | Description |
|---------|-------------|
| `Error::NoSuchStore` | The requested store label is not recognized by the host |
| `Error::AccessDenied` | The application does not have permission to access the store |
| `Error::Other(String)` | An implementation-specific error (I/O or internal host failure) |

### Code Example: Open → Get → Decode

```rust,no_run
use fastedge::key_value::{Error, Store};
use wstd::http::body::Body;
use wstd::http::{Request, Response};

#[wstd::http_server]
async fn main(_request: Request<Body>) -> anyhow::Result<Response<Body>> {
    let store = match Store::open("user-data") {
        Ok(s) => s,
        Err(Error::NoSuchStore) => {
            return Ok(Response::builder()
                .status(500)
                .body(Body::from("Store not configured"))?);
        }
        Err(Error::AccessDenied) => {
            return Ok(Response::builder()
                .status(403)
                .body(Body::from("Access denied"))?);
        }
        Err(Error::Other(msg)) => {
            return Err(anyhow::anyhow!("KV store error: {}", msg));
        }
    };

    match store.get("user:123:profile")? {
        Some(data) => {
            // data is Vec<u8> — decode as needed
            let text = String::from_utf8_lossy(&data);
            Ok(Response::builder()
                .status(200)
                .body(Body::from(text.into_owned()))?)
        }
        None => Ok(Response::builder()
            .status(404)
            .body(Body::from("not found"))?),
    }
}
```

### Code Example: Pattern Scanning

```rust,no_run
use fastedge::key_value::Store;
use wstd::http::body::Body;
use wstd::http::{Request, Response};

#[wstd::http_server]
async fn main(_request: Request<Body>) -> anyhow::Result<Response<Body>> {
    let store = Store::open("user-data")?;

    let keys = store.scan("user:123:*")?;
    for key in &keys {
        println!("Found key: {}", key);
    }

    Ok(Response::builder()
        .status(200)
        .body(Body::from(format!("{} keys found", keys.len())))?)
}
```

### Code Example: Sorted Sets

```rust,no_run
use fastedge::key_value::Store;
use wstd::http::body::Body;
use wstd::http::{Request, Response};

#[wstd::http_server]
async fn main(_request: Request<Body>) -> anyhow::Result<Response<Body>> {
    let store = Store::open("game-data")?;

    // All leaderboard entries with scores >= 1000
    let top_players = store.zrange_by_score("leaderboard", 1000.0, f64::INFINITY)?;
    for (member, score) in &top_players {
        let name = String::from_utf8_lossy(member);
        println!("Player: {}, Score: {}", name, score);
    }

    // Sorted set members matching a pattern
    let guild_members = store.zscan("guild:42:members", "player:*")?;

    Ok(Response::builder()
        .status(200)
        .body(Body::from(format!(
            "{} top players, {} guild members",
            top_players.len(),
            guild_members.len()
        )))?)
}
```

### Code Example: Bloom Filter

```rust,no_run
use fastedge::key_value::Store;
use wstd::http::body::Body;
use wstd::http::{Request, Response};

#[wstd::http_server]
async fn main(_request: Request<Body>) -> anyhow::Result<Response<Body>> {
    let store = Store::open("rate-limit")?;

    let client_ip = "203.0.113.42";

    if store.bf_exists("blocked_ips", client_ip)? {
        return Ok(Response::builder()
            .status(403)
            .body(Body::from("Blocked"))?);
    }

    Ok(Response::builder()
        .status(200)
        .body(Body::empty())?)
}
```

---

## Secret Management

Module: `fastedge::secret`

Provides access to encrypted secrets such as API keys, passwords, and certificates. Secrets are encrypted at rest and support versioned retrieval for rotation scenarios.

### API

```rust
pub fn get(key: &str) -> Result<Option<Vec<u8>>, Error>
```

Returns the currently effective value of the named secret as raw bytes. Returns `Ok(None)` if no secret with that name is configured. Returns `Err(secret::Error)` on authorization failure — `Ok(None)` does not indicate an authorization failure.

```rust
pub fn get_effective_at(key: &str, at: u32) -> Result<Option<Vec<u8>>, Error>
```

Returns the value of the named secret that was effective at the given Unix timestamp (`at`, seconds since epoch, `u32`). Useful during secret rotation to verify that both the old and new versions are accessible. Returns `Ok(None)` if no version of the secret was configured at that time.

### Code Example: Reading a Secret

```rust,no_run
use fastedge::secret;
use wstd::http::body::Body;
use wstd::http::{Request, Response};

#[wstd::http_server]
async fn main(_request: Request<Body>) -> anyhow::Result<Response<Body>> {
    let api_key = match secret::get("UPSTREAM_API_KEY")? {
        Some(key) => key,
        None => {
            return Ok(Response::builder()
                .status(500)
                .body(Body::from("API key not configured"))?);
        }
    };

    // Use api_key bytes for authentication — do not log or include in responses
    let _ = api_key;

    Ok(Response::builder()
        .status(200)
        .body(Body::empty())?)
}
```

### Code Example: Rotation Validation

```rust,no_run
use fastedge::secret;
use std::time::{SystemTime, UNIX_EPOCH};
use wstd::http::body::Body;
use wstd::http::{Request, Response};

#[wstd::http_server]
async fn main(_request: Request<Body>) -> anyhow::Result<Response<Body>> {
    let five_minutes_ago = SystemTime::now()
        .duration_since(UNIX_EPOCH)?
        .as_secs() as u32
        - 300;

    let previous_secret = secret::get_effective_at("SIGNING_KEY", five_minutes_ago)?;
    let current_secret = secret::get("SIGNING_KEY")?;

    let _ = (previous_secret, current_secret);

    Ok(Response::builder()
        .status(200)
        .body(Body::empty())?)
}
```

### Security Notes

- Never include secret values in HTTP responses, log output, or diagnostic messages.
- Secret values are returned as raw bytes (`Vec<u8>`). Convert to `String` only when the secret is defined as UTF-8 text, and handle the conversion error explicitly.
- `Ok(None)` means the secret is not configured or not found. Authorization failures return `Err(secret::Error)`, not `Ok(None)`.
- Clear secret material from memory as soon as it is no longer needed. Binding a secret to a local variable ensures it is dropped at end of scope.

---

## Dictionary

Module: `fastedge::dictionary`

Provides fast, read-only lookups for configuration values that do not change during the lifetime of a deployment.

### API

```rust
pub fn get(key: &str) -> Option<String>
```

Returns `Some(value)` if the key exists and its value is valid UTF-8, or `None` if the key is not found or the value cannot be decoded as UTF-8.

Dictionary values are environment variables set at deployment time via the platform — the same management mechanism as secrets, but without encryption. They are not writable from application code.

### Code Example

```rust,no_run
use fastedge::dictionary;
use wstd::http::body::Body;
use wstd::http::{Request, Response};

#[wstd::http_server]
async fn main(_request: Request<Body>) -> anyhow::Result<Response<Body>> {
    let upstream = dictionary::get("upstream_origin")
        .unwrap_or_else(|| "https://default.example.com".to_string());

    let timeout_ms: u64 = dictionary::get("timeout_ms")
        .and_then(|v| v.parse().ok())
        .unwrap_or(5000);

    Ok(Response::builder()
        .status(200)
        .body(Body::from(format!(
            "Upstream: {}, Timeout: {}ms",
            upstream, timeout_ms
        )))?)
}
```

### When to Use Dictionary vs Key-Value vs Secrets

| Criterion | `dictionary` | `key_value` | `secret` |
|-----------|-------------|-------------|---------|
| **Mutability** | Read-only; set at deployment time | Read-only from application code | Read-only; managed by platform |
| **Value type** | UTF-8 strings only | Arbitrary bytes | Arbitrary bytes |
| **Advanced data structures** | No | Sorted sets, bloom filters, glob scan | No |
| **Confidentiality** | Not encrypted; visible in config | Not encrypted at the application layer | Encrypted at rest; access-controlled |
| **Typical use cases** | Feature flags, routing config, tuning | Caching, counters, state, rate-limit data | API keys, tokens, certificates, credentials |
| **Versioning / rotation** | No | No | Yes, via `get_effective_at` |

Use `dictionary` for simple, non-sensitive string configuration known at deployment time. Use `key_value` for larger datasets, binary values, or data requiring advanced query patterns. Use `secret` for any value that must be kept confidential.

---

## Utilities

Module: `fastedge::utils`

Provides diagnostic functions for monitoring and debugging edge applications.

### API

```rust
pub fn set_user_diag(value: &str)
```

Writes a diagnostic string that appears in the FastEdge platform logs associated with the current request. No return value. Panics if the host rejects the call.

**Stdout vs stderr**: The FastEdge platform captures only **stdout**. `stderr` is silently discarded and does not appear in the platform log viewer. Use `println!` for any output that needs to be observed. Do not use `eprintln!`.

One diagnostic message per request is the typical pattern. If `set_user_diag` is called multiple times, the platform may record only the last value or concatenate them depending on runtime behavior.

Do not write sensitive values (secrets, credentials, personally identifiable information) to diagnostics, as output appears in platform logs accessible to operations personnel.

### Code Example

```rust,no_run
use fastedge::key_value::Store;
use fastedge::utils::set_user_diag;
use wstd::http::body::Body;
use wstd::http::{Request, Response};

#[wstd::http_server]
async fn main(_request: Request<Body>) -> anyhow::Result<Response<Body>> {
    set_user_diag("handler entered");

    let store = Store::open("cache")?;

    match store.get("config:version")? {
        Some(v) => {
            set_user_diag(&format!("config version: {}", String::from_utf8_lossy(&v)));
        }
        None => {
            set_user_diag("config version: not found");
        }
    }

    Ok(Response::builder()
        .status(200)
        .body(Body::empty())?)
}
```

---

## See Also

- SDK API reference (sdk-reference-rust.md) — Core HTTP handler, `send_request`, `Body`, and the `#[fastedge::http]` macro
- CDN Apps reference — ProxyWasm API for CDN apps (`fastedge::proxywasm::key_value`, `fastedge::proxywasm::secret`, `fastedge::proxywasm::dictionary`, `fastedge::proxywasm::utils`)
- Platform Overview — Store configuration, secret management, and deployment-time variable setup
