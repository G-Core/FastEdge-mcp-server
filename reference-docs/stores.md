<!--
  auto-updated: true
  sources:
    - id: fastedge-test
      ref: v0.3.1
      commit: ccc68985ba8dcb688c077c04f2a3762ee34f944d
      updated: 2026-11-23
-->

# Stores — `@gcoredev/fastedge-test`

Local cache and Edge KV behavior in the test framework: seeding, inspection, and test usage.

## Overview

CDN apps (`proxy_cache_*`, `proxy_kv_store_*`) and HTTP apps (via `fastedge-run`) share the same local cache and Edge KV. A value written by an app in one hook, or loaded from a fixture, is visible to every app using the same storage service.

| Store   | Scope | Writable by apps | Seeded from |
|---------|-------|-----------------|-------------|
| Cache   | One bucket per `dc` (edge location) | Yes | `fixtures/stores/cache/<dc>.json` |
| Edge KV | Every runner and debugger using the same storage service, by store name | No (read-only) | `fixtures/stores/kv/<store>.json` |

**Cache bucket selection** (order of precedence):
1. The `dc` set on the test config or runner.
2. The `dc` of the `edge` request context.
3. The `dc` passed to `createStores()`.
4. `"local"` (fallback).

The bucket is fixed when the app loads. Cache keys are scoped by `dc` only: the same key in two buckets is two separate entries.

**Edge KV store access:** Apps open a KV store by name. A store exists locally when it has a fixture or was created in the Storage Explorer. Opening any other name fails the same way an unattached store fails on the edge (`AccessDenied` in the SDKs).

**When stores are disabled** (`stores: false` or the service cannot start): store functions still link; every call returns `InternalFailure`; the first call in a hook logs `[host] stores are off: ...`.

## Where the Data Lives

The package runs one storage service per **stores root**. Every debugger server and every test process resolving to the same root connects to the same service and shares one cache, one set of KV stores, and one clock.

**Stores root resolution order:**
1. The `FASTEDGE_STORES_ROOT` environment variable, if set.
2. The nearest ancestor folder containing `.git`. Sibling app folders in one repository share their stores.
3. The app folder itself.

| Variable | Type | Effect |
|----------|------|--------|
| `FASTEDGE_STORES_ROOT` | `string` | Overrides the stores root. Fixtures load from `<root>/fixtures/stores/` |
| `WORKSPACE_PATH` | `string` | Starting folder for root lookup in `createStores()` when `FASTEDGE_APP_ROOT` is unset, before the process working directory |

**Service lifecycle:**
- The first client starts the service as a detached process. Later clients find it via its descriptor file (`service.json`) and join it.
- A lock file (`service.lock`) makes simultaneous starters agree on one service. A log file (`service.log`) records start-up failures. These files are written into a folder the package manages for the stores root.
- Each client holds a lease and renews it. The service exits when the last lease expires.
- If the service dies while clients are connected, the next renewal restarts it on the same port with the same token. A running `fastedge-run` process keeps working at the old address.
- Edits made at runtime (via Storage Explorer or an app) live in the service until it restarts or is reset. Save them as fixtures to persist them.
- If another `fastedge-test` version speaks a different service protocol on the same root, startup fails with a message naming the process to stop.

Test stores created with `createStores()` do not use the shared service (see Stores in Tests).

## Seeding with Fixtures

Fixtures are JSON files under `<stores root>/fixtures/stores/`.

**Load triggers:**
- When the service starts.
- When you reset from the Storage Explorer.
- When `createStores()` creates or resets an instance.

**File layout:**
```
fixtures/stores/kv/<store>.json     one file per Edge KV store; file name = store name
fixtures/stores/cache/<dc>.json     one file per cache bucket; file name = dc
```

A value or sorted-set member is a UTF-8 string, or `{ "base64": "..." }` for binary data. Base64 must be well-formed; an invalid value is a load error that names the file and key.

### Edge KV Fixture Format

```json
{
  "strings": {
    "greeting": "hello",
    "logo": { "base64": "iVBORw0KGgo=" }
  },
  "zsets": {
    "leaderboard": [["alice", 120], ["bob", 95.5]]
  },
  "bloom": {
    "seen-ids": ["a1", "b2", "c3"]
  }
}
```

| Section | Shape | Notes |
|---------|-------|-------|
| `strings` | `{ [key: string]: Value }` | Values cannot be empty: the edge API refuses them |
| `zsets` | `{ [key: string]: [Value, number][] }` | Pairs of `[member, score]` |
| `bloom` | `{ [key: string]: string[] }` | Items are plain strings; stored as an exact set |

`Value` is `string | { base64: string }`. All three sections are optional.

KV is read-only to apps. KV fixtures **replace all KV data** when loaded. Stores or keys not in a fixture are gone after a load or reset.

### Cache Fixture Format

```json
{
  "session:42": { "value": "active", "ttl_ms": 60000 },
  "avatar:42": { "base64": "iVBORw0KGgo=" }
}
```

