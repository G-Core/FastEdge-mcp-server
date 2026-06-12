<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-js
      ref: main
      commit: 36cf4c4af034a19e45e5a92d06aa95adeb9b1ff9
      updated: 2026-06-11
-->

# JavaScript SDK Reference (`@gcoredev/fastedge-sdk-js`)

**Source:** `FastEdge-sdk-js` repo — `types/*.d.ts` are the authoritative API surface.

---

### Import Patterns

All FastEdge-specific modules use the `fastedge::` specifier — these are NOT Node.js module paths:

```ts
import { getEnv } from "fastedge::env";
import { getSecret, getSecretEffectiveAt } from "fastedge::secret";
import { KvStore } from "fastedge::kv";
import { Cache } from "fastedge::cache";
import { readFileSync } from "fastedge::fs";
```

Add the type reference to your entry file:

```ts
/// <reference types="@gcoredev/fastedge-sdk-js" />
```

Or in `tsconfig.json`:

```json
{ "compilerOptions": { "types": ["@gcoredev/fastedge-sdk-js"] } }
```

---

### Two Programming Models

#### Model 1: Service Worker style (`addEventListener`)

The `addEventListener` callback **must synchronously call** `event.respondWith()`. The response itself can be a Promise.

```js
addEventListener('fetch', (event) => {
  event.respondWith(handler(event));
});

async function handler(event) {
  return new Response(`Hello from ${event.request.url}`);
}
```

#### Model 2: Hono framework (`app.fire()`)

`app.fire()` connects Hono's router to FastEdge's fetch event handler. Use this for routing.

```ts
import { Hono } from "hono";

const app = new Hono();
app.get("/", (c) => c.json({ message: "Hello FastEdge!" }));
app.get("/health", (c) => c.json({ status: "ok" }));
app.post("/data", async (c) => {
  const body = await c.req.json();
  return c.json({ received: body });
});
app.fire();  // Not export default, not Deno.serve — use fire()
```

---

### Environment Variables — `fastedge::env`

Only available **during request handling**, not at build-time initialization.

| Function | Signature | Returns |
|----------|-----------|---------|
| `getEnv` | `(name: string) => string \| null` | `string \| null` |

Returns `null` if the variable is not set. Environment variables are set on the application and injected at request time.

```js
/// <reference types="@gcoredev/fastedge-sdk-js" />

import { getEnv } from "fastedge::env";

async function app(event) {
  const hostname = getEnv("HOSTNAME");
  const traceId  = getEnv("TRACE_ID");
  return new Response(`hostname=${hostname} trace=${traceId}`, { status: 200 });
}

addEventListener("fetch", event => event.respondWith(app(event)));
```

---

### Secrets — `fastedge::secret`

Only available **during request handling**, not at build-time initialization.

| Function | Signature | Returns |
|----------|-----------|---------|
| `getSecret` | `(name: string) => string \| null` | `string \| null` |
| `getSecretEffectiveAt` | `(name: string, effectiveAt: number) => string \| null` | `string \| null` |

**`getSecret`** — Returns the current value of a named secret. Returns `null` if not set.

**`getSecretEffectiveAt`** — Returns the value of a named secret from a specific slot. `effectiveAt` is a Unix timestamp (number). The slot returned is the most recent slot where `slot <= effectiveAt`. Returns `null` if not set. Use for zero-downtime secret rotation.

```js
/// <reference types="@gcoredev/fastedge-sdk-js" />

import { getSecret, getSecretEffectiveAt } from "fastedge::secret";

async function app(event) {
  const token   = getSecret("API_TOKEN");
  const slotted = getSecretEffectiveAt("API_TOKEN", 1745698356);
  return new Response("ok", { status: 200 });
}

addEventListener("fetch", event => event.respondWith(app(event)));
```

---

### KV Store — `fastedge::kv`

KV stores must be created in the Gcore portal first, then referenced by name from the application. The KV store is **read-only** from the app — there is no `set()`, `delete()`, or `list()`. `KvStore` is globally replicated with eventual consistency. For strongly-consistent, POP-local storage with atomic counter primitives, see Cache below.

```ts
import { KvStore } from "fastedge::kv";
```

#### Static Methods — `KvStore`

`new KvStore(...)` does not exist. Use the static factory method:

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `KvStore.open` | `(name: string) => KvStoreInstance` | `KvStoreInstance` | Opens a named KV store. `name` must match a store configured on the application. Throws if the store cannot be opened. |

#### KvStoreEntry

A handle to a value retrieved from the KV store. The bytes are already in memory when you receive a `KvStoreEntry`; the accessor methods return `Promise` to align with the standard Web `Body` interface, but they resolve immediately.

| Method | Signature | Returns |
|--------|-----------|---------|
| `arrayBuffer()` | `() => Promise<ArrayBuffer>` | `Promise<ArrayBuffer>` |
| `text()` | `() => Promise<string>` | `Promise<string>` |
| `json()` | `() => Promise<unknown>` | `Promise<unknown>` |

`json()` rejects with a `SyntaxError` if the bytes are not valid JSON.

