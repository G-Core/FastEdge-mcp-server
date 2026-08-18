<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 6347a7c2fda0d03e66f1214db5eec041c16801b7
      updated: 2026-08-17
-->

# CDN Example: Convert Image (Rust)

Converts upstream images to AVIF format on the fly using the proxy-wasm ABI. Operates as a three-hook pipeline across request headers, response headers, and response body. Skips transformation for paths without recognized extensions, missing User-Agent, and optionally configured user-agent substrings.

## App Type

CDN (`ContextType::HttpContext`)

## Environment Variables (Configuration)

| Variable | Required | Type | Range/Format | Default | Description |
|---|---|---|---|---|---|
| `FORMATS_TO_TRANSFORM` | Yes | String | Comma-separated extensions | — | File extensions to convert (e.g. `jpg,jpeg,png`). Note: `jpg` and `jpeg` are distinct values. |
| `IGNORED_UA_LIST` | No | String | Comma-separated substrings | — | User-Agent substrings; requests matching any entry are not transformed. |
| `AVIF_SPEED` | No | u8 | 1–10 | 5 | AVIF encoding speed. Values outside range fall back to default. |
| `AVIF_QUALITY` | No | u8 | 1–100 | 70 | AVIF encoding quality. Values outside range fall back to default. |

If `FORMATS_TO_TRANSFORM` is absent or empty, transformation is skipped entirely.

## Hook Pipeline

### 1. `on_http_request_headers`

**Purpose**: Inspect the request, decide whether transformation is needed, set cache-differentiation header.

**Steps**:
1. Always sets `Image-Format: original` — used as the baseline cache key so the unmodified image is cached separately.
2. Reads `request.extension` property via `self.get_property(vec!["request.extension"])`.
   - Returns `None` (not an empty `Vec`) if the path has no extension — skip transformation.
   - Returns `Some(Vec<u8>)` — decode as UTF-8; skip on failure or empty string.
3. Reads `FORMATS_TO_TRANSFORM` env var; skips if absent, empty, or if the extension is not in the comma-separated list.
4. Reads `User-Agent` request header; skips if absent or empty.
5. Optionally reads `IGNORED_UA_LIST`; if any entry is a substring of the User-Agent, skips transformation.
6. If all checks pass: overwrites `Image-Format` header to `image/avif` — signals downstream hooks and acts as cache key for the converted variant.

**Return**: `Action::Continue` in all cases.

**Key APIs**:
```rust
self.add_http_request_header("Image-Format", "original");
self.get_property(vec!["request.path"])       // -> Option<Vec<u8>>
self.get_property(vec!["request.extension"])  // -> Option<Vec<u8>>, None if no extension
self.get_http_request_header("User-Agent")    // -> Option<String>
self.set_http_request_header("Image-Format", Some("image/avif"));
```

### 2. `on_http_response_headers`

**Purpose**: Validate the response, configure caching variation, prepare headers for body replacement.

**Steps**:
1. Reads `response.status` property; skips if not present or not a 200.
   - **Decoding**: property returns `Option<Vec<u8>>`, expected length exactly 2 bytes; decoded as big-endian u16: `u16::from_be_bytes([status[0], status[1]])`.
2. Reads `Image-Format` request header (set in hook 1); skips if absent.
3. Adds `Vary: Image-Format` response header — instructs cache to store `original` and `image/avif` separately.
4. If `Image-Format == "original"`: returns without further modification.
5. If transformation is needed:
   - Clears `Content-Length` (set to `None`) — **required** before body replacement; the platform sets it to an empty string rather than removing it if not cleared.
   - Sets `Transfer-Encoding: Chunked`.
   - Sets `Content-Type` to the value of `Image-Format` (i.e. `image/avif`).
   - Stores the target content type in `response.content-type` property for cross-hook signalling.

**Return**: `Action::Continue` in all cases.

**Key APIs**:
```rust
self.get_property(vec!["response.status"])              // -> Option<Vec<u8>>, 2-byte big-endian u16
self.get_http_request_header("Image-Format")            // -> Option<String>
self.add_http_response_header("Vary", "Image-Format");
self.set_http_response_header("Content-Length", None);  // clear before body replacement
self.set_http_response_header("Transfer-Encoding", Some("Chunked"));
self.set_http_response_header("Content-Type", Some(content_type.as_str()));
self.set_property(vec!["response.content-type"], Some(content_type.as_bytes()));
```

### 3. `on_http_response_body`

**Purpose**: Buffer the full response body, decode the image, re-encode as AVIF, write back.

**Steps**:
1. **Buffering**: If `!end_of_stream`, return `Action::Pause` to accumulate further body chunks. Only proceed when `end_of_stream == true`.
2. Reads `response.content-type` property (set in hook 2); if absent, skips (no transformation was signalled).
3. Validates the content type is `"image/avif"`; if not, skips.
4. Reads full body: `self.get_http_response_body(0, body_size)` — retrieves all buffered bytes.
5. Decodes the image from memory using the `image` crate (`load_from_memory`); logs and skips on decode failure without sending an error response.
6. Encodes to AVIF using `AvifEncoder::new_with_speed_quality(writer, speed, quality)` with values from `AVIF_SPEED` and `AVIF_QUALITY` env vars.
7. On success: `self.set_http_response_body(0, body_size, &out)` replaces the original body with AVIF bytes.
8. On encode failure: logs the error; does not send an HTTP error response (connection safety).

