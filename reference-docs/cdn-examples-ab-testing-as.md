<!--
  auto-updated: true
  sources:
    - id: proxy-wasm-sdk-as
      ref: v1.2.4
      commit: 073f583217448aaf25cb98f5d336a0fda26273ba
      updated: 2026-09-29
-->

# A/B Testing — AssemblyScript (CDN)

Cookie-based A/B traffic splitting at the CDN layer. Routes requests to different origin paths based on variant assignment, with cookie persistence for session stickiness.

---

## Metadata

| Field | Value |
|---|---|
| App type | CDN (proxy-wasm) |
| Language | AssemblyScript |
| SDK | `@gcoredev/proxy-wasm-sdk-as` ^1.2.3 |
| Entry point | `assembly/index.ts` |
| Root context | `AbTestingRoot` |
| Request context | `AbTestingContext` |
| Registration key | `"abTesting"` |

---

## Environment Variables

All variables are read via `getEnv()`. Returns empty string when unset — not null.

| Variable | Required | Example | Description |
|---|---|---|---|
| `EXPERIMENT_NAME` | Yes | `homepage-redesign` | Identifies the experiment. Used in cookie name and upstream headers. |
| `VARIANT_A_PATH` | Yes | `/variant-a` | Path prefix prepended to the original path for variant A. |
| `VARIANT_B_PATH` | Yes | `/variant-b` | Path prefix prepended to the original path for variant B. |

Missing any required variable causes an immediate `500` response via `send_http_response`.

---

## Request Flow — `onRequestHeaders`

Signature: `onRequestHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues`

### Step 1 — Validate configuration

```
getEnv("EXPERIMENT_NAME") === "" → send_http_response(500, ...) → StopIteration
getEnv("VARIANT_A_PATH") === "" || getEnv("VARIANT_B_PATH") === "" → send_http_response(500, ...) → StopIteration
```

### Step 2 — Read experiment cookie

Cookie name: `fe_exp_<EXPERIMENT_NAME>`

```
cookieHeader = stream_context.headers.request.get("Cookie")
assignedVariant = getCookieValue(cookieHeader, cookieName)
```

`getCookieValue` splits the `Cookie` header on `;`, trims each pair, and matches `name=` prefix. Returns empty string if not found. AssemblyScript has no closures — cookie parsing must be a private class method.

### Step 3 — Assign variant if not already set

If `assignedVariant` is not `"A"` or `"B"`:

```
now = getCurrentTime()   // returns u64 milliseconds since epoch
assignedVariant = now % 2 == 0 ? "A" : "B"
```

**Gotcha**: `getCurrentTime()` returns milliseconds (`u64`). Two requests arriving in the same millisecond will receive the same assignment. This is illustrative entropy — not suitable for strict 50/50 production guarantees. Production implementations should hash a stable visitor identifier (e.g., client IP or session token).

### Step 4 — Rewrite request URL

Reads the original path:
```
pathArrBuf = get_property("request.path")   // ArrayBuffer; byteLength === 0 → Continue
originalPath = String.UTF8.decode(pathArrBuf)
```

Computes new path:
```
variantPath = assignedVariant === "A" ? variantAPath : variantBPath
newPath = variantPath + originalPath
```

Reconstructs full URL from decomposed properties — do NOT string-splice the original URL (breaks when path appears in host; silently loses query string):

```
scheme = String.UTF8.decode(get_property("request.scheme"))
host   = String.UTF8.decode(get_property("request.host"))
query  = String.UTF8.decode(get_property("request.query"))   // empty string if byteLength === 0

newUrl = scheme + "://" + host + newPath + (query.length > 0 ? "?" + query : "")
set_property("request.url", String.UTF8.encode(newUrl))
```

`set_property` / `get_property` key: `"request.url"`, `"request.path"`, `"request.scheme"`, `"request.host"`, `"request.query"`.

URL rewrite is skipped entirely if `schemeBuf.byteLength === 0` or `hostBuf.byteLength === 0`.

### Step 5 — Add upstream headers

