<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-js
      ref: main
      commit: 81145a9a43ec499240c687bd49376ab20c72b11c
      updated: 2026-08-20
-->

# A/B Testing — FastEdge Example

## Overview

Cookie-based A/B testing at the edge. Assigns visitors to test variants using a persistent cookie, injects variant headers before forwarding to origin, and proxies the response.

---

## Pattern Summary

| Concern | Approach |
|---|---|
| Variant assignment | Random float `[0,1)` on first visit; persisted in `x-fastedge-abid` cookie |
| Variant communication | Request headers (`ab-test-<testName>: <variant>`) forwarded to origin |
| Cookie persistence | `Max-Age=31536000` (1 year), `Secure; HttpOnly; SameSite=Lax` |
| Origin URL | Configured via `OUTBOUND_URL` environment variable |
| Weight normalization | Weights are relative (not required to sum to 100) |

---

## Environment Variables

| Name | Required | Description |
|---|---|---|
| `OUTBOUND_URL` | Yes | Full URL of the outbound/origin service to proxy requests to |

Returns `500` with body `OUTBOUND_URL environment variable is not configured` if missing or blank.

---

## Test Configuration Schema

```js
const testConfig = {
  <testName>: [
    { variant: string, weight: number },
    ...
  ],
  ...
};
```

- `testName`: Used as the header name suffix — becomes `ab-test-<testName>`
- `variant`: Value set on the header
- `weight`: Relative weight; normalized to percentages internally

### Example

```js
const testConfig = {
  logo: [
    { variant: 'hops', weight: 50 },
    { variant: 'bottle', weight: 50 },
  ],
  font: [
    { variant: 'exo2', weight: 40 },
    { variant: 'gloria', weight: 65 },
    { variant: 'standard', weight: 45 },
  ],
};
```

---

## Request Flow

1. Extract `x-fastedge-abid` cookie from incoming request
2. If present: use existing `xid` value; strip cookie from upstream request
3. If absent: generate `xid = Math.random().toString().slice(1, 5)` (e.g. `.473`)
4. For each test in `testConfig`: map `xid * 100` to a variant bucket using normalized weights
5. Set `ab-test-<testName>: <variant>` header on the upstream request
6. Fetch `OUTBOUND_URL` with modified headers
7. Set `x-fastedge-abid=<xid>` cookie on the response

---

## Cookie Format

**Inbound read** (regex): `/(?:^|;) *x-fastedge-abid=((0|1|)\.\d+) *(?:;|$)/u`

Matches values like `.473`, `0.473`, `1.0` (float with leading digit 0, 1, or empty).

**Outbound set**:
```
x-fastedge-abid=<xid>; Max-Age=31536000; Path=/; Secure; HttpOnly; SameSite=Lax;
```

---

## Variant Selection Algorithm

```
xidPercentage = parseFloat(xid) * 100
normalized = weights mapped to percentages (sum of weights = 100%)
for each variant [start, end):
  if xidPercentage >= start && xidPercentage < end → assign variant
```

Variant assignment is deterministic for a given `xid`. Weights are relative — they do not need to sum to 100.

---

## Headers Set on Upstream Request

One header per test name:

```
ab-test-logo: hops
ab-test-font: gloria
```

The `cookie` header is modified: `x-fastedge-abid` is stripped before forwarding to origin.

---

## Cookie Stripping Logic

When the `x-fastedge-abid` cookie is present:

- The full cookie string value matching `/x-fastedge-abid=[^;]+;?\s*/gu` is removed.
- If the resulting cookie string is non-empty, `headers.set('cookie', newCookie)` is called.
- If the resulting cookie string is empty, `headers.delete('cookie')` is called.

---

## Key Functions

### `sliceAbTestIdFromCookie(request)`

Extracts the A/B test ID from the incoming request cookie and returns modified headers with the cookie stripped.

**Parameters**: `request` — incoming `Request` object

**Returns**: `[xid: string, headers: Headers]`
- `xid`: existing cookie value if present, otherwise `` `${Math.random()}`.slice(1, 5) ``
- `headers`: new `Headers` instance with `x-fastedge-abid` cookie removed (or `cookie` header deleted if it was the only cookie)

---

### `forceWeightsToPercentages(testValues)`

Normalizes variant weights to percentages.

**Parameters**: `testValues` — `Array<{ variant: string, weight: number }>`

**Returns**: `Array<{ variant: string, percentage: number }>`

Divides each weight by the sum of all weights, then multiplies by 100. Weights do not need to sum to any specific value.

---

### `createAbTestHeaders(reqHeaders, testConfig, xid)`

Builds upstream request headers with A/B test variant assignments.

**Parameters**:
- `reqHeaders: Headers` — headers from the (already stripped) incoming request
- `testConfig: object` — test configuration object (see schema above)
- `xid: string` — A/B test ID value

