<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 6347a7c2fda0d03e66f1214db5eec041c16801b7
      updated: 2026-08-17
-->

---
type: example
app_type: http
languages:
  - rust
capabilities:
  - ab-testing
  - cookie-parsing
  - outbound-fetch
  - header-mutation
  - request-proxying
---

# Example: A/B Testing (WASI, Rust)

Cookie-based A/B testing handler. Reads or creates an `x-fastedge-abid` cookie, uses its value to deterministically assign the visitor to weighted variants of each configured test, proxies the request to a downstream origin with variant assignments as `ab-test-<name>` request headers, and sets the cookie on the response so returning visitors receive the same variants on subsequent visits.

**Crate:** `ab_testing_wasi`  
**Runtime:** WASI (`wstd` 0.6)  
**Entry point:** `#[wstd::http_server] async fn main(req: Request<Body>) -> anyhow::Result<Response<Body>>`

---

## Required Configuration

| Name | Type | Required | Description |
|---|---|---|---|
| `OUTBOUND_URL` | Environment variable | Yes | Downstream origin URL to proxy to. Must be non-empty. |

If `OUTBOUND_URL` is missing or empty, the handler returns `HTTP 500` immediately with the body `"OUTBOUND_URL environment variable is not configured"`. No outbound request is made.

---

## Dependencies

```toml
wstd = "0.6"
anyhow = "1"
```

`crate-type = ["cdylib"]` — required for WASM compilation.

---

## Core API Usage

### Reading the incoming cookie

```rust
let raw_cookie = req
    .headers()
    .get("cookie")
    .and_then(|v| v.to_str().ok())
    .unwrap_or("")
    .to_string();
```

- `req.headers().get("cookie")` → `Option<&HeaderValue>`
- `.to_str().ok()` → `Option<&str>` (returns `None` if header value contains non-visible ASCII)
- Falls back to empty string; no error is propagated for a missing or malformed cookie header.

### Building the outbound request

```rust
let mut builder = Request::get(&outbound_url);
// Copy headers selectively
builder = builder.header(name, value);
// Add variant assignments
builder = builder.header(format!("ab-test-{}", test.name), variant);

let outbound_req = builder
    .body(Body::empty())
    .map_err(|e| anyhow!("failed to build outbound request: {e}"))?;
```

- `Request::get(&url)` — constructs a builder for an HTTP GET request.
- `.body(Body::empty())` → `Result<Request<Body>, http::Error>` — errors are propagated via `?` as `anyhow::Error`.
- `host` and `cookie` headers are explicitly skipped when copying from the incoming request.

### Sending the outbound request

```rust
let outbound_resp = Client::new()
    .send(outbound_req)
    .await
    .map_err(|e| anyhow!("outbound request failed: {e}"))?;
```

- `Client::new()` — creates a new HTTP client.
- `.send(req)` → `impl Future<Output = Result<Response<Body>, ...>>` — async, awaited.
- Errors are mapped to `anyhow::Error` and propagated via `?`.

### Reading the response body

```rust
let (parts, mut body) = outbound_resp.into_parts();
let body_bytes = body.contents().await?;
```

- `.into_parts()` → `(Parts, Body)` — splits response into headers/status and body.
- `body.contents().await?` → `Result<Vec<u8>>` — reads the complete body into memory.

### Building the response with set-cookie

```rust
let xid_cookie =
    format!("{AB_COOKIE}={xid}; Max-Age=31536000; Path=/; Secure; HttpOnly; SameSite=Lax");

Ok(Response::builder()
    .status(parts.status)
    .header("content-type", content_type)
    .header("set-cookie", xid_cookie)
    .body(Body::from(body_bytes))?)
```

- `Response::builder()` → `http::response::Builder`
- `.body(Body::from(body_bytes))` → `Result<Response<Body>, http::Error>` — `?` propagates errors.
- The `content-type` is copied from the origin response; falls back to `"application/octet-stream"` if absent or non-ASCII.
- Cookie lifetime: `Max-Age=31536000` (one year). Attributes: `Secure; HttpOnly; SameSite=Lax`.

---

## A/B Test Configuration

Tests are declared as a static slice in source code. Each test has a name and a list of variants with weights.

```rust
static TESTS: &[AbTest] = &[
    AbTest {
        name: "logo",
        variants: &[
            VariantWeight { variant: "hops",   weight: 50.0 },
            VariantWeight { variant: "bottle", weight: 50.0 },
        ],
    },
    AbTest {
        name: "font",
        variants: &[
            VariantWeight { variant: "exo2",     weight: 40.0 },
            VariantWeight { variant: "gloria",   weight: 65.0 },
            VariantWeight { variant: "standard", weight: 45.0 },
        ],
    },
];
```

- Weights are normalised at assignment time — they do not need to sum to 100.
- Each test produces one `ab-test-<name>` header on the outbound request (e.g. `ab-test-logo: hops`).
- To add, remove, or reweight variants, edit `TESTS` directly and recompile.

---

## Assignment Algorithm