#### Instance Methods — `KvStoreInstance`

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `get` | `(key: string) => ArrayBuffer \| null` | `ArrayBuffer \| null` | Get value by exact key. Returns `null` if key does not exist. **Returns `ArrayBuffer`, not string — decode explicitly.** |
| `getEntry` | `(key: string) => Promise<KvStoreEntry \| null>` | `Promise<KvStoreEntry \| null>` | Get value as a `KvStoreEntry` with `text()`, `json()`, and `arrayBuffer()` accessors. Returns `null` if key does not exist. |
| `scan` | `(pattern: string) => Array<string>` | `Array<string>` | Get keys matching prefix pattern — must include `*` wildcard. Returns empty array if no match. |
| `zrangeByScore` | `(key: string, min: number, max: number) => Array<[ArrayBuffer, number]>` | `Array<[ArrayBuffer, number]>` | Get sorted set members with scores in `[min, max]`. Each entry is a `[value, score]` tuple. Returns empty array if no match. |
| `zrangeByScoreEntries` | `(key: string, min: number, max: number) => Promise<Array<[KvStoreEntry, number]>>` | `Promise<Array<[KvStoreEntry, number]>>` | Equivalent to `zrangeByScore` but each tuple's value is a `KvStoreEntry` instead of a raw `ArrayBuffer`. |
| `zscan` | `(key: string, pattern: string) => Array<[ArrayBuffer, number]>` | `Array<[ArrayBuffer, number]>` | Get sorted set members matching value prefix pattern. Must include `*`. Each entry is a `[value, score]` tuple. Returns empty array if no match. |
| `zscanEntries` | `(key: string, pattern: string) => Promise<Array<[KvStoreEntry, number]>>` | `Promise<Array<[KvStoreEntry, number]>>` | Equivalent to `zscan` but each tuple's value is a `KvStoreEntry` instead of a raw `ArrayBuffer`. |
| `bfExists` | `(key: string, value: string) => boolean` | `boolean` | Check if value exists in Bloom Filter. Returns `true` if likely present, `false` if definitely absent. |

```js
/// <reference types="@gcoredev/fastedge-sdk-js" />

import { KvStore } from "fastedge::kv";

async function app(event) {
  try {
    const kv  = KvStore.open("my-store");

    // get — returns ArrayBuffer | null, not string
    const buf = kv.get("config");
    if (buf === null) {
      return new Response("not found", { status: 404 });
    }
    const text = new TextDecoder().decode(buf);

    // getEntry — returns KvStoreEntry | null with text/json/arrayBuffer accessors
    const entry = await kv.getEntry("user:42");
    if (entry !== null) {
      const user = await entry.json();
    }

    // scan — returns Array<string>
    const keys = kv.scan("user:*");

    // zrangeByScore — returns Array<[ArrayBuffer, number]>
    const entries = kv.zrangeByScore("leaderboard", 100, 500);
    for (const [valBuf, score] of entries) {
      const name = new TextDecoder().decode(valBuf);
      console.log(name, score);
    }

    // zscan — returns Array<[ArrayBuffer, number]>
    const matches = kv.zscan("leaderboard", "user:*");

    // bfExists — probabilistic presence check
    const seen = kv.bfExists("visited-ips", "203.0.113.42");

    return new Response(text, { status: 200 });
  } catch (err) {
    return new Response("store error", { status: 500 });
  }
}

addEventListener("fetch", event => event.respondWith(app(event)));
```

---

### Cache — `fastedge::cache`

`Cache` is a POP-local key/value store with TTL and atomic counter primitives. It is strongly consistent within a single point-of-presence and is designed for transient, request-time state: rate limiting, hit counters, response memoisation, and deduplicated origin fetches. A value written from one data center is not visible to another.

```ts
import { Cache } from "fastedge::cache";
```

**`Cache` vs `KvStore` at a glance:**

| Concern | `Cache` | `KvStore` |
|---------|---------|-----------|
| Consistency scope | Strong within a POP; independent across POPs | Eventual; globally replicated |
| Atomic operations | `incr`, `decr`, `getOrSet` coalescing | Not available |
| Typical use cases | Rate limits, counters, request coalescing | Configuration, lookup tables, sorted sets |
| Data persistence | Evicted; no durability guarantee | Durable; persists across deployments |

#### CacheValue

Values accepted by `Cache.set` and the `populate` callback of `Cache.getOrSet`:

```typescript
type CacheValue = string | ArrayBuffer | ArrayBufferView | ReadableStream | Response;
```

All forms are stored as raw bytes. `string` is encoded as UTF-8. `ReadableStream` is fully consumed before storage. `Response` — `response.arrayBuffer()` is consumed; status and headers are discarded. The cache stores bytes only. To round-trip status or headers, encode them into the value (e.g., as a JSON envelope).

#### WriteOptions

Controls how long a cache entry lives. Pass exactly one of `ttl`, `ttlMs`, or `expiresAt`. Passing more than one, or a zero or negative value, throws `TypeError`. Omitting `options` entirely stores the entry with no expiry (subject to host eviction policy).

| Field | Type | Description |
|-------|------|-------------|
| `ttl` | `number` | Relative TTL, seconds from now. Mutually exclusive with `ttlMs`, `expiresAt`. |
| `ttlMs` | `number` | Relative TTL, milliseconds from now. Mutually exclusive with `ttl`, `expiresAt`. |
| `expiresAt` | `number` | Absolute expiry, Unix epoch seconds. Mutually exclusive with `ttl`, `ttlMs`. |

#### CacheEntry

A handle to a cached value. The bytes are already in memory when you receive a `CacheEntry`; the accessor methods return `Promise` to align with the standard Web `Body` interface, but they resolve immediately.

| Method | Signature | Returns |
|--------|-----------|---------|
| `arrayBuffer()` | `() => Promise<ArrayBuffer>` | `Promise<ArrayBuffer>` |
| `text()` | `() => Promise<string>` | `Promise<string>` |
| `json()` | `() => Promise<unknown>` | `Promise<unknown>` |

`json()` rejects with a `SyntaxError` if the bytes are not valid JSON.

#### Cache Methods

All methods are static; `Cache` is never constructed. All methods return `Promise`. Operational errors surface as Promise rejections. Argument validation errors (wrong types, conflicting `WriteOptions` fields) throw synchronously; both are caught the same way by `try`/`catch` around an `await`.

