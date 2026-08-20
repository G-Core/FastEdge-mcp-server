<!--
  auto-updated: true
  sources:
    - id: proxy-wasm-sdk-as
      ref: master
      commit: 8e3bb621bc013a0aed7e52122066b417ad62a207
      updated: 2026-08-17
-->

# CORS — AssemblyScript (CDN)

CORS response-header injection for FastEdge CDN apps using the proxy-wasm AssemblyScript SDK.

## Overview

Injects `Access-Control-Allow-Origin` and `Vary: Origin` headers into responses for requests from allowed origins. Optionally injects `Access-Control-Expose-Headers`. Requests from disallowed origins pass through unchanged.

**Hook pattern:**
- `onRequestHeaders` — reads and validates the `Origin` request header (logging only; does not short-circuit)
- `onResponseHeaders` — injects CORS headers when origin is allowed

**OPTIONS preflights:** The FastEdge edge layer answers OPTIONS preflight requests directly before any proxy-wasm hook fires. Do not attempt preflight handling in WASM code. Configure preflight behaviour (allowed methods, `Access-Control-Max-Age`, etc.) in CDN application settings.

## Environment Variables

| Variable | Required | Example | Description |
|---|---|---|---|
| `ALLOWED_ORIGINS` | Yes | `https://example.com,https://app.example.com` | Comma-separated allowed origins, or `*` for any origin |
| `EXPOSE_HEADERS` | No | `X-Request-Id,X-Trace-Id` | Response headers to expose to the browser via `Access-Control-Expose-Headers` |

## API Usage

### Reading the request origin

```typescript
const origin = stream_context.headers.request.get("Origin");
```

Returns empty string `""` (not null) when header is absent. Always test for empty string before processing.

### Writing response headers

```typescript
stream_context.headers.response.add("Access-Control-Allow-Origin", effectiveOrigin);
stream_context.headers.response.add("Vary", "Origin");
stream_context.headers.response.add("Access-Control-Expose-Headers", exposeHeaders);
```

### Reading environment variables

```typescript
const allowedOrigins = getEnv("ALLOWED_ORIGINS");
const exposeHeaders = getEnv("EXPOSE_HEADERS");
```

Returns empty string `""` when variable is unset. Test for empty string, not null.

## Origin Matching Logic

```typescript
private isOriginAllowed(origin: string, allowedOrigins: string): bool {
  if (allowedOrigins === "" || allowedOrigins === "*") return true;
  const origins = allowedOrigins.split(",");
  for (let i = 0; i < origins.length; i++) {
    if (origins[i].trim() == origin) return true;
  }
  return false;
}
```

- `ALLOWED_ORIGINS` empty or `"*"` — all origins allowed
- Otherwise: split on `,`, `.trim()` each entry, exact-match against request `Origin`
- No glob or prefix matching — exact strings only

**Effective origin in response header:**

```typescript
const effectiveOrigin = allowedOrigins === "*" ? "*" : origin;
```

When `ALLOWED_ORIGINS` is `"*"`, respond with `Access-Control-Allow-Origin: *`. Otherwise echo the matched origin value.

## Hook Implementations

### `onRequestHeaders`

```typescript
onRequestHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues {
  const allowedOrigins = getEnv("ALLOWED_ORIGINS");
  const origin = stream_context.headers.request.get("Origin");
  log(LogLevelValues.info, "onRequestHeaders >> origin: " + origin);

  if (origin !== "" && !this.isOriginAllowed(origin, allowedOrigins)) {
    log(LogLevelValues.info, "CORS: origin not allowed: " + origin);
  }

  return FilterHeadersStatusValues.Continue;
}
```

- Always returns `FilterHeadersStatusValues.Continue` — does not block or short-circuit
- Disallowed origins are logged only; no rejection occurs here
- Call `getEnv` inside the hook (not in the constructor) — env is available per-request

### `onResponseHeaders`

