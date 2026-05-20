<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-js
      ref: main
      commit: f52d9220499e073755091cb39b28915d86d2c8d9
      updated: 2026-04-14
-->

# FastEdge Quickstart

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

Prompts for app type (HTTP event handler or Static website), then creates a `.fastedge/` directory and `build-config.js`. See the init-cli reference for full details.

### Build Directly

For an existing JS/TS file, pass input and output directly:

```bash
npx fastedge-build src/index.js app.wasm
```

Supports `--input`, `--output`, `--tsconfig`, and `--config` flags. See the build-cli reference for full details.

## First App Example

```js
/// <reference types="@gcoredev/fastedge-sdk-js" />
import { getEnv } from 'fastedge::env';
import { getSecret } from 'fastedge::secret';
import { KvStore } from 'fastedge::kv';

addEventListener('fetch', (event) => {
  event.respondWith(
    (async () => {
      const request = event.request;
      const url = new URL(request.url);

      const apiKey = getEnv('API_KEY');
      if (apiKey === null) {
        return new Response('API_KEY not configured', { status: 500 });
      }

      const token = getSecret('SECRET_TOKEN');

      const store = KvStore.open('my-store');
      const cached = store.get(url.pathname);
      if (cached) {
        return new Response(new TextDecoder().decode(cached), {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        });
      }

      return new Response(`Hello from FastEdge! Path: ${url.pathname}`, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    })(),
  );
});
```

**Constraints:**
- `getEnv`, `getSecret`, and `KvStore` are only available during request processing — not at module initialization time.
- `getEnv(name: string): string | null` — returns `null` if not set.
- `getSecret(name: string): string | null` — returns `null` if not set.
- `getSecretEffectiveAt(name: string, effectiveAt: number): string | null` — returns `null` if not set.
- `KvStore.open(name: string): KvStoreInstance` — opens a named KV store.
- `KvStoreInstance.get(key: string): ArrayBuffer | null`
- `KvStoreInstance.scan(pattern: string): Array<string>`
- `KvStoreInstance.zrangeByScore(key: string, min: number, max: number): Array<[ArrayBuffer, number]>`
- `KvStoreInstance.zscan(key: string, pattern: string): Array<[ArrayBuffer, number]>`
- `KvStoreInstance.bfExists(key: string, value: string): boolean`

## Build and Deploy

Build the app:

```bash
npx fastedge-build --config .fastedge/build-config.js
```

Or directly:

```bash
npx fastedge-build src/index.js app.wasm
```

Output is a `.wasm` WebAssembly component. Deploy via the Gcore panel or API, or use the `/gcore-fastedge:deploy` skill.

## Next Steps

- SDK API reference — full runtime API for env, secrets, KV, and fetch
- Build CLI reference — all build flags and config options
- Init CLI reference — scaffold wizard details
- Static sites guide — serve static websites from FastEdge