**Return**: `Action::Continue` in all cases (including after body replacement).

**Key APIs**:
```rust
// Buffering pattern
fn on_http_response_body(&mut self, body_size: usize, end_of_stream: bool) -> Action {
    if !end_of_stream {
        return Action::Pause; // wait for complete body
    }
    // ... process when end_of_stream == true
}

self.get_property(vec!["response.content-type"])          // -> Option<Vec<u8>>
self.get_http_response_body(0, body_size)                 // -> Option<Bytes>, full buffered body
self.set_http_response_body(0, body_size, &out);          // replace body bytes
self.send_http_response(500, vec![], None);               // only for unrecoverable UTF-8 errors
```

## Cross-Hook Signalling

The `response.content-type` WASM property is used to pass state from `on_http_response_headers` to `on_http_response_body` within the same request context. It is set only when transformation is required, so its absence in the body hook safely signals "skip".

The `Image-Format` HTTP request header serves dual purpose: cache key (read by the CDN caching layer via `Vary`) and inter-hook signal (readable in response hooks via `get_http_request_header`).

## `response.status` Decoding

```rust
fn rsp_status(&mut self) -> Option<u16> {
    if let Some(status) = self.get_property(vec!["response.status"]) {
        if status.len() != 2 {
            return None; // malformed — skip transformation
        }
        return Some(u16::from_be_bytes([status[0], status[1]]));
    }
    None
}
```

The property returns exactly 2 bytes encoding the HTTP status as a big-endian u16. Any other length is treated as absent.

## Env-Var Helper Functions

### `str_param(name: &str) -> Result<String, VarError>`

Returns `Err(VarError::NotPresent)` if the variable is unset **or** empty. Used for required string parameters.

### `u8_param(name: &str, min: u8, max: u8, default: u8) -> u8`

Reads an env var as a `u8`. Falls back to `default` if:
- Variable is unset or empty
- Value is not a valid number
- Value is below `min` or above `max`

Does not clamp — out-of-range values use `default`, not the boundary value.

```rust
u8_param("AVIF_SPEED", 1, 10, 5)     // -> u8 in [1,10], default 5
u8_param("AVIF_QUALITY", 1, 100, 70) // -> u8 in [1,100], default 70
```

## Cargo Dependencies

```toml
[dependencies]
proxy-wasm = "0.2"
image = "0.25"
```

Crate type: `cdylib` (required for WASM compilation).

The `image` crate provides `load_from_memory` and `codecs::avif::AvifEncoder`. AVIF encoding is CPU-intensive; lower `AVIF_SPEED` values produce smaller files but increase processing time.

## Caching Behavior

- `Vary: Image-Format` response header causes the CDN to maintain two cache entries per URL: one for `Image-Format: original` and one for `Image-Format: image/avif`.
- The `Image-Format` request header is set unconditionally on every request, so cache lookups are always keyed correctly.

## Gotchas and Constraints

- `request.extension` returns `None` for paths with no extension, not an empty `Vec`. Guard with `let Some(ext) = raw_ext` before decoding.
- `Content-Length` must be explicitly set to `None` before replacing the response body. If omitted, the platform emits an empty `Content-Length` header rather than removing it, which causes content-length mismatch errors.
- Do not call `send_http_response` after partial body processing has begun — it may break the connection. Only call it for unrecoverable pre-processing errors (e.g. UTF-8 failure on the content-type property).
- `jpg` and `jpeg` are distinct extension strings; include both in `FORMATS_TO_TRANSFORM` if both must be converted.
- The body hook must not assume the body is available on every call; `get_http_response_body` may return `None` if the body is empty.
- AVIF encoding via the `image` crate is CPU-intensive; choose `AVIF_SPEED` values carefully based on performance requirements.

## Transformation Skip Conditions

Transformation is skipped (returning `Action::Continue` without modifying the response) when:
- Request path has no file extension
- Extension is not in `FORMATS_TO_TRANSFORM`
- `FORMATS_TO_TRANSFORM` is unset or empty
- `User-Agent` request header is absent or empty
- User-Agent matches a substring in `IGNORED_UA_LIST`
- Response status is not 200
- `Image-Format` request header is absent in the response phase
- `response.content-type` property is absent in the body phase
- Image cannot be loaded from memory (logged, no error response)
- AVIF encoding fails (logged, original body untouched)

## See Also

- proxy-wasm Rust SDK reference (proxy-wasm traits: Context, RootContext, HttpContext)
- FastEdge CDN app platform overview
- FastEdge SDK Rust reference
- FastEdge error codes reference
