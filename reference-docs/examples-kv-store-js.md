<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-js
      ref: main
      commit: 26ae6629dd6abc3f09fc5e58afc2095f19d67436
      updated: 2026-04-09
-->

## KV Store — Example Reference

### Overview

Demonstrates usage of the `KvStore` API from `fastedge::kv` in a FastEdge edge function. Covers `get`, `scan`, `zrangeByScore`, `zscan`, and `bfExists` operations dispatched via HTTP query parameters.

---

### Import

```ts
import { KvStore } from 'fastedge::kv';
```

---

### KvStore API

#### `KvStore.open(name: string): KvStoreInstance`

Static factory method. Opens a named KV store and returns a `KvStoreInstance` bound to the given store name.

| Parameter | Type     | Required | Description           |
|-----------|----------|----------|-----------------------|
| `name`    | `string` | Yes      | Name of the KV store  |

**Returns:** `KvStoreInstance`

---

#### `kvStore.get(key: string): ArrayBuffer | null`

Retrieves the value for a key.

| Parameter | Type     | Required |
|-----------|----------|----------|
| `key`     | `string` | Yes      |

**Returns:** `ArrayBuffer | null` — raw bytes of the stored value, or `null` if the key does not exist.

**Decoding pattern:**
```ts
const decoder = new TextDecoder();
const text = arrVal ? decoder.decode(arrVal) : '';
```

---

#### `kvStore.scan(match: string): string[]`

Returns keys matching a pattern.

| Parameter | Type     | Required | Description                   |
|-----------|----------|----------|-------------------------------|
| `match`   | `string` | Yes      | Pattern to match keys against |

**Returns:** `string[]` — array of matching key names.

---

#### `kvStore.zrangeByScore(key: string, min: number, max: number): Array<[ArrayBuffer, number]>`

Returns sorted-set members with scores between `min` and `max` (inclusive).

| Parameter | Type     | Required | Description             |
|-----------|----------|----------|-------------------------|
| `key`     | `string` | Yes      | Sorted set key          |
| `min`     | `number` | Yes      | Minimum score (float)   |
| `max`     | `number` | Yes      | Maximum score (float)   |

**Returns:** `Array<[ArrayBuffer, number]>` — array of `[value, score]` tuples. Values are raw `ArrayBuffer`; decode with `TextDecoder`.

---

#### `kvStore.zscan(key: string, match: string): Array<[ArrayBuffer, number]>`

Scans a sorted set for members whose values match a pattern.

| Parameter | Type     | Required | Description                        |
|-----------|----------|----------|------------------------------------|
| `key`     | `string` | Yes      | Sorted set key                     |
| `match`   | `string` | Yes      | Pattern to match member values     |

**Returns:** `Array<[ArrayBuffer, number]>` — array of `[value, score]` tuples.

---

#### `kvStore.bfExists(key: string, item: string): boolean`

Checks membership in a Bloom filter stored at `key`.

| Parameter | Type     | Required | Description                 |
|-----------|----------|----------|-----------------------------|
| `key`     | `string` | Yes      | Bloom filter key            |
| `item`    | `string` | Yes      | Item to test for membership |

**Returns:** `boolean` — `true` if the item is likely present; `false` if definitely absent.

---

### Supported Actions (Query Parameter Dispatch)

| `action`    | Required params              | KvStoreInstance method called            |
|-------------|------------------------------|------------------------------------------|
| `get`       | `store`, `key`               | `kvStore.get(key)`                       |
| `scan`      | `store`, `match`             | `kvStore.scan(match)`                    |
| `zrange`    | `store`, `key`, `min`, `max` | `kvStore.zrangeByScore(key, min, max)`   |
| `zscan`     | `store`, `key`, `match`      | `kvStore.zscan(key, match)`              |
| `bfExists`  | `store`, `key`, `item`       | `kvStore.bfExists(key, item)`            |

Default action when `action` param is absent: `get`.

---

### Error Handling

- If `action` is not one of the supported values, returns HTTP 500 with `{ error: "Invalid action '...'. Supported actions are: get, scan, zscan, zrange, bfExists" }`.
- If any required query parameter for the selected action is missing or empty, returns HTTP 500 with `{ error: "Query parameters must provide '<param>' for a '<action>' action." }`.
- All unhandled exceptions are caught and returned as HTTP 500 with `{ error: "<message>" }`.

---

### Full Event Handler Pattern

```ts
import { KvStore } from 'fastedge::kv';

async function eventHandler(event: FetchEvent): Promise<Response> {
  try {
    const { request: req } = event;
    const url = new URL(req.url);
    const store = url.searchParams.get('store');
    const key = url.searchParams.get('key');

    const myStore = KvStore.open(store!);
    const value = myStore.get(key!);

    const decoder = new TextDecoder();
    return Response.json({ value: value ? decoder.decode(value) : null });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}

addEventListener('fetch', (event: FetchEvent) => {
  event.respondWith(eventHandler(event));
});
```

---

### Build Configuration

**`package.json`**
```json
{
  "name": "fastedge-example-kv-store",
  "version": "1.0.0",
  "description": "FastEdge JS example: KV Store operations via query params",
  "type": "module",
  "scripts": { "build": "fastedge-build -c" },
  "dependencies": { "@gcoredev/fastedge-sdk-js": "^2.1.0" }
}
```

**`tsconfig.json` key options**
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "strict": true,
    "esModuleInterop": true,
    "moduleResolution": "Node",
    "rootDir": "./",
    "noEmit": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "lib": ["ES2020", "DOM"],
    "types": ["@gcoredev/fastedge-sdk-js"]
  },
  "include": ["src/**/*", "./node_modules/@gcoredev/fastedge-sdk-js/types"],
  "exclude": ["node_modules"]
}
```

TypeScript types for FastEdge globals (`FetchEvent`, etc.) are provided by `@gcoredev/fastedge-sdk-js`.

---

### Constraints and Gotchas

- `KvStore.open()` takes a store **name** (string), not a numeric ID.
- The KV store is **read-only** from the app — there is no `set()`, `delete()`, or `list()` method. Data is written via the Gcore portal or API.
- `get()` returns `ArrayBuffer | null` — always check for `null` before decoding.
- `zrangeByScore` and `zscan` return tuples `[ArrayBuffer, number]` — values must be decoded separately with `TextDecoder`.
- `bfExists` returning `true` is probabilistic (Bloom filter); `false` is definitive.
- `min` and `max` for `zrangeByScore` are parsed from query strings with `Number.parseFloat` — ensure numeric string inputs.
- `"type": "module"` must be set in `package.json` for ESM compatibility with `fastedge-build`.