```typescript
onResponseHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues {
  const allowedOrigins = getEnv("ALLOWED_ORIGINS");
  const origin = stream_context.headers.request.get("Origin");

  if (origin === "" || !this.isOriginAllowed(origin, allowedOrigins)) {
    return FilterHeadersStatusValues.Continue;
  }

  const effectiveOrigin = allowedOrigins === "*" ? "*" : origin;

  stream_context.headers.response.add("Access-Control-Allow-Origin", effectiveOrigin);
  stream_context.headers.response.add("Vary", "Origin");

  const exposeHeaders = getEnv("EXPOSE_HEADERS");
  if (exposeHeaders !== "") {
    stream_context.headers.response.add("Access-Control-Expose-Headers", exposeHeaders);
  }

  return FilterHeadersStatusValues.Continue;
}
```

- Re-reads `Origin` from request headers (available in response hook via `stream_context.headers.request`)
- Only injects headers when origin is non-empty and allowed
- `Vary: Origin` is always added alongside `Access-Control-Allow-Origin` to prevent cache collapsing across origins
- `Access-Control-Expose-Headers` is conditional on `EXPOSE_HEADERS` being non-empty

## Context Class Structure

No closures in AssemblyScript proxy-wasm. Origin matching must be a class private method, not a free function or lambda.

```typescript
class CorsRoot extends RootContext {
  createContext(context_id: u32): Context {
    setLogLevel(LogLevelValues.info);
    return new CorsContext(context_id, this);
  }
}

class CorsContext extends Context {
  constructor(context_id: u32, root_context: CorsRoot) {
    super(context_id, root_context);
  }
  // origin helper and hooks defined here
}

registerRootContext((context_id: u32) => {
  return new CorsRoot(context_id);
}, "cors");
```

Root context name registered as `"cors"`.

## Build

```sh
pnpm install
pnpm run asbuild
```

| Output file | Description |
|---|---|
| `build/cors.wasm` | Optimised release binary — upload to FastEdge |
| `build/cors-debug.wasm` | Debug binary with source maps |

## Dependencies

| Package | Version constraint | Role |
|---|---|---|
| `@gcoredev/proxy-wasm-sdk-as` | `^1.2.3` | Proxy-wasm SDK (Context, hooks, stream_context, getEnv) |
| `assemblyscript` | `^0.28.9` | AssemblyScript compiler (dev) |
| `@assemblyscript/wasi-shim` | `^0.1.0` | WASI shim for AssemblyScript (dev) |

## Gotchas

- **No closures.** Origin helper must be a class private method. Free functions and lambdas capturing `this` are not supported in proxy-wasm AssemblyScript.
- **Empty string, not null.** `getEnv` and `stream_context.headers.request.get` return `""` for missing values. Check `=== ""`, not null.
- **Always set `Vary: Origin` when echoing origin.** Omitting it causes caches to serve the same response to different origins, leaking credentials or breaking cross-origin isolation.
- **`remove` sets to empty string.** On the FastEdge CDN platform, calling `remove` on a header sets it to empty string rather than removing it. When checking for header absence, test for both missing and `""`.
- **OPTIONS not reachable.** FastEdge edge layer intercepts OPTIONS preflights before proxy-wasm hooks run. Any preflight-handling code in WASM is dead code.
- **Re-read env per hook.** `getEnv` is called at hook execution time, not cached at construction time.

## See Also

- proxy-wasm AssemblyScript SDK reference
- FastEdge CDN application environment variables configuration
- platform-overview (CDN app lifecycle and OPTIONS handling)
- best-practices (header mutation patterns, Vary usage)

## Source Material

### FILE: examples/cors/assembly/index.ts

