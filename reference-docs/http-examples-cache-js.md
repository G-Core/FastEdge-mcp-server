<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-js
      ref: main
      commit: b78b2a80317bb632af88010816d3e54afd3bd72d
      updated: 2026-06-16
-->

# FastEdge Cache — JavaScript Examples

**Module**: `fastedge::cache`
**Import**: `import { Cache } from 'fastedge::cache';`
**SDK**: `@gcoredev/fastedge-sdk-js` `^2.3.0`
**App type**: HTTP
**Language**: TypeScript / JavaScript

---

## Overview

The `Cache` module provides a POP-local, strongly consistent key-value store with atomic counter primitives. It is optimized for sub-millisecond reads and writes on the hot path. Values do not replicate across data centers.

Use `fastedge::cache` (not `fastedge::kv`) for:
- Atomic counters (rate limiters, quotas, distributed locks)
- Short-lived byte caches where strong consistency within a POP is required
- Memoised computation with TTL-bounded freshness

---

## API Reference

### `Cache.incr(key)`

```ts
Cache.incr(key: string): Promise<number>
```

Atomically increments the integer value at `key` and returns the new count. Creates the key at `1` if it does not exist. The operation is atomic under concurrent load — two simultaneous requests cannot both observe the same post-increment value.

**Parameters**:
- `key` — string cache key

**Returns**: `Promise<number>` — the new count after increment

**Use for**: rate limiters, quotas, locks, and any counter primitive requiring atomicity.

---

### `Cache.expire(key, options)`

```ts
Cache.expire(key: string, options: { ttl: number }): Promise<void>
```

Attaches or replaces a TTL on an existing key. The key expires `ttl` seconds from the time this call is made.

**Parameters**:
- `key` — string cache key
- `options.ttl` — expiry duration in seconds (integer)

**Returns**: `Promise<void>`

**Note**: Call this only when needed (e.g., on the first `incr` hit to anchor a rate-limit window). Calling on every request resets the window deadline and prevents expiry.

---

### `Cache.get(key)`

```ts
Cache.get(key: string): Promise<CacheEntry | null>
```

Retrieves the value at `key`. Returns `null` on a cache miss.

**Parameters**:
- `key` — string cache key

**Returns**: `Promise<CacheEntry | null>`

**CacheEntry methods**:
- `entry.arrayBuffer()` — `Promise<ArrayBuffer>` — raw bytes
- `entry.text()` — `Promise<string>` — UTF-8 decoded string
- `entry.json()` — `Promise<unknown>` — JSON-parsed value

---

### `Cache.set(key, value, options)`

```ts
Cache.set(key: string, value: ArrayBuffer | Uint8Array | string, options: { ttl: number }): Promise<void>
```

Writes a value to the cache with a TTL.

**Parameters**:
- `key` — string cache key
- `value` — `ArrayBuffer`, `Uint8Array`, or `string`
- `options.ttl` — expiry duration in seconds (integer)

**Returns**: `Promise<void>`

**Constraint**: Only the body bytes are stored. Status code, headers, and content-type are NOT preserved. Callers reconstructing HTTP responses must supply these explicitly on read.

---

### `Cache.getOrSet(key, populator, options)`

```ts
Cache.getOrSet(
  key: string,
  populator: () => string | ArrayBuffer | Uint8Array | Promise<string | ArrayBuffer | Uint8Array>,
  options: { ttl: number }
): Promise<CacheEntry>
```

Returns the cached entry for `key` if present; otherwise calls `populator`, stores its return value, and returns it as a `CacheEntry`. The populator may be synchronous or async.

**Parameters**:
- `key` — string cache key
- `populator` — function returning the value to store; sync or async
- `options.ttl` — expiry duration in seconds (integer)

**Returns**: `Promise<CacheEntry>` — always returns an entry (never `null`)

**Constraint**: Every populator return value is stored unconditionally. The populator cannot signal "do not cache." For conditional caching (e.g., only on HTTP 2xx), use manual `Cache.get` / `Cache.set` instead.

---

## Patterns

### Pattern 1 — Rate Limiting (atomic counter + expire)

Fixed sliding window anchored to the first request in the window.

```ts
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_S = 60;

async function rateLimit(event: FetchEvent): Promise<Response> {
  const ip = event.client.address || 'unknown';
  const key = `rl:${ip}`;

  const count = await Cache.incr(key);

  // Set TTL only on the first hit — anchors the window to this request.
  // Setting on every request would push the deadline out indefinitely.
  if (count === 1) {
    await Cache.expire(key, { ttl: RATE_LIMIT_WINDOW_S });
  }

  if (count > RATE_LIMIT_MAX) {
    return Response.json(
      { error: 'Too Many Requests', limit: RATE_LIMIT_MAX, count },
      { status: 429, headers: { 'retry-after': String(RATE_LIMIT_WINDOW_S) } },
    );
  }

  return Response.json({
    pattern: 'rate-limit',
    ip,
    count,
    remaining: RATE_LIMIT_MAX - count,
    windowSeconds: RATE_LIMIT_WINDOW_S,
  });
}
```