```
stream_context.headers.request.add("X-Experiment", experimentName)
stream_context.headers.request.add("X-Variant", assignedVariant)
```

These headers carry variant state to the origin and enable cross-hook state recovery (see Response Flow).

### Return value

Returns `FilterHeadersStatusValues.Continue` on success, `FilterHeadersStatusValues.StopIteration` on configuration error.

---

## Response Flow — `onResponseHeaders`

Signature: `onResponseHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues`

**Cross-hook state**: Instance fields (`this.*`) do NOT survive the nginx → core-proxy hop between request and response phases. Variant assignment is recovered from the request header set in `onRequestHeaders`:

```
variant = stream_context.headers.request.get("X-Variant")
```

If `variant === ""`, returns `Continue` immediately (no-op).

### Sets persistence cookie

```
cookieName = "fe_exp_" + experimentName
Set-Cookie: fe_exp_<EXPERIMENT_NAME>=<A|B>; Path=/; Max-Age=86400; SameSite=Lax
```

Added via: `stream_context.headers.response.add("Set-Cookie", ...)`

TTL: 86400 seconds (24 hours).

### Sets response observability header

```
stream_context.headers.response.add("X-Variant", variant)
```

Returns `FilterHeadersStatusValues.Continue`.

---

## API Surface

| Symbol | Source | Type | Notes |
|---|---|---|---|
| `getEnv(name: string): string` | `fastedge` | Function | Returns `""` when variable is unset, never null |
| `setLogLevel(level: LogLevelValues): void` | `fastedge` | Function | Called once in `createContext` |
| `getCurrentTime(): u64` | `fastedge/utils/runtime` | Function | Milliseconds since epoch |
| `get_property(path: string): ArrayBuffer` | `proxy-wasm-sdk-as` | Function | Returns zero-length buffer when property absent |
| `set_property(path: string, value: ArrayBuffer): void` | `proxy-wasm-sdk-as` | Function | Writes wasm property |
| `stream_context.headers.request.get(name: string): string` | `proxy-wasm-sdk-as` | Method | Reads request header |
| `stream_context.headers.request.add(name: string, value: string): void` | `proxy-wasm-sdk-as` | Method | Adds request header |
| `stream_context.headers.response.add(name: string, value: string): void` | `proxy-wasm-sdk-as` | Method | Adds response header |
| `send_http_response(status: u32, reason: string, body: ArrayBuffer, headers: string[]): void` | `proxy-wasm-sdk-as` | Function | Sends immediate response; use with `StopIteration` |
| `log(level: LogLevelValues, msg: string): void` | `proxy-wasm-sdk-as` | Function | Structured log output |
| `registerRootContext(factory: (id: u32) => RootContext, name: string): void` | `proxy-wasm-sdk-as` | Function | Registers root context factory |

---

## Cookie Convention

| Attribute | Value |
|---|---|
| Name | `fe_exp_<EXPERIMENT_NAME>` |
| Value | `A` or `B` |
| Path | `/` |
| Max-Age | `86400` (24 hours) |
| SameSite | `Lax` |

---

## Error Conditions

| Condition | Response |
|---|---|
| `EXPERIMENT_NAME` not set | HTTP 500, body: `App misconfigured - EXPERIMENT_NAME must be set` |
| `VARIANT_A_PATH` or `VARIANT_B_PATH` not set | HTTP 500, body: `App misconfigured - VARIANT_A_PATH and VARIANT_B_PATH must be set` |
| `request.path` property empty | Skip URL rewrite, return `Continue` |
| `request.scheme` or `request.host` empty | Skip `set_property("request.url", ...)` entirely |

---

## Build

```sh
pnpm install
pnpm run asbuild
```

| Output file | Use |
|---|---|
| `build/abTesting.wasm` | Release binary — upload to FastEdge |
| `build/abTesting-debug.wasm` | Debug binary with source maps |

Build scripts use `asc assembly/index.ts --target debug` and `--target release`.

---

## AssemblyScript-Specific Constraints