```ts
export * from "@gcoredev/proxy-wasm-sdk-as/assembly/proxy";
import {
  Context,
  FilterHeadersStatusValues,
  log,
  LogLevelValues,
  registerRootContext,
  RootContext,
  stream_context,
} from "@gcoredev/proxy-wasm-sdk-as/assembly";
import {
  getEnv,
  setLogLevel,
} from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";

class CorsRoot extends RootContext {
  createContext(context_id: u32): Context {
    setLogLevel(LogLevelValues.info);
    return new CorsContext(context_id, this);
  }
}

class CorsContext extends Context {
  constructor(context_id: u32, root_context: CorsRoot) {
    super(context_id, root_context);
  }

  private isOriginAllowed(origin: string, allowedOrigins: string): bool {
    if (allowedOrigins === "" || allowedOrigins === "*") return true;
    const origins = allowedOrigins.split(",");
    for (let i = 0; i < origins.length; i++) {
      if (origins[i].trim() == origin) return true;
    }
    return false;
  }

  onRequestHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues {
    const allowedOrigins = getEnv("ALLOWED_ORIGINS");
    const origin = stream_context.headers.request.get("Origin");
    log(LogLevelValues.info, "onRequestHeaders >> origin: " + origin);

    if (origin !== "" && !this.isOriginAllowed(origin, allowedOrigins)) {
      log(LogLevelValues.info, "CORS: origin not allowed: " + origin);
    }

    // OPTIONS preflights are answered by the FastEdge edge layer before this
    // hook fires — don't try to handle them here.

    return FilterHeadersStatusValues.Continue;
  }

  onResponseHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues {
    const allowedOrigins = getEnv("ALLOWED_ORIGINS");
    const origin = stream_context.headers.request.get("Origin");

    if (origin === "" || !this.isOriginAllowed(origin, allowedOrigins)) {
      return FilterHeadersStatusValues.Continue;
    }

    const effectiveOrigin = allowedOrigins === "*" ? "*" : origin;

    stream_context.headers.response.add(
      "Access-Control-Allow-Origin",
      effectiveOrigin,
    );
    stream_context.headers.response.add("Vary", "Origin");

    const exposeHeaders = getEnv("EXPOSE_HEADERS");
    if (exposeHeaders !== "") {
      stream_context.headers.response.add(
        "Access-Control-Expose-Headers",
        exposeHeaders,
      );
    }

    return FilterHeadersStatusValues.Continue;
  }
}

registerRootContext((context_id: u32) => {
  return new CorsRoot(context_id);
}, "cors");
```


### FILE: examples/cors/package.json

```json
{
  "name": "fastedge-as-example-cors",
  "version": "1.0.0",
  "description": "FastEdge AssemblyScript example: CORS — preflight handling and response headers",
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


### FILE: examples/cors/README.md

```
[← Back to examples](../README.md)

# CORS

This application adds Cross-Origin Resource Sharing (CORS) headers to responses from allowed origins.

## What it does

In `onResponseHeaders`, for requests from allowed origins, the app adds `Access-Control-Allow-Origin` and `Vary: Origin` response headers. Optionally exposes additional headers via `Access-Control-Expose-Headers`. Requests from disallowed origins pass through unchanged (no CORS headers added).

> **Note on OPTIONS preflights:** FastEdge's edge layer answers OPTIONS preflight requests directly — proxy-wasm hooks do not fire for OPTIONS. Configure preflight behaviour (allowed methods, max-age, etc.) in your CDN application settings, not in WASM code.

## Configuration

Set the following environment variables on your FastEdge application:

| Variable | Example | Description |
|----------|---------|-------------|
| `ALLOWED_ORIGINS` | `https://example.com,https://app.example.com` | Comma-separated allowed origins, or `*` for any (required) |
| `EXPOSE_HEADERS` | `X-Request-Id, X-Trace-Id` | Response headers to expose to the browser (optional) |

## Build

```sh
pnpm install
pnpm run asbuild
```

Build output:

| File | Description |
|------|-------------|
| `build/cors.wasm` | Optimised release binary — upload this to FastEdge |
| `build/cors-debug.wasm` | Debug binary with source maps |

## Deploy

Upload `build/cors.wasm` to the FastEdge portal and attach it to your CDN application. Configure the `ALLOWED_ORIGINS` environment variable in the application settings.
```