| Method | Signature | Returns |
|--------|-----------|---------|
| `get(key)` | `(key: string) => Promise<CacheEntry \| null>` | `Promise<CacheEntry \| null>` |
| `exists(key)` | `(key: string) => Promise<boolean>` | `Promise<boolean>` |
| `set(key, value, options?)` | `(key: string, value: CacheValue, options?: WriteOptions) => Promise<void>` | `Promise<void>` |
| `delete(key)` | `(key: string) => Promise<void>` | `Promise<void>` |
| `expire(key, options)` | `(key: string, options: WriteOptions) => Promise<boolean>` | `Promise<boolean>` |
| `incr(key, delta?)` | `(key: string, delta?: number) => Promise<number>` | `Promise<number>` |
| `decr(key, delta?)` | `(key: string, delta?: number) => Promise<number>` | `Promise<number>` |
| `getOrSet(key, populate, options?)` | `(key: string, populate: () => CacheValue \| Promise<CacheValue>, options?: WriteOptions) => Promise<CacheEntry>` | `Promise<CacheEntry>` |
| `getOrSet(key, populate, options?)` | `(key: string, populate: () => CacheValue \| null \| Promise<CacheValue \| null>, options?: WriteOptions) => Promise<CacheEntry \| null>` | `Promise<CacheEntry \| null>` |
| `purge()` | `() => Promise<number>` | `Promise<number>` |
| `purgePrefix(prefix)` | `(prefix: string) => Promise<number>` | `Promise<number>` |

**`get`** — Returns the entry for `key`, or `null` if absent or expired.

**`exists`** — Returns `true` if `key` is present. Cheaper than `get` when you only need presence, as no value bytes are transferred.

**`set`** — Stores `value` under `key`, optionally with an expiry. Overwrites any existing value at `key`.

**`delete`** — Removes `key` from the cache. A no-op if the key does not exist.

**`expire`** — Updates the expiry of an existing key without changing its value. Resolves to `true` if the expiry was set, `false` if the key does not exist.

**`incr` / `decr`** — Atomically increment or decrement an integer stored at `key`. If the key does not exist, it is initialised to `0` before the operation. Resolves to the new value after the operation. Rejects if the stored value is not an integer. `delta` defaults to `1`. `Cache.decr` is sugar for `Cache.incr(key, -(delta ?? 1))`. `delta` may be any integer; prefer `decr` when subtracting for readability. Strong per-POP consistency makes these reliable for per-POP rate limits.

**`getOrSet`** — Returns the entry for `key`, or calls `populate` on a cache miss and stores the result. All concurrent callers for the same key within the same WASM instance share a single `populate` execution — the callback is not duplicated for joiners. Concurrent requests handled by other WASM instances race independently and may each call `populate`. If `populate` throws or its Promise rejects, the rejection propagates to all current waiters; the next call after a failure retries `populate` (no negative caching). If `populate` resolves with `null`, the value is not written to the cache and `getOrSet` resolves with `null` (skip-cache signal). Use this to wrap fallible work and only pin successes.

**`purge`** — Deletes all cache entries available to this application. The host scans the key index, removes every cached key, and clears the index. Resolves with the number of keys deleted.

**`purgePrefix`** — Deletes all cache entries whose keys begin with `prefix`. The host scans the key index for matching keys, removes them, and updates the index (the index itself is retained for any remaining keys). Resolves with the number of keys deleted.

```js
/// <reference types="@gcoredev/fastedge-sdk-js" />

import { Cache } from "fastedge::cache";

async function app(event) {
  const ip    = event.client.address;
  const key   = `rl:${ip}`;
  const count = await Cache.incr(key);

  if (count === 1) {
    await Cache.expire(key, { ttl: 60 });
  }

  if (count > 100) {
    return new Response("Too Many Requests", { status: 429 });
  }

  const url   = new URL(event.request.url);
  const entry = await Cache.getOrSet(
    `proxy:${url.pathname}`,
    async () => {
      const r = await fetch(`https://origin.example.com${url.pathname}`);
      return r.ok ? r : null;
    },
    { ttl: 30 },
  );

  if (entry === null) {
    return Response.json({ error: "upstream unavailable" }, { status: 503 });
  }

  return new Response(await entry.arrayBuffer(), {
    headers: { "content-type": "application/json" },
  });
}

addEventListener("fetch", event => event.respondWith(app(event)));
```

```js
/// <reference types="@gcoredev/fastedge-sdk-js" />

import { Cache } from "fastedge::cache";

// Purge all entries
async function purgeAll(event) {
  const deleted = await Cache.purge();
  return Response.json({ purged: deleted });
}

// Purge by prefix
async function purgeUsers(event) {
  const deleted = await Cache.purgePrefix("user:");
  return Response.json({ purged: deleted });
}
```

---

### Build-time File Embedding — `fastedge::fs`

**Only available at build-time initialization**, not during request handling. Used to embed static files into the Wasm binary.

| Function | Signature | Returns |
|----------|-----------|---------|
| `readFileSync` | `(path: string) => Uint8Array` | `Uint8Array` |

```ts
import { readFileSync } from "fastedge::fs";

