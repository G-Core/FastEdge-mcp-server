<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 6347a7c2fda0d03e66f1214db5eec041c16801b7
      updated: 2026-07-23
-->

# HTTP Example: Watermark (Basic, Rust)

**App type**: HTTP  
**Language**: Rust  
**Handler**: `#[fastedge::http]` (sync, `wasm32-wasip1`)  
**Cargo package**: `watermark`

---

## What This Example Does

Fetches an image from an S3-compatible bucket using AWS Signature V4 request signing, overlays an embedded watermark PNG using per-pixel alpha blending, and returns the composited image in the original format with the correct MIME type. If the S3 response body is not a valid image, it is forwarded to the caller unchanged.

---

## Handler Signature

```rust
#[fastedge::http]
fn main(req: Request<Body>) -> Result<Response<Body>, Error>
```

- **Runtime**: sync (`wasm32-wasip1`)
- **Entry point macro**: `#[fastedge::http]`

---

## Request Handling

### Method filter

| Method | Behaviour |
|---|---|
| `GET`, `HEAD` | Allowed — processing continues |
| Any other | `405 Method Not Allowed`, header `Allow: GET, HEAD`, body `This method is not allowed\n` |

### Path extraction

- Filename extracted from `req.uri().path()` via `trim_start_matches('/')`.
- Empty path → `400 Bad Request`, body `Malformed request - filename expected\n`.

---

## S3 Integration

### Signed URL construction (`sign_s3`)

```rust
fn sign_s3(fname: &str) -> anyhow::Result<(Url, String)>
```

- Reads S3 credentials from env vars (see Environment Variables).
- Constructs `host` as `{REGION}.{BASE_HOSTNAME}`.
- Constructs `upload_url` as `{SCHEME}://{host}`.
- Creates a `rusty_s3::Bucket` with `UrlStyle::Path`.
- Signs a `GET` action with a 1-hour expiry (`Duration::from_secs(60 * 60)`).
- Returns `(signed_url: Url, host: String)`.
- Any error (missing env var, parse failure) → caller returns `500 Internal Server Error`, body `App misconfigured\n`.

### S3 fetch

```rust
fastedge::send_request(req: Request<Body>) -> Result<Response<Body>, Error>
```

- Outbound `GET` to signed S3 URL, with `Host` header set to computed `host`.
- Non-`200` S3 response → forwarded as-is to the caller (status + body unchanged).
- `send_request` error → `500 Internal Server Error`, empty body.

---

## Image Processing

### Format detection

```rust
image::guess_format(buf: &[u8]) -> Result<ImageFormat, ImageError>
```

- Applied to the S3 response body bytes.
- If format detection fails → S3 body forwarded to caller unchanged (not a valid image).

### Image decode

```rust
image::load_from_memory(buf: &[u8]) -> Result<DynamicImage, ImageError>
```

- Applied to both the S3 response body and the embedded watermark bytes.
- S3 body decode failure → body forwarded to caller unchanged.
- Watermark decode failure → `500 Internal Server Error`, body `Invalid watermark format\n` (should never occur at runtime if `sample.png` is valid at compile time).

### Watermark embedding

```rust
fn watermark(
    img: &DynamicImage,
    wm: &DynamicImage,
    offset_x: u32,
    offset_y: u32,
    opacity: f32,
) -> DynamicImage
```

- Per-pixel alpha blending over the region `[offset_x, offset_x+wm_width) × [offset_y, offset_y+wm_height)`.
- Watermark dimensions are clamped to image bounds: if `offset_x + wm_width > img_width`, `wm_width` is reduced to `img_width - offset_x`; same for height.
- Opacity clamped internally to `[0.0, 1.0]` (values above `1.0` clamped to `1.0`, below `0.0` clamped to `0.0`).
- Alpha blend formula per channel:
  - `img_alpha = img_pixel[3] / 255.0`
  - `wm_alpha = wm_pixel[3] / 255.0 * opacity`
  - `out_channel = wm_channel * wm_alpha + (1.0 - wm_alpha) * img_channel * img_alpha`
  - Output alpha is always set to `255`.
- Reads pixels with `DynamicImage::get_pixel(x, y)` and writes with `DynamicImage::put_pixel(x, y, pixel)` on a cloned canvas.
- In this example, `offset_x` and `offset_y` are hardcoded to `0` — watermark is placed at top-left.

### Result encoding

```rust
result.write_to(&mut Cursor::new(&mut out), out_format)
```

- Encodes composited `DynamicImage` back into the format detected by `guess_format`.
- Response `Content-Type` set via `out_format.to_mime_type()`.

---

## Watermark File Embedding

```rust
let wm_buf = include_bytes!("sample.png");
```

- Path is relative to `src/lib.rs` → resolves to `src/sample.png`.
- File **must exist at compile time**; a missing file is a compile error, not a runtime error.
- No runtime filesystem access required.

---

## Environment Variables