**Client IP source**: `event.client.address` — set by the FastEdge POP from `x-real-ip` (fallback: `x-forwarded-for`). These headers are set by the POP, not the client, so they are safe to use as rate-limit keys.

**Why `incr` and not `kv`**: `Cache.incr` is atomic under concurrent load. `fastedge::kv` provides no atomicity guarantee for read-modify-write operations, making it unsuitable for counter primitives.

---

### Pattern 2 — Origin-Cache Proxy (conditional caching)

Caches successful upstream responses; passes non-2xx and redirects through uncached.

```ts
const PROXY_TTL_S = 30;

async function proxy(url: string): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return Response.json({ error: `Invalid url: "${url}"` }, { status: 400 });
  }

  // Strip fragment — never sent to origin; same upstream resource must share one cache entry.
  parsed.hash = '';
  const key = `proxy:${parsed.toString()}`;

  const cached = await Cache.get(key);
  if (cached !== null) {
    return new Response(await cached.arrayBuffer(), {
      headers: {
        'content-type': 'application/octet-stream',
        'x-cache': 'hit',
        'x-cache-ttl': String(PROXY_TTL_S),
      },
    });
  }

  const upstream = await fetch(parsed.toString());
  if (!upstream.ok) {
    // Pass non-2xx and redirects through uncached.
    // Caching a transient 404 or 500 would pin the error for the TTL window.
    return upstream;
  }

  const bytes = await upstream.arrayBuffer();
  await Cache.set(key, bytes, { ttl: PROXY_TTL_S });
  return new Response(bytes, {
    headers: {
      'content-type': 'application/octet-stream',
      'x-cache': 'miss',
      'x-cache-ttl': String(PROXY_TTL_S),
    },
  });
}
```

**Why not `getOrSet`**: The populator for `getOrSet` cannot signal "do not cache." Since upstream errors must not be cached, manual `get` / `set` is required here.

**Byte cache constraint**: The cache stores only body bytes. Status code, headers, and content-type from the original upstream response are not preserved. The reconstructed response above always returns `200` with `application/octet-stream`.

---

### Pattern 3 — JSON Memoisation (`getOrSet` with computed populator)

Cache the result of an expensive computation for a fixed TTL.

```ts
const MEMO_TTL_S = 60;

async function memo(): Promise<Response> {
  const entry = await Cache.getOrSet(
    'memo:report',
    () => {
      const report = {
        generatedAt: new Date().toISOString(),
        topItems: ['alpha', 'beta', 'gamma'].map((name, i) => ({
          name,
          score: Math.round(Math.random() * 1000) / 10,
          rank: i + 1,
        })),
      };
      // Serialise to string; read back with entry.json()
      return JSON.stringify(report);
    },
    { ttl: MEMO_TTL_S },
  );

  const report = await entry.json();

  return Response.json({
    pattern: 'memo',
    note: `Cached for ${MEMO_TTL_S}s. Refresh to confirm 'generatedAt' stays the same until expiry.`,
    report,
  });
}
```

**Populator contract**: The populator returns the value to store. `getOrSet` always stores whatever the populator returns. Use `entry.json()` to parse the stored UTF-8 JSON back to a structured object.

**When to use**: CPU-bound work called repeatedly — search index lookups, signed-token verification, derived report rollups, JSON transformations of slow-changing data.

---

## Gotchas and Constraints

| Constraint | Detail |
|---|---|
| Byte cache only | Only the body is stored. Status code, headers, and content-type are NOT preserved. Reconstruct them explicitly on read. |
| POP-local | Values do not replicate across data centers. Appropriate for rate limiters, locks, and short-lived transient caches. |
| Strongly consistent within a POP | `Cache.incr` is atomic under concurrent load. Safe for counters, quotas, and lock primitives. `fastedge::kv` does not provide this guarantee. |
| `getOrSet` always stores | Populator cannot signal "do not cache." Use manual `get` / `set` for conditional caching (e.g., HTTP 2xx only). |
| Error handling | Validation errors (e.g., conflicting `WriteOptions` fields) throw synchronously. Host errors arrive as Promise rejections. A single `try/catch` handles both. |
| Rate-limit window anchoring | Call `Cache.expire` only on `count === 1`. Calling on every request resets the window deadline and prevents it from closing. |
| Fragment stripping for proxy keys | Strip `URL.hash` before using a URL as a cache key. The fragment is never sent to the origin; different fragments represent the same upstream resource. |