// Runs at build time — embeds file bytes into the binary
const html = readFileSync("./public/index.html");  // Uint8Array
```

---

### FetchEvent

Every FastEdge application handles incoming requests by registering a listener for the `"fetch"` event.

```typescript
addEventListener("fetch", (event: FetchEvent) => void);
```

`respondWith` must be called **synchronously** within the event listener, but may be passed a `Promise<Response>`. The service is kept alive until the response is fully sent.

**`FetchEvent`:**

| Member | Type | Description |
|--------|------|-------------|
| `request` | `Request` | Incoming HTTP request from the client |
| `client` | `ClientInfo` | Downstream client info |
| `server` | `ServerInfo` | Information about the FastEdge POP handling the request |
| `respondWith(r)` | `(Response \| PromiseLike<Response>) => void` | Send response. Must be called synchronously. |
| `waitUntil(p)` | `(Promise<any>) => void` | Extend lifetime for post-response async work (e.g., logging, telemetry) |

**`ClientInfo`:**

| Property | Type | Description |
|----------|------|-------------|
| `address` | `string` | IPv4 or IPv6 address of the downstream client. Empty string if unavailable. |
| `tlsJA3MD5` | `string` | JA3 TLS-handshake fingerprint as an MD5 hex string. Empty string for non-TLS requests or when fingerprinting is unavailable. |
| `protocol` | `string` | Protocol family — `"https"` or `"http"`. Not the TLS version string. |
| `geo` | `GeoInfo` | Client geographic information. Populated lazily on first access. |

**`GeoInfo`:**

| Property | Type | Description |
|----------|------|-------------|
| `asn` | `string` | Autonomous System Number of the client's network. Empty if unavailable. |
| `latitude` | `number \| null` | Latitude in decimal degrees, or `null` if unavailable. |
| `longitude` | `number \| null` | Longitude in decimal degrees, or `null` if unavailable. |
| `region` | `string` | Region or state code (subdivision). Empty string if unavailable. |
| `continent` | `string` | Continent code (e.g. `"EU"`, `"NA"`). Empty string if unavailable. |
| `countryCode` | `string` | ISO 3166-1 alpha-2 country code (e.g. `"PT"`). Empty string if unavailable. |
| `countryName` | `string` | Country name (e.g. `"Portugal"`). Empty string if unavailable. |
| `city` | `string` | City name. Empty string when geo lookup did not resolve a city. |

**`ServerInfo`:**

| Property | Type | Description |
|----------|------|-------------|
| `address` | `string` | Server-side IP address that received the request. |
| `name` | `string` | Server hostname. |
| `pop` | `PopInfo` | POP location information. Populated lazily on first access. |

**`PopInfo`:**

| Property | Type | Description |
|----------|------|-------------|
| `latitude` | `number \| null` | POP latitude in decimal degrees, or `null` if unavailable. |
| `longitude` | `number \| null` | POP longitude in decimal degrees, or `null` if unavailable. |
| `region` | `string` | POP region or state code. Empty string if unavailable. |
| `continent` | `string` | POP continent code. Empty string if unavailable. |
| `countryCode` | `string` | ISO 3166-1 alpha-2 POP country code. Empty string if unavailable. |
| `countryName` | `string` | POP country name. Empty string if unavailable. |
| `city` | `string` | POP city. Empty string when not resolved. |

```js
/// <reference types="@gcoredev/fastedge-sdk-js" />

addEventListener("fetch", event => {
  event.respondWith(handleRequest(event));
});

async function handleRequest(event) {
  const { request, client, server } = event;

  console.log(`Request from ${client.address} in ${client.geo.city}, ${client.geo.countryCode}`);
  console.log(`Served by ${server.name} in ${server.pop.city}, ${server.pop.countryCode}`);

  event.waitUntil(
    logRequest(request.url, client.address)
  );

  return new Response("hello", { status: 200 });
}

