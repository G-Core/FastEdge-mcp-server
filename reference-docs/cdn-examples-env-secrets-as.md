<!--
  auto-updated: true
  sources:
    - id: proxy-wasm-sdk-as
      ref: master
      commit: 8e3bb621bc013a0aed7e52122066b417ad62a207
      updated: 2026-08-17
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
    setLogLevel(LogLevelValues.info);
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
    log(LogLevelValues.info, "PASSWORD: [set, length " + password.length.toString() + "]");

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
- **Secret logging**: Never log secret values verbatim. Log the secret's length instead — `"[set, length " + password.length.toString() + "]"` — to confirm presence without exposing the value. Logs are often persisted and accessible to operators who should not see credential values.
- **Return value type**: Both `getEnv` and `getSecret` return `string`, not `ArrayBuffer`. No decoding step is needed.
- **Missing values**: Both functions return an empty string `""` when the variable or secret is not found. Callers must handle this case explicitly if a missing value is an error condition.
- **Forwarding scope**: Be deliberate about which upstream systems receive secret values via forwarded headers. Limit forwarding to systems that require the value.

---

## Local Testing

The test fixture at `fixtures/happy-path.test.json` uses `"dotenv": {"enabled": true}` to load values from `fixtures/.env`. The runner maps environment variable names as follows:

| Runner env var | Maps to |
|---|---|
| `FASTEDGE_VAR_ENV_<NAME>` | `getEnv("<NAME>")` |
| `FASTEDGE_VAR_SECRET_<NAME>` | `getSecret("<NAME>")` |

Create `fixtures/.env` for local testing:

```
FASTEDGE_VAR_ENV_USERNAME=my-username
FASTEDGE_VAR_SECRET_PASSWORD=my-password
```

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

Build output:

| File | Description |
|---|---|
| `build/variablesAndSecrets.wasm` | Optimised release binary — upload this to FastEdge |
| `build/variablesAndSecrets-debug.wasm` | Debug binary with source maps |

---

## Deployment Configuration

Set the following on your FastEdge application:

| Name | Type | Description |
|---|---|---|
| `USERNAME` | Environment variable | The username value to forward upstream |
| `PASSWORD` | Secret | The password value to forward upstream |

Upload `build/variablesAndSecrets.wasm` to the FastEdge portal and attach it to your CDN application. Configure the `USERNAME` environment variable and the `PASSWORD` secret in the application settings.

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

## Source Material

### FILE: examples/variablesAndSecrets/assembly/index.ts

```ts
export * from "@gcoredev/proxy-wasm-sdk-as/assembly/proxy"; // this exports the required functions for the proxy to interact with us.
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
    setLogLevel(LogLevelValues.info);
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
    log(LogLevelValues.info, "PASSWORD: [set, length " + password.length.toString() + "]");

    stream_context.headers.request.add("x-env-username", username);
    stream_context.headers.request.add("x-env-password", password);

    return FilterHeadersStatusValues.Continue;
  }
}

registerRootContext((context_id: u32) => {
  return new VariablesRoot(context_id);
}, "variablesAndSecrets");
```


### FILE: examples/variablesAndSecrets/package.json

```json
{
  "name": "fastedge-as-example-variables-and-secrets",
  "version": "0.0.1",
  "description": "FastEdge AssemblyScript example: Variables and Secrets",
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


### FILE: examples/variablesAndSecrets/README.md

```
[← Back to examples](../README.md)

# Variables and Secrets

This application demonstrates reading environment variables and secrets, then forwarding their values as request headers to the upstream.

## What it does

In `onRequestHeaders`, the app:

1. Reads the `USERNAME` environment variable using `getEnv`.
2. Reads the `PASSWORD` secret using `getSecret`.
3. Logs that both values were retrieved (without logging the secret value itself).
4. Injects them as `x-env-username` and `x-env-password` request headers so the upstream receives them.

This is useful as a reference for understanding how to access environment variables and secrets within a FastEdge plugin.

> **Security warning:** Never log secret values verbatim in production. Logs are often persisted and accessible to operators who should not see credential values. This example logs the secret's length rather than its content. Similarly, be deliberate about which upstream systems receive secret values via forwarded headers — limit forwarding to systems that need it.

## Configuration

Set the following on your FastEdge application:

| Name       | Type                 | Description                            |
| ---------- | -------------------- | -------------------------------------- |
| `USERNAME` | Environment variable | The username value to forward upstream |
| `PASSWORD` | Secret               | The password value to forward upstream |

## Local testing

The fixture at `fixtures/happy-path.test.json` uses `"dotenv": {"enabled": true}` to load values from `fixtures/.env`. The runner maps `FASTEDGE_VAR_ENV_<NAME>` to `getEnv("NAME")` and `FASTEDGE_VAR_SECRET_<NAME>` to `getSecret("NAME")`.

To test locally with the visual debugger, create `fixtures/.env`:

```
FASTEDGE_VAR_ENV_USERNAME=my-username
FASTEDGE_VAR_SECRET_PASSWORD=my-password
```

## Build

```sh
pnpm install
pnpm run asbuild
```

Build output:

| File                                   | Description                                        |
| -------------------------------------- | -------------------------------------------------- |
| `build/variablesAndSecrets.wasm`       | Optimised release binary — upload this to FastEdge |
| `build/variablesAndSecrets-debug.wasm` | Debug binary with source maps                      |

## Deploy

Upload `build/variablesAndSecrets.wasm` to the [FastEdge portal](https://portal.gcore.com) and attach it to your CDN application. Configure the `USERNAME` environment variable and the `PASSWORD` secret in the application settings.
```
