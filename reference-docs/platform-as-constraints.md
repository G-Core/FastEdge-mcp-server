# AssemblyScript CDN App Constraints

This document is for **agents** generating AssemblyScript code for FastEdge CDN apps. These are hard constraints — not style preferences — enforced by the AssemblyScript compiler and the WebAssembly runtime. Violating them produces code that either fails to compile or traps at runtime in production.

Read this before writing or reviewing any AssemblyScript CDN app code.

---

## No `try/catch`

AssemblyScript does not support `try/catch`. Error handling must use return values, null checks, and early returns.

```typescript
// ❌ Does not compile
try {
  const val = getEnv("KEY");
} catch (e) {
  log(LogLevelValues.info, "error");
}

// ✅ Return-value pattern
const val = getEnv("KEY");
if (val === "") {
  send_http_response(500, "error", String.UTF8.encode("misconfigured"), []);
  return FilterHeadersStatusValues.StopIteration;
}
```

---

## No closures over mutable state

AssemblyScript prohibits closures that capture mutable variables. Arrow functions and nested functions may not reference outer-scope `let` or `var` bindings.

The one allowed exception is the `registerRootContext` factory callback — it captures nothing mutable (only the constructor reference).

```typescript
// ❌ Does not compile — closes over mutable `count`
let count = 0;
const inc = () => { count++; };

// ✅ Store state in class fields instead
class MyFilter extends Context {
  private count: u32 = 0;
  onRequestHeaders(a: u32, eos: bool): FilterHeadersStatusValues {
    this.count++;
    return FilterHeadersStatusValues.Continue;
  }
}

// ✅ registerRootContext factory is always fine — captures nothing mutable
registerRootContext((context_id: u32) => new MyRoot(context_id), "my-filter");
```

---

## Explicit numeric types

Use AssemblyScript numeric types — not JavaScript's `number` or `boolean`. Using JS types produces a compiler error.

| Use this | Not this |
|----------|----------|
| `u32`, `i32`, `u64`, `i64` | `number` |
| `f32`, `f64` | `number` |
| `bool` | `boolean` |
| `usize` | `number` (for pointer/size values) |

```typescript
// ❌ Wrong — TypeScript types
onRequestHeaders(headers: number, end_of_stream: boolean): number { ... }

// ✅ Correct — AssemblyScript types
onRequestHeaders(headers: u32, end_of_stream: bool): FilterHeadersStatusValues { ... }
```

---

## Use `log()` — not `console.log`

`console.log` is not available in the WebAssembly environment. Log output must go through the proxy-wasm host via the SDK's `log` function.

```typescript
import { log, LogLevelValues } from "@gcoredev/proxy-wasm-sdk-as/assembly";
import { setLogLevel } from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";

// ❌ Silently does nothing (or crashes) — console is not available
console.log("hello");

// ✅ Routes through the proxy-wasm host to stdout
setLogLevel(LogLevelValues.info); // call once in createContext or onStart
log(LogLevelValues.info, "hello");
```

Only messages at or above the configured log level are emitted. `setLogLevel` is imported from `assembly/fastedge`, not from `assembly`.

---

## No default parameters on nested functions

AssemblyScript compiles nested functions (functions defined inside a method body) to `call_indirect` entries in the WebAssembly element table. Default parameter values are applied at **direct call sites only** — for indirect calls, unspecified argument slots receive `0` (a null pointer). Using that slot as a string or object (e.g. `.length`, `.split()`) traps with a memory access out-of-bounds error at runtime. The wasm will also crash identically in production FastEdge — this is not a test-only issue.

```typescript
// ❌ Traps at runtime — nested function defaults not applied via call_indirect
onRequestHeaders(a: u32, eos: bool): FilterHeadersStatusValues {
  function helper(key: string, code: u32, name: string = ""): void {
    log(LogLevelValues.info, name.length.toString()); // traps: name receives 0, not ""
  }
  helper("request.host", 552); // name slot receives null pointer
  return FilterHeadersStatusValues.Continue;
}

// ✅ Private class method — direct call, defaults applied correctly
class MyFilter extends Context {
  private helper(key: string, code: u32, name: string = ""): void {
    log(LogLevelValues.info, name.length.toString()); // safe
  }
  onRequestHeaders(a: u32, eos: bool): FilterHeadersStatusValues {
    this.helper("request.host", 552); // direct call — default "" applied
    return FilterHeadersStatusValues.Continue;
  }
}
```

**Fix:** promote the helper to a `private` class method, or pass all arguments explicitly at every call site.

---

## `||` does not fall back on empty strings

