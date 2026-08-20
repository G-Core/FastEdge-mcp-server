<!--
  auto-updated: true
  sources:
    - id: proxy-wasm-sdk-as
      ref: master
      commit: 8e3bb621bc013a0aed7e52122066b417ad62a207
      updated: 2026-08-17
-->

# Quickstart: AssemblyScript CDN Apps on FastEdge

Build CDN filter applications that compile to WebAssembly and run on the FastEdge platform using the AssemblyScript Proxy-Wasm SDK.

---

## Prerequisites

- Node.js 18 or later
- npm or pnpm

---

## Create a New Project

```bash
mkdir my-cdn-app
cd my-cdn-app
npm init -y
```

### Install dependencies

```bash
npm install @gcoredev/proxy-wasm-sdk-as@1.2.3
npm install --save-dev assemblyscript@^0.28.9 @assemblyscript/wasi-shim@^0.1.0
```

### Add build scripts to `package.json`

```json
{
  "scripts": {
    "asbuild:debug": "asc assembly/index.ts --target debug",
    "asbuild:release": "asc assembly/index.ts --target release",
    "asbuild": "npm run asbuild:debug && npm run asbuild:release"
  }
}
```

---

## First CDN App

Create `assembly/index.ts`. The `export *` line must appear first, before all imports.

```typescript
export * from "@gcoredev/proxy-wasm-sdk-as/assembly/proxy";

import {
  Context,
  FilterDataStatusValues,
  FilterHeadersStatusValues,
  log,
  LogLevelValues,
  registerRootContext,
  RootContext,
} from "@gcoredev/proxy-wasm-sdk-as/assembly";

class HelloWorldRoot extends RootContext {
  createContext(context_id: u32): Context {
    return new HelloWorld(context_id, this);
  }
}

class HelloWorld extends Context {
  constructor(context_id: u32, root_context: HelloWorldRoot) {
    super(context_id, root_context);
  }

  onRequestHeaders(
    headers: u32,
    end_of_stream: bool,
  ): FilterHeadersStatusValues {
    log(LogLevelValues.info, "onRequestHeaders >> Hello World!");
    return FilterHeadersStatusValues.Continue;
  }

  onRequestBody(
    body_buffer_length: usize,
    end_of_stream: bool,
  ): FilterDataStatusValues {
    log(LogLevelValues.info, "onRequestBody >> Hello World!");
    return FilterDataStatusValues.Continue;
  }

  onResponseHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues {
    log(LogLevelValues.info, "onResponseHeaders >> Hello World!");
    return FilterHeadersStatusValues.Continue;
  }

  onResponseBody(
    body_buffer_length: usize,
    end_of_stream: bool,
  ): FilterDataStatusValues {
    log(LogLevelValues.info, "onResponseBody >> Hello World!");
    return FilterDataStatusValues.Continue;
  }
}

registerRootContext((context_id: u32) => {
  return new HelloWorldRoot(context_id);
}, "helloWorld");
```

### Structure map

| Part | Purpose |
|------|---------|
| `export * from ".../assembly/proxy"` | Exposes wasm entry points the host runtime calls into. Required in every app. Must be the first line. |
| `RootContext` subclass | Created once per worker. `createContext` produces a `Context` instance for each hook invocation. |
| `Context` subclass | Handles a single lifecycle hook phase. A fresh instance is created for each hook phase — instance fields do not persist across hooks (hook state isolation). |
| `registerRootContext` | Registers the root context factory with the proxy runtime. |

### Lifecycle hooks

Override any of these methods on your `Context` subclass to intercept traffic:

| Method | Signature | Called when |
|--------|-----------|-------------|
| `onRequestHeaders` | `(headers: u32, end_of_stream: bool): FilterHeadersStatusValues` | Inbound request headers arrive |
| `onRequestBody` | `(body_buffer_length: usize, end_of_stream: bool): FilterDataStatusValues` | Inbound request body chunk arrives |
| `onResponseHeaders` | `(a: u32, end_of_stream: bool): FilterHeadersStatusValues` | Outbound response headers arrive |
| `onResponseBody` | `(body_buffer_length: usize, end_of_stream: bool): FilterDataStatusValues` | Outbound response body chunk arrives |

