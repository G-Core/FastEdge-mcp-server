<!--
  auto-updated: true
  sources:
    - id: proxy-wasm-sdk-as
      ref: master
      commit: 8e3bb621bc013a0aed7e52122066b417ad62a207
      updated: 2026-08-20
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

### Descriptions

| Code | Description |
|---|---|
| 400 | The server could not understand the request due to invalid syntax. |
| 401 | You need to authenticate to access this resource. |
| 403 | You do not have permission to access this resource. |
| 404 | The requested page could not be found. It may have been moved or deleted. |
| 405 | The request method is not supported for this resource. |
| 408 | The server timed out waiting for the request. |
| 429 | You have sent too many requests. Please try again later. |
| 500 | The server encountered an unexpected condition that prevented it from fulfilling the request. |
| 502 | The server received an invalid response from the upstream server. |
| 503 | The server is temporarily unavailable. Please try again later. |
| 504 | The server did not receive a timely response from the upstream server. |
| other 5xx | The server encountered an error processing your request. |
| other | An error occurred processing your request. |

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

## Source Material

### FILE: examples/customErrorPages/assembly/index.ts

```ts
export * from "@gcoredev/proxy-wasm-sdk-as/assembly/proxy";
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

class ErrorPagesRoot extends RootContext {
  createContext(context_id: u32): Context {
    setLogLevel(LogLevelValues.info);
    return new ErrorPagesContext(context_id, this);
  }
}

class ErrorPagesContext extends Context {
  constructor(context_id: u32, root_context: ErrorPagesRoot) {
    super(context_id, root_context);
  }

  onResponseHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues {
    const statusBuf = get_property("response.status");
    if (statusBuf.byteLength < 2) {
      return FilterHeadersStatusValues.Continue;
    }

    const bytes = Uint8Array.wrap(statusBuf);
    const code: u32 = (u32(bytes[0]) << 8) | u32(bytes[1]);

    if (code >= 400 && code < 600) {
      stream_context.headers.response.replace("Content-Type", "text/html");
      stream_context.headers.response.remove("Content-Length");
      stream_context.headers.response.replace("Transfer-Encoding", "Chunked");

      log(LogLevelValues.info, "Error response detected: " + code.toString());
    }

    return FilterHeadersStatusValues.Continue;
  }

  onResponseBody(
    body_buffer_length: usize,
    end_of_stream: bool,
  ): FilterDataStatusValues {
    // Read response status from property (no instance state between hooks)
    const statusBuf = get_property("response.status");
    if (statusBuf.byteLength < 2) {
      return FilterDataStatusValues.Continue;
    }

    const bytes = Uint8Array.wrap(statusBuf);
    const code: u32 = (u32(bytes[0]) << 8) | u32(bytes[1]);

    if (code < 400 || code >= 600) {
      return FilterDataStatusValues.Continue;
    }

    if (!end_of_stream) {
      return FilterDataStatusValues.StopIterationAndBuffer;
    }
    const title = this.getErrorTitle(code);
    const description = this.getErrorDescription(code);
    const category = code >= 500 ? "Server Error" : "Client Error";

    const html =
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      "<title>" +
      code.toString() +
      " — " +
      title +
      "</title>" +
      "<style>" +
      "body{margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;" +
      "display:flex;align-items:center;justify-content:center;min-height:100vh;" +
      "background:#f8f9fa;color:#333}" +
      ".container{text-align:center;padding:2rem;max-width:480px}" +
      ".code{font-size:6rem;font-weight:700;color:#dee2e6;margin:0;line-height:1}" +
      ".title{font-size:1.5rem;font-weight:600;margin:1rem 0 .5rem}" +
      ".desc{color:#6c757d;line-height:1.6}" +
      ".category{font-size:.75rem;text-transform:uppercase;letter-spacing:.1em;color:#adb5bd;margin-top:2rem}" +
      "</style></head><body><div class='container'>" +
      "<p class='code'>" +
      code.toString() +
      "</p>" +
      "<h1 class='title'>" +
      title +
      "</h1>" +
      "<p class='desc'>" +
      description +
      "</p>" +
      "<p class='category'>" +
      category +
      "</p>" +
      "</div></body></html>";

    const body = String.UTF8.encode(html);
    // Replace the entire original body — pass body_buffer_length as the length
    // to replace, not body.byteLength. Otherwise any original bytes beyond the
    // new body's length survive at the tail of the response.
    set_buffer_bytes(
      BufferTypeValues.HttpResponseBody,
      0,
      body_buffer_length as u32,
      body,
    );

    return FilterDataStatusValues.Continue;
  }

  private getErrorTitle(code: u32): string {
    if (code == 400) return "Bad Request";
    if (code == 401) return "Unauthorized";
    if (code == 403) return "Forbidden";
    if (code == 404) return "Not Found";
    if (code == 405) return "Method Not Allowed";
    if (code == 408) return "Request Timeout";
    if (code == 429) return "Too Many Requests";
    if (code == 500) return "Internal Server Error";
    if (code == 502) return "Bad Gateway";
    if (code == 503) return "Service Unavailable";
    if (code == 504) return "Gateway Timeout";
    if (code >= 500) return "Server Error";
    return "Error";
  }

  private getErrorDescription(code: u32): string {
    if (code == 400)
      return "The server could not understand the request due to invalid syntax.";
    if (code == 401)
      return "You need to authenticate to access this resource.";
    if (code == 403)
      return "You do not have permission to access this resource.";
    if (code == 404)
      return "The requested page could not be found. It may have been moved or deleted.";
    if (code == 405)
      return "The request method is not supported for this resource.";
    if (code == 408)
      return "The server timed out waiting for the request.";
    if (code == 429)
      return "You have sent too many requests. Please try again later.";
    if (code == 500)
      return "The server encountered an unexpected condition that prevented it from fulfilling the request.";
    if (code == 502)
      return "The server received an invalid response from the upstream server.";
    if (code == 503)
      return "The server is temporarily unavailable. Please try again later.";
    if (code == 504)
      return "The server did not receive a timely response from the upstream server.";
    if (code >= 500)
      return "The server encountered an error processing your request.";
    return "An error occurred processing your request.";
  }
}

registerRootContext((context_id: u32) => {
  return new ErrorPagesRoot(context_id);
}, "customErrorPages");
```