async function logRequest(url, ip) {
  await fetch("https://logging.example.com/log", {
    method: "POST",
    body: JSON.stringify({ url, ip }),
    headers: { "content-type": "application/json" },
  });
}
```

---

### Web APIs

FastEdge runs on StarlingMonkey (SpiderMonkey-based Wasm runtime). The following standard Web APIs are available:

| API | Standard-conformant | Notes |
|-----|--------------------|----- |
| Fetch (`fetch`, `Request`, `Response`, `Headers`) | Mostly — see limitations | Incoming `request.headers` is read-only |
| URL (`URL`, `URLSearchParams`) | Yes | WHATWG URL spec |
| Streams (`ReadableStream`, `WritableStream`, `TransformStream`) | Yes | WHATWG Streams spec; includes BYOB reader, compression streams |
| Encoding (`TextEncoder`, `TextDecoder`, `atob`, `btoa`) | Yes | |
| File (`Blob`, `File`, `FormData`) | Yes | |
| Abort (`AbortController`, `AbortSignal`) | Yes | `AbortSignal.timeout`, `AbortSignal.any` supported |
| Crypto (`crypto.subtle`, `crypto.getRandomValues`, `crypto.randomUUID`) | Partial | See SubtleCrypto section |
| Timers (`setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`) | Yes | |
| Console | Partial | No format-string substitution; all args stringified and concatenated |
| Performance (`performance.now`, `performance.timeOrigin`) | Yes | |
| DOM Events (`Event`, `EventTarget`, `CustomEvent`) | Yes | Underpins FetchEvent mechanism |
| `structuredClone` | Yes | Transferable: `ArrayBuffer` |

**NOT available:** WebSocket, localStorage, sessionStorage, DOM APIs, Node.js APIs (`fs`, `path`, `process`, `node:crypto`, etc.)

---

#### Fetch API

##### `fetch`

```typescript
fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
```

Makes an outbound HTTP request. Follows the WHATWG Fetch specification.

```js
const response = await fetch("https://api.example.com/data", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ key: "value" }),
});
const data = await response.json();
```

##### `Request`

```typescript
new Request(input: RequestInfo | URL, init?: RequestInit): Request
```

| `RequestInit` field | Type | Description |
|---------------------|------|-------------|
| `method` | `string` | HTTP method. Defaults to `"GET"`. |
| `headers` | `HeadersInit` | Request headers. |
| `body` | `BodyInit \| null` | Request body. |
| `signal` | `AbortSignal \| null` | Abort signal for the request. |

| `Request` property / method | Type | Description |
|-----------------------------|------|-------------|
| `method` | `string` | HTTP method. |
| `url` | `string` | Request URL as a string. |
| `headers` | `Headers` | Request headers. Read-only on incoming requests. |
| `signal` | `AbortSignal` | Abort signal associated with this request. |
| `body` | `ReadableStream<Uint8Array> \| null` | Request body stream. |
| `bodyUsed` | `boolean` | Whether the body has already been consumed. |
| `clone()` | `() => Request` | Creates a copy of the request. |
| `text()` | `() => Promise<string>` | Reads body as a string. |
| `json()` | `() => Promise<any>` | Reads body and parses as JSON. |
| `arrayBuffer()` | `() => Promise<ArrayBuffer>` | Reads body as an `ArrayBuffer`. |
| `blob()` | `() => Promise<Blob>` | Reads body as a `Blob`. |
| `formData()` | `() => Promise<FormData>` | Reads body as `FormData`. |

##### `Response`

```typescript
new Response(body?: BodyInit | null, init?: ResponseInit): Response
Response.redirect(url: string | URL, status?: number): Response
Response.json(data: any, init?: ResponseInit): Response
```

| `ResponseInit` field | Type | Description |
|----------------------|------|-------------|
| `status` | `number` | HTTP status code. Defaults to `200`. |
| `statusText` | `string` | HTTP status text. |
| `headers` | `HeadersInit` | Response headers. |

| `Response` property / method | Type | Description |
|------------------------------|------|-------------|
| `status` | `number` | HTTP status code. |
| `statusText` | `string` | HTTP status text. |
| `ok` | `boolean` | `true` if status is in the range 200–299. |
| `redirected` | `boolean` | `true` if the response was redirected. |
| `url` | `string` | URL of the response. |
| `type` | `ResponseType` | Response type (e.g., `"basic"`, `"cors"`). |
| `headers` | `Headers` | Response headers. |
| `body` | `ReadableStream<Uint8Array> \| null` | Response body stream. |
| `bodyUsed` | `boolean` | Whether the body has already been consumed. |
| `text()` | `() => Promise<string>` | Reads body as a string. |
| `json()` | `() => Promise<any>` | Reads body and parses as JSON. |
| `arrayBuffer()` | `() => Promise<ArrayBuffer>` | Reads body as an `ArrayBuffer`. |
| `blob()` | `() => Promise<Blob>` | Reads body as a `Blob`. |
| `formData()` | `() => Promise<FormData>` | Reads body as `FormData`. |

##### `Headers`

```typescript
new Headers(init?: HeadersInit): Headers
```

`HeadersInit` accepts a `Headers` instance, a `string[][]` array of `[name, value]` pairs, or a `Record<string, string>` object.

| Method | Signature |
|--------|-----------|
| `get(name)` | `(name: string) => string \| null` |
| `has(name)` | `(name: string) => boolean` |
| `set(name, value)` | `(name: string, value: string) => void` |
| `append(name, value)` | `(name: string, value: string) => void` |
| `delete(name)` | `(name: string) => void` |
| `getSetCookie()` | `() => string[]` |
| `forEach(callback)` | `(callback: (value: string, key: string, parent: Headers) => void) => void` |
| `entries()` | `() => IterableIterator<[string, string]>` |
| `keys()` | `() => IterableIterator<string>` |
| `values()` | `() => IterableIterator<string>` |

##### Headers Immutability

The `headers` object on an incoming `event.request` is **read-only**. Calls to `append`, `set`, or `delete` will throw a `TypeError`. To modify headers, construct a new `Headers` object:

```js
const newHeaders = new Headers(event.request.headers);
newHeaders.set("x-custom", "value");

const proxied = new Request(event.request.url, {
  method: event.request.method,
  headers: newHeaders,
  body: event.request.body,
});
```

---

#### URL API

##### `URL`

```typescript
new URL(url: string, base?: string | URL): URL
```

Parses and manipulates URLs per the WHATWG URL specification.

| Property | Type | Mutable |
|----------|------|---------|
| `href` | `string` | yes |
| `origin` | `string` | no |
| `protocol` | `string` | yes |
| `username` | `string` | yes |
| `password` | `string` | yes |
| `host` | `string` | yes |
| `hostname` | `string` | yes |
| `port` | `string` | yes |
| `pathname` | `string` | yes |
| `search` | `string` | yes |
| `searchParams` | `URLSearchParams` | no |
| `hash` | `string` | yes |

```js
const url = new URL(event.request.url);
const id  = url.searchParams.get("id");
```

##### `URLSearchParams`

```typescript
new URLSearchParams(
  init?: string | ReadonlyArray<readonly [string, string]> | Iterable<readonly [string, string]> | Record<string, string>
): URLSearchParams
```

| Method | Signature |
|--------|-----------|
| `get(name)` | `(name: string) => string \| null` |
| `getAll(name)` | `(name: string) => string[]` |
| `has(name)` | `(name: string) => boolean` |
| `set(name, value)` | `(name: string, value: string) => void` |
| `append(name, value)` | `(name: string, value: string) => void` |
| `delete(name)` | `(name: string) => void` |
| `sort()` | `() => void` |
| `entries()` | `() => IterableIterator<[string, string]>` |
| `keys()` | `() => IterableIterator<string>` |
| `values()` | `() => IterableIterator<string>` |
| `forEach(callback)` | `(callback: (value: string, name: string, searchParams: URLSearchParams) => void) => void` |

---

#### Streams API

The WHATWG Streams API is available for constructing and transforming streaming bodies.

##### `ReadableStream`

```typescript
new ReadableStream<R>(underlyingSource?: UnderlyingSource<R>, strategy?: QueuingStrategy<R>): ReadableStream<R>
```

| `UnderlyingSource` field | Type |
|--------------------------|------|
| `start` | `(controller: ReadableStreamDefaultController<R>) => any` |
| `pull` | `(controller: ReadableStreamDefaultController<R>) => void \| PromiseLike<void>` |
| `cancel` | `(reason?: any) => void \| PromiseLike<void>` |
| `type` | `"bytes" \| undefined` |
| `autoAllocateChunkSize` | `number` |

| `ReadableStream` method | Signature |
|-------------------------|-----------|
| `getReader()` | `() => ReadableStreamDefaultReader<R>` |
| `pipeTo(dest, options?)` | `(dest: WritableStream<R>, options?: StreamPipeOptions) => Promise<void>` |
| `pipeThrough(transform, options?)` | `(transform: ReadableWritablePair<T, R>, options?: StreamPipeOptions) => ReadableStream<T>` |
| `tee()` | `() => [ReadableStream<R>, ReadableStream<R>]` |
| `cancel(reason?)` | `(reason?: any) => Promise<void>` |

To read a byte stream with a caller-supplied buffer, call `getReader({ mode: 'byob' })` which returns a `ReadableStreamBYOBReader`. The BYOB reader's `read(view)` method fills the provided `ArrayBufferView` in-place.

```js
const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("hello "));
    controller.enqueue(new TextEncoder().encode("world"));
    controller.close();
  },
});

