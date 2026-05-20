<!--
  auto-updated: true
  sources:
    - id: proxy-wasm-sdk-as
      ref: master
      commit: 60f25c7bd35564e5bafb421be7f37aa4acf1bf81
      updated: 2026-05-20
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
