<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-js
      ref: main
      commit: 81145a9a43ec499240c687bd49376ab20c72b11c
      updated: 2026-08-17
-->

# Proxy and Response Transform Patterns (JavaScript/TypeScript)

Patterns for using FastEdge HTTP apps as a thin proxy in front of an origin or upstream API: forwarding requests, transforming responses, and returning results to the client.

---

## Simple Proxy

Forward the inbound request to an upstream and return the response body unchanged.

```typescript
async function handle(request) {
  const url = new URL(request.url);
  const upstream = `https://backend.example.com${url.pathname}${url.search}`;

  const response = await fetch(upstream, {
    method: request.method,
    headers: request.headers,
    body: request.method !== "GET" && request.method !== "HEAD"
      ? await request.arrayBuffer()
      : undefined,
  });

  return response;
}

addEventListener("fetch", (event) => {
  event.respondWith(handle(event.request));
});
```

**Behavior:** `fetch()` returns a streamable `Response`. Returning it directly forwards body chunks without buffering everything into memory.

---

## Proxy with JSON Transform

Read the upstream response body, modify it, and return a new `Response`. Source: `examples/outbound-modify-response/`.

```typescript
async function handle() {
  const upstream = await fetch("https://jsonplaceholder.typicode.com/users");
  const users = await upstream.json();

  const transformed = {
    users: users.slice(0, 5),
    total: 5,
    skip: 0,
    limit: 30,
  };

  return new Response(JSON.stringify(transformed), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

addEventListener("fetch", (event) => {
  event.respondWith(handle());
});
```

**Gotcha:** `.json()`, `.text()`, and `.arrayBuffer()` are one-shot body consumers — calling any of them exhausts the body stream. You cannot read the body a second time from the same `Response`. If you need the raw bytes and a parsed value, read with `.arrayBuffer()` once, then parse from that buffer.

---

## Hono Proxy with Transform

Inside a Hono app, use `c.req.raw.headers` to access inbound headers and `c.req.arrayBuffer()` to read the request body for forwarding.

```typescript
import { Hono } from "hono";

const app = new Hono();

app.all("/api/*", async (c) => {
  const url = new URL(c.req.url);
  const upstream = `https://backend.example.com${url.pathname}${url.search}`;

  const response = await fetch(upstream, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.method !== "GET" && c.req.method !== "HEAD"
      ? await c.req.arrayBuffer()
      : undefined,
  });

  const data = await response.json();
  data.processedAt = new Date().toISOString();
  return c.json(data, response.status);
});

addEventListener("fetch", (event) => {
  event.respondWith(app.fetch(event.request));
});
```

**Note:** `c.req.raw` is the underlying Web API `Request` object. Use `c.req.raw.headers` (not `c.req.header()`) when you need a `Headers` instance to pass directly to `fetch()`.

---

## Header Manipulation in Proxies

Strip hop-by-hop headers before forwarding to upstream; add diagnostic headers on the response.

```typescript
async function handle(request) {
  const upstreamHeaders = new Headers(request.headers);
  // Hop-by-hop headers must not be forwarded
  upstreamHeaders.delete("connection");
  upstreamHeaders.delete("keep-alive");
  upstreamHeaders.delete("transfer-encoding");

  const upstream = await fetch("https://backend.example.com", {
    method: request.method,
    headers: upstreamHeaders,
  });

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set("X-Proxied-By", "FastEdge");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
```

**Streaming pattern:** `new Response(upstream.body, { status, headers })` passes the body stream through without reading it into memory. This is preferred for large responses. Use this form whenever no body transformation is needed.

**Hop-by-hop headers to strip before forwarding:** `connection`, `keep-alive`, `transfer-encoding`. These are transport-level headers that are not meaningful across proxy hops.

---

## Cache-Aware Proxy with KV

Use the KV store to cache upstream responses and avoid repeated outbound calls.

```typescript
import { KvStore } from "fastedge::kv";

async function handle(request) {
  const url = new URL(request.url);

  try {
    const cache = KvStore.open("api-cache");
    const cached = cache.get(url.pathname);
    if (cached !== null) {
      return new Response(cached, {
        status: 200,
        headers: { "content-type": "application/json", "x-cache": "hit" },
      });
    }
  } catch {
    // KV store unavailable — fall through to upstream fetch
  }

  const upstream = await fetch(`https://backend.example.com${url.pathname}`);
  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: { ...Object.fromEntries(upstream.headers), "x-cache": "miss" },
  });
}
```

**KV API details:**
- `KvStore.open(name: string)` — returns a `KvStoreInstance`. Does not return `null`, but **throws** if the named store is not provisioned. Always wrap the `open()` call in `try/catch`.
- `instance.get(key: string)` — returns `ArrayBuffer | null`. Returns `null` when the key is absent. An empty `ArrayBuffer` is a valid cached value — check strictly for `null`, not falsy.
- **KV is read-only from app code.** Writes happen via the Gcore portal or management API, not from within the app.

---

## API Reference

### `fetch(input, init?)`

Outbound HTTP request. Available globally in FastEdge HTTP apps.

| Parameter | Type | Description |
|---|---|---|
| `input` | `string \| URL \| Request` | Target URL or Request object |
| `init.method` | `string` | HTTP method |
| `init.headers` | `Headers \| Record<string, string>` | Request headers |
| `init.body` | `ArrayBuffer \| string \| ReadableStream \| null` | Request body; omit or set `undefined` for GET/HEAD |
| `init.redirect` | `"follow" \| "manual" \| "error"` | Redirect handling policy |

Returns: `Promise<Response>`

### `new Response(body, init?)`

| Parameter | Type | Description |
|---|---|---|
| `body` | `ReadableStream \| ArrayBuffer \| string \| null` | Response body. Pass `upstream.body` to stream without buffering. |
| `init.status` | `number` | HTTP status code |
| `init.headers` | `Headers \| Record<string, string>` | Response headers |

### `request.arrayBuffer()`

Returns: `Promise<ArrayBuffer>` — reads and consumes the full request body. One-shot; throws if called more than once on the same `Request`.

### `KvStore.open(name)`

Returns: `KvStoreInstance` — throws if the store is not provisioned.

### `instance.get(key)`

Returns: `ArrayBuffer | null` — `null` if the key does not exist.

---

## Operational Constraints

| Constraint | Basic plan | Pro plan |
|---|---|---|
| Outbound `fetch()` calls per invocation | 5 | 20 |
| Execution time budget | 50 ms | 200 ms |

- **Parallelise outbound calls** with `Promise.all([fetch(...), fetch(...)])` to stay within the call budget and reduce wall-clock time. Sequential `await fetch(...)` chains count against the same budget and are slower.
- **Slow upstreams** count against the execution budget. An upstream that does not respond within the remaining budget triggers a 532 timeout.
- **Body size limits** apply to both inbound and outbound bodies. Stream with `upstream.body` rather than buffering with `.arrayBuffer()` / `.text()` / `.json()` when the response is large.

---

## Gotchas

| Issue | Detail |
|---|---|
| Body consumed | `.json()`, `.text()`, `.arrayBuffer()` exhaust the body stream. Read once only. |
| KV throws, not null | `KvStore.open()` throws on missing store. Wrap in `try/catch`. |
| Hop-by-hop headers | `connection`, `keep-alive`, `transfer-encoding` must be deleted before forwarding. |
| Buffering vs streaming | Use `new Response(upstream.body, ...)` to stream; use `.arrayBuffer()` only when transformation requires the full body in memory. |
| Sequential fetch chains | Each `await fetch(...)` uses one outbound call slot sequentially. Use `Promise.all` to parallelise. |

---

## See Also

- examples/outbound-modify-response — JSON transform of upstream response
- examples/outbound-fetch — basic outbound fetch patterns
- examples/headers — request/response header manipulation
- examples/kv-store — KV-backed caching patterns
- platform-overview reference — plan limits, execution budget, and body size constraints
- sdk-reference-js reference — full KvStore API