return new Response(stream, { status: 200 });
```

##### `WritableStream`

```typescript
new WritableStream<W>(underlyingSink?: UnderlyingSink<W>, strategy?: QueuingStrategy<W>): WritableStream<W>
```

| `WritableStream` method | Signature |
|-------------------------|-----------|
| `getWriter()` | `() => WritableStreamDefaultWriter<W>` |
| `abort(reason?)` | `(reason?: any) => Promise<void>` |

##### `TransformStream`

```typescript
new TransformStream<I, O>(
  transformer?: Transformer<I, O>,
  writableStrategy?: QueuingStrategy<I>,
  readableStrategy?: QueuingStrategy<O>,
): TransformStream<I, O>
```

| Property | Type | Description |
|----------|------|-------------|
| `readable` | `ReadableStream<O>` | The readable side of the transform. |
| `writable` | `WritableStream<I>` | The writable side of the transform. |

##### Queuing Strategies

Two built-in queuing strategies control backpressure. Both accept `{ highWaterMark: number }`.

```typescript
new ByteLengthQueuingStrategy(init: QueuingStrategyInit): ByteLengthQueuingStrategy
new CountQueuingStrategy(init: QueuingStrategyInit): CountQueuingStrategy
```

| Strategy | Counts |
|----------|--------|
| `ByteLengthQueuingStrategy` | Byte length of each `ArrayBufferView` chunk |
| `CountQueuingStrategy` | Each chunk as a single unit |

##### Compression Streams

```typescript
new CompressionStream(format: CompressionFormat): CompressionStream
new DecompressionStream(format: CompressionFormat): DecompressionStream
```

`CompressionFormat` is one of `"deflate"`, `"deflate-raw"`, or `"gzip"`. Both implement the transform-stream shape (`readable` / `writable`) and can be piped directly with `pipeThrough`.

```js
/// <reference types="@gcoredev/fastedge-sdk-js" />

async function app(event) {
  const upstream   = await fetch("https://origin.example.com/data");
  const compressed = upstream.body.pipeThrough(new CompressionStream("gzip"));

  return new Response(compressed, {
    headers: {
      "content-type":     upstream.headers.get("content-type") ?? "application/octet-stream",
      "content-encoding": "gzip",
    },
  });
}