| Field | Type | Notes |
|-------|------|-------|
| `value` | `string` | UTF-8 text. Cache values may be empty |
| `base64` | `string` | Binary value; used instead of `value` |
| `ttl_ms` | `number` (non-negative integer) | Optional. Omitted means default TTL, counted from load time |

Cache fixtures **overwrite their keys** with a fresh TTL and leave other cached entries alone.

### Load Errors

A malformed file (invalid JSON, wrong shape, empty KV string, negative or non-integer `ttl_ms`, invalid base64) is an error that names the file and the offending key. Nothing partial is loaded silently.

## Time and Expiry

Cache TTLs run on one service clock shared by every runner and debugger on the same storage service. Advancing the clock moves expiry for HTTP and CDN apps together.

**TTL rules:**
- Default TTL: 4 days. Maximum TTL: 4 days. A larger TTL is clamped.
- `set` with TTL 0 uses the default TTL.
- A negative TTL is `BadArgument`.
- `expire` with a negative TTL applies the default TTL.
- `expire` on a missing key returns `false`.
- `incr` accepts canonical decimal `i64` values only. An existing key keeps its TTL.
- Pausing the clock stops it; it then moves only when explicitly advanced. This makes expiry deterministic.

**Ways to move the clock:**

| Where | How |
|-------|-----|
| Storage Explorer | The Clock group: pause or resume, and advance buttons |
| REST API | Clock routes (see the API reference) |
| Tests | `stores.advanceClock(ms)` and `stores.pauseClock(paused?)` on a `createStores()` instance |

## Storage Trace

For each request, the service records every cache and Edge KV call the app makes, in order, with the result. Values are not recorded, only their size.

| Field | Type | Description |
|-------|------|-------------|
| `app` | `"cdn" \| "http"` | Kind of app that made the call |
| `hook` | `string` (optional) | CDN hook that made the call |
| `kind` | `"cache" \| "kv"` | Which store |
| `op` | `string` | Operation, e.g. `get` or `set` |
| `dc` | `string` (optional) | Cache bucket, on cache calls |
| `store` | `string` (optional) | Edge KV store, on KV calls |
| `key` | `string` (optional) | Key |
| `pattern` | `string` (optional) | Glob pattern, on `scan` and `zscan` |
| `prefix` | `string` (optional) | Prefix, on `purge-prefix` |
| `result` | `string` | `ok`, or the service error such as `wrong-type` or `invalid-pattern` |
| `value` | `string` (optional) | A count, a flag, `missing` for a missed `get`, or the size of a value or list (`12 bytes`, `3 items`) |
| `at` | `number` | Wall-clock time in milliseconds since the epoch |

The trace appears in each hook's result and in `storeCalls` on the request's results (see the TEST_FRAMEWORK and RUNNER references for result types, and WEBSOCKET for debugger events). The service retains the most recent 5000 traced calls and drops the oldest.

## Storage Explorer

The Storage Explorer is a page of the debugger. It works with or without an app loaded and shows data of the connected storage service.

**Edge KV tab:**
- Lists stores with key counts.
- Each key shows type (`string`, `zset`, `bloom`) and size; expand to see value.
- Operations: add a key (string value optionally base64; sorted set as one `score member` per line; bloom filter as one item per line), edit a key in place (a value that is cut off or binary cannot be edited — replace it with the same key), delete a key, create or delete a whole store, import JSON (fixture format or plain object of key → value; non-string values stored as JSON text; optionally replace store keys).

**Cache tab:**
- Shows entries of one `dc` bucket with size and remaining TTL.
- A selector lists known buckets, including the loaded app's own, and accepts any other `dc`.
- Operations: add an entry (with optional TTL and base64), change an entry's TTL, delete an entry.

**Clock:** Pause or resume the clock; advance it.

**Reset:** Returns to fixture files. Every cache bucket is emptied and Edge KV is re-seeded. Unsaved KV edits are lost.

**Refresh:** Reloads the view from the service.

A store created in the Explorer is available to a loaded HTTP app after it reloads, which happens when you return to the Debugger page.

### Save to Fixtures

Save writes the current Edge KV data to `fixtures/stores/kv/<store>.json` files.

**Behavior:**
- Shows a line diff per file with status (new, changed, or deleted) before writing.
- New and changed files start selected; deletions are opt-in.
- Keys are written sorted.
- A value is written as plain text when it is valid UTF-8, and as `{ "base64": "..." }` otherwise.
- Cache entries are not saved.
- The save writes only what the diff showed. If the data changed since you opened the diff, the save is refused and you must reopen the diff.

## Stores in Tests

By default, each test gets its own isolated stores: an in-memory storage service inside the test process, with no detached process, lock, or lease. It is seeded from `fixtures/stores/` and dropped when the test ends. Tests cannot see each other's cache writes, and the debugger's service is not touched.

