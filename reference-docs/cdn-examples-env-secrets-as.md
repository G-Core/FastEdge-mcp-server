<!--
  auto-updated: true
  sources:
    - id: proxy-wasm-sdk-as
      ref: master
      commit: 20b31c05b39c5537fb1ac7cc8693d9d8ec314f25
      updated: 2026-04-15
-->
---
type: example
app_type: cdn
languages: [as]
capabilities: [env-vars, secrets]
---

# Environment Variables and Secrets — CDN (AssemblyScript)

Runtime access to deployment-time environment variables and platform-managed secrets from within a CDN proxy-wasm filter written in AssemblyScript.

---

## API Reference

### `getEnv(name: string): string`

Retrieves an environment variable by name.

- **Parameter**: `name` — the variable name as set at deployment time
- **Returns**: `string` value; empty string if the variable is not set
- **Import**: `@gcoredev/proxy-wasm-sdk-as/assembly/fastedge`
- **Use for**: non-sensitive configuration values (usernames, feature flags, region identifiers)

### `getSecret(name: string): string`

Retrieves the current value of a platform-managed secret by name.

- **Parameter**: `name` — the secret name as registered in the FastEdge platform
- **Returns**: `string` value; empty string if the secret does not exist
- **Import**: `@gcoredev/proxy-wasm-sdk-as/assembly/fastedge`
- **Use for**: sensitive values (passwords, API tokens, credentials)

### `getSecretEffectiveAt(name: string, slot: u32): string`

Retrieves a secret value pinned to a specific rotation slot.

- **Parameters**:
  - `name` — secret name
  - `slot` — rotation slot index (platform-managed)
- **Returns**: `string` value for that rotation slot
- **Import**: `@gcoredev/proxy-wasm-sdk-as/assembly/fastedge`
- **Use for**: zero-downtime secret rotation — read both current and next slot during transition windows

---

## Deprecated Alternatives

| Deprecated | Replacement |
|---|---|
| `getEnvVar(name)` | `getEnv(name)` |
| `getSecretVar(name)` | `getSecret(name)` |

Do not use the deprecated forms in new code.

---

## Env Vars vs Secrets — Decision Guide

| Characteristic | `getEnv` | `getSecret` |
|---|---|---|
| Value sensitivity | Non-sensitive | Sensitive |
| Set at | Deployment time | Platform secret store |
| Rotation support | No | Yes (`getSecretEffectiveAt`) |
| Typical use | Config, usernames, flags | Passwords, API keys, tokens |

---

## Complete Example

**Source**: `examples/variablesAndSecrets/assembly/index.ts`

```typescript
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
  getSecret,
  setLogLevel,
} from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";

class VariablesRoot extends RootContext {
  createContext(context_id: u32): Context {
    setLogLevel(LogLevelValues.debug);
    return new VariablesContext(context_id, this);
  }
}

class VariablesContext extends Context {
  constructor(context_id: u32, root_context: VariablesRoot) {
    super(context_id, root_context);
  }

  onRequestHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues {
    const username = getEnv("USERNAME");
    const password = getSecret("PASSWORD");

    log(LogLevelValues.info, "USERNAME: " + username);
    log(LogLevelValues.info, "PASSWORD: " + password);

    stream_context.headers.request.add("x-env-username", username);
    stream_context.headers.request.add("x-env-password", password);

    return FilterHeadersStatusValues.Continue;
  }
}

registerRootContext((context_id: u32) => {
  return new VariablesRoot(context_id);
}, "variablesAndSecrets");
```

---

## Key Patterns

- **Hook**: Read env vars and secrets in `onRequestHeaders` before forwarding the request upstream.
- **Forwarding values**: Use `stream_context.headers.request.add(headerName, value)` to inject retrieved values as request headers.
- **Logging**: Both `getEnv` and `getSecret` return plain strings; log them with `log(LogLevelValues.info, ...)`. Avoid logging secrets in production — use `LogLevelValues.debug` and disable debug logging via `setLogLevel` at release time.
- **Return value type**: Both functions return `string`, not `ArrayBuffer`. No decoding step is needed.
- **Missing values**: Both functions return an empty string `""` when the variable or secret is not found. Callers must handle this case explicitly if a missing value is an error condition.

---

## Build Configuration

**Package name**: `fastedge-as-example-variables-and-secrets`

Build commands (from `package.json`):

| Command | Output |
|---|---|
| `npm run asbuild:debug` | Debug WASM binary |
| `npm run asbuild:release` | Release WASM binary |
| `npm run asbuild` | Both debug and release |

Entry point: `assembly/index.ts`  
Compiler: `asc` (AssemblyScript compiler, `assemblyscript ^0.28.9`)  
Runtime shim: `@assemblyscript/wasi-shim ^0.1.0`

---

## Imports Summary

```typescript
// Core proxy-wasm types and lifecycle hooks
import {
  Context,
  FilterHeadersStatusValues,
  log,
  LogLevelValues,
  registerRootContext,
  RootContext,
  stream_context,
} from "@gcoredev/proxy-wasm-sdk-as/assembly";

// FastEdge-specific env/secret APIs
import {
  getEnv,
  getSecret,
  setLogLevel,
} from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";
```

---

## See Also

- sdk-reference-js (AssemblyScript SDK full API reference)
- examples-headers-cdn-as (request/response header manipulation patterns)
- platform-overview (secret management and deployment configuration)
- best-practices (logging levels and secret handling guidelines)
