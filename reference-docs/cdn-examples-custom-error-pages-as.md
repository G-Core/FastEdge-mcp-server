<!--
  auto-updated: true
  sources:
    - id: proxy-wasm-sdk-as
      ref: master
      commit: 60f25c7bd35564e5bafb421be7f37aa4acf1bf81
      updated: 2026-05-20
-->

---
type: example
app_type: cdn
languages: [assemblyscript]
capabilities: [response-headers, response-body, error-pages, body-replacement]
---

# Custom Error Pages — AssemblyScript (CDN)

Intercepts 4xx and 5xx upstream responses and replaces the response body with a styled HTML error page. No environment variables or secrets required.

---

## Overview

| Hook | Responsibility |
|---|---|
| `onResponseHeaders` | Detect error status; rewrite `Content-Type`, remove `Content-Length`, set `Transfer-Encoding: Chunked` |
| `onResponseBody` | Buffer full body; replace with branded HTML |

Two-hook flow is required because response status must be read independently in each hook — instance state does not survive between `onResponseHeaders` and `onResponseBody`.

---

## Package

```json
{
  "name": "fastedge-as-example-custom-error-pages",
  "dependencies": {
    "@gcoredev/proxy-wasm-sdk-as": "^1.2.3"
  },
  "devDependencies": {
    "@assemblyscript/wasi-shim": "^0.1.0",
    "assemblyscript": "^0.28.9"
  }
}
```

---

## Class Structure

```
ErrorPagesRoot extends RootContext
  createContext(context_id: u32): Context
    → ErrorPagesContext

ErrorPagesContext extends Context
  onResponseHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues
  onResponseBody(body_buffer_length: usize, end_of_stream: bool): FilterDataStatusValues
  private getErrorTitle(code: u32): string
  private getErrorDescription(code: u32): string
```

Registration:
```ts
registerRootContext((context_id: u32) => new ErrorPagesRoot(context_id), "customErrorPages");
```

---

## API Usage

### Reading Response Status

```ts
const statusBuf = get_property("response.status");
```

- **Return type**: `ArrayBuffer`
- **Encoding**: 2-byte big-endian binary `u16` — NOT UTF-8
- **Minimum safe length**: 2 bytes; guard with `if (statusBuf.byteLength < 2)`

**Decode pattern** (mandatory — do NOT use `String.UTF8.decode`):
```ts
const bytes = Uint8Array.wrap(statusBuf);
const code: u32 = (u32(bytes[0]) << 8) | u32(bytes[1]);
```

This status read must be performed independently in both `onResponseHeaders` and `onResponseBody`. Do not cache the result on the instance.

---

### `onResponseHeaders`

```ts
onResponseHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues
```

When `code >= 400 && code < 600`:
```ts
stream_context.headers.response.replace("Content-Type", "text/html");
stream_context.headers.response.remove("Content-Length");
stream_context.headers.response.replace("Transfer-Encoding", "Chunked");
```

- `remove("Content-Length")` uses the FastEdge CDN platform behavior. Downstream code testing for header absence must test for both missing and empty string — the platform may represent removal as an empty string.
- Returns `FilterHeadersStatusValues.Continue` in all cases.

---

### `onResponseBody`

```ts
onResponseBody(body_buffer_length: usize, end_of_stream: bool): FilterDataStatusValues
```

**Buffering pattern** — buffer until full body is available:
```ts
if (!end_of_stream) {
  return FilterDataStatusValues.StopIterationAndBuffer;
}
```

Once `end_of_stream` is true and status is in 4xx–5xx range, replace body:
```ts
const body = String.UTF8.encode(html);
set_buffer_bytes(
  BufferTypeValues.HttpResponseBody,
  0,
  body_buffer_length as u32,
  body,
);
return FilterDataStatusValues.Continue;
```

**Critical**: Pass `body_buffer_length` (the original buffer length) as the `length` argument to `set_buffer_bytes`, not `body.byteLength`. If the new body is shorter than the original, original bytes beyond the new body's length survive at the tail of the response.

---

### `set_buffer_bytes` Signature (effective usage)

```ts
set_buffer_bytes(
  type: BufferTypeValues,   // BufferTypeValues.HttpResponseBody
  start: u32,               // 0 — replace from beginning
  size: u32,                // body_buffer_length as u32 — original buffer length
  data: ArrayBuffer,        // UTF-8 encoded replacement body
): void
```

---

## Error Code Coverage

### Titles

| Code | Title |
|---|---|
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 405 | Method Not Allowed |
| 408 | Request Timeout |
| 429 | Too Many Requests |
| 500 | Internal Server Error |
| 502 | Bad Gateway |
| 503 | Service Unavailable |
| 504 | Gateway Timeout |
| other 5xx | Server Error |
| other | Error |

### Categories

| Range | Category label |
|---|---|
| 400–499 | Client Error |
| 500–599 | Server Error |

---

## HTML Output Structure

Generated inline; no external assets or template files.

```
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{code} — {title}</title>
    <style> ... </style>
  </head>
  <body>
    <div class="container">
      <p class="code">{code}</p>
      <h1 class="title">{title}</h1>
      <p class="desc">{description}</p>
      <p class="category">{category}</p>
    </div>
  </body>
</html>
```

CSS is embedded inline via `<style>`. Layout uses flexbox centering. No external dependencies.

---

## Build

```sh
pnpm install
pnpm run asbuild
```

| Output file | Purpose |
|---|---|
| `build/customErrorPages.wasm` | Release binary — upload to FastEdge |
| `build/customErrorPages-debug.wasm` | Debug binary with source maps |

Build scripts:
- `asbuild:debug` — `asc assembly/index.ts --target debug`
- `asbuild:release` — `asc assembly/index.ts --target release`
- `asbuild` — runs both

---

## Deploy

Upload `build/customErrorPages.wasm` to the FastEdge portal and attach it to a CDN application. No environment variables or secrets required.

---

## Constraints and Gotchas

| Constraint | Detail |
|---|---|
| Status is binary `u16` | Decode with `Uint8Array.wrap` + bit-shift. Never use `String.UTF8.decode` on status bytes. |
| No instance state between hooks | Re-read `get_property("response.status")` in both `onResponseHeaders` and `onResponseBody`. |
| No closures in AssemblyScript | Status-to-string lookups must be class private methods, not closures or lambdas. |
| `set_buffer_bytes` length argument | Must be `body_buffer_length` (original), not `body.byteLength` (new). Using new length leaves original tail bytes in the response. |
| `remove("Content-Length")` behavior | FastEdge CDN platform may represent header removal as an empty string. Test for both absent and empty when inspecting downstream. |
| Buffering requirement | `StopIterationAndBuffer` must be returned until `end_of_stream` is true before replacing the body. |

---

## Imports

```ts
import {
  Context,
  FilterDataStatusValues,
  FilterHeadersStatusValues,
  get_property,
  log,
  LogLevelValues,
  registerRootContext,
  RootContext,
  set_buffer_bytes,
  BufferTypeValues,
  stream_context,
} from "@gcoredev/proxy-wasm-sdk-as/assembly";
import { setLogLevel } from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";
export * from "@gcoredev/proxy-wasm-sdk-as/assembly/proxy";
```

---

## See Also

- proxy-wasm-sdk-as SDK reference
- CDN app platform overview
- host-services-rust reference (for Rust equivalent patterns)
- best-practices reference (response body buffering, hook sequencing)
