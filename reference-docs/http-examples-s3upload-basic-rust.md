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
- Query params (`?name=...`) are parsed manually using `split('&')` and `splitn(2, '=')` into a `HashMap<String, String>`.

---

## See Also

- fastedge-docs HTTP examples overview
- platform-overview (environment variables, `send_request` capability)
- sdk-reference-rust (`fastedge::send_request`, `Body`, `Request`, `Response`)
- host-services-rust (outbound HTTP)
- rusty-s3 crate documentation (external)

## Source Material

### FILE: examples/http/basic/s3upload/src/lib.rs

```rust
use std::time::Duration;

use fastedge::{
    body::Body,
    http::{header, Error, Method, Request, Response, StatusCode},
};
use rusty_s3::{Bucket, Credentials, S3Action, UrlStyle};
use std::{collections::HashMap, env};
use url::Url;

#[fastedge::http]
fn main(req: Request<Body>) -> Result<Response<Body>, Error> {
    match req.method() {
        // Allow only POST and PUT requests
        &Method::POST | &Method::PUT => (),

        &Method::OPTIONS => {
            return Response::builder()
                .status(StatusCode::NO_CONTENT)
                .body(Body::empty());
        }

        // Deny anything else
        _ => {
            return Response::builder()
                .status(StatusCode::METHOD_NOT_ALLOWED)
                .header(header::ALLOW, "PUT, POST")
                .body(Body::from("This method is not allowed\n"));
        }
    };

    /* get request params */
    let query_pairs = |q: &str| {
        q.split('&')
            .filter_map(|q| {
                let mut i = q.splitn(2, '=');
                let k = i.next()?;
                let v = i.next()?;
                Some((k, v))
            })
            .map(|(k, v)| (k.to_owned(), v.to_owned()))
            .collect::<HashMap<String, String>>()
    };
    let hash_query: HashMap<String, String> = req.uri().query().map_or(HashMap::new(), query_pairs);

    let fname = match hash_query.get("name") {
        None => {
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Body::from("Malformed request\n"))
        }
        Some(i) => i,
    };
    if req.body().is_empty() {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(Body::from("Malformed request\n"));
    }
    let content_type = match req.headers().get("Content-Type") {
        None => "application/octet-stream",
        Some(v) => v.to_str().unwrap_or("application/octet-stream"),
    };
    let content_type = content_type.to_owned();
    let content = req.into_body();

    match env::var("MAX_FILE_SIZE").ok() {
        None => {}
        Some(l) => match l.parse::<usize>() {
            Err(_) => {}
            Ok(v) => {
                if content.len() > v {
                    let msg = format!("File exceeds allowed limit of {} bytes\n", v);
                    return Response::builder()
                        .status(StatusCode::PAYLOAD_TOO_LARGE)
                        .body(Body::from(msg.as_str().to_owned()));
                }
            }
        },
    }

    let (signed_url, host) = match prepare_s3(fname) {
        Err(_) => {
            return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::from("App misconfigured\n"))
        }
        Ok((u, h)) => (u, h),
    };

    /* build outgoing req */
    let out_req = Request::builder()
        .method(Method::PUT)
        .uri(signed_url.as_str())
        .header("Host", host)
        .header("Accept-Encoding", "identity")
        .header("Content-Length", content.len().to_string())
        .header("Content-Type", content_type);

    let Ok(req) = out_req.body(content) else {
        return Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Body::from("Malformed request\n"));
    };

    let rsp = match fastedge::send_request(req) {
        Err(_) => {
            return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::empty())
        }
        Ok(r) => r,
    };
    let (parts, body) = rsp.into_parts();
    let body = if parts.status == StatusCode::OK {
        let mut tmp_url = signed_url.clone();
        tmp_url.set_query(None);
        Body::from(tmp_url.to_string())
    } else {
        body
    };
    Ok(Response::from_parts(parts, body))
}

fn prepare_s3(fname: &str) -> anyhow::Result<(Url, String)> {
    /* read S3 access params from env */
    let access_key = env::var("ACCESS_KEY")?;
    let secret_key = env::var("SECRET_KEY")?;
    let region = env::var("REGION")?;
    let base_hostname = env::var("BASE_HOSTNAME")?;
    let bucket = env::var("BUCKET")?;
    let scheme = env::var("SCHEME").unwrap_or_else(|_| "http".to_string());

    /* set S3 request params */
    let host = region.clone() + "." + base_hostname.as_str();
    let upload_url = scheme + "://" + host.as_str();
    let parsed_url = upload_url.parse()?;
    let bucket = Bucket::new(parsed_url, UrlStyle::Path, bucket, region)?;

    let creds = Credentials::new(access_key, secret_key);
    let action = bucket.put_object(Some(&creds), fname);
    let signed_url = action.sign(Duration::from_secs(60 * 60));

    Ok((signed_url, host))
}
```


### FILE: examples/http/basic/s3upload/Cargo.toml

```toml
[workspace]

[package]
name = "s3upload"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
fastedge = "0.4"
url = "2.3"
rusty-s3 = "0.5"
anyhow = "1"
```


### FILE: examples/http/basic/s3upload/README.md

```
[← Back to examples](../../../README.md)

# S3 Upload

FastEdge edge function that accepts a file upload, signs an S3 PUT request on the fly, uploads the file directly to an S3-compatible bucket, and returns the clean object URL to the caller.

> **Legacy handler:** Uses `#[fastedge::http]` (sync, `wasm32-wasip1`). For new apps prefer the async WASI handler — see [`examples/http/wasi/`](../../wasi/).

## What it does

1. Accepts `POST` or `PUT` only — returns 405 for other methods
2. Requires `?name=<filename>` query parameter and a non-empty body — returns 400 otherwise
3. Enforces `MAX_FILE_SIZE` if set — returns 413 if exceeded
4. Calls `prepare_s3()` to build a 1-hour presigned `PUT` URL using `rusty_s3`
5. Forwards the file body to S3 via `fastedge::send_request`
6. On success (S3 returns 200): responds with the clean object URL (no query string)
7. On S3 error: forwards the S3 status and error body back to the caller

## Configuration

| Env var | Required | Description |
|---|---|---|
| `ACCESS_KEY` | ✅ | S3 access key |
| `SECRET_KEY` | ✅ | S3 secret key |
| `REGION` | ✅ | S3 region (e.g. `s-ed1`) |
| `BASE_HOSTNAME` | ✅ | S3 base hostname (e.g. `cloud.gcore.lu`) |
| `BUCKET` | ✅ | S3 bucket name |
| `SCHEME` | optional | URL scheme — defaults to `http` |
| `MAX_FILE_SIZE` | optional | Maximum upload size in bytes — no limit if unset |

The constructed endpoint is `<SCHEME>://<REGION>.<BASE_HOSTNAME>/<BUCKET>/<name>`.

## Build

```sh
cargo build --release
# Output: target/wasm32-wasip1/release/s3upload.wasm
```

## Usage

```
POST /upload?name=photo.jpg
Content-Type: image/jpeg

<file bytes>
```

On success (200), the response body is the clean S3 object URL (presign query parameters stripped).

## Notes

- The `OPTIONS` method returns 204 but does **not** include CORS headers — add `Access-Control-Allow-*` headers if browser preflight support is needed.
- The presigned URL expires after 1 hour, but since the upload is performed server-side this has no practical impact.
- `MAX_FILE_SIZE` is silently ignored if set to a non-numeric value.
```