### FILE: examples/customErrorPages/package.json

```json
{
  "name": "fastedge-as-example-custom-error-pages",
  "version": "1.0.0",
  "description": "FastEdge AssemblyScript example: Custom Error Pages — replace 4xx/5xx responses with branded HTML",
  "scripts": {
    "asbuild:debug": "asc assembly/index.ts --target debug",
    "asbuild:release": "asc assembly/index.ts --target release",
    "asbuild": "npm run asbuild:debug && npm run asbuild:release"
  },
  "dependencies": {
    "@gcoredev/proxy-wasm-sdk-as": "^1.2.3"
  },
  "devDependencies": {
    "@assemblyscript/wasi-shim": "^0.1.0",
    "assemblyscript": "^0.28.9"
  }
}
```


### FILE: examples/customErrorPages/README.md

```
[← Back to examples](../README.md)

# Custom Error Pages

This application intercepts 4xx and 5xx error responses and replaces them with clean, branded HTML error pages.

## What it does

In `onResponseHeaders`, the app reads the `response.status` property. If it is in the 400-599 range, it sets the `Content-Type` to `text/html` and prepares for body replacement.

In `onResponseBody`, the app buffers the full response, then replaces the body with a styled HTML page containing:

- The numeric status code
- A human-readable error title (e.g. "Not Found", "Bad Gateway")
- A description explaining what went wrong
- An error category label ("Client Error" or "Server Error")

Covers all common HTTP error codes (400, 401, 403, 404, 405, 408, 429, 500, 502, 503, 504) with specific messages and falls back to generic messages for other codes.

## Build

```sh
pnpm install
pnpm run asbuild
```

Build output:

| File | Description |
|------|-------------|
| `build/customErrorPages.wasm` | Optimised release binary — upload this to FastEdge |
| `build/customErrorPages-debug.wasm` | Debug binary with source maps |

## Deploy

Upload `build/customErrorPages.wasm` to the FastEdge portal and attach it to your CDN application. No environment variables or secrets are required.
```