---

## Error Handling

Wrap all `Cache.*` call sites in a single `try/catch`:

```ts
try {
  // Cache operations
} catch (error: unknown) {
  return Response.json({ error: (error as Error).message }, { status: 500 });
}
```

Validation errors (e.g., conflicting `WriteOptions`) are thrown synchronously. Host-level errors arrive as Promise rejections. Both are caught by the same handler.

---

## Project Configuration

**package.json**:
```json
{
  "type": "module",
  "scripts": { "build": "fastedge-build -c" },
  "dependencies": { "@gcoredev/fastedge-sdk-js": "^2.3.0" }
}
```

**tsconfig.json** (relevant options):
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "lib": ["ES2023"],
    "types": ["@gcoredev/fastedge-sdk-js"]
  }
}
```

---

## See Also

- fastedge::kv reference (non-atomic key-value store; use cache for counter primitives)
- platform-overview (POP topology, request lifecycle)
- deploy skill reference (fastedge-build CLI, binary upload)
- best-practices (error handling patterns, response construction)

## Source Material

### FILE: examples/cache/src/index.ts

```ts
// FastEdge Cache — flagship patterns
//
// This example demonstrates the three highest-value uses of the
// `fastedge::cache` module:
//
//   1. Per-IP rate limiting (atomic counters)
//   2. Origin-cache proxy (manual get/set with conditional caching)
//   3. JSON memoisation   (getOrSet with a computed populator)
//
// All three patterns rely on the cache being:
//   - **Strongly consistent within a POP** — atomic `incr` returns a
//     correct count under concurrent load, which `fastedge::kv` cannot.
//   - **Fast for both reads and writes** — sub-millisecond on the hot
//     path, so caching is cheaper than recomputing or refetching.
//   - **POP-local** — values do not replicate across data centers.
//     This is acceptable (and often desirable) for transient state.

import { Cache } from 'fastedge::cache';

// ---------------------------------------------------------------------------
// Pattern 1 — Rate limiting via atomic incr + expire
// ---------------------------------------------------------------------------
//
// Increment a per-IP counter. On the first hit (count === 1) we attach
// a TTL to create a fixed 60-second window anchored to that request:
// the counter resets 60 seconds after the user's *first* request, not
// after every request.
//
// `Cache.incr` is atomic: under concurrent load, two simultaneous
// requests cannot both see "count === 1" and double-set the expiry.
// This is the property that makes the cache suitable for limiting,
// quotas, locks, and other counter primitives.

const RATE_LIMIT_MAX = 10; // Requests per window.
const RATE_LIMIT_WINDOW_S = 60; // Window length, seconds.

async function rateLimit(event: FetchEvent): Promise<Response> {
  // `event.client.address` is the trusted-edge client IP. Sourced from
  // `x-real-ip` (with fallback to `x-forwarded-for`); both are set by
  // the FastEdge POP, not the client, so they're safe to key on.
  const ip = event.client.address || 'unknown';

  const key = `rl:${ip}`;

  const count = await Cache.incr(key);

  // Only set the expiry on the first hit of a new window. If we set it
  // on every request, the window would never close — each new request
  // would push the deadline another 60 seconds out.
  if (count === 1) {
    await Cache.expire(key, { ttl: RATE_LIMIT_WINDOW_S });
  }

  if (count > RATE_LIMIT_MAX) {
    return Response.json(
      { error: 'Too Many Requests', limit: RATE_LIMIT_MAX, count },
      { status: 429, headers: { 'retry-after': String(RATE_LIMIT_WINDOW_S) } },
    );
  }

  return Response.json({
    pattern: 'rate-limit',
    ip,
    count,
    remaining: RATE_LIMIT_MAX - count,
    windowSeconds: RATE_LIMIT_WINDOW_S,
  });
}

// ---------------------------------------------------------------------------
// Pattern 2 — Origin-cache proxy with conditional caching
// ---------------------------------------------------------------------------
//
// Cache successful upstream responses for PROXY_TTL_S seconds; pass
// non-2xx and redirects through *without* caching, so a transient 404
// or 500 doesn't get pinned for the rest of the window. The cache is
// a byte cache (no status/headers), so we only cache when "200 OK with
// application/octet-stream" is a faithful replay of the upstream.
//
// `getOrSet` is not used here because its populator can't signal
// "fetched, but don't cache" — we need that distinction to handle
// error responses safely. See Pattern 3 for `getOrSet` in a context
// where every populator output is cacheable.

const PROXY_TTL_S = 30;

