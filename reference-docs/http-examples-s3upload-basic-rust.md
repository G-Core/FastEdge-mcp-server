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
capabilities: [s3-upload, presigned-url, outbound-fetch, env-config, file-size-limit]
---

# S3 Upload — HTTP Example (Rust)

Edge function that accepts a file upload via `POST` or `PUT`, generates a presigned S3 `PUT` URL on the fly using `rusty_s3`, forwards the file body to the S3-compatible endpoint via `fastedge::send_request`, and returns the clean object URL to the caller.

**Handler type:** `#[fastedge::http]` (sync, `wasm32-wasip1` target). For new apps, prefer the async WASI handler.

**Crate:** `s3upload` — `crate-type = ["cdylib"]`

---

## Dependencies

```toml
fastedge = "0.4"
url = "2.3"
rusty-s3 = "0.5"
anyhow = "1"
```

---

## Handler Signature

```rust
#[fastedge::http]
fn main(req: Request<Body>) -> Result<Response<Body>, Error>
```

---

## Request Flow

1. **Method guard** — Accepts `POST` and `PUT` only.
   - `OPTIONS` → `204 NO_CONTENT` (no CORS headers included).
   - Any other method → `405 METHOD_NOT_ALLOWED` with `Allow: PUT, POST` header.
2. **Query param extraction** — Parses `?name=<filename>` from the request URI. Missing `name` → `400 BAD_REQUEST`.
3. **Body check** — Empty body → `400 BAD_REQUEST`.
4. **Content-Type extraction** — Reads `Content-Type` header; falls back to `"application/octet-stream"`.
5. **Body consumption** — `req.into_body()` consumes the request. All headers, method, and query params must be extracted before this call.
6. **File size enforcement** — If `MAX_FILE_SIZE` env var is set and parseable as `usize`, rejects bodies exceeding that byte count with `413 PAYLOAD_TOO_LARGE`.
7. **S3 URL preparation** — Calls `prepare_s3(fname)` → returns `(signed_url: Url, host: String)` or `500 INTERNAL_SERVER_ERROR` on failure.
8. **Outbound PUT** — Constructs a `PUT` request to the signed URL with explicit `Host`, `Accept-Encoding: identity`, `Content-Length`, and `Content-Type` headers. Sends via `fastedge::send_request`.
9. **Response construction**:
   - S3 returns `200`: response body is replaced with the clean object URL (signed URL with query string stripped via `set_query(None)`).
   - S3 returns other status: S3 status and body forwarded as-is to caller.

---

## S3 URL Signing — `prepare_s3`

```rust
fn prepare_s3(fname: &str) -> anyhow::Result<(Url, String)>
```

### Behavior

Reads S3 credentials and configuration from environment variables, constructs the bucket endpoint, and generates a presigned `PUT` URL valid for **1 hour**.

### rusty_s3 API Used

| Call | Purpose |
|---|---|
| `Bucket::new(parsed_url, UrlStyle::Path, bucket, region)` | Create bucket handle with path-style URLs |
| `Credentials::new(access_key, secret_key)` | Create S3 credentials |
| `bucket.put_object(Some(&creds), fname)` | Create a `PutObject` action for the given object key |
| `action.sign(Duration::from_secs(3600))` | Generate presigned URL valid for 1 hour |

### Endpoint Construction

```
<SCHEME>://<REGION>.<BASE_HOSTNAME>/<BUCKET>/<fname>
```

Example: `http://s-ed1.cloud.gcore.lu/mybucket/photo.jpg`

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ACCESS_KEY` | yes | — | S3 access key |
| `SECRET_KEY` | yes | — | S3 secret key |
| `REGION` | yes | — | S3 region (e.g. `s-ed1`) |
| `BASE_HOSTNAME` | yes | — | S3 base hostname (e.g. `cloud.gcore.lu`) |
| `BUCKET` | yes | — | S3 bucket name |
| `SCHEME` | no | `"http"` | URL scheme for the S3 endpoint |
| `MAX_FILE_SIZE` | no | no limit | Maximum upload size in bytes; silently ignored if non-numeric |

---

## Outbound Request Construction

```rust
Request::builder()
    .method(Method::PUT)
    .uri(signed_url.as_str())
    .header("Host", host)
    .header("Accept-Encoding", "identity")
    .header("Content-Length", content.len().to_string())
    .header("Content-Type", content_type)
    .body(content)
```

- `Content-Length` must be set explicitly — `fastedge::send_request` does not auto-compute it.
- `Accept-Encoding: identity` prevents compressed transfer encoding issues.
- `host` is `<REGION>.<BASE_HOSTNAME>` (no scheme, no bucket).

---

## Response Codes

| Status | Condition |
|---|---|
| `200 OK` | Upload succeeded; body is the clean S3 object URL |
| `204 NO_CONTENT` | `OPTIONS` method received |
| `400 BAD_REQUEST` | Missing `name` query param or empty body |
| `405 METHOD_NOT_ALLOWED` | Method is not `POST`, `PUT`, or `OPTIONS` |
| `413 PAYLOAD_TOO_LARGE` | Body exceeds `MAX_FILE_SIZE` |
| `500 INTERNAL_SERVER_ERROR` | `prepare_s3` failed (missing env var or parse error), or request builder failed |
| Forwarded from S3 | Any non-200 S3 response — status and body passed through |

---

## Example Request

```
POST /upload?name=photo.jpg
Content-Type: image/jpeg

<file bytes>
```

**Success response (200):**
```
http://s-ed1.cloud.gcore.lu/mybucket/photo.jpg
```

---

## Build

```sh
cargo build --release
# Output: target/wasm32-wasip1/release/s3upload.wasm
```

---

## Key Constraints and Gotchas

- `req.into_body()` consumes the request — extract method, URI query, and all headers **before** calling it.
- The presigned URL expires after 1 hour. Because the upload is performed server-side immediately, expiry has no practical impact.
- `OPTIONS` returns `204` without CORS headers. Add `Access-Control-Allow-*` headers manually if browser preflight support is required.
- `MAX_FILE_SIZE` is silently ignored (no error, no log) when set to a non-numeric string.
- On S3 success, the response body is replaced entirely with the clean object URL — the original S3 response body is discarded.
- The `UrlStyle::Path` style is used for `Bucket::new` — bucket name appears in the URL path, not the hostname.

---

## See Also

- fastedge-docs HTTP examples overview
- platform-overview (environment variables, `send_request` capability)
- sdk-reference-rust (`fastedge::send_request`, `Body`, `Request`, `Response`)
- host-services-rust (outbound HTTP)
- rusty-s3 crate documentation (external)
