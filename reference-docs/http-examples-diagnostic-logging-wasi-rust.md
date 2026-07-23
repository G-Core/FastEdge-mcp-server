<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 6347a7c2fda0d03e66f1214db5eec041c16801b7
      updated: 2026-07-23
-->

---
capabilities: [diagnostic-logging, http]
type: example
app_type: http
languages: [rust]
---

# Diagnostic Logging — Rust (WASI HTTP)

Pass-through proxy that writes a single `fastedge::utils::set_user_diag` tag per request summarising the outcome. The tag appears in the FastEdge platform's per-request log viewer, distinct from stdout, and is designed to be filtered, counted, or aggregated by SREs looking at per-request outcomes.

## Cargo.toml

```toml
[package]
name = "diagnostic_logging_wasi"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wstd = "0.6"
fastedge = "0.4"
anyhow = "1"
```

## Imports

```rust
use fastedge::utils::set_user_diag;
use wstd::http::body::Body;
use wstd::http::{Client, Request, Response};
use std::env;
```

## Entry Point

```rust
#[wstd::http_server]
async fn main(req: Request<Body>) -> anyhow::Result<Response<Body>> { ... }
```

The `#[wstd::http_server]` macro is required. The handler is `async` and returns `anyhow::Result<Response<Body>>`.

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `ORIGIN_URL` | Yes | The origin URL that requests are proxied to. Must be non-empty. |

## Core API: `set_user_diag`

```rust
fastedge::utils::set_user_diag(tag: &str)
```

- **Parameters:** `tag` — a short string label, typically in `logfmt`-style `key=value key=value` format.
- **Return value:** none (unit).
- **Async:** no — synchronous call, no `.await`.
- **Effect:** sets the per-request diagnostic tag visible in the FastEdge platform's log viewer.
- **Cardinality:** call exactly **once** per request. If called multiple times, only the last call's value may be visible, or calls may be concatenated — behaviour is undefined. Do not call it multiple times expecting concatenation.
- **Length limit:** keep the tag string under 256 characters to avoid platform-defined truncation.
- **Forbidden content:** do not include secrets or PII — tags appear in platform logs.

## Request Flow and Outcome Tags

The example pattern: extract `method` and `path` from the incoming request up front, then call `set_user_diag` at **every terminal branch** before returning the response.

### Branch 1 — Config error (`ORIGIN_URL` missing or empty)

```rust
let origin = match env::var("ORIGIN_URL") {
    Ok(u) if !u.trim().is_empty() => u,
    _ => {
        set_user_diag("outcome=config_error reason=origin_missing");
        return Ok(Response::builder()
            .status(500)
            .header("content-type", "text/plain; charset=utf-8")
            .body(Body::from("ORIGIN_URL is not configured"))?);
    }
};
```

Tag emitted: `outcome=config_error reason=origin_missing`

### Branch 2 — Origin unreachable (outbound request fails)

```rust
let resp = match Client::new().send(outbound).await {
    Ok(r) => r,
    Err(e) => {
        set_user_diag(&format!(
            "outcome=origin_unreachable method={method} path={path} err={e}"
        ));
        return Ok(Response::builder()
            .status(502)
            .header("content-type", "text/plain; charset=utf-8")
            .body(Body::from("origin unreachable"))?);
    }
};
```

Tag emitted: `outcome=origin_unreachable method=<M> path=<P> err=<E>`

### Branch 3 — Request successfully proxied

```rust
let status = resp.status().as_u16();
set_user_diag(&format!(
    "outcome=proxied method={method} path={path} status={status}"
));
```

Tag emitted: `outcome=proxied method=<M> path=<P> status=<S>`

## Outcome Tag Reference

| Condition | Tag |
|-----------|-----|
| `ORIGIN_URL` missing or empty | `outcome=config_error reason=origin_missing` |
| Origin unreachable | `outcome=origin_unreachable method=<M> path=<P> err=<E>` |
| Request proxied | `outcome=proxied method=<M> path=<P> status=<S>` |

## `set_user_diag` vs `println!`

| | `println!` | `set_user_diag` |
|---|---|---|
| Channel | stdout — general application logs | per-request structured tag in platform log viewer |
| Cardinality | many per request | **one per request** — multiple calls leave only the last or are concatenated (undefined) |
| Best for | verbose traces, debug details | a single filterable outcome label |
| Forbidden | — | secrets and PII (tags appear in platform logs) |

`println!` and `set_user_diag` are independent — using one does not affect the other. Both may be used in the same handler.

## Proxy Response Passthrough

After a successful upstream call, the example reads the full response body and forwards it:

```rust
let (parts, mut body) = resp.into_parts();
let bytes = body.contents().await?;
let content_type = parts
    .headers
    .get("content-type")
    .and_then(|v| v.to_str().ok())
    .unwrap_or("application/octet-stream")
    .to_string();

Ok(Response::builder()
    .status(parts.status)
    .header("content-type", content_type)
    .body(Body::from(bytes))?)
```

- `body.contents().await?` — reads the full body as `Vec<u8>`.
- `content-type` is forwarded from the upstream response; falls back to `application/octet-stream` if absent or non-UTF-8.
- HTTP status is forwarded from the upstream response.

## Convention: logfmt-style Tags

Use `key=value` pairs separated by spaces (`logfmt`-ish format). Benefits:
- Easy to slice and filter in log search tooling.
- Keys should be short and stable so they make reliable filter terms.
- Include `method`, `path`, and `status` in success tags for correlation with access logs.

## Constraints and Notes

- `set_user_diag` must be called **once per request**, at every terminal branch, late enough in the handler to know the outcome.
- Do not call `set_user_diag` multiple times within a single request — only the last tag (or an undefined concatenation) will appear.
- The tag string has a platform-defined length limit; keep it under 256 characters.
- Do not include secrets or PII in the tag string — it appears in platform logs.
- `crate-type = ["cdylib"]` is required for WASM compilation.
- The outbound request in this example always issues a `GET` to `ORIGIN_URL` regardless of the incoming method. Adapt to forward the incoming method and body if needed.
- `Client::new().send(outbound).await` is the WASI HTTP client call — requires `wstd = "0.6"`.

## See Also

- fastedge-docs platform-overview (per-request log viewer and diagnostic tag display)
- host-services-rust (other host service integrations available to Rust WASI apps)
- CDN (proxy-wasm) variant: `fastedge::proxywasm::utils::set_user_diag` — same semantics, different module path (see CDN apps reference)
- examples-kv-store-wasi-rust (another Rust WASI HTTP example showing KV Store usage)
