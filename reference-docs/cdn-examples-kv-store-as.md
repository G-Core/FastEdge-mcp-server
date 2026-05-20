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
languages: [assemblyscript]
capabilities: [kv-store, sorted-sets, bloom-filter, query-routing]
---

# KV Store — AssemblyScript CDN Example

## Purpose

Demonstrates reading from a FastEdge KV Store within a CDN app lifecycle hook. Supports five access patterns driven by URL query parameters: key lookup, key-pattern scan, sorted-set range query, sorted-set pattern scan, and Bloom filter existence check. Results are returned as a JSON response body.

## Package

```
examples/kvStore/
├── assembly/index.ts   — main app logic
├── assembly/utils.ts   — query param parsing and response formatting helpers
└── package.json        — build configuration
```

**Package name**: `fastedge-as-example-kvstore`  
**SDK dependency**: `@gcoredev/proxy-wasm-sdk-as` (workspace local)

---

## Imports

```typescript
// Core proxy-wasm lifecycle
import {
  Context,
  FilterDataStatusValues,
  FilterHeadersStatusValues,
  log,
  LogLevelValues,
  registerRootContext,
  RootContext,
  stream_context,
  set_property,
  set_buffer_bytes,
  BufferTypeValues,
  get_property,
} from "@gcoredev/proxy-wasm-sdk-as/assembly";

// FastEdge KV Store API
import {
  KvStore,
  setLogLevel,
} from "@gcoredev/proxy-wasm-sdk-as/assembly/fastedge";

// Internal helpers
import {
  stringifyMap,
  stringifyValueScoreTuples,
  validateQueryParams,
} from "./utils";
```

---

## KvStore API

### `KvStore.open(name: string): KvStore | null`

Opens a named KV Store attached to the application.

- `name`: store name as configured on the FastEdge application
- Returns `KvStore` instance on success, `null` if the store cannot be opened
- Must be called from within a lifecycle hook (e.g., `onResponseBody`)

### `KvStore.get(key: string): ArrayBuffer | null`

Fetches a single value by key.

- Returns `ArrayBuffer` containing the raw bytes on hit
- Returns `null` on miss (key not found — this is not an error condition)
- Decode with `String.UTF8.decode(storeArrBuff)` to obtain a string

### `KvStore.scan(match: string): string[]`

Scans keys matching a prefix pattern.

- `match`: glob-style pattern; must include a wildcard (e.g., `foo*`)
- Returns `string[]` of matching keys (empty array if no matches)

### `KvStore.zrangeByScore(key: string, min: f64, max: f64): ValueScoreTuple[]`

Queries a sorted set for members with scores in `[min, max]`.

- `key`: sorted set key
- `min`, `max`: score bounds (inclusive), parsed with `parseFloat`
- Returns `ValueScoreTuple[]`

### `KvStore.zscan(key: string, match: string): ValueScoreTuple[]`

Scans a sorted set for members whose value matches a pattern.

- `key`: sorted set key
- `match`: glob-style pattern (e.g., `foo*`)
- Returns `ValueScoreTuple[]`

### `KvStore.bfExists(key: string, item: string): bool`

Checks whether `item` exists in the Bloom filter stored at `key`.

- Returns `true` if the item is probably present, `false` if definitely absent

---

## ValueScoreTuple

Returned by `zrangeByScore` and `zscan`.

```typescript
// From @gcoredev/proxy-wasm-sdk-as/assembly/fastedge
class ValueScoreTuple {
  value: ArrayBuffer;  // raw bytes — decode with String.UTF8.decode(tuple.value)
  score: f64;
}
```

Stringify pattern used in this example:

```typescript
function stringifyValueScoreTuples(arr: Array<ValueScoreTuple>): string {
  // produces: "{ value: <decoded>, score: <f64> }, ..."
}
```

---

## Lifecycle Hooks

### `onResponseHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues`

Executes before the response body is processed. Prepares response headers:

- Removes `content-length` (body size changes after replacement)
- Removes `refresh` and `location` (clears redirect headers)
- Sets `transfer-encoding: Chunked`
- Sets `content-type: application/json`
- Returns `FilterHeadersStatusValues.Continue`

### `onResponseBody(body_buffer_length: usize, end_of_stream: bool): FilterDataStatusValues`

Main logic. Executes once the complete response body is buffered.

**Buffering guard**:
```typescript
if (!end_of_stream) {
  return FilterDataStatusValues.StopIterationAndBuffer;
}
```

