<!--
  auto-updated: true
  sources:
    - id: proxy-wasm-sdk-as
      ref: master
      commit: 8e3bb621bc013a0aed7e52122066b417ad62a207
      updated: 2026-08-20
-->
---
capabilities:
  - jwt-auth
  - request-header-inspection
  - secret-access
  - http-response
type: example
app_type: cdn
languages:
  - assemblyscript
---

# JWT Validation — CDN App (AssemblyScript)

Validates a JWT Bearer token on every incoming request before passing it upstream. Uses `@gcoredev/as-jwt` for signature and expiry verification and `getSecret` to retrieve the HMAC key from FastEdge secrets.

---

## Lifecycle Hook

All logic runs in `onRequestHeaders`. The request is either allowed through (`FilterHeadersStatusValues.Continue`) or blocked with an early HTTP response (`FilterHeadersStatusValues.StopIteration`).

---

## Imports

```typescript
import {
  Context,
  FilterHeadersStatusValues,
  log,
  LogLevelValues,
  registerRootContext,
  RootContext,
  send_http_response,
  stream_context,
} from "@gcoredev/proxy-wasm-sdk-as/assembly";

import {
  getSecret,
  setLogLevel,
} from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";

import { jwtVerify, JwtValidation } from "@gcoredev/as-jwt/assembly";
```

---

## Key APIs

### `getSecret(name: string): string | null`

Reads a named secret variable configured on the FastEdge application.

- **Parameter**: `name` — secret variable name (string)
- **Returns**: secret value as a UTF-8 string, or `null` if not found
- **Type note**: returns `string`, not `ArrayBuffer`; pass directly to `jwtVerify` without encoding

```typescript
const secret = getSecret("SECRET");
if (!secret) {
  send_http_response(INTERNAL_SERVER_ERROR, "internal server error",
    String.UTF8.encode("App misconfigured"), []);
  return FilterHeadersStatusValues.StopIteration;
}
```

### `jwtVerify(token: string, secret: string): JwtValidation`

Verifies a JWT token against an HMAC-SHA256 secret.

- **Parameters**:
  - `token` — raw JWT string (without `Bearer ` prefix)
  - `secret` — HMAC signing secret (string)
- **Returns**: `JwtValidation` enum value
- **Package**: `@gcoredev/as-jwt` (separate dependency, not part of proxy-wasm-sdk-as)
- **Behavior**: does not throw; always check the return value against `JwtValidation.Ok`

### `JwtValidation` enum

| Value | Meaning |
|---|---|
| `JwtValidation.Ok` | Token is valid and not expired |
| `JwtValidation.Expired` | Token signature valid but `exp` claim has passed |
| *(other values)* | Token is malformed or signature is invalid |

### `stream_context.headers.request.get(name: string): string | null`

Reads a request header by name.

```typescript
const authHeader = stream_context.headers.request.get("Authorization");
```

### `send_http_response(status: u32, statusText: string, body: ArrayBuffer, headers: Array<...>): void`

Sends an immediate HTTP response and stops the request. Body must be encoded as `ArrayBuffer` via `String.UTF8.encode(...)`.

### `setLogLevel(level: LogLevelValues): void`

Sets the log verbosity. Default is `LogLevelValues.info`. Called in `createContext`. Present in source for demonstration purposes only — explicitly setting the default is optional.

### `log(level: LogLevelValues, message: string): void`

Emits a log entry. Used to record token rejection reasons (e.g. `"Token Expired"`, `"Bad Token"`).

---

## Validation Flow

```
onRequestHeaders
  ├── getSecret("SECRET")              → null → 500 (app misconfigured)
  ├── get "Authorization" header       → null → 401 "No Authorization header"
  ├── check startsWith("Bearer ")      → false → 401 "Authorization header must use Bearer scheme"
  ├── slice(7) to strip "Bearer "      → empty → 401 "Token not found"
  └── jwtVerify(token, secret)
        ├── JwtValidation.Ok           → Continue (pass request upstream)
        ├── JwtValidation.Expired      → 403 "Expired token"
        └── other                      → 403 "Invalid token"
```

