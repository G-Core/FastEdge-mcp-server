<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-js
      ref: main
      commit: 81145a9a43ec499240c687bd49376ab20c72b11c
      updated: 2026-07-23
-->

# FastEdge JavaScript Quickstart

## Prerequisites

- Node.js `>=22`
- npm, yarn, or pnpm

## Install

```bash
npm install --save-dev @gcoredev/fastedge-sdk-js
```

## Two Paths

### Scaffold with fastedge-init

Run the interactive wizard to create a new project:

```bash
npx fastedge-init
```

The wizard asks what you're building (HTTP event handler or Static website), then creates a `.fastedge/` directory with build configuration and generates a `build-config.js` file. See the fastedge-init CLI reference for full wizard details.

### Build Directly

For an existing JavaScript or TypeScript file, pass input and output as positional arguments:

```bash
npx fastedge-build src/index.js output.wasm
```

Or with explicit flags:

```bash
npx fastedge-build --input src/index.ts --output app.wasm --tsconfig tsconfig.json
```

See the fastedge-build CLI reference for all flags and config options.

## First App Example

Create `src/index.js`:

```js
/// <reference types="@gcoredev/fastedge-sdk-js" />
import { getEnv } from 'fastedge::env';
import { getSecret } from 'fastedge::secret';
import { KvStore } from 'fastedge::kv';

async function handler(event) {
  const request = event.request;
  const url = new URL(request.url);

  // Read environment variable
  const region = getEnv('REGION') ?? 'default';

  // Read secret
  const token = getSecret('API_TOKEN');
  if (token === null) {
    return new Response('API_TOKEN not configured', { status: 500 });
  }

  // Read from KV store
  const store = KvStore.open('my-store');
  const entry = await store.getEntry(url.pathname);
  if (entry !== null) {
    return new Response(await entry.text(), {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  return new Response(`Hello from FastEdge! Region: ${region}, path: ${url.pathname}`, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}

addEventListener('fetch', (event) => {
  event.respondWith(handler(event));
});
```

Build it:

```bash
npx fastedge-build src/index.js app.wasm
```

The output `app.wasm` is a WebAssembly component ready for deployment on the FastEdge platform.

## Build and Deploy

Build using a config file:

```bash
npx fastedge-build --config .fastedge/build-config.js
```

Deploy the resulting `.wasm` binary via the Gcore panel or the FastEdge REST API. See the deploy skill for guided deployment steps.

## API Quick Reference

### getEnv

```
getEnv(name: string): string | null
```

Returns the value of the named environment variable, or `null` if not set. Only available during request processing, not at build-time initialization.

### getSecret

```
getSecret(name: string): string | null
getSecretEffectiveAt(name: string, effectiveAt: number): string | null
```

Returns the named secret value, or `null` if not set. Only available during request processing, not at build-time initialization.

### KvStore

```
KvStore.open(name: string): KvStoreInstance
KvStoreInstance.get(key: string): ArrayBuffer | null
KvStoreInstance.getEntry(key: string): Promise<KvStoreEntry | null>
KvStoreInstance.scan(pattern: string): Array<string>
KvStoreInstance.zrangeByScore(key: string, min: number, max: number): Array<[ArrayBuffer, number]>
KvStoreInstance.zrangeByScoreEntries(key: string, min: number, max: number): Promise<Array<[KvStoreEntry, number]>>
KvStoreInstance.zscan(key: string, pattern: string): Array<[ArrayBuffer, number]>
KvStoreInstance.zscanEntries(key: string, pattern: string): Promise<Array<[KvStoreEntry, number]>>
KvStoreInstance.bfExists(key: string, value: string): boolean
```

`KvStoreEntry` methods:
- `arrayBuffer(): Promise<ArrayBuffer>`
- `text(): Promise<string>`
- `json(): Promise<unknown>`

### Cache

The `fastedge::cache` module provides a POP-local key/value store with TTL and atomic counter primitives. Unlike `fastedge::kv`, which is globally replicated across all data centers, the cache is strongly consistent within a single point of presence and invisible to other POPs — suited for request-time state such as rate limiting, hit counters, and response memoisation where low latency within a POP matters more than global durability.

```
Cache.get(key: string): Promise<CacheEntry | null>
Cache.set(key: string, value: CacheValue, options?: WriteOptions): Promise<void>
Cache.getOrSet(key: string, populate: () => CacheValue | Promise<CacheValue>, options?: WriteOptions): Promise<CacheEntry>
Cache.incr(key: string, delta?: number): Promise<number>
Cache.expire(key: string, options: WriteOptions): Promise<boolean>
```

Example — rate limiting with cache:

```js
/// <reference types="@gcoredev/fastedge-sdk-js" />
import { Cache } from 'fastedge::cache';

addEventListener('fetch', (event) => {
  event.respondWith(
    (async () => {
      const ip = event.request.headers.get('x-forwarded-for') ?? 'unknown';

      // Atomic per-IP counter; initialised to 0 on first call
      const count = await Cache.incr(`rl:${ip}`);
      if (count === 1) await Cache.expire(`rl:${ip}`, { ttl: 60 });
      if (count > 100) {
        return new Response('Too Many Requests', { status: 429 });
      }

      // Cache-aside: serve from cache, populate on miss
      const entry = await Cache.getOrSet(
        'upstream-data',
        async () => {
          const r = await fetch('https://example.com/data');
          return r.ok ? r : null;
        },
        { ttl: 30 },
      );

      if (entry === null) {
        return new Response('Upstream unavailable', { status: 503 });
      }

      return new Response(await entry.text());
    })(),
  );
});
```

See the SDK Runtime API reference for the complete `Cache` method reference, `CacheValue` type, and `WriteOptions` fields.

## TypeScript Configuration

If you're using TypeScript, use a `tsconfig.json` that works with `fastedge-build`'s esbuild-based compilation pipeline:

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

Key settings:
- **`moduleResolution: "Bundler"`** — Required. `fastedge-build` uses esbuild to resolve modules. The `node`, `node16`, and `nodenext` modes are incorrect for FastEdge apps and will produce spurious import errors.
- **`types: ["@gcoredev/fastedge-sdk-js"]`** — Brings `FetchEvent` and all FastEdge globals into scope automatically. No triple-slash directive is needed in TypeScript source files when this field is set.
- **`noEmit: true`** — `tsc` is used for type-checking only. `fastedge-build` handles the actual compilation to WebAssembly.

## Next Steps

- SDK API reference — full runtime API for env, secrets, KV, cache, and fetch
- Build CLI reference — all fastedge-build flags and config options
- Init CLI reference — fastedge-init scaffold wizard details
- Static sites guide — serve static websites from FastEdge