**Execution flow**:
1. Read query string: `get_property("request.query")` → `ArrayBuffer`, decode to string
2. Validate query params via `validateQueryParams(query)` → `Map<string, string>`
3. Open store: `KvStore.open(store)` — send error response if `null`
4. Dispatch on `action` parameter
5. Serialize result map with `stringifyMap` → JSON string
6. Replace response body: `set_buffer_bytes(BufferTypeValues.HttpResponseBody, 0, body_buffer_length, encoded)`
7. Returns `FilterDataStatusValues.Continue`

**Error path**: calls `sendErrorResponse(msg, body_buffer_length)` which:
- Sets `response.status` to `545` via `set_property("response.status", ...)`
- Replaces body with `{ "error": "<msg>" }`

---

## Query Parameters

| Parameter | Type     | Required for                     | Description                                      |
|-----------|----------|----------------------------------|--------------------------------------------------|
| `store`   | `string` | all actions                      | Name of the KV Store attached to the application |
| `action`  | `string` | all (defaults to `get`)          | One of: `get`, `scan`, `zrange`, `zscan`, `bfExists` |
| `key`     | `string` | `get`, `zrange`, `zscan`, `bfExists` | Key to access in the store                   |
| `match`   | `string` | `scan`, `zscan`                  | Glob-style pattern; must include wildcard        |
| `min`     | `string` | `zrange`                         | Minimum score bound (parsed as `f64`)            |
| `max`     | `string` | `zrange`                         | Maximum score bound (parsed as `f64`)            |
| `item`    | `string` | `bfExists`                       | Item to check in the Bloom filter                |

**Example request**:
```
GET /?store=my-store&action=get&key=some-key
```

---

## Action Dispatch

```typescript
switch (action) {
  case "get": {
    const storeArrBuff = myStore.get(key);
    // null → "null (Not found)", non-null → String.UTF8.decode(storeArrBuff)
  }
  case "scan": {
    const keys = myStore.scan(match);
    // returns string[] — joined with ", "
  }
  case "zrange": {
    const tuples = myStore.zrangeByScore(key, parseFloat(min), parseFloat(max));
    // returns ValueScoreTuple[]
  }
  case "zscan": {
    const tuples = myStore.zscan(key, match);
    // returns ValueScoreTuple[]
  }
  case "bfExists": {
    const exists = myStore.bfExists(key, item);
    // returns bool → "true" | "false"
  }
}
```

---

## Response Body Format

All responses are JSON. Success example for `get`:

```json
{ "Store": "my-store", "Action": "get", "Key": "some-key", "Response": "some-value" }
```

Error response:

```json
{ "error": "<error message>" }
```

Error HTTP status: `545` (set via `response.status` property).

---

## Query Param Validation

Implemented in `utils.ts` via `validateQueryParams(queryParams: string): Map<string, string>`.

- Validates `action` is one of the five supported values
- Validates all action-specific required parameters are present and non-empty
- Returns a map with key `"error"` if validation fails; calling code checks `params.has("error")`
- Parses raw query string including URL-encoded characters (`%xx`) and `+` as space

---

## Logging

```typescript
setLogLevel(LogLevelValues.info);  // set in createContext; reduce to .trace for verbose output
log(LogLevelValues.debug, "onResponseHeaders >>");
log(LogLevelValues.debug, errorMsg);
```

---

## Build

```sh
npm install
npm run asbuild         # builds both debug and release
npm run asbuild:release # release only
```

| Output file                | Use                                  |
|----------------------------|--------------------------------------|
| `build/kvStore.wasm`       | Upload to FastEdge (release binary)  |
| `build/kvStore-debug.wasm` | Local debugging with source maps     |

---

## Deployment Requirements

- Upload `build/kvStore.wasm` to the FastEdge portal
- Attach the binary to a CDN application
- Configure and link at least one KV Store to the application under the name used in the `store` query parameter
- For Bloom filter operations (`bfExists`), the target key must contain a Bloom filter data structure
- For sorted set operations (`zrange`, `zscan`), the target key must contain a sorted set

---

## Gotchas

- `KvStore.get` returns `null` for missing keys — this is not an error; the response body will contain `"null (Not found)"`
- `KvStore.open` returns `null` if the store name is not configured on the application — results in a `545` error response
- `content-length` must be removed in `onResponseHeaders` before body replacement; failing to do so causes a mismatch
- `onResponseBody` must buffer until `end_of_stream` is `true`; return `StopIterationAndBuffer` otherwise
- `min` and `max` for `zrange` are received as strings from query params and must be parsed with `parseFloat`

---

## See Also

- KvStore API reference: see the host-services-rust reference for cross-language context on KV Store semantics
- Platform lifecycle hooks: see the platform-overview reference for CDN app execution model
- Error codes: see the error-codes reference for FastEdge status code conventions