- **No closures**: Cookie parsing is implemented as a private class method (`getCookieValue`), not an inline lambda.
- **Cross-hook state**: Instance fields do not survive the nginx → core-proxy boundary. Use request headers (e.g., `X-Variant`) or wasm properties to carry state from `onRequestHeaders` to `onResponseHeaders`.
- **`getEnv` return type**: Always `string`. Check for empty string `""`, not `null`.
- **`getCurrentTime` return type**: `u64` (milliseconds). Modulo arithmetic for 50/50 split uses integer remainder — no floating point needed.
- **`get_property` return type**: `ArrayBuffer`. Always check `byteLength > 0` before decoding.

---

## See Also

- proxy-wasm-sdk-as SDK reference
- FastEdge CDN application platform overview
- FastEdge environment variable configuration
- fastedge-test local WASM test runner (for unit-testing cookie parsing and variant assignment logic)

## Source Material

### FILE: examples/abTesting/assembly/index.ts

```ts
export * from "@gcoredev/proxy-wasm-sdk-as/assembly/proxy";
import {
  Context,
  FilterHeadersStatusValues,
  get_property,
  log,
  LogLevelValues,
  registerRootContext,
  RootContext,
  send_http_response,
  set_property,
  stream_context,
} from "@gcoredev/proxy-wasm-sdk-as/assembly";
import {
  getEnv,
  setLogLevel,
} from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";
import { getCurrentTime } from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge/utils/runtime";

class AbTestingRoot extends RootContext {
  createContext(context_id: u32): Context {
    setLogLevel(LogLevelValues.info);
    return new AbTestingContext(context_id, this);
  }
}

class AbTestingContext extends Context {
  constructor(context_id: u32, root_context: AbTestingRoot) {
    super(context_id, root_context);
  }

  onRequestHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues {
    const experimentName = getEnv("EXPERIMENT_NAME");
    if (experimentName === "") {
      send_http_response(
        500,
        "internal server error",
        String.UTF8.encode("App misconfigured - EXPERIMENT_NAME must be set"),
        [],
      );
      return FilterHeadersStatusValues.StopIteration;
    }

    const variantAPath = getEnv("VARIANT_A_PATH");
    const variantBPath = getEnv("VARIANT_B_PATH");
    if (variantAPath === "" || variantBPath === "") {
      send_http_response(
        500,
        "internal server error",
        String.UTF8.encode(
          "App misconfigured - VARIANT_A_PATH and VARIANT_B_PATH must be set",
        ),
        [],
      );
      return FilterHeadersStatusValues.StopIteration;
    }

    // Check for existing experiment cookie
    const cookieName = "fe_exp_" + experimentName;
    const cookieHeader = stream_context.headers.request.get("Cookie");
    let assignedVariant = this.getCookieValue(cookieHeader, cookieName);

    // Assign variant if not already set
    if (assignedVariant !== "A" && assignedVariant !== "B") {
      // Use current time as a simple entropy source for 50/50 split
      const now = getCurrentTime();
      assignedVariant = now % 2 == 0 ? "A" : "B";
    }

    // Rewrite the request path to the variant path
    const pathArrBuf = get_property("request.path");
    if (pathArrBuf.byteLength === 0) {
      return FilterHeadersStatusValues.Continue;
    }
    const originalPath = String.UTF8.decode(pathArrBuf);
    const variantPath = assignedVariant === "A" ? variantAPath : variantBPath;
    const newPath = variantPath + originalPath;

    // Reconstruct request.url from its decomposed parts rather than splicing
    // the path out of the full URL — splicing breaks when the path happens to
    // appear inside the host, and it can silently lose the query string.
    const schemeBuf = get_property("request.scheme");
    const hostBuf = get_property("request.host");
    if (schemeBuf.byteLength > 0 && hostBuf.byteLength > 0) {
      const scheme = String.UTF8.decode(schemeBuf);
      const host = String.UTF8.decode(hostBuf);
      const queryBuf = get_property("request.query");
      const query = queryBuf.byteLength > 0 ? String.UTF8.decode(queryBuf) : "";
      const newUrl =
        scheme + "://" + host + newPath + (query.length > 0 ? "?" + query : "");
      log(LogLevelValues.info, `A/B routing: ${newUrl}`);
      set_property("request.url", String.UTF8.encode(newUrl));
    }

    // Add variant header for upstream visibility
    stream_context.headers.request.add("X-Experiment", experimentName);
    stream_context.headers.request.add("X-Variant", assignedVariant);

    log(
      LogLevelValues.info,
      `A/B test "${experimentName}": variant ${assignedVariant}, path ${newPath}`,
    );

    return FilterHeadersStatusValues.Continue;
  }

  onResponseHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues {
    // Recover the assigned variant from the request header set in onRequestHeaders.
    // Instance state (this.variant) does not survive the nginx -> core-proxy hop.
    const variant = stream_context.headers.request.get("X-Variant");
    if (variant === "") {
      return FilterHeadersStatusValues.Continue;
    }

    const experimentName = getEnv("EXPERIMENT_NAME");
    const cookieName = "fe_exp_" + experimentName;

    // Set the experiment cookie so subsequent requests stick to the same variant
    stream_context.headers.response.add(
      "Set-Cookie",
      cookieName + "=" + variant + "; Path=/; Max-Age=86400; SameSite=Lax",
    );

    // Add variant as response header for observability
    stream_context.headers.response.add("X-Variant", variant);

    return FilterHeadersStatusValues.Continue;
  }

  private getCookieValue(cookieHeader: string, name: string): string {
    if (cookieHeader === "") return "";
    const pairs = cookieHeader.split(";");
    const prefix = name + "=";
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i].trim();
      if (pair.startsWith(prefix)) {
        return pair.substring(prefix.length);
      }
    }
    return "";
  }
}

registerRootContext((context_id: u32) => {
  return new AbTestingRoot(context_id);
}, "abTesting");
```


