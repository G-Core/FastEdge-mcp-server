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
app_type: http
languages: [rust]
capabilities: [kv-store, bloom-filter, ip-denylist]
---

# Example: Bloom Filter IP Denylist (WASI, Rust)

HTTP handler that checks the client IP against a bloom filter stored in a FastEdge KV Store. Returns 403 if the IP is (probably) blocked, 200 otherwise.

## Source

`examples/http/wasi/bloom_filter_denylist/src/lib.rs`

## Use Case

IP-based access control using a probabilistic data structure. Suitable for denylists where occasional false positives (over-blocking legitimate IPs) are acceptable. Not suitable for allowlists or exact membership checks.

## Configuration

| Variable | Type | Required | Description |
|---|---|---|---|
| `DENYLIST_STORE` | env var | yes | Name of the KV store containing the bloom filter |

- Bloom filter key is hardcoded to `"blocked-ips"` (constant `BLOOM_KEY`). Change in source if your key differs.
- The handler is read-only — the bloom filter must be populated out of band (e.g. via the FastEdge API).

## Dependencies

```toml
wstd = "0.6"
fastedge = "0.4"
anyhow = "1"
serde_json = "1"
```

Crate type: `cdylib`

## API Used

### `fastedge::key_value::Store::open`

```rust
use fastedge::key_value::{Error as StoreError, Store};

fn Store::open(name: &str) -> Result<Store, StoreError>
```

- `name`: KV store name (from `DENYLIST_STORE` env var)
- Returns `Ok(Store)` on success
- Returns `Err(StoreError::AccessDenied)` if the store is not accessible
- Returns `Err(StoreError)` for other failures

### `Store::bf_exists`

```rust
fn Store::bf_exists(key: &str, member: &str) -> Result<bool, StoreError>
```

- `key`: the bloom filter key in the store (`"blocked-ips"`)
- `member`: the value to test for membership (client IP string)
- Returns `Ok(true)` — member is **probably** in the set (may be a false positive)
- Returns `Ok(false)` — member is **definitely not** in the set
- Returns `Err(StoreError)` on failure (propagated via `anyhow!`)

## Request Flow

1. Read `DENYLIST_STORE` env var → 500 if missing or empty.
2. Extract client IP from `x-real-ip` header; fall back to `x-forwarded-for` (first comma-separated value, trimmed) → 500 if neither present.
3. Open KV store via `Store::open(&store_name)` → 403 on `AccessDenied`, 500 on other errors.
4. Call `store.bf_exists(BLOOM_KEY, ip)` → propagate error via `?`.
5. If `true`: return 403 with `{ "allowed": false, "ip": "..." }`.
6. If `false`: return 200 with `{ "allowed": true, "ip": "..." }`.

## Client IP Extraction Pattern

```rust
let client_ip = headers
    .get("x-real-ip")
    .or_else(|| headers.get("x-forwarded-for"))
    .and_then(|v| v.to_str().ok())
    .and_then(|v| v.split(',').next())
    .map(str::trim)
    .filter(|s| !s.is_empty());
```

- Priority: `x-real-ip` → `x-forwarded-for`
- For `x-forwarded-for`: takes only the first value (leftmost client IP) after splitting on `,`
- Returns `None` if both headers are absent or produce an empty string → handler returns 500

## Error Handling

| Condition | Status | Body |
|---|---|---|
| `DENYLIST_STORE` not set or empty | 500 | `{ "error": "DENYLIST_STORE environment variable is not configured" }` |
| Client IP not resolvable | 500 | `{ "error": "client IP not available" }` |
| `Store::open` → `AccessDenied` | 403 | `{ "error": "access denied opening denylist store" }` |
| `Store::open` → other error | 500 | `{ "error": "store open error: <e>" }` |
| `bf_exists` error | propagated as `anyhow::Error` | — |
| IP blocked (`bf_exists` → `true`) | 403 | `{ "allowed": false, "ip": "..." }` |
| IP not blocked (`bf_exists` → `false`) | 200 | `{ "allowed": true, "ip": "..." }` |

## Response Helper

All responses are JSON. A local helper is used:

```rust
fn json_response(status: u16, value: serde_json::Value) -> anyhow::Result<Response<Body>> {
    Ok(Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(Body::from(value.to_string()))?)
}
```

## Bloom Filter Semantics

| `bf_exists` result | Meaning |
|---|---|
| `true` | Probably in set — small false-positive rate; some legitimate IPs may be over-blocked |
| `false` | Definitely not in set — no false negatives |

- False positives are acceptable for denylists (over-blocking is the safe failure mode).
- False positives are **not** acceptable for allowlists. Use `store.get()` on a regular key for exact membership checks.
- False negatives cannot occur with a correctly implemented bloom filter.

## Entry Point

```rust
#[wstd::http_server]
async fn main(req: Request<Body>) -> anyhow::Result<Response<Body>>
```

Uses the `wstd` WASI Component Model HTTP server macro.

## See Also

- fastedge::key_value module reference (Store API, StoreError variants)
- KV Store provisioning and population via FastEdge API
- examples-bloom-filter-denylist-js (JavaScript mirror of this example)
- platform-overview (KV Store concepts)