addEventListener("fetch", event => event.respondWith(app(event)));
```

---

#### Encoding API

##### `TextEncoder` / `TextDecoder`

Standard `TextEncoder` and `TextDecoder` are available as globals for converting between strings and `Uint8Array`.

```js
const encoded = new TextEncoder().encode("hello");    // Uint8Array
const decoded = new TextDecoder().decode(encoded);    // "hello"
```

`TextDecoder` accepts an optional encoding label (default `"utf-8"`) and options `{ fatal?: boolean, ignoreBOM?: boolean }`. `TextEncoder` always encodes as UTF-8 and additionally exposes `encodeInto(source, destination)` which writes into a pre-allocated `Uint8Array` and returns `{ read, written }`.

##### Base64

```typescript
atob(data: string): string
btoa(data: string): string
```

| Function | Description |
|----------|-------------|
| `btoa` | Encodes a binary string to a Base64 ASCII string. |
| `atob` | Decodes a Base64 ASCII string to a binary string. |

```js
const encoded = btoa("hello world");    // "aGVsbG8gd29ybGQ="
const decoded = atob(encoded);          // "hello world"
```

---

#### File API

##### `Blob`

```typescript
new Blob(blobParts?: BlobPart[], options?: BlobPropertyBag): Blob
```

`BlobPart` is `BufferSource | Blob | string`. `BlobPropertyBag` accepts `{ type?: string, endings?: "native" | "transparent" }`.

| `Blob` property / method | Type / Signature | Description |
|--------------------------|-----------------|-------------|
| `size` | `number` | Total byte length. |
| `type` | `string` | MIME type string. |
| `arrayBuffer()` | `() => Promise<ArrayBuffer>` | Reads content as an `ArrayBuffer`. |
| `bytes()` | `() => Promise<Uint8Array>` | Reads content as a `Uint8Array`. |
| `text()` | `() => Promise<string>` | Reads content as a UTF-8 string. |
| `stream()` | `() => ReadableStream<Uint8Array>` | Returns a `ReadableStream` of the bytes. |
| `slice(start?, end?, contentType?)` | `(start?: number, end?: number, contentType?: string) => Blob` | Returns a sub-blob. |

##### `File`

```typescript
new File(fileBits: BlobPart[], fileName: string, options?: FilePropertyBag): File
```

`File` extends `Blob` and adds:

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | File name as provided to the constructor. |
| `lastModified` | `number` | Last modified timestamp in milliseconds. |

##### `FormData`

```typescript
new FormData(): FormData
```

`FormDataEntryValue` is `File | string`.

| Method | Signature |
|--------|-----------|
| `append(name, value)` | `(name: string, value: string \| Blob, fileName?: string) => void` |
| `delete(name)` | `(name: string) => void` |
| `get(name)` | `(name: string) => FormDataEntryValue \| null` |
| `getAll(name)` | `(name: string) => FormDataEntryValue[]` |
| `has(name)` | `(name: string) => boolean` |
| `set(name, value)` | `(name: string, value: string \| Blob, fileName?: string) => void` |
| `forEach(callback)` | `(callback: (value: FormDataEntryValue, key: string, parent: FormData) => void) => void` |
| `entries()` | `() => IterableIterator<[string, FormDataEntryValue]>` |
| `keys()` | `() => IterableIterator<string>` |
| `values()` | `() => IterableIterator<FormDataEntryValue>` |

---

#### Abort API

```typescript
new AbortController(): AbortController
```

| `AbortController` member | Type / Signature | Description |
|--------------------------|-----------------|-------------|
| `signal` | `AbortSignal` | The associated signal object. |
| `abort(reason?)` | `(reason?: any) => void` | Triggers the signal's aborted state. |

| `AbortSignal` member | Type / Signature | Description |
|---------------------|-----------------|-------------|
| `aborted` | `boolean` | Whether the signal has been aborted. |
| `reason` | `any` | The abort reason, if any. |
| `onabort` | `((ev: Event) => any) \| null` | Event handler fired when the signal aborts. |
| `throwIfAborted()` | `() => void` | Throws the abort reason if the signal is aborted. |
| `AbortSignal.abort(reason?)` | `(reason?: any) => AbortSignal` | Returns an already-aborted signal. |
| `AbortSignal.timeout(ms)` | `(milliseconds: number) => AbortSignal` | Returns a signal that aborts after the given delay. |
| `AbortSignal.any(signals)` | `(signals: AbortSignal[]) => AbortSignal` | Returns a signal that aborts when any input aborts. |

Pass a signal via `RequestInit.signal` to cancel an in-flight `fetch`:

```js
/// <reference types="@gcoredev/fastedge-sdk-js" />

async function app(event) {
  try {
    const response = await fetch("https://slow-origin.example.com/data", {
      signal: AbortSignal.timeout(5000),
    });
    return new Response(await response.text(), { status: 200 });
  } catch (err) {
    return new Response("upstream timeout", { status: 504 });
  }
}

addEventListener("fetch", event => event.respondWith(app(event)));
```

---

#### Crypto API

```typescript
crypto.getRandomValues<T extends ArrayBufferView | null>(array: T): T
crypto.randomUUID(): string
crypto.subtle: SubtleCrypto
```

##### `SubtleCrypto`

Available as `crypto.subtle`.

| Method | Signature |
|--------|-----------|
| `digest` | `(algorithm: AlgorithmIdentifier, data: BufferSource) => Promise<ArrayBuffer>` |
| `importKey` | See overloads below |
| `sign` | `(algorithm: AlgorithmIdentifier \| EcdsaParams, key: CryptoKey, data: BufferSource) => Promise<ArrayBuffer>` |
| `verify` | `(algorithm: AlgorithmIdentifier \| EcdsaParams, key: CryptoKey, signature: BufferSource, data: BufferSource) => Promise<boolean>` |

**Supported operations:**

| Operation | Supported Algorithms |
|-----------|---------------------|
| `digest()` | SHA-1, SHA-256, SHA-384, SHA-512, MD5 |
| `sign()` / `verify()` | RSASSA-PKCS1-v1_5, ECDSA, HMAC |
| `importKey()` | JWK, PKCS#8, SPKI, raw (HMAC) |
| `getRandomValues()` | ✓ |
| `encrypt()` / `decrypt()` | **Not implemented** |
| `generateKey()`, `deriveKey()`, `deriveBits()` | **Not implemented** |
| `exportKey()` | **Not implemented** |

These operations support JWT verification (HMAC / ECDSA / RSASSA-PKCS1-v1_5), SAML assertion verification (SHA-256 digest + RSASSA-PKCS1-v1_5 + SPKI importKey), and general signature verification workflows.

`ECDSA` requires `EcdsaParams` (`{ name: 'ECDSA', hash: AlgorithmIdentifier }`) for `sign` and `verify` so that the hash function can be specified.

`importKey` overloads:

```typescript
// JWK format
subtle.importKey(
  format: 'jwk',
  keyData: JsonWebKey,
  algorithm: AlgorithmIdentifier | HmacImportParams | RsaHashedImportParams | EcKeyImportParams,
  extractable: boolean,
  keyUsages: ReadonlyArray<KeyUsage>,
): Promise<CryptoKey>