### FILE: examples/abTesting/package.json

```json
{
  "name": "fastedge-as-example-ab-testing",
  "version": "1.0.0",
  "description": "FastEdge AssemblyScript example: A/B Testing — cookie-based traffic splitting at the CDN layer",
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


### FILE: examples/abTesting/README.md

```
[← Back to examples](../README.md)

# A/B Testing

This application performs cookie-based A/B traffic splitting at the CDN layer, routing requests to different origin paths based on variant assignment.

## What it does

In `onRequestHeaders`, the app:

1. Checks for an existing experiment cookie (`fe_exp_<EXPERIMENT_NAME>`).
2. If no cookie is found, assigns the user to variant **A** or **B** (50/50 split).
3. Rewrites the request path by prepending the variant-specific path prefix (e.g. `/variant-a/original/path`).
4. Adds `X-Experiment` and `X-Variant` request headers for upstream visibility.

In `onResponseHeaders`, the app sets a `Set-Cookie` header to persist the variant assignment for subsequent requests (24-hour TTL).

> **Note on variant assignment entropy:** New-visitor assignment uses `getCurrentTime() % 2` as a simple 50/50 source. This is illustrative — it is not sticky across two requests that arrive in the same millisecond and is not reproducible in tests. Production A/B implementations typically hash a stable visitor identifier (e.g. client IP or session token) for deterministic, sticky pre-cookie assignment.

## Configuration

Set the following environment variables on your FastEdge application:

| Variable | Example | Description |
|----------|---------|-------------|
| `EXPERIMENT_NAME` | `homepage-redesign` | Name of the experiment (required) |
| `VARIANT_A_PATH` | `/variant-a` | Path prefix for variant A (required) |
| `VARIANT_B_PATH` | `/variant-b` | Path prefix for variant B (required) |

Your origin server should serve different content at each variant path prefix.

## Build

```sh
pnpm install
pnpm run asbuild
```

Build output:

| File | Description |
|------|-------------|
| `build/abTesting.wasm` | Optimised release binary — upload this to FastEdge |
| `build/abTesting-debug.wasm` | Debug binary with source maps |

## Deploy

Upload `build/abTesting.wasm` to the FastEdge portal and attach it to your CDN application. Configure the experiment environment variables in the application settings.
```
