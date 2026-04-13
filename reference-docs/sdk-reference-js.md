<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-js
      ref: main
      commit: 26ae6629dd6abc3f09fc5e58afc2095f19d67436
      updated: 2026-04-09
-->

# JavaScript SDK Reference (`@gcoredev/fastedge-sdk-js`)

**Source:** `FastEdge-sdk-js` repo — `types/*.d.ts` are the authoritative API surface.

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

### Import Patterns

All FastEdge-specific modules use the `fastedge::` specifier — these are NOT Node.js module paths:

```ts
import { getEnv } from "fastedge::env";
import { getSecret, getSecretEffectiveAt } from "fastedge::secret";
import { KvStore } from "fastedge::kv";
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

KV stores must be created in the Gcore portal first, then referenced by name from the application. The KV store is **read-only** from the app — there is no `set()`, `delete()`, or `list()`.

```ts
import { KvStore } from "fastedge::kv";
```

#### Static Methods — `KvStore`

`new KvStore(...)` does not exist. Use the static factory method:

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `KvStore.open` | `(name: string) => KvStoreInstance` | `KvStoreInstance` | Opens a named KV store. `name` must match a store configured on the application. Throws if the store cannot be opened. |

#### Instance Methods — `KvStoreInstance`

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `get` | `(key: string) => ArrayBuffer \| null` | `ArrayBuffer \| null` | Get value by exact key. Returns `null` if key does not exist. **Returns `ArrayBuffer`, not string — decode explicitly.** |
| `scan` | `(pattern: string) => Array<string>` | `Array<string>` | Get keys matching prefix pattern — must include `*` wildcard. Returns empty array if no match. |
| `zrangeByScore` | `(key: string, min: number, max: number) => Array<[ArrayBuffer, number]>` | `Array<[ArrayBuffer, number]>` | Get sorted set members with scores in `[min, max]`. Each entry is a `[value, score]` tuple. Returns empty array if no match. |
| `zscan` | `(key: string, pattern: string) => Array<[ArrayBuffer, number]>` | `Array<[ArrayBuffer, number]>` | Get sorted set members matching value prefix pattern. Must include `*`. Each entry is a `[value, score]` tuple. Returns empty array if no match. |
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
| `respondWith(r)` | `(Response \| PromiseLike<Response>) => void` | Send response. Must be called synchronously. |
| `waitUntil(p)` | `(Promise<any>) => void` | Extend lifetime for post-response async work (e.g., logging, telemetry) |

**`ClientInfo`:**

| Property | Type | Description |
|----------|------|-------------|
| `address` | `string` | IPv4 or IPv6 address of the downstream client |
| `tlsProtocol` | `string` | Negotiated TLS protocol version (e.g. `"TLSv1.3"`) |
| `tlsCipherOpensslName` | `string` | OpenSSL name of the negotiated TLS cipher |
| `tlsJA3MD5` | `string` | JA3 MD5 fingerprint of the TLS client hello |
| `tlsClientCertificate` | `ArrayBuffer` | Raw bytes of the client TLS certificate, if present |
| `tlsClientHello` | `ArrayBuffer` | Raw bytes of the TLS ClientHello message |

```js
/// <reference types="@gcoredev/fastedge-sdk-js" />

addEventListener("fetch", event => {
  event.respondWith(handleRequest(event));
});