// Raw / SPKI / PKCS#8 formats
subtle.importKey(
  format: Exclude<KeyFormat, 'jwk'>,
  keyData: BufferSource,
  algorithm: AlgorithmIdentifier | HmacImportParams | RsaHashedImportParams | EcKeyImportParams,
  extractable: boolean,
  keyUsages: KeyUsage[],
): Promise<CryptoKey>
```

Supported `(algorithm, format)` combinations:

| Algorithm | Supported formats |
|-----------|------------------|
| `HMAC` | `'raw'`, `'jwk'` |
| `RSASSA-PKCS1-v1_5` | `'jwk'`, `'spki'`, `'pkcs8'` |
| `ECDSA` | `'jwk'`, `'raw'`, `'spki'`, `'pkcs8'` |

```js
// Compute SHA-256 digest
const data    = new TextEncoder().encode("hello world");
const hashBuf = await crypto.subtle.digest("SHA-256", data);
const hashHex = Array.from(new Uint8Array(hashBuf))
  .map(b => b.toString(16).padStart(2, "0"))
  .join("");
```

---

#### Timers

```typescript
setTimeout(callback: (...args: TArgs) => void, delay?: number, ...args: TArgs): number
clearTimeout(timeoutID?: number): void

setInterval(callback: (...args: TArgs) => void, delay?: number, ...args: TArgs): number
clearInterval(intervalID?: number): void
```

| Function | Description |
|----------|-------------|
| `setTimeout` | Calls `callback` once after `delay` milliseconds. Returns a timer ID. |
| `clearTimeout` | Cancels a timer created by `setTimeout`. |
| `setInterval` | Calls `callback` repeatedly every `delay` milliseconds. Returns a timer ID. |
| `clearInterval` | Cancels a repeating timer created by `setInterval`. |

---

#### Console

The global `console` object writes to stdout. Unlike browser or Node.js implementations, this version does **not** perform string substitution in format strings — all arguments are stringified and concatenated.

| Method | Description |
|--------|-------------|
| `console.log` | General output. |
| `console.info` | Informational output. |
| `console.warn` | Warning output. |
| `console.error` | Error output. |
| `console.debug` | Debug output. |
| `console.assert` | Logs if condition is falsy. |
| `console.trace` | Outputs a stack trace. |
| `console.time` | Starts a named timer. |
| `console.timeEnd` | Stops a named timer and logs elapsed ms. |
| `console.timeLog` | Logs current elapsed time for a timer. |
| `console.count` | Logs call count for a label. |
| `console.countReset` | Resets call count for a label. |
| `console.group` | Starts an indented group. |
| `console.groupEnd` | Ends an indented group. |
| `console.dir` | Logs object representation. |
| `console.table` | Logs tabular data. |

---

#### Performance API

```typescript
performance.now(): DOMHighResTimeStamp   // number (milliseconds)
performance.timeOrigin: DOMHighResTimeStamp
```

`performance.now()` returns a high-resolution timestamp in milliseconds relative to `performance.timeOrigin`.

```js
const start   = performance.now();
// ... work ...
const elapsed = performance.now() - start;
console.log(`elapsed: ${elapsed}ms`);
```

---

#### DOM Events

The standard `Event`, `EventTarget`, and `CustomEvent` interfaces are available as globals. These underpin the `FetchEvent` mechanism and can be used to implement custom event dispatch within an application.

```typescript
new Event(type: string, eventInitDict?: EventInit): Event
new CustomEvent<T>(type: string, eventInitDict?: CustomEventInit<T>): CustomEvent<T>
new EventTarget(): EventTarget
```

`EventTarget` exposes `addEventListener`, `removeEventListener`, and `dispatchEvent`. `CustomEvent` extends `Event` and adds a `detail` property carrying application-defined data.

---

#### Additional Globals

| Global | Type / Signature | Description |
|--------|-----------------|-------------|
| `self` | `typeof globalThis` | Reference to the global object. |
| `location` | `WorkerLocation` | URL of the current worker script. |
| `queueMicrotask(callback)` | `(callback: () => void) => void` | Queues a microtask. |
| `structuredClone(value, opts?)` | `(value: any, options?: StructuredSerializeOptions) => any` | Deep-clones a value. Transferable: `ArrayBuffer`. |

`WorkerLocation` exposes `href`, `origin`, `protocol`, `host`, `hostname`, `port`, `pathname`, `search`, and `hash` as read-only string properties.

---

### Unavailable APIs

These APIs are not implemented on the FastEdge JS runtime (StarlingMonkey, WinterCG-style). There is no Node.js compatibility layer.

- `node:crypto` — not implemented; not polyfillable (sync Node crypto cannot bridge to async `crypto.subtle`). See the js-runtime reference for why polyfills don't work.
- `node:fs`, `node:path`, `node:buffer`, `process`, `require` — not implemented
- `WebSocket` — not implemented
- DOM APIs (`document`, `window`, etc.) — not implemented (this is a server-side runtime, not a browser)

For implementation guidance on what to use instead — particularly for crypto-heavy patterns like SAML — see the js-runtime reference.

---

### Hono Integration

Hono is the recommended framework for routing. Use standard Hono patterns — the only FastEdge-specific change is `app.fire()` instead of `export default app`.

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

const app = new Hono();

app.use("/*", cors());
app.use("/*", logger());

app.onError((err, c) => {
  return c.json({ error: "Internal Server Error" }, 500);
});

app.notFound((c) => c.json({ error: "Not Found" }, 404));

app.get("/api/items/:id", (c) => {
  const id = c.req.param("id");
  return c.json({ id });
});

app.fire();  // <- FastEdge-specific: replaces export default
```

---

### See Also

- quickstart — Getting started with your first FastEdge application
- BUILD_CLI reference — `fastedge-build` CLI
- INIT_CLI reference — `fastedge-init` CLI
- STATIC_SITES reference — Serving static assets from WASM
- ASSETS_CLI reference — `fastedge-assets` CLI
- js-runtime reference — Full `crypto.subtle` operation matrix, Node.js crypto polyfill limitations, SAML/XMLDSig guidance
