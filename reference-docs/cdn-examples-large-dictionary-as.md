<!--
  auto-updated: true
  sources:
    - id: proxy-wasm-sdk-as
      ref: master
      commit: 60f25c7bd35564e5bafb421be7f37aa4acf1bf81
      updated: 2026-05-20
-->

# Large Dictionary — AssemblyScript (CDN)

## Overview

Demonstrates reading large environment variables (exceeding the 64 KB WASI limit) using `getDictionary` from the proxy-wasm dictionary API. Useful for large JSON configs, PEM certificates, and policy documents that cannot be passed via standard WASI environment variables.

## API Reference

### `getDictionary(name: string): string`

**Import:** `@gcoredev/proxy-wasm-sdk-as/assembly/fastedge`

Reads a named environment variable via `proxy_dictionary_get`, bypassing the 64 KB WASI environment variable size limit.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Environment variable name |

**Returns:** `string` — the variable value, or an empty string (`""`) if not found.

**Constraints and behavior:**
- No error variant — a missing key returns `""` (empty string), not `null`
- The returned value is an AssemblyScript `string` (UTF-16); decoding is handled by the SDK
- Values can be megabytes in size — do not log the full payload
- No try/catch needed; there is no exception path

### `getDictionary` vs `getEnv`

| Function | Use when |
|----------|----------|
| `getEnv(name)` | Variable value is under 64 KB (most cases) — uses standard WASI env interface, lower overhead |
| `getDictionary(name)` | Variable value may exceed the 64 KB WASI env var size limit |

Prefer `getEnv` for normal-sized variables. Use `getDictionary` only when values may exceed 64 KB.

## Pattern: Read in `onRequestHeaders`

```typescript
import {
  getDictionary,
  setLogLevel,
} from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";
import {
  Context,
  FilterHeadersStatusValues,
  log,
  LogLevelValues,
  registerRootContext,
  RootContext,
  stream_context,
} from "@gcoredev/proxy-wasm-sdk-as/assembly";

class LargeDictionaryRoot extends RootContext {
  createContext(context_id: u32): Context {
    setLogLevel(LogLevelValues.info);
    return new LargeDictionaryContext(context_id, this);
  }
}

class LargeDictionaryContext extends Context {
  constructor(context_id: u32, root_context: LargeDictionaryRoot) {
    super(context_id, root_context);
  }

  onRequestHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues {
    const config = getDictionary("LARGE_CONFIG");
    // Check for missing key — returns empty string, not null
    const size = config.length;
    log(LogLevelValues.info, "LARGE_CONFIG size: " + size.toString() + " bytes");
    stream_context.headers.request.add("x-config-size", size.toString());
    return FilterHeadersStatusValues.Continue;
  }
}

registerRootContext((context_id: u32) => {
  return new LargeDictionaryRoot(context_id);
}, "largeDictionary");
```

## Environment Variables

| Name | Type | Description |
|------|------|-------------|
| `LARGE_CONFIG` | Environment variable | Large configuration payload (e.g. JSON, PEM certificate). Set in FastEdge application settings. |

## Build

**Package manager:** pnpm (or npm)

**Scripts:**

| Script | Output |
|--------|--------|
| `pnpm run asbuild` | Builds both debug and release binaries |
| `pnpm run asbuild:release` | Release binary only |
| `pnpm run asbuild:debug` | Debug binary with source maps |

**Build outputs:**

| File | Description |
|------|-------------|
| `build/largeDictionary.wasm` | Optimised release binary — upload to FastEdge |
| `build/largeDictionary-debug.wasm` | Debug binary with source maps |

**Dependencies:**

| Package | Role |
|---------|------|
| `@gcoredev/proxy-wasm-sdk-as` `^1.2.3` | SDK providing `getDictionary`, `getEnv`, proxy-wasm hooks |
| `assemblyscript` `^0.28.9` | AssemblyScript compiler |
| `@assemblyscript/wasi-shim` `^0.1.0` | WASI shim for AssemblyScript |

## Deployment

Upload `build/largeDictionary.wasm` to the FastEdge portal and attach it to your CDN application. Configure the `LARGE_CONFIG` environment variable in the application settings.

## Gotchas

- **Empty string, not null:** Always check `config.length === 0` or `config === ""` to detect a missing key — there is no null or error return.
- **Do not log full payload:** Values can be megabytes. Log size or a summary only (`config.length`, a hash, or a prefix).
- **AssemblyScript string is UTF-16:** The SDK decodes the raw bytes. Treat the return value as a standard AS string.
- **No exception path:** `getDictionary` never throws. No try/catch is needed.
- **Overhead:** `getDictionary` calls `proxy_dictionary_get` (a host function); for small variables, `getEnv` has lower overhead.

## See Also

- `getEnv` — standard WASI environment variable access (under 64 KB)
- proxy-wasm-sdk-as SDK reference — full list of imports from `@gcoredev/proxy-wasm-sdk-as/assembly` and `@gcoredev/proxy-wasm-sdk-as/assembly/fastedge`
- FastEdge CDN app examples (other concepts) — additional CDN app patterns in the fastedge-docs reference