**Returns**: `Headers` — new `Headers` instance with `ab-test-<testName>` headers set for each test

Iterates each test in `testConfig`, maps `xid * 100` into the normalized variant bucket range using `Number.parseFloat`, and sets the corresponding header.

---

## Imports Used

| Import | Source | Purpose |
|---|---|---|
| `getEnv` | `fastedge::env` | Read `OUTBOUND_URL` environment variable |

---

## Build

```json
{
  "main": "src/index.js",
  "scripts": {
    "build": "fastedge-build src/index.js dist/ab-testing.wasm"
  },
  "dependencies": {
    "@gcoredev/fastedge-sdk-js": "^2.3.0"
  }
}
```

---

## Gotchas

- **Headers are immutable**: `Request` and `Response` headers cannot be mutated in place. Always construct `new Headers(existingHeaders)` before calling `.set()` or `.delete()`.
- **Cookie stripping**: The `x-fastedge-abid` cookie is removed from the upstream request to avoid leaking internal test identifiers to the origin.
- **Caching**: Variant headers on the upstream request will cause cache misses if the CDN or origin caches by request headers. Ensure cache keys or `Vary` headers account for `ab-test-*` headers.
- **Cookie scope**: `Path=/` means the cookie applies site-wide. `SameSite=Lax` prevents cross-site cookie sending while allowing top-level navigation.
- **Variant consistency**: Consistency is guaranteed only while the cookie persists. Clearing cookies resets variant assignment.
- **`xid` range**: `Math.random()` can return `0` but not `1`. `slice(1, 5)` on `"0.473..."` yields `".473"` — always a 4-character string starting with `.`.
- **Empty cookie after strip**: If `x-fastedge-abid` was the only cookie, the `cookie` header is deleted entirely rather than set to an empty string.
- **Last variant not assigned**: If `xid * 100` falls exactly at or beyond the sum of all normalized percentages (due to floating-point rounding), no variant header is set for that test. In practice this is extremely rare given `xid` is always `< 1`.

---

## Source

```js
import { getEnv } from 'fastedge::env';

const testConfig = {
  logo: [
    { variant: 'hops', weight: 50 },
    { variant: 'bottle', weight: 50 },
  ],
  font: [
    { variant: 'exo2', weight: 40 },
    { variant: 'gloria', weight: 65 },
    { variant: 'standard', weight: 45 },
  ],
};

async function eventHandler({ request }) {
  const [xid, slicedHeaders] = sliceAbTestIdFromCookie(request);

  const headers = createAbTestHeaders(slicedHeaders, testConfig, xid);

  const outboundUrl = getEnv('OUTBOUND_URL');
  if (!outboundUrl || !String(outboundUrl).trim()) {
    return new Response('OUTBOUND_URL environment variable is not configured', {
      status: 500,
    });
  }

  const response = await fetch(outboundUrl, { headers });

  const resHeaders = new Headers(response.headers);
  resHeaders.set(
    'set-cookie',
    `x-fastedge-abid=${xid}; Max-Age=31536000; Path=/; Secure; HttpOnly; SameSite=Lax;`,
  );

  return new Response(response.body, {
    status: response.status,
    headers: resHeaders,
  });
}

addEventListener('fetch', (event) => {
  event.respondWith(eventHandler(event));
});

const sliceAbTestIdFromCookie = ({ headers: reqHeaders }) => {
  const headers = new Headers(reqHeaders);
  const cookie = headers.get('cookie') || '';
  const xid = (cookie.match(/(?:^|;) *x-fastedge-abid=((0|1|)\.\d+) *(?:;|$)/u) || [])[1];
  if (xid) {
    const newCookie = cookie.replace(/x-fastedge-abid=[^;]+;?\s*/gu, '');
    if (newCookie) {
      headers.set('cookie', newCookie);
    } else {
      headers.delete('cookie');
    }
    return [xid, headers];
  }
  const randomXid = `${Math.random()}`.slice(1, 5);
  return [randomXid, headers];
};

const forceWeightsToPercentages = (testValues) => {
  const total = testValues.reduce((acc, { weight }) => acc + weight, 0);
  return testValues.map(({ variant, weight }) => ({
    variant,
    percentage: (weight / total) * 100,
  }));
};

const createAbTestHeaders = (reqHeaders, testConfig, xid) => {
  const headers = new Headers(reqHeaders);
  for (const testName of Object.keys(testConfig)) {
    const xidPercentage = Number.parseFloat(xid) * 100;
    const testValues = forceWeightsToPercentages(testConfig[testName]);
    let start = 0;
    for (const { variant, percentage } of testValues) {
      const end = start + percentage;
      if (xidPercentage >= start && xidPercentage < end) {
        headers.set(`ab-test-${testName}`, variant);
        break;
      }
      start = end;
    }
  }
  return headers;
};
```