### Cookie format

`AB_COOKIE = "x-fastedge-abid"`. Value is a decimal string in `[0.0, 1.0)`, e.g. `"0.4532"`.

### Validation

```rust
fn is_valid_xid(xid: &str) -> bool {
    matches!(xid.parse::<f64>(), Ok(v) if (0.0..1.0).contains(&v))
}
```

A cookie value is accepted only if it parses as `f64` and lies in `[0.0, 1.0)`. Invalid or tampered values cause a new `xid` to be generated. This prevents client-supplied values from biasing assignment.

### Generation

```rust
fn generate_xid() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("0.{:04}", now.subsec_nanos() % 10000)
}
```

**Gotcha — weak entropy:** `generate_xid()` uses request-time subsecond nanoseconds as an entropy source. This is intentionally simplistic and produces only 10,000 distinct values. For production use, replace this with a cryptographic RNG backed by `wasi-random` (e.g. via the `rand` crate wired to `getrandom` with the WASI feature enabled).

### Variant selection

```rust
fn assign_variant(xid: &str, test: &AbTest) -> Option<&'static str> {
    let xid_value: f64 = xid.parse().ok()?;
    let xid_percentage = xid_value * 100.0;
    let total: f64 = test.variants.iter().map(|v| v.weight).sum();
    if total == 0.0 { return None; }
    let mut start = 0.0;
    for vw in test.variants {
        let percentage = (vw.weight / total) * 100.0;
        let end = start + percentage;
        if xid_percentage >= start && xid_percentage < end {
            return Some(vw.variant);
        }
        start = end;
    }
    None
}
```

- Converts `xid` to a percentage `[0.0, 100.0)`.
- Walks each variant's normalised cumulative weight range; returns the first variant whose bucket contains the percentage.
- Returns `None` if `xid` fails to parse or total weight is zero; in that case no `ab-test-<name>` header is added for that test.

---

## Cookie Handling Details

### Extraction

```rust
fn extract_abid(cookie_header: &str) -> Option<&str>
```

Splits on `;`, trims whitespace, finds the first segment with prefix `"x-fastedge-abid="`, returns the value portion.

### Stripping before forwarding

```rust
fn strip_abid(cookie_header: &str) -> String
```

Filters out the `x-fastedge-abid=...` segment and rejoins with `"; "`. The origin never sees the internal A/B cookie. If the cleaned cookie is empty or whitespace-only, the `cookie` header is omitted from the outbound request entirely.

---

## Request Flow

1. Read `OUTBOUND_URL` from env — return 500 if missing/empty.
2. Read incoming `cookie` header.
3. Extract `x-fastedge-abid` value. If absent or invalid, generate a new `xid`.
4. Build outbound request:
   - Copy all incoming headers except `host` and `cookie`.
   - Attach cleaned cookie (without `x-fastedge-abid`) if non-empty.
   - Attach one `ab-test-<name>` header per test.
5. Send outbound request via `Client::new().send(...).await`.
6. Read origin response body with `body.contents().await`.
7. Return origin response (status + content-type) plus `set-cookie: x-fastedge-abid=<xid>; ...`.

---

## Error Conditions

| Condition | Behaviour |
|---|---|
| `OUTBOUND_URL` env var missing or empty | Returns `HTTP 500` with descriptive message; no outbound call made |
| Outbound request build fails | Returns `anyhow::Error` (HTTP 500 via framework) |
| Outbound request send fails | Returns `anyhow::Error` (HTTP 500 via framework) |
| `body.contents()` fails | Returns `anyhow::Error` (HTTP 500 via framework) |
| Cookie header is absent or non-ASCII | Treated as no cookie; new `xid` generated |
| Cookie `xid` value is invalid (outside `[0.0, 1.0)`) | New `xid` generated; client's value discarded |
| Variant total weight is zero | No `ab-test-<name>` header added for that test |

---

## Outbound Request Headers

| Header | Source |
|---|---|
| All incoming headers (except `host`, `cookie`) | Copied verbatim from the original request |
| `cookie` | Incoming cookie minus the `x-fastedge-abid` segment |
| `ab-test-logo` | Assigned variant name (e.g. `"hops"` or `"bottle"`) |
| `ab-test-font` | Assigned variant name (e.g. `"exo2"`, `"gloria"`, or `"standard"`) |

---

## Response Headers Added

| Header | Value |
|---|---|
| `set-cookie` | `x-fastedge-abid=<xid>; Max-Age=31536000; Path=/; Secure; HttpOnly; SameSite=Lax` |
| `content-type` | Copied from origin response; fallback `"application/octet-stream"` |

All other origin response headers are dropped. Only status, content-type, and set-cookie are forwarded.

---

## See Also

- ab-testing example for JavaScript (FastEdge-sdk-js) — mirrors this implementation
- fastedge-docs platform-overview — environment variable configuration
- fastedge-docs sdk-reference-rust — `wstd::http` Client, Request, Response API
- fastedge-docs best-practices — production RNG guidance for WASI targets