| Option | Effect |
|--------|--------|
| default | A fresh instance per test, seeded from `fixtures/stores/`, passed as `context.stores` |
| `runnerConfig.stores` | Use the instance you give (shared by every runner given it); `false` turns stores off |
| `stores: false` | `context.stores` is `null` |

The `createStores()` options, `TestStores` methods, and `stores` field types are defined in the TEST_FRAMEWORK and TEST_CONFIG references.

**`TestStores` capabilities:** read, write, and delete cache entries directly; add data in fixture formats via `seed`; advance or pause the clock; `reset()` to fixtures; `close()`.

**Example — cache expiry test:**

```typescript
import { defineTestSuite, runFlow } from "@gcoredev/fastedge-test/test";

export default defineTestSuite({
  wasmPath: "./build/app.wasm",
  tests: [
    {
      name: "serves the cached value until it expires",
      run: async (runner, { stores }) => {
        if (!stores) throw new Error("stores are off");

        // Seed the cache, then run a request through the app.
        stores.seed({
          cache: { local: { "page:/home": { value: "<h1>cached</h1>", ttl_ms: 1000 } } },
        });
        await runFlow(runner, { url: "https://example.com/home" });

        // The app has not changed the entry yet.
        if (stores.cache.get("page:/home") !== "<h1>cached</h1>") {
          throw new Error("expected the seeded entry");
        }

        // Move the shared clock past the TTL: the entry is gone.
        stores.advanceClock(2000);
        if (stores.cache.get("page:/home") !== null) {
          throw new Error("expected the entry to have expired");
        }
      },
    },
  ],
});
```

**Sharing stores across runners:** To share one instance between several runners (e.g. a CDN app and an HTTP app exchanging data through the cache), create it with `createStores()`, pass it as `runnerConfig.stores`, and call `close()` when done.

## Local KV and a Real KV Store

A local KV fixture and a real Edge KV store hold the same kind of data, so data can be moved between them via the Gcore API. Base URL: `https://api.gcore.com/fastedge/v1`. These steps use the API directly; the package does not call it.

### Export a Real Store into a Fixture

1. `GET /kv` — lists stores (`id`, `name`). The `name` is the fixture file name.
2. `GET /kv/{store_id}/data` — lists entries: `key`, `datatype` (`kv`, `sorted_set`, or `bloom_filter`); for `kv`, a `payload` with `value` and `encoding`.
3. `GET /kv/{store_id}/data/{key}` — reads one entry in full. Use for sorted sets and bloom filters (the list does not carry their contents).

**Datatype mapping:**

| API `datatype` | Fixture section |
|----------------|-----------------|
| `kv` | `strings` |
| `sorted_set` | `zsets` |
| `bloom_filter` | `bloom` |

**Encoding mapping for `kv` entries:**

| `encoding` | Fixture value |
|------------|---------------|
| `plain` | the string as is |
| `base64` | `{ "base64": "..." }` |
| `masked` | cannot be exported: the API does not return the value |
| `sha256` | cannot be exported: the API returns a hash, not the value |

### Seed a Real Store from a Fixture

`PUT /kv/{store_id}/data` takes an array of operations:

```json
[
  { "op": "add", "key": "greeting", "datatype": "kv", "payload": { "value": "hello", "encoding": "plain" } }
]
```

For `kv` entries the payload is `{ "value", "encoding" }`; use `"encoding": "base64"` for a `{ "base64": "..." }` fixture value. For sorted sets and bloom filters, write one entry in the Gcore portal or API, read it back with `GET /kv/{store_id}/data/{key}`, and copy that shape: the read shape mirrors the write shape.

### Attach the Store to the App

On the edge, an app reads a store only when the store is attached to it. Attach it on the app (`PUT /apps/{app_id}`), keyed by the name the app opens:

```json
{ "stores": { "<name>": { "id": 123 } } }
```

Locally there is no attachment: every store with a fixture is open to every app.

### Limits

- Edge KV values cannot be empty, on the edge or in a fixture.
- The cache cannot be seeded on the edge. Cache fixtures exist only for local runs.

## Differences from the Edge

| Behavior | Edge | Local |
|----------|------|-------|
| Cache key scope | Per account and `dc` | Per `dc` only (one service = one account) |
| `incr` on a missing key | New key has no TTL; survives `purge` until server restart | Gets the default TTL; can be purged |
| Bloom filters | Probabilistic; false positives possible | Exact set; no false positives |
| Store attachment | App opens only attached stores | Every app opens every store with a fixture, including each app of a resource |
| Service restart | CDN runners follow on new port | CDN runners follow; a running `fastedge-run` keeps old address until its runner reloads |
| `dc` visibility | App sees only its own location's cache | Debugger on a shared service sees every `dc` bucket that has data |

## See Also

- TEST_FRAMEWORK — `createStores()`, `TestStores`, and test suites
- TEST_CONFIG — the `stores` and `dc` fields of the test config
- RUNNER — runner configuration and results
- API — stores and clock REST routes
- WEBSOCKET — debugger events
