<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-js
      ref: main
      commit: 81145a9a43ec499240c687bd49376ab20c72b11c
      updated: 2026-08-20
-->

## Example: Geo-Redirect

Redirects incoming requests to different origins based on the visitor's country, using environment variables as a configurable country-to-URL mapping.

---

### Source

`examples/geo-redirect/src/index.js`

---

### Dependencies

| Package | Version |
|---|---|
| `@gcoredev/fastedge-sdk-js` | `^2.3.0` |

---

### Build

```bash
fastedge-build src/index.js dist/geo-redirect.wasm
```

---

### How It Works

1. Read `BASE_ORIGIN` env var — required fallback URL.
2. Read `geoip-country-code` request header — injected by FastEdge edge infrastructure.
3. Look up an env var matching the country code (e.g., `DE`, `US`, `FR`).
4. Redirect to the country-specific origin if found; otherwise redirect to `BASE_ORIGIN`.

---

### API Usage

#### `getEnv(name: string): string | null`

Import path: `fastedge::env`

| Parameter | Type | Description |
|---|---|---|
| `name` | `string` | Environment variable name |

Returns the value of the named env var, or `null` if not set.

Used for:
- `BASE_ORIGIN` — required fallback redirect target
- `<COUNTRY_CODE>` — optional per-country redirect target (e.g., `getEnv('DE')`)

---

#### `request.headers.get(name: string): string | null`

| Header | Source | Description |
|---|---|---|
| `geoip-country-code` | FastEdge infrastructure | ISO 3166-1 alpha-2 country code of the client |

Returns `null` if the header is absent.

---

#### `Response.redirect(url: string, status: number): Response`

| Parameter | Type | Description |
|---|---|---|
| `url` | `string` | Redirect target URL — must be a fully-qualified absolute URL |
| `status` | `number` | HTTP redirect status code |

This example uses status `302` (temporary redirect).

---

### Environment Variable Schema

| Variable | Required | Description |
|---|---|---|
| `BASE_ORIGIN` | Yes | Default redirect URL; used when no country-specific mapping exists |
| `<ISO_COUNTRY_CODE>` | No | Per-country redirect URL (e.g., `DE=https://de.example.com`) |

---

### Error Conditions

| Condition | Response |
|---|---|
| `BASE_ORIGIN` not set | `500` with body `BASE_ORIGIN environment variable is not set` |
| Country code absent or no matching env var | Redirects to `BASE_ORIGIN` |

---

### Event Handler Pattern

```js
addEventListener('fetch', (event) => {
  event.respondWith(eventHandler(event));
});
```

The handler receives `{ request }` from the event object.

---

### Full Source

```js
import { getEnv } from 'fastedge::env';

async function eventHandler({ request }) {
  const baseOrigin = getEnv('BASE_ORIGIN');

  if (!baseOrigin) {
    return new Response('BASE_ORIGIN environment variable is not set', {
      status: 500,
    });
  }

  const countryCode = request.headers.get('geoip-country-code');

  const customOrigin = countryCode ? getEnv(countryCode) : null;

  const redirectOrigin = customOrigin ?? baseOrigin;

  return Response.redirect(redirectOrigin, 302);
}

addEventListener('fetch', (event) => {
  event.respondWith(eventHandler(event));
});
```

---

### Gotchas

- **Header availability**: `geoip-country-code` is injected by FastEdge infrastructure. It is absent in local test environments unless manually set.
- **Geolocation accuracy**: Country detection is based on IP geolocation; VPN or proxy users may be misidentified.
- **Caching**: If responses are cached by a CDN layer, add `Vary: geoip-country-code` to prevent stale geo-mismatches across clients from different countries.
- **Null-safe lookup**: The example uses `countryCode ? getEnv(countryCode) : null` — if `geoip-country-code` is an empty string, it is treated as absent.
- **Redirect target must be an absolute URL**: `Response.redirect` requires a fully-qualified URL (e.g., `https://de.example.com`), not a path.
