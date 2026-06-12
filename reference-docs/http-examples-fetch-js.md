<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-js
      ref: main
      commit: 36cf4c4af034a19e45e5a92d06aa95adeb9b1ff9
      updated: 2026-06-11
-->

## fetch — Outbound HTTP Requests

### Overview

FastEdge JS supports outbound HTTP requests via the standard `fetch(url, options)` API. The runtime exposes a subset of the browser Fetch API sufficient for downstream service calls.

---

### API Signature

```js
fetch(url: string, options?: RequestInit): Promise<Response>
```

**Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | `string` | Yes | Absolute URL of the downstream resource |
| `options` | `RequestInit` | No | Standard fetch init object (method, headers, body, etc.) |

**Returns**: `Promise<Response>` — resolves to a `Response` object.

---

### Usage Pattern

**Simple GET request**

```js
async function app(event) {
  return await fetch('http://jsonplaceholder.typicode.com/users');
}

addEventListener('fetch', (event) => {
  event.respondWith(app(event));
});
```

- `fetch()` result can be returned directly from the handler — the runtime forwards the downstream response to the client.
- `event.respondWith()` accepts a `Promise<Response>`.

---

### Dependencies

| Package | Version |
|---------|---------|
| `@gcoredev/fastedge-sdk-js` | `^2.2.2` |

**Build command**: `fastedge-build src/index.js dist/outbound-fetch.wasm`

**Module format**: ESM (`"type": "module"` in `package.json`). CommonJS `require()` is not supported.

---

### Constraints

- Only **absolute URLs** are supported. Relative URLs are not valid.
- The runtime handles DNS resolution and connection management; no direct socket access is available.
- `fetch()` is available globally within the handler scope — no explicit import required.
- Module format: **ESM** (`"type": "module"` in `package.json`). CommonJS `require()` is not supported.

---

### Response Handling

The returned `Response` object supports standard properties:

| Property/Method | Type | Description |
|----------------|------|-------------|
| `response.status` | `number` | HTTP status code |
| `response.headers` | `Headers` | Response headers |
| `response.text()` | `Promise<string>` | Body as text |
| `response.json()` | `Promise<any>` | Body parsed as JSON |
| `response.arrayBuffer()` | `Promise<ArrayBuffer>` | Raw body bytes |

---

### Error Conditions

- Network failures (unreachable host, DNS failure) cause the `fetch()` promise to reject. Unhandled rejections result in a 500 response to the client.
- No timeout configuration is exposed in source material; assume runtime-level limits apply.