AssemblyScript's `||` operator compiles to a raw pointer-non-null check (`ptr != 0`), not a value-falsy check. The empty string `""` is a static non-null object — its pointer is always non-zero. This means `str || "fallback"` silently returns `""` rather than `"fallback"` when `str` is empty. No compile error, no runtime trap — just wrong behaviour.

This affects any pattern that reads from `getEnv`, `getSecret`, `get_property`, or other APIs that return `""` for missing/unset values.

```typescript
const raw = getEnv("MY_VAR"); // returns "" when unset

// ❌ Silently wrong — "" pointer is non-zero, || short-circuits and returns ""
const val = raw || "default";

// ✅ Explicit empty-string check
const val = raw === "" ? "default" : raw;
```

**Note:** The `!str` unary operator IS handled correctly — AssemblyScript calls `String.__not`, which returns `true` for both `null` and `""`. Only `||` and `&&` are affected by pointer-truthy semantics.

---

## Array higher-order methods require explicit type parameters

AssemblyScript generics are not inferred from context. `Array<T>.map`, `.filter`, `.reduce`, and similar methods require an explicit type parameter. Without it the compiler infers `void` or errors.

```typescript
const parts: Array<string> = ["a=1", "b=2"];

// ❌ Compile error or infers void — type parameter missing
const keys = parts.map(p => p.split("=")[0]);

// ✅ Explicit type parameter
const keys = parts.map<string>(p => p.split("=")[0]);
const lengths = parts.map<i32>(p => p.length);
```

---

## String concatenation does not auto-coerce numeric types

In TypeScript, `"value: " + 42` works. In AssemblyScript, concatenating a string with a non-string type (`u32`, `i32`, `bool`, etc.) does not auto-coerce — it either fails to compile or produces a pointer address as a string. Always call `.toString()` explicitly.

```typescript
const status: u32 = 200;
const count: i32 = 5;

// ❌ Produces garbage or compile error
log(LogLevelValues.info, "status: " + status);
log(LogLevelValues.info, "count: " + count);

// ✅ Explicit .toString()
log(LogLevelValues.info, "status: " + status.toString());
log(LogLevelValues.info, "count: " + count.toString());

// ✅ Template literals work correctly
log(LogLevelValues.info, `status: ${status}`);
```

---

## Use `changetype<T>` for pointer casts — not `as T`

For low-level pointer or memory casts (e.g. treating an `ArrayBuffer` as a `usize` for manual memory operations), use `changetype<T>`. Using `as T` for pointer-level reinterpretation either fails to compile or truncates/sign-extends the value incorrectly.

```typescript
// ❌ Wrong — `as usize` is a numeric conversion, not a reinterpret cast
const ptr = buf as usize;

// ✅ Correct — reinterprets the reference as a raw pointer
const ptr = changetype<usize>(buf);
```

This pattern appears in SDK internals (`malloc.ts`) and is occasionally needed when calling raw host functions directly. For normal SDK usage (getEnv, stream_context, etc.) you should not need pointer casts — if you find yourself reaching for one, check whether a higher-level SDK API covers the use case.

---

## No dynamic property access on class instances

AssemblyScript does not support `obj["key"]` for dynamic property lookup on class instances — there is no JS-style prototype chain or reflection. For dynamic key-value lookup, use `Map<string, T>` explicitly.

```typescript
class Config {
  timeout: u32 = 30;
  retries: u32 = 3;
}

// ❌ Does not compile — no dynamic property access
const cfg = new Config();
const val = cfg["timeout"];

// ✅ Use Map for dynamic lookup
const cfg = new Map<string, u32>();
cfg.set("timeout", 30);
cfg.set("retries", 3);
const val = cfg.get("timeout");
```

---

## `Map` requires primitive or value-comparable key types

AssemblyScript's `Map<K, V>` uses value equality for keys, not reference equality. Primitive keys (`string`, `u32`, `i32`, etc.) work correctly. Class instances as keys use reference identity — two separate objects with the same field values are different keys — which usually produces unexpected misses.

```typescript
// ✅ String keys — value equality, works as expected
const m = new Map<string, u32>();
m.set("DE", 1);
m.has("DE"); // true

// ⚠️ Class instance keys — reference equality only
class Country { code: string = ""; }
const m2 = new Map<Country, u32>();
const de = new Country();
de.code = "DE";
m2.set(de, 1);
const de2 = new Country();
de2.code = "DE";
m2.has(de2); // false — different object reference, even though code matches
```

For lookup by struct-like keys, extract the discriminating field as a string or integer key instead.

---

## See Also

- `sdk-reference-as.md` — API reference for `@gcoredev/proxy-wasm-sdk-as`
- `platform/best-practices.md` — agent workflow rules (confirmation discipline, scaffold-first, etc.)