| Variable | Required | Type | Description |
|---|---|---|---|
| `ACCESS_KEY` | Yes | string | S3 access key ID |
| `SECRET_KEY` | Yes | string | S3 secret access key |
| `REGION` | Yes | string | S3 region (e.g. `us-east-1`) |
| `BASE_HOSTNAME` | Yes | string | S3 endpoint hostname (e.g. `cloud.gcore.lu`) |
| `BUCKET` | Yes | string | S3 bucket name |
| `SCHEME` | No | string | URL scheme for S3 endpoint (default: `http`) |
| `OPACITY` | No | float | Watermark opacity in `[0.0, 1.0]` (default: `1.0`) |

### OPACITY validation

- If `OPACITY` env var is absent → default `1.0` is used.
- Parsed via `l.parse::<f32>()`.
- Parse failure → `500 Internal Server Error`, body `Invalid opacity value\n`.
- Value outside `[0.0, 1.0]` → `500 Internal Server Error`, body `Invalid opacity value\n`.

---

## Response Behaviour

| Condition | Status | Body / Notes |
|---|---|---|
| Non-GET/HEAD method | `405 Method Not Allowed` | `This method is not allowed\n`; `Allow: GET, HEAD` header |
| Empty URL path | `400 Bad Request` | `Malformed request - filename expected\n` |
| Missing or invalid env vars (S3 config) | `500 Internal Server Error` | `App misconfigured\n` |
| `send_request` failure | `500 Internal Server Error` | Empty body |
| Non-`200` S3 response | Forwarded as-is | S3 status + body passed through to caller |
| S3 body not a valid image (`guess_format` or `load_from_memory` fails) | `200 OK` (forwarded) | S3 body passed through unchanged |
| Invalid `OPACITY` value (non-numeric or out of range) | `500 Internal Server Error` | `Invalid opacity value\n` |
| Invalid watermark format (`load_from_memory` fails on embedded PNG) | `500 Internal Server Error` | `Invalid watermark format\n` |
| Success | `200 OK` | Composited image; `Content-Type` from `out_format.to_mime_type()` |

---

## Dependencies (`Cargo.toml`)

```toml
[lib]
crate-type = ["cdylib"]

[dependencies]
fastedge = "0.4"
url = "2.3"
image = "0.24"
rusty-s3 = "0.5"
anyhow = "1"
```

---

## Build

```sh
cargo build --release
# Output: target/wasm32-wasip1/release/watermark.wasm
```

---

## Key APIs Used

| API | Crate | Purpose |
|---|---|---|
| `include_bytes!("sample.png")` | std | Embed watermark PNG at compile time |
| `fastedge::send_request(req)` | `fastedge` | Outbound HTTP request to S3 |
| `image::guess_format(buf)` | `image` | Detect image format from bytes |
| `image::load_from_memory(buf)` | `image` | Decode image from bytes into `DynamicImage` |
| `DynamicImage::get_pixel(x, y)` | `image` | Read pixel for alpha blending |
| `DynamicImage::put_pixel(x, y, pixel)` | `image` | Write blended pixel to canvas |
| `DynamicImage::write_to(&mut w, fmt)` | `image` | Encode composited image to bytes |
| `ImageFormat::to_mime_type()` | `image` | Get MIME type string for `Content-Type` |
| `rusty_s3::Bucket::new(url, style, bucket, region)` | `rusty-s3` | Construct S3 bucket handle |
| `rusty_s3::Credentials::new(access, secret)` | `rusty-s3` | Construct S3 credentials |
| `bucket.get_object(Some(&creds), fname)` | `rusty-s3` | Build S3 GET action |
| `action.sign(Duration::from_secs(3600))` | `rusty-s3` | Generate signed URL (1-hour expiry) |
| `std::env::var(key)` | std | Read app env vars |

---

## Gotchas

- `include_bytes!("sample.png")` resolves relative to `src/lib.rs`. The file must exist at compile time — its absence is a **compile error**.
- `OPACITY` must be a float in `[0.0, 1.0]`. Values outside this range or non-numeric strings return `500`.
- Signed S3 URLs expire after **1 hour**. Each request generates a fresh signed URL.
- Non-`200` S3 responses are forwarded as-is to the caller, potentially exposing S3 error details. The source code includes a commented alternative that returns a generic `500` instead.
- The watermark pixel loop clamps `wm_width` and `wm_height` to stay within the source image bounds relative to `offset_x`/`offset_y`.
- `offset_x` and `offset_y` are hardcoded to `0` in `main`. To support configurable placement, modify the `watermark(...)` call arguments.
- This example uses the legacy `#[fastedge::http]` sync handler (`wasm32-wasip1`). For new HTTP apps, prefer `#[wstd::http_server]` (async, `wasm32-wasip2`).

---

## See Also

- fastedge-docs platform-overview — FastEdge app model, env var configuration, deployment
- fastedge-docs sdk-reference-rust — `fastedge::send_request`, `Request`, `Response`, `Body`, `#[fastedge::http]`
- fastedge-docs best-practices — outbound request patterns, error handling conventions
- examples-s3-fetch (if available) — simpler S3 fetch without image processing