Return `FilterHeadersStatusValues.Continue` or `FilterDataStatusValues.Continue` to pass data through unmodified.

---

## Logging

Use the SDK `log` function. `console.log` is not available in the WebAssembly environment.

```typescript
import { log, LogLevelValues } from "@gcoredev/proxy-wasm-sdk-as/assembly";

log(LogLevelValues.info, "request received");
log(LogLevelValues.warn, "unexpected header value");
log(LogLevelValues.error, "aborting request");
log(LogLevelValues.debug, "header count: " + headers.toString());
```

Log output is routed through the proxy-wasm host to stdout.

---

## Error Handling

AssemblyScript does not support `try/catch` in most contexts. Check return values instead.

`getEnv` returns an empty string when the variable is not set — check for empty string, not null:

```typescript
import {
  FilterHeadersStatusValues,
  log,
  LogLevelValues,
} from "@gcoredev/proxy-wasm-sdk-as/assembly";
import { getEnv } from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";

// inside a Context hook, e.g. onRequestHeaders
const value = getEnv("MY_VAR");
if (!value) {
  log(LogLevelValues.warn, "MY_VAR not set");
  return FilterHeadersStatusValues.Continue;
}
```

---

## Build Configuration (`asconfig.json`)

Create `asconfig.json` in your project root:

```json
{
  "extends": "./node_modules/@assemblyscript/wasi-shim/asconfig.json",
  "targets": {
    "debug": {
      "outFile": "build/my-cdn-app-debug.wasm",
      "textFile": "build/my-cdn-app-debug.wat",
      "sourceMap": true,
      "debug": true
    },
    "release": {
      "outFile": "build/my-cdn-app.wasm",
      "textFile": "build/my-cdn-app.wat",
      "sourceMap": true,
      "optimizeLevel": 3,
      "shrinkLevel": 0,
      "converge": false,
      "noAssert": false
    }
  },
  "options": {
    "bindings": "esm",
    "use": "abort=abort_proc_exit"
  }
}
```

### Required fields

| Field | Required | Description |
|-------|----------|-------------|
| `extends` (wasi-shim) | Yes | Imports WASI shim configuration for AssemblyScript compatibility with the host runtime. |
| `options.use: "abort=abort_proc_exit"` | Yes | Redirects AssemblyScript's built-in `abort` to a WASI-compatible exit. Without it, unhandled aborts will not terminate the wasm module correctly on the FastEdge host. |
| `options.bindings: "esm"` | Yes | Generates ESM JavaScript bindings alongside the wasm binary. |
| `targets.release.outFile` | Yes | Path for the compiled release wasm binary to deploy. |
| `targets.debug.outFile` | Yes | Path for the debug wasm binary with source maps. |

---

## IDE Configuration (`tsconfig.json`)

Create `tsconfig.json` in your project root:

```json
{
  "extends": "assemblyscript/std/assembly.json",
  "include": ["./**/*.ts"]
}
```

This file is consumed exclusively by your IDE or language server (VS Code, WebStorm, etc.) to recognise AssemblyScript-specific types: `u32`, `usize`, `bool`, `i32`, `f64`. Without it, editors flag these types as unknown TypeScript errors. The AssemblyScript compiler (`asc`) does not read `tsconfig.json` — build behaviour is controlled entirely by `asconfig.json`.

---

## Build

```bash
# Build release wasm (production — deploy this binary)
npm run asbuild:release

# Build debug wasm (includes source maps and debug symbols)
npm run asbuild:debug

# Build both
npm run asbuild
```

| Command | Output |
|---------|--------|
| `asbuild:release` | `build/my-cdn-app.wasm` — deploy this to FastEdge |
| `asbuild:debug` | `build/my-cdn-app-debug.wasm` — local inspection only |

---

## Next Steps

- **SDK API reference** — complete lifecycle hook signatures, `FilterHeadersStatusValues` and `FilterDataStatusValues` enums, header/body/property manipulation APIs, and all FastEdge host APIs: environment variables (`getEnv`), secrets (`getSecret`), KV store (`KvStore`), and utilities (`getCurrentTime`)
- **SDK examples directory** — standalone, buildable reference apps covering headers manipulation, geo-blocking, JWT validation, KV store queries, and more; each follows the same project structure described in this guide
