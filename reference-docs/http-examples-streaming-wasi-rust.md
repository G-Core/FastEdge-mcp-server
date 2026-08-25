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
capabilities: [streaming, async, timer, body]
---

# Streaming Response — WASI (Rust)

Generates a response body on the fly using an async stream. Five text chunks are emitted at 200ms intervals via `Body::from_stream`, allowing each chunk to flow to the client as it is produced rather than buffering the full body before sending.

## Key APIs

### `Body::from_stream`

```rust
pub fn from_stream<S>(stream: S) -> Body
where
    S: Stream<Item = String> + Send + 'static,
```

- Crate: `wstd::http::body`
- Accepts any `futures_lite::Stream` whose item type is `String`.
- The runtime polls the stream incrementally as the body is transmitted; chunks are not buffered internally.
- Do not collect the stream before passing it — that defeats streaming and buffers the full body in memory.

### `stream::unfold`

```rust
pub fn unfold<T, F, Fut, Item>(init: T, f: F) -> impl Stream<Item = Item>
where
    F: FnMut(T) -> Fut,
    Fut: Future<Output = Option<(Item, T)>>,
```

- Crate: `futures_lite::stream`
- `init`: initial state value (e.g. `0u32` as a chunk counter).
- `f`: async closure receiving current state; returns `None` to terminate stream, `Some((item, next_state))` to emit an item and advance state.
- Item type must match what `Body::from_stream` expects (`String`).

### `Timer::after`

```rust
pub fn after(duration: Duration) -> Timer
```

```rust
pub async fn wait(self)
```

- Crate: `wstd::time`
- `Timer::after(Duration::from_millis(200)).wait().await` suspends the current async task for the specified duration.
- Async-only: must be awaited inside an `async` block or `async fn`.
- Place inside the `unfold` closure to introduce per-chunk delay.

## Cargo.toml Dependencies

```toml
[dependencies]
wstd = "0.6"
anyhow = "1"
futures-lite = "1"
```

- `futures-lite` must be explicitly added; it is not re-exported by `wstd`.
- Crate type must be `cdylib` for WASM compilation.

## Complete Example

```rust
use futures_lite::stream;
use wstd::http::body::Body;
use wstd::http::{Request, Response};
use wstd::time::{Duration, Timer};

#[wstd::http_server]
async fn main(_request: Request<Body>) -> anyhow::Result<Response<Body>> {
    let chunk_stream = stream::unfold(0u32, |i| async move {
        if i >= 5 {
            return None;
        }
        Timer::after(Duration::from_millis(200)).wait().await;
        Some((format!("chunk {i}\n"), i + 1))
    });

    Ok(Response::builder()
        .status(200)
        .header("content-type", "text/plain; charset=utf-8")
        .body(Body::from_stream(chunk_stream))?)
}
```

## Behavior

- Emits chunks `chunk 0` through `chunk 4`, each followed by a newline.
- Each chunk is delayed 200ms via `Timer::after` before being emitted.
- Total response time: ~1000ms (5 × 200ms).
- `content-type` is set to `text/plain; charset=utf-8`.

## Testing

```sh
curl -N https://<your-app>.fastedge.cdn.gc.onl/
```

The `-N` flag disables curl's client-side buffering. Without it, all chunks may appear simultaneously at the end rather than incrementally.

Expected output (one line per ~200ms):
```
chunk 0
chunk 1
chunk 2
chunk 3
chunk 4
```

## Constraints and Gotchas

- Stream item type must be `String`. Use `format!()` to construct each chunk. `&str` and `Bytes` are not accepted directly by `Body::from_stream`.
- Do not collect the stream (e.g. via `.collect::<Vec<_>>().await`) before passing to `Body::from_stream` — this buffers the entire body and defeats streaming.
- `Timer::after(...).wait().await` is async-only and must appear inside an `async` block.
- Client-side buffering (curl without `-N`, browsers with default settings) may hide the streaming effect during development.
- `futures-lite` must be declared in `Cargo.toml`; it is not transitively available from `wstd`.

## Other Streaming Patterns

- **Pass-through streaming**: return an upstream response body directly without buffering. See the outbound_fetch example.
- **Transform streaming**: apply `http_body_util::BodyExt::map_frame` to an incoming body, then wrap with `Body::from_http_body`. Used for chunk-level rewrites.
- **Stream from an iterator**: `Body::from_stream(futures_lite::stream::iter(chunks))` where `chunks` is any iterable of items convertible to `String`.

## See Also

- outbound_fetch WASI Rust example (pass-through streaming pattern)
- examples-streaming-js reference (JavaScript mirror of this example)
- wstd HTTP body reference
- FastEdge SDK Rust reference
