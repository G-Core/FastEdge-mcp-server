<!--
  auto-updated: true
  sources:
    - id: proxy-wasm-sdk-as
      ref: master
      commit: 20b31c05b39c5537fb1ac7cc8693d9d8ec314f25
      updated: 2026-04-15
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
- **Type note**: returns `string`, not `ArrayBuffer`; pass directly to `jwtVerify`

```typescript
const secret = getSecret("secret");
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

Sets the log verbosity. Default is `LogLevelValues.info`. Called in `createContext`.

### `log(level: LogLevelValues, message: string): void`

Emits a log entry. Used to record token rejection reasons.

---

## Validation Flow

```
onRequestHeaders
  ├── getSecret("secret")          → null → 500 (app misconfigured)
  ├── get "Authorization" header   → null or empty → 401
  ├── strip "Bearer " prefix       → empty → 401
  └── jwtVerify(token, secret)
        ├── JwtValidation.Ok       → Continue (pass request upstream)
        ├── JwtValidation.Expired  → 403 "Expired token"
        └── other                  → 403 "Invalid token"
```

---

## Error Responses

| Condition | Status | Body |
|---|---|---|
| Secret not configured | `500` | `App misconfigured` |
| `Authorization` header missing or empty | `401` | `No Authorization header` |
| Token missing after stripping `Bearer ` prefix | `401` | `Token not found` |
| Token expired (`JwtValidation.Expired`) | `403` | `Expired token` |
| Token invalid (any other failure) | `403` | `Invalid token` |

All blocked responses return `FilterHeadersStatusValues.StopIteration`.

---

## Required Secret

| Secret name | Type | Constraint |
|---|---|---|
| `secret` | HMAC-SHA256 signing key | String; minimum 256 bits / 32 characters |

Configure this secret variable on the FastEdge application before deployment. For secret rotation, see `getSecretEffectiveAt` in the FastEdge secrets reference.

---

## Dependencies

```json
{
  "@gcoredev/as-jwt": "^1.0.3",
  "@gcoredev/proxy-wasm-sdk-as": "file:../.."
}
```

- `@gcoredev/as-jwt` is a required peer dependency — it is NOT bundled in proxy-wasm-sdk-as.
- `assemblyscript-json` is declared as a dependency but not directly used in this example.

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

- `getSecret` returns `string | null`, not `ArrayBuffer`. Pass the returned string directly to `jwtVerify` without encoding.
- `@gcoredev/as-jwt` must be declared as an explicit dependency in `package.json`. It is not re-exported by proxy-wasm-sdk-as.
- Both `null` check and `.length == 0` check are required for the `Authorization` header — an empty-string header passes the null check but must still be rejected.
- `jwtVerify` does not throw; always check the return value against `JwtValidation.Ok`.
- Validation happens in `onRequestHeaders` only. There is no body or response hook in this example.
- For HMAC secret rotation using slot-based secrets, use `getSecretEffectiveAt` instead of `getSecret`. See the FastEdge secrets reference.

---

## See Also

- proxy-wasm-sdk-as SDK reference (AssemblyScript)
- FastEdge secrets reference (`getSecret`, `getSecretEffectiveAt`, rotation slots)
- CDN app platform overview
- `@gcoredev/as-jwt` package (npmjs.com)