---

## Error Responses

| Condition | Status | Body |
|---|---|---|
| Secret not configured | `500` | `App misconfigured` |
| `Authorization` header missing | `401` | `No Authorization header` |
| `Authorization` header does not use Bearer scheme | `401` | `Authorization header must use Bearer scheme` |
| Token missing after stripping `Bearer ` prefix | `401` | `Token not found` |
| Token expired (`JwtValidation.Expired`) | `403` | `Expired token` |
| Token invalid (any other failure) | `403` | `Invalid token` |

All blocked responses return `FilterHeadersStatusValues.StopIteration`.

---

## Required Secret

| Secret name | Type | Constraint |
|---|---|---|
| `SECRET` | HMAC-SHA256 signing key | String; minimum 256 bits / 32 characters |

Configure this secret variable on the FastEdge application before deployment. For secret rotation, use `getSecretEffectiveAt` instead of `getSecret` — see the FastEdge secrets reference.

---

## Testing Tokens

Both tokens use the secret `a-string-secret-at-least-256-bits-long-thats-hard-to-break`.

**Expired token** (returns `403 Forbidden`):
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjk3ODMxMDg2MX0.egSSDoDdAHz8Kqee7be9N168CDEwOiOej96Idm2c1yQ
```

**Valid token** (expiry: 2035-01-01, returns `200 OK`):
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjIwNTEyMjYwNjF9.zn_pSdcBo8T3SvNgMVYzWc5CU_MKqOlms7TpZXhPtJU
```

---

## Dependencies

```json
{
  "@gcoredev/as-jwt": "^1.0.3",
  "@gcoredev/proxy-wasm-sdk-as": "^1.2.3",
  "assemblyscript-json": "^1.1.0"
}
```

- `@gcoredev/as-jwt` is a required peer dependency — it is NOT bundled in proxy-wasm-sdk-as.
- `assemblyscript-json` is declared as a dependency but not directly used in this example.

**Dev dependencies:**
```json
{
  "@assemblyscript/wasi-shim": "^0.1.0",
  "assemblyscript": "^0.28.9"
}
```

---

## Build

```sh
pnpm install
pnpm run asbuild
```

| Output file | Purpose |
|---|---|
| `build/jwt.wasm` | Optimised release binary — upload to FastEdge |
| `build/jwt-debug.wasm` | Debug binary with source maps |

Build scripts:
- `asbuild:release` — `asc assembly/index.ts --target release`
- `asbuild:debug` — `asc assembly/index.ts --target debug`
- `asbuild` — runs both

---

## Registration

```typescript
registerRootContext((context_id: u32) => {
  return new AuthRoot(context_id);
}, "auth");
```

Root context name: `"auth"`.

---

## Gotchas

- The secret variable name is `SECRET` (uppercase). Using a different case will cause a 500 at runtime.
- `getSecret` returns `string | null`, not `ArrayBuffer`. Pass the returned string directly to `jwtVerify` without encoding.
- `@gcoredev/as-jwt` must be declared as an explicit dependency in `package.json`. It is not re-exported by proxy-wasm-sdk-as.
- The `Authorization` header is validated in two steps: first a null check (missing header → 401), then a `startsWith("Bearer ")` check (wrong scheme → 401). An empty-string header would fail the Bearer scheme check.
- `jwtVerify` does not throw; always check the return value against `JwtValidation.Ok`.
- Validation happens in `onRequestHeaders` only. There is no body or response hook in this example.
- The `setLogLevel(LogLevelValues.info)` call in `createContext` is present for demonstration only — `info` is the default level and the call is not required.
- For HMAC secret rotation using slot-based secrets, use `getSecretEffectiveAt` instead of `getSecret`. See the FastEdge secrets reference.

---

## See Also

- proxy-wasm-sdk-as SDK reference (AssemblyScript)
- FastEdge secrets reference (`getSecret`, `getSecretEffectiveAt`, rotation slots)
- CDN app platform overview
- `@gcoredev/as-jwt` package on npmjs.com