async function proxy(url: string): Promise<Response> {
  // Validate the URL before we use it as a cache key.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return Response.json({ error: `Invalid url: "${url}"` }, { status: 400 });
  }

  // Strip the fragment: fetch() never sends it to the origin, so
  // `https://example.com/#a` and `#b` are the same upstream resource
  // and must share one cache entry.
  parsed.hash = '';

  const key = `proxy:${parsed.toString()}`;

  // Cache hit — replay the bytes as 200 OK. Status/headers from the
  // original response are not preserved by the byte cache.
  const cached = await Cache.get(key);
  if (cached !== null) {
    return new Response(await cached.arrayBuffer(), {
      headers: {
        'content-type': 'application/octet-stream',
        'x-cache': 'hit',
        'x-cache-ttl': String(PROXY_TTL_S),
      },
    });
  }

  // Cache miss — fetch upstream and only cache successful responses.
  // Non-2xx and redirects flow through unchanged so callers see the
  // real status code instead of a synthetic 200.
  const upstream = await fetch(parsed.toString());
  if (!upstream.ok) {
    return upstream;
  }

  const bytes = await upstream.arrayBuffer();
  await Cache.set(key, bytes, { ttl: PROXY_TTL_S });
  return new Response(bytes, {
    headers: {
      'content-type': 'application/octet-stream',
      'x-cache': 'miss',
      'x-cache-ttl': String(PROXY_TTL_S),
    },
  });
}

// ---------------------------------------------------------------------------
// Pattern 3 — JSON memoisation via getOrSet with a computed populator
// ---------------------------------------------------------------------------
//
// Same shape as the proxy pattern, but the populator does CPU work
// instead of network I/O. Use this whenever you compute the same
// expensive answer many times in a row — search index lookups,
// signed-token verification, derived report rollups, JSON
// transformations of slow-changing source data.
//
// We embed `generatedAt` in the result so a client refreshing the
// page can see the timestamp stay constant within the cache window
// and update once it expires.

const MEMO_TTL_S = 60;

async function memo(): Promise<Response> {
  const entry = await Cache.getOrSet(
    'memo:report',
    () => {
      // Stand-in for "expensive computation". The populator can be
      // synchronous or async — both are accepted.
      const report = {
        generatedAt: new Date().toISOString(),
        topItems: ['alpha', 'beta', 'gamma'].map((name, i) => ({
          name,
          score: Math.round(Math.random() * 1000) / 10,
          rank: i + 1,
        })),
      };
      // The populator returns the value to store. Because we want
      // structured JSON back later, we serialise here and re-parse
      // via `entry.json()` on read.
      return JSON.stringify(report);
    },
    { ttl: MEMO_TTL_S },
  );

  // `entry.json()` parses the cached UTF-8 bytes as JSON. Use
  // `entry.text()` for a string, or `entry.arrayBuffer()` for bytes.
  const report = await entry.json();

  return Response.json({
    pattern: 'memo',
    note: `Cached for ${MEMO_TTL_S}s. Refresh to confirm 'generatedAt' stays the same until expiry.`,
    report,
  });
}

// ---------------------------------------------------------------------------
// Default landing — usage menu when no action is supplied
// ---------------------------------------------------------------------------

function landing(): Response {
  return Response.json({
    name: 'FastEdge Cache patterns',
    actions: {
      'rate-limit': '/?action=rate-limit',
      proxy: '/?action=proxy&url=https://www.example.com',
      memo: '/?action=memo',
    },
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function eventHandler(event: FetchEvent): Promise<Response> {
  try {
    const url = new URL(event.request.url);
    const action = url.searchParams.get('action');

    switch (action) {
      case 'rate-limit':
        return await rateLimit(event);
      case 'proxy':
        return await proxy(url.searchParams.get('url') ?? '');
      case 'memo':
        return await memo();
      case null:
        return landing();
      default:
        return Response.json(
          { error: `Unknown action: "${action}". Use one of: rate-limit, proxy, memo.` },
          { status: 400 },
        );
    }
  } catch (error: unknown) {
    // Validation errors thrown by Cache.* (e.g. conflicting WriteOptions
    // fields) are synchronous; host errors arrive as Promise rejections.
    // Both are caught by this single handler.
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}

addEventListener('fetch', (event: FetchEvent) => {
  event.respondWith(eventHandler(event));
});
```


### FILE: examples/cache/package.json

```json
{
  "name": "fastedge-example-cache",
  "version": "1.0.0",
  "description": "FastEdge JS example: Cache patterns — rate limiting, origin-cache proxy, memoisation",
  "type": "module",
  "scripts": {
    "build": "fastedge-build -c"
  },
  "dependencies": {
    "@gcoredev/fastedge-sdk-js": "^2.3.0"
  }
}
```


### FILE: examples/cache/tsconfig.json

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
