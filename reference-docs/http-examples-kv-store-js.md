<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-js
      ref: main
      commit: 81145a9a43ec499240c687bd49376ab20c72b11c
      updated: 2026-08-17
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

| `action`   | Required params              | KvStoreInstance method called          |
|------------|------------------------------|----------------------------------------|
| `get`      | `store`, `key`               | `kvStore.get(key)`                     |
| `scan`     | `store`, `match`             | `kvStore.scan(match)`                  |
| `zrange`   | `store`, `key`, `min`, `max` | `kvStore.zrangeByScore(key, min, max)` |
| `zscan`    | `store`, `key`, `match`      | `kvStore.zscan(key, match)`            |
| `bfExists` | `store`, `key`, `item`       | `kvStore.bfExists(key, item)`          |

Default action when `action` param is absent: `get`.

---

### Parameter Validation

Validation is performed by `validateQueryParams(queryParams: URLSearchParams)` in `utils.ts`. It returns a `Params` object with either all required fields populated or an `error` field set.

- `action` defaults to `'get'` if not provided.
- `store` is required for all actions.
- `key` is required for: `get`, `zrange`, `zscan`, `bfExists`.
- `match` is required for: `scan`, `zscan`.
- `min` and `max` are required for: `zrange`.
- `item` is required for: `bfExists`.

**Type definitions (from `utils.ts`):**
```ts
const ALL_ACTIONS = ['get', 'scan', 'zscan', 'zrange', 'bfExists'] as const;
export type Action = (typeof ALL_ACTIONS)[number];
type ParamKey = 'action' | 'store' | 'key' | 'match' | 'min' | 'max' | 'item' | 'error';
type Params = { [key in ParamKey]: string };
```

---

### Error Handling

- If `action` is not one of the supported values, returns HTTP 500 with `{ error: "Invalid action '...'. Supported actions are: get, scan, zscan, zrange, bfExists" }`.
- If any required query parameter for the selected action is missing or empty, returns HTTP 500 with `{ error: "Query parameters must provide '<param>' for a '<action>' action." }`.
- All unhandled exceptions are caught and returned as HTTP 500 with `{ error: "<message>" }`.

---

### Response Shape

The success response is a JSON object with the following fields (present fields depend on action):

| Field      | Type     | Always present | Description                              |
|------------|----------|----------------|------------------------------------------|
| `Store`    | `string` | Yes            | Name of the KV store used                |
| `Action`   | `string` | Yes            | Action that was executed                 |
| `Key`      | `string` | When used      | Key parameter                            |
| `Match`    | `string` | When used      | Match pattern parameter                  |
| `Min`      | `string` | When used      | Min score parameter (zrange)             |
| `Max`      | `string` | When used      | Max score parameter (zrange)             |
| `Item`     | `string` | When used      | Item parameter (bfExists)                |
| `Response` | `string` | Yes            | Stringified result of the KV operation   |

For `zrangeByScore` and `zscan`, `Response` is formatted as: `[{ Value: <decoded>, Score: <number> }, ...]`.

---

### Full Event Handler Pattern

```ts
import { KvStore } from 'fastedge::kv';
import { Action, decodeValueArray, stringifyValueScoreTuples, validateQueryParams } from './utils';

async function eventHandler(event: FetchEvent): Promise<Response> {
  try {
    const { request: req } = event;
    const url = new URL(req.url);

    const params = validateQueryParams(url.searchParams);
    if (params.error) {
      throw new Error(params.error);
    }

    const myStore = KvStore.open(params.store);
    const action = params.action as Action;

    const responseObj: Record<string, string> = {
      Store: params.store,
      Action: action,
    };

    switch (action) {
      case 'get': {
        const response = myStore.get(params.key);
        responseObj.Key = params.key;
        responseObj.Response = decodeValueArray(response);
        break;
      }
      case 'scan': {
        const response = myStore.scan(params.match);
        responseObj.Match = params.match;
        responseObj.Response = response.join(', ');
        break;
      }
      case 'zrange': {
        const { key, min, max } = params;
        const response = myStore.zrangeByScore(key, Number.parseFloat(min), Number.parseFloat(max));
        responseObj.Key = key;
        responseObj.Min = min;
        responseObj.Max = max;
        responseObj.Response = stringifyValueScoreTuples(response);
        break;
      }
      case 'zscan': {
        const { key, match } = params;
        const response = myStore.zscan(key, match);
        responseObj.Key = key;
        responseObj.Match = match;
        responseObj.Response = stringifyValueScoreTuples(response);
        break;
      }
      case 'bfExists': {
        const { key, item } = params;
        const exists = myStore.bfExists(key, item);
        responseObj.Key = key;
        responseObj.Item = item;
        responseObj.Response = exists ? 'true' : 'false';
        break;
      }
      default:
        break;
    }

    return Response.json(responseObj);
  } catch (error: Error | unknown) {
    return Response.json({ error: `${(error as Error).message}` }, { status: 500 });
  }
}

addEventListener('fetch', (event: FetchEvent) => {
  event.respondWith(eventHandler(event));
});
```

---

### Utility Functions

#### `decodeValueArray(arrVal: ArrayBuffer | null): string`

Decodes an `ArrayBuffer` to a UTF-8 string. Returns `''` if `arrVal` is `null`.

```ts
export const decodeValueArray = (arrVal: ArrayBuffer | null) => {
  if (arrVal) {
    const decoder = new TextDecoder();
    return decoder.decode(arrVal);
  }
  return '';
};
```

#### `stringifyValueScoreTuples(tupleList: Array<[ArrayBuffer, number]>): string`

Formats sorted-set result tuples as a string: `[{ Value: <decoded>, Score: <number> }, ...]`.

```ts
export const stringifyValueScoreTuples = (tupleList: Array<[ArrayBuffer, number]>): string => {
  let strResponse = '[';
  for (const tuple of tupleList) {
    strResponse += `{ Value: ${decodeValueArray(tuple[0])}, Score: ${tuple[1]} }, `;
  }
  strResponse += ']';
  return strResponse;
};
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
  "dependencies": { "@gcoredev/fastedge-sdk-js": "^2.3.0" }
}
```

**`tsconfig.json` key options**
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "lib": ["ES2023"],
    "types": ["@gcoredev/fastedge-sdk-js"]
  },
  "include": ["src/**/*"],
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
- The SDK dependency version is `^2.3.0`.
- `tsconfig.json` `target` is `ES2023`; `moduleResolution` is `Bundler`; `lib` is `["ES2023"]`; `types` is `["@gcoredev/fastedge-sdk-js"]`.
- Empty string values for required query parameters are treated as missing — validation rejects them the same as absent params.
