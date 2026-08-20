<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-js
      ref: main
      commit: 81145a9a43ec499240c687bd49376ab20c72b11c
      updated: 2026-08-20
-->

## Headers Example — FastEdge JS

### Overview

Demonstrates reading request headers, injecting environment variable values into response headers, and echoing request headers to the response.

---

### Source

`examples/headers/src/index.js`

---

### Full Example

```js
import { getEnv } from 'fastedge::env';

async function eventHandler(event) {
  const request = event.request;

  const customEnvVariable = getEnv('MY_CUSTOM_ENV_VAR') ?? '';

  const responseHeaders = new Headers(request.headers);
  responseHeaders.set('my-custom-header', customEnvVariable);

  return new Response('Returned all headers with a custom header added', {
    headers: responseHeaders,
  });
}

addEventListener('fetch', (event) => {
  event.respondWith(eventHandler(event));
});
```

---

### API Usage in This Example

#### `new Headers(init?)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `init` | `HeadersInit` \| `Headers` | Optional. Existing `Headers` object or header key-value pairs to copy. |

- Passing an existing `Headers` instance (e.g., `request.headers`) copies all headers into a new mutable `Headers` object.
- The resulting object is **mutable** — `set`, `append`, `delete` are available.
- `request.headers` itself is **immutable**; do not attempt to mutate it directly.

#### `headers.set(name, value)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Header name. Case-insensitive per HTTP spec. |
| `value` | `string` | Header value to set. Replaces any existing value for this name. |

- Overwrites any existing header with the same name.
- Does not throw on reserved header names at the JS layer, but the runtime may strip or reject certain headers (e.g., `host`, `content-length`).

#### `headers.get(name)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Header name. Case-insensitive per HTTP spec. |

**Returns**: `string | null` — the header value, or `null` if the header is absent.

- Use to read individual request headers by name.
- Header name lookup is case-insensitive.

#### `getEnv(name)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Environment variable name as configured in the FastEdge app. |

**Returns**: `string | null` — the variable value, or `null` if not set.

Import path: `fastedge::env`

- Use nullish coalescing (`?? ''`) to provide a default when the variable is absent.
- Variable names are case-sensitive.

---

### Patterns Demonstrated

#### Echo request headers to response

```js
const responseHeaders = new Headers(request.headers);
return new Response(body, { headers: responseHeaders });
```

All incoming request headers are copied to the response by initialising `Headers` from `request.headers`.

#### Inject env var as response header

```js
const value = getEnv('MY_CUSTOM_ENV_VAR') ?? '';
responseHeaders.set('my-custom-header', value);
```

Environment variables are read at request time. Missing variables produce an empty string via the `??` fallback.

#### Read a specific request header

```js
const value = request.headers.get('x-some-header');
if (value !== null) {
  // header is present
}
```

`get` returns `null` when the header is absent; check explicitly before using the value.

#### Add a custom response header conditionally

```js
const responseHeaders = new Headers(request.headers);
const incoming = request.headers.get('x-forwarded-for');
if (incoming) {
  responseHeaders.set('x-client-ip', incoming);
}
```

Conditional header injection based on presence of a request header.

---

### Headers API Reference (Web-Standard Subset)

| Method | Signature | Description |
|--------|-----------|-------------|
| `get` | `get(name: string): string \| null` | Returns value for header name, or `null` if absent. |
| `set` | `set(name: string, value: string): void` | Sets header, replacing any existing value. |
| `append` | `append(name: string, value: string): void` | Adds a value without removing existing values for that name. |
| `delete` | `delete(name: string): void` | Removes the header. |
| `has` | `has(name: string): boolean` | Returns `true` if the header exists. |
| `entries` | `entries(): IterableIterator<[string, string]>` | Iterates all header name/value pairs. |

All method names are **case-insensitive** with respect to the header name argument (per HTTP spec).

---

### Constraints and Gotchas

| Constraint | Detail |
|------------|--------|
| `request.headers` is immutable | Cannot call `set`/`append`/`delete` on it directly. Copy into `new Headers(request.headers)` first. |
| Header name case | HTTP headers are case-insensitive; the `Headers` API normalises names to lowercase internally. |
| Reserved headers | Some headers (`host`, `content-length`, `transfer-encoding`) may be stripped or overridden by the runtime regardless of what is set. |
| Missing env var | `getEnv` returns `null` (not `undefined`) when the variable is unset. Use `?? ''` or an explicit null check. |
| `get` on absent header | Returns `null`, not `undefined` or empty string. Always null-check before string operations. |

---

### Package Configuration

```json
{
  "name": "fastedge-example-headers",
  "version": "1.0.0",
  "description": "FastEdge JS example: header manipulation with env vars",
  "type": "module",
  "scripts": {
    "build": "fastedge-build src/index.js dist/headers.wasm"
  },
  "dependencies": {
    "@gcoredev/fastedge-sdk-js": "^2.3.0"
  }
}
```

- `"type": "module"` — ES module syntax required (`import`/`export`).
- Build output: `dist/headers.wasm` — the binary uploaded to FastEdge.
- SDK version: `@gcoredev/fastedge-sdk-js ^2.3.0`.