async function handleRequest(event) {
  const { request, client } = event;

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
| Streams (`ReadableStream`, `WritableStream`, `TransformStream`) | Yes | WHATWG Streams spec |
| Encoding (`TextEncoder`, `TextDecoder`, `atob`, `btoa`) | Yes | |
| Crypto (`crypto.subtle`, `crypto.getRandomValues`, `crypto.randomUUID`) | Partial | See SubtleCrypto section |
| Timers (`setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`) | Yes | |
| Console | Partial | No format-string substitution; all args stringified and concatenated |
| Performance (`performance.now`, `performance.timeOrigin`) | Yes | |
| `structuredClone` | Yes | Transferable: `ArrayBuffer` |

**NOT available:** WebSocket, localStorage, sessionStorage, DOM APIs, Node.js APIs (`fs`, `path`, `process`, etc.)

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
| `manualFramingHeaders` | `boolean` | When `true`, disables automatic framing header management. |

| `Request` property / method | Type | Description |
|-----------------------------|------|-------------|
| `method` | `string` | HTTP method. |
| `url` | `string` | Request URL as a string. |
| `headers` | `Headers` | Request headers. Read-only on incoming requests. |
| `body` | `ReadableStream<Uint8Array> \| null` | Request body stream. |
| `bodyUsed` | `boolean` | Whether the body has already been consumed. |
| `clone()` | `() => Request` | Creates a copy of the request. |
| `text()` | `() => Promise<string>` | Reads body as a string. |
| `json()` | `() => Promise<any>` | Reads body and parses as JSON. |
| `arrayBuffer()` | `() => Promise<ArrayBuffer>` | Reads body as an `ArrayBuffer`. |
| `setCacheKey(key)` | `(key: string) => void` | Sets a custom cache key for the request. |
| `setManualFramingHeaders(manual)` | `(manual: boolean) => void` | Toggles manual framing header control. |

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
| `manualFramingHeaders` | `boolean` | When `true`, disables automatic framing header management. |

| `Response` property / method | Type | Description |
|------------------------------|------|-------------|
| `status` | `number` | HTTP status code. |
| `statusText` | `string` | HTTP status text. |
| `ok` | `boolean` | `true` if status is in the range 200–299. |
| `url` | `string` | URL of the response. |
| `headers` | `Headers` | Response headers. |
| `body` | `ReadableStream<Uint8Array> \| null` | Response body stream. |
| `bodyUsed` | `boolean` | Whether the body has already been consumed. |
| `text()` | `() => Promise<string>` | Reads body as a string. |
| `json()` | `() => Promise<any>` | Reads body and parses as JSON. |
| `arrayBuffer()` | `() => Promise<ArrayBuffer>` | Reads body as an `ArrayBuffer`. |
| `setManualFramingHeaders(manual)` | `(manual: boolean) => void` | Toggles manual framing header control. |

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

---

#### Encoding API

##### `TextEncoder` / `TextDecoder`

Standard `TextEncoder` and `TextDecoder` are available as globals.

```js
const encoded = new TextEncoder().encode("hello");    // Uint8Array
const decoded = new TextDecoder().decode(encoded);    // "hello"
```

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
| `sign` | `(algorithm: AlgorithmIdentifier, key: CryptoKey, data: BufferSource) => Promise<ArrayBuffer>` |
| `verify` | `(algorithm: AlgorithmIdentifier, key: CryptoKey, signature: BufferSource, data: BufferSource) => Promise<boolean>` |

`importKey` overloads:

```typescript
// JWK format
subtle.importKey(
  format: 'jwk',
  keyData: JsonWebKey,
  algorithm: AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams,
  extractable: boolean,
  keyUsages: ReadonlyArray<KeyUsage>,
): Promise<CryptoKey>

// Raw / other formats
subtle.importKey(
  format: Exclude<KeyFormat, 'jwk'>,
  keyData: BufferSource,
  algorithm: AlgorithmIdentifier | RsaHashedImportParams | HmacImportParams,
  extractable: boolean,
  keyUsages: KeyUsage[],
): Promise<CryptoKey>
```

Supported `KeyFormat` values: `"jwk"`, `"raw"`.

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

#### Additional Globals

| Global | Type / Signature | Description |
|--------|-----------------|-------------|
| `self` | `typeof globalThis` | Reference to the global object. |
| `location` | `WorkerLocation` | URL of the current worker script. |
| `queueMicrotask(callback)` | `(callback: () => void) => void` | Queues a microtask. |
| `structuredClone(value, opts?)` | `(value: any, options?: StructuredSerializeOptions) => any` | Deep-clones a value. Transferable: `ArrayBuffer`. |

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
