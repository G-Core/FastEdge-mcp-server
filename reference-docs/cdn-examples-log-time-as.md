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
languages: [assemblyscript]
capabilities: [logging, time]
---

# Log Time — CDN App (AssemblyScript)

Demonstrates using `getCurrentTime()` to retrieve the current timestamp and `log()` to emit structured log messages during CDN request and response processing.

---

## APIs Used

### `getCurrentTime`

```typescript
import { getCurrentTime } from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";

getCurrentTime(): u64
```

- Returns current time as a `u64` representing **milliseconds since Unix epoch**.
- Unit is milliseconds — not seconds, not nanoseconds.
- Compatible with `new Date(milliseconds)` in AssemblyScript.

---

### `log`

```typescript
import { log, LogLevelValues } from "@gcoredev/proxy-wasm-sdk-as/assembly";

log(level: LogLevelValues, message: string): void
```

- Emits a log message via the proxy-wasm host.
- Do NOT use `console.log` — it is not available in the proxy-wasm runtime.
- `LogLevelValues` members: `trace`, `debug`, `info`, `warn`, `error`, `critical`.

---

## Timestamp Formatting Pattern

```typescript
import { getCurrentTime } from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";

function getCurrentDateString(): string {
  const date = new Date(getCurrentTime());
  return date.toISOString(); // UTC ISO 8601 string, e.g. "2026-04-15T12:00:00.000Z"
}
```

- `new Date(u64)` accepts milliseconds directly.
- `toISOString()` returns UTC date in ISO 8601 format.

---

## Full Example

**Source**: `examples/logTime/assembly/index.ts`

```typescript
export * from "@gcoredev/proxy-wasm-sdk-as/assembly/proxy";
import {
  Context,
  FilterHeadersStatusValues,
  log,
  LogLevelValues,
  registerRootContext,
  RootContext,
} from "@gcoredev/proxy-wasm-sdk-as/assembly";
import { getCurrentTime } from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";

function getCurrentDateString(): string {
  const date = new Date(getCurrentTime());
  return date.toISOString();
}

class LogTimeRoot extends RootContext {
  createContext(context_id: u32): Context {
    return new LogTime(context_id, this);
  }
}

class LogTime extends Context {
  constructor(context_id: u32, root_context: LogTimeRoot) {
    super(context_id, root_context);
  }

  onRequestHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues {
    log(
      LogLevelValues.info,
      "onRequestHeaders >> currentTime: " + getCurrentDateString()
    );
    return FilterHeadersStatusValues.Continue;
  }

  onResponseHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues {
    log(
      LogLevelValues.info,
      "onResponseHeaders >> currentTime: " + getCurrentDateString()
    );
    return FilterHeadersStatusValues.Continue;
  }
}

registerRootContext((context_id: u32) => {
  return new LogTimeRoot(context_id);
}, "logtime");
```

---

## Lifecycle Hooks Used

| Hook | Trigger | Return Value |
|---|---|---|
| `onRequestHeaders` | Incoming request headers received | `FilterHeadersStatusValues.Continue` |
| `onResponseHeaders` | Upstream response headers received | `FilterHeadersStatusValues.Continue` |

- `FilterHeadersStatusValues.Continue` must be returned from header hooks to allow request/response to proceed.
- `this.context_id` is available in all `Context` methods and uniquely identifies the request context.

---

## Import Summary

| Symbol | Module |
|---|---|
| `getCurrentTime` | `@gcoredev/proxy-wasm-sdk-as/assembly/fastedge` |
| `log`, `LogLevelValues` | `@gcoredev/proxy-wasm-sdk-as/assembly` |
| `Context`, `RootContext`, `FilterHeadersStatusValues`, `registerRootContext` | `@gcoredev/proxy-wasm-sdk-as/assembly` |

Always include `export * from "@gcoredev/proxy-wasm-sdk-as/assembly/proxy"` — this exports required functions for the proxy host to interact with the WASM module.

---

## Package Configuration

**Package name**: `fastedge-as-example-logtime`

**Build scripts**:

```json
{
  "asbuild:debug": "asc assembly/index.ts --target debug",
  "asbuild:release": "asc assembly/index.ts --target release",
  "asbuild": "npm run asbuild:debug && npm run asbuild:release"
}
```

**Runtime dependency**: `@gcoredev/proxy-wasm-sdk-as`

**Dev dependencies**: `assemblyscript ^0.28.9`, `@assemblyscript/wasi-shim ^0.1.0`

---

## Gotchas

- `getCurrentTime()` returns **milliseconds**. Pass directly to `new Date()` without conversion.
- Logging uses the proxy-wasm host ABI via `log()`. `console.log` is not available and will not emit output.
- `FilterHeadersStatusValues.Continue` must be returned from header hooks to allow request/response to proceed.
- The root context plugin name (`"logtime"` in `registerRootContext`) must match the configured plugin name in the FastEdge platform.

---

## See Also

- sdk-reference-js (AssemblyScript SDK full API reference)
- platform-overview (CDN app lifecycle and hook execution model)
- best-practices (logging patterns and performance considerations)
