<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-rust
      ref: main
      commit: 6347a7c2fda0d03e66f1214db5eec041c16801b7
      updated: 2026-08-17
-->

# FastEdge Rust SDK — Quickstart

## Prerequisites

- Rust toolchain (stable)
- `wasm32-wasip1` target — required for the sync handler path
- `wasm32-wasip2` target — required for the async WASI handler path

```bash
rustup target add wasm32-wasip1
rustup target add wasm32-wasip2
```

## Create a New Project

```bash
cargo new --lib my-edge-app
cd my-edge-app
```

The crate must be compiled as a `cdylib`. Add to `Cargo.toml`:

```toml
[lib]
crate-type = ["cdylib"]
```

## Async Handler (Recommended)

The async handler uses the standard WASI-HTTP interface via the `wstd` crate. This path supports `async`/`await` and a full HTTP client.

Add dependencies to `Cargo.toml`:

```toml
[dependencies]
wstd   = "0.6"
anyhow = "1"

[lib]
crate-type = ["cdylib"]
```

Write the handler in `src/lib.rs`:

```rust
use wstd::http::body::Body;
use wstd::http::{Request, Response};

#[wstd::http_server]
async fn main(request: Request<Body>) -> anyhow::Result<Response<Body>> {
    let url = request.uri().to_string();

    Ok(Response::builder()
        .status(200)
        .header("content-type", "text/plain;charset=UTF-8")
        .body(Body::from(format!("Hello, you made a request to {url}")))?)
}
```

Build targeting `wasm32-wasip2`:

```bash
cargo build --target wasm32-wasip2 --release
```

To avoid passing `--target` on every build, add `.cargo/config.toml` to your project:

```toml
[build]
target = "wasm32-wasip2"
```

Then `cargo build --release` is sufficient. The compiled `.wasm` file is written to `target/wasm32-wasip2/release/`.

## Sync Handler (Alternative)

The sync handler uses the `fastedge` crate directly. It is synchronous and suited for simple request/response processing where `async` is not required. New async apps should prefer the `wstd` handler above.

Add dependencies to `Cargo.toml`:

```toml
[dependencies]
fastedge = "0.4.0"
anyhow   = "1"

[lib]
crate-type = ["cdylib"]
```

Write the handler in `src/lib.rs`:

```rust
use anyhow::Result;
use fastedge::body::Body;
use fastedge::http::{Request, Response, StatusCode};

#[fastedge::http]
fn main(req: Request<Body>) -> Result<Response<Body>> {
    let url = req.uri().to_string();

    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "text/plain;charset=UTF-8")
        .body(Body::from(format!("Hello, you made a request to {url}")))
        .map_err(Into::into)
}
```

Build targeting `wasm32-wasip1`:

```bash
cargo build --target wasm32-wasip1 --release
```

The compiled `.wasm` file is written to `target/wasm32-wasip1/release/`.

## Build Summary

| Handler path            | Build command                                  |
| ----------------------- | ---------------------------------------------- |
| Async (`wstd`)          | `cargo build --target wasm32-wasip2 --release` |
| Sync (`fastedge::http`) | `cargo build --target wasm32-wasip1 --release` |

Neither path requires `cargo-component`.

## Feature Flags

The most common optional feature is `json`, which enables JSON body support via `serde_json`:

```toml
[dependencies]
fastedge = { version = "0.4.0", features = ["json"] }
```

The `proxywasm` feature is enabled by default.

## CDN Apps

CDN applications use a different handler architecture based on proxy-wasm rather than the HTTP handler model described above. They intercept and modify requests passing through the CDN layer and have access to request properties such as geolocation, client IP, and matched CDN rule metadata. Refer to the CDN apps reference for the full setup guide, including handler structure, available properties, host services, and build instructions.

## Next Steps

- **FastEdge SDK API reference** — handler macros, Body type, outbound HTTP, error handling
- **FastEdge host services reference** — key-value storage, secrets, dictionary
- **FastEdge CDN apps reference** — proxy-wasm lifecycle and API surface
