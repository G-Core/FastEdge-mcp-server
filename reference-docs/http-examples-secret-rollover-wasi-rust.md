<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 6347a7c2fda0d03e66f1214db5eec041c16801b7
      updated: 2026-06-16
-->

# Secret Rollover (WASI, Rust)

Demonstrates slot-based secret retrieval for zero-downtime secret rotation using `fastedge::secret::get_effective_at()`. Compares the current (latest-slot) secret value with the value effective at a given slot and returns both as JSON.

## Metadata

| Field | Value |
|---|---|
| Example path | `examples/http/wasi/secret_rollover` |
| Language | Rust |
| App type | HTTP |
| Runtime | WASI (wasm32-wasip2) |
| Crate type | cdylib |

## Dependencies

```toml
wstd = "0.6"
fastedge = "0.4"
anyhow = "1"
serde_json = "1"
```

## APIs Used

### `fastedge::secret::get`

```rust
pub fn get(name: &str) -> Result<Option<String>, Error>
```

Returns the current (latest-slot) value for the named secret.

- `name`: secret name as configured in the FastEdge app
- Returns `Ok(Some(value))` when the secret exists and has a slot value
- Returns `Ok(None)` when the secret exists but has no slot value
- Returns `Err` on retrieval failure

### `fastedge::secret::get_effective_at`

```rust
pub fn get_effective_at(name: &str, slot: u32) -> Result<Option<String>, Error>
```

Returns the secret value effective at the given slot using greatest-matching-slot semantics.

- `name`: secret name as configured in the FastEdge app
- `slot`: unsigned 32-bit integer; interpreted as an index or Unix timestamp (seconds)
- Returns `Ok(Some(value))` when a matching slot is found
- Returns `Ok(None)` when no slot matches (no slot with value `<= effective_at` exists)
- Returns `Err` on retrieval failure

## Slot Semantics

Slot lookup uses a **greatest-match rule**: the slot with the highest value that is `<= effective_at` is returned. This is not an exact match.

```
Secret slots: { 0: "original_password", 1741790697: "new_password" }

get_effective_at("TOKEN_SECRET", 0)          → "original_password"
get_effective_at("TOKEN_SECRET", 100)        → "original_password"
get_effective_at("TOKEN_SECRET", 1741790697) → "new_password"
get_effective_at("TOKEN_SECRET", 9999999999) → "new_password"
```

Typical JWT rotation use: pass `claims.iat` (issued-at timestamp) as the slot. This returns the password that was active when the token was issued, enabling zero-downtime rotation without invalidating existing tokens.

## Request Interface

| Header | Default | Description |
|---|---|---|
| `x-secret-name` | `TOKEN_SECRET` | Name of the secret to query |
| `x-slot` | current Unix timestamp (as `u32`) | Slot value passed to `get_effective_at` |

Slot is read from the `x-slot` header, parsed to `u32`. If absent or unparseable, defaults to `SystemTime::now()` as seconds since UNIX epoch cast to `u32`.

## Response

HTTP 200, `Content-Type: application/json`.

```json
{
  "secret_name": "TOKEN_SECRET",
  "slot": 0,
  "current": "new_password",
  "effective_at_slot": "original_password",
  "is_same": false
}
```

| Field | Type | Description |
|---|---|---|
| `secret_name` | string | The secret name queried |
| `slot` | number | The slot value used for `get_effective_at` |
| `current` | string \| null | Current (latest-slot) value from `secret::get` |
| `effective_at_slot` | string \| null | Value from `secret::get_effective_at` at the given slot |
| `is_same` | boolean | Whether `current == effective_at_slot` |

## Secret Configuration Format

```json
{
  "secret": {
    "name": "token-secret",
    "secret_slots": [
      { "slot": 0, "value": "original_password" },
      { "slot": 1741790697, "value": "new_password" }
    ]
  }
}
```

Slots are ordered by slot number; any non-negative `u32` value is valid as a slot key.

## Implementation Pattern

```rust
use fastedge::secret;

// Read slot from header, default to current unix timestamp
let slot: u32 = request
    .headers()
    .get("x-slot")
    .and_then(|v| v.to_str().ok())
    .and_then(|v| v.parse().ok())
    .unwrap_or_else(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("Time went backwards")
            .as_secs() as u32
    });

// Get current (latest) value
let current = secret::get(secret_name)
    .map_err(|e| anyhow!("secret::get failed: {e}"))?;

// Get value effective at the given slot
let effective = secret::get_effective_at(secret_name, slot)
    .map_err(|e| anyhow!("secret::get_effective_at failed: {e}"))?;
```

## Constraints and Gotchas

- `slot` is `u32`: Unix timestamps after year 2106 (~4294967295 seconds) will overflow. Use slot values within `u32` range.
- `Ok(None)` means the secret exists but no slot with value `<= effective_at` was found — it does not mean the secret is absent.
- Both `get` and `get_effective_at` return `Result<Option<String>>`. Errors must be propagated explicitly (e.g. via `map_err(...)?`).
- The `fastedge` crate must appear in `[dependencies]` alongside `wstd`. The `wstd` crate alone does not expose secret APIs.
- Slot matching is `<=`, not exact. There is no "not found for this exact slot" distinction — a lower-numbered slot will be returned instead.

## Build

```sh
cargo build --release
# Output: target/wasm32-wasip2/release/secret_rollover.wasm
```

## See Also

- fastedge::secret API reference (host-services-rust)
- JWT token validation patterns using `iat` claims
- Platform secrets management (platform-overview)
- Deploy skill reference for uploading and configuring secrets on FastEdge apps
