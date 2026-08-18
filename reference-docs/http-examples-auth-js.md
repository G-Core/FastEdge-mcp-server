<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-js
      ref: main
      commit: 81145a9a43ec499240c687bd49376ab20c72b11c
      updated: 2026-08-17
-->

# Authentication Patterns (JavaScript)

Authentication on FastEdge combines `getSecret` (for signing keys and shared secrets) with `crypto.subtle` (for HMAC and signature verification). This document covers Bearer-token validation and HMAC-SHA256 JWT verification.

## API Reference

### `getSecret(name: string): string | null`

Import: `import { getSecret } from "fastedge::secret";`

Returns the secret value as a string, or `null` if the secret is not provisioned. Must be called inside the request handler — not at module initialization scope.

### `crypto.subtle.importKey`

Supported key formats: JWK, PKCS#8, SPKI, raw (HMAC).

### `crypto.subtle.verify`

Supported algorithms: RSASSA-PKCS1-v1_5, ECDSA, HMAC.

### Crypto capability matrix

| Operation | Algorithms supported |
|---|---|
| `digest` | SHA-1, SHA-256, SHA-384, SHA-512 |
| `sign` / `verify` | RSASSA-PKCS1-v1_5, ECDSA, HMAC |
| `importKey` | JWK, PKCS#8, SPKI, raw (HMAC) |

**Not implemented:** `encrypt`, `decrypt`, `generateKey`, `deriveKey`, `deriveBits`, `exportKey`. For the full crypto matrix and runtime constraints, see the runtime constraints reference.

---

## Secrets Setup

Auth credentials must never be hardcoded. Store them as FastEdge secrets and read at request time:

```typescript
import { getSecret } from "fastedge::secret";

const token = getSecret("API_TOKEN");      // string | null
if (token === null) {
  return new Response("Server misconfigured", { status: 500 });
}
```

`getSecret` returns `null` when the secret is not provisioned. Always handle the null case before using the value — omitting the null check causes a 531 runtime error.

---

## Bearer Token Pattern

Extract a Bearer token from the `Authorization` header and compare against a configured shared secret:

```typescript
import { getSecret } from "fastedge::secret";

addEventListener("fetch", (event) => {
  event.respondWith(handle(event.request));
});

async function handle(request) {
  const authHeader = request.headers.get("Authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/iu);
  if (!match) {
    return Response.json(
      { error: "missing or malformed Authorization header" },
      { status: 401 },
    );
  }

  const expected = getSecret("API_TOKEN");
  if (expected === null) {
    return Response.json({ error: "server misconfigured" }, { status: 500 });
  }

  if (match[1] !== expected) {
    return Response.json({ error: "invalid token" }, { status: 403 });
  }

  return Response.json({ ok: true });
}
```

Response shape:
- Missing or malformed header → 401 `{ error: "missing or malformed Authorization header" }`
- Secret not provisioned → 500 `{ error: "server misconfigured" }`
- Token mismatch → 403 `{ error: "invalid token" }`
- Success → 200 `{ ok: true }`

### Hono Middleware Variant

The same logic wrapped as Hono middleware for route-level protection:

```typescript
import { Hono } from "hono";
import { getSecret } from "fastedge::secret";

const app = new Hono();

app.use("/api/*", async (c, next) => {
  const auth = c.req.header("Authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/iu);
  if (!match) return c.json({ error: "missing bearer token" }, 401);

  const expected = getSecret("API_TOKEN");
  if (expected === null) return c.json({ error: "server misconfigured" }, 500);
  if (match[1] !== expected) return c.json({ error: "invalid token" }, 403);

  await next();
});
```

---

## HMAC-SHA256 JWT Verification

Source: `examples/crypto-hmac-jwt/`. Uses `crypto.subtle.importKey` and `crypto.subtle.verify` with `{ name: "HMAC", hash: "SHA-256" }`.

### Helper: `base64urlToBytes`

```typescript
function base64urlToBytes(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
```

### `verifyJwtHs256(token, secret)`

```typescript
const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function verifyJwtHs256(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const signature = base64urlToBytes(encodedSignature);
  const signedData = encoder.encode(`${encodedHeader}.${encodedPayload}`);
  const valid = await crypto.subtle.verify("HMAC", key, signature, signedData);
  if (!valid) throw new Error("invalid signature");

  const claims = JSON.parse(decoder.decode(base64urlToBytes(encodedPayload)));
  if (typeof claims.exp === "number" && Math.floor(Date.now() / 1000) >= claims.exp) {
    throw new Error("token expired");
  }
  return claims;
}
```

Throws:
- `"malformed token"` — token does not have exactly 3 dot-separated parts
- `"invalid signature"` — HMAC verification failed
- `"token expired"` — `exp` claim is present and in the past

Returns: parsed claims object on success.

### Request Handler Integration

```typescript
async function handle(request) {
  const auth = request.headers.get("Authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/iu);
  if (!match) {
    return Response.json({ ok: false, error: "missing bearer" }, { status: 401 });
  }

  const secret = getSecret("JWT_SECRET");
  if (!secret) {
    return Response.json({ ok: false, error: "JWT_SECRET not configured" }, { status: 500 });
  }

  try {
    const claims = await verifyJwtHs256(match[1], secret);
    return Response.json({ ok: true, claims });
  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 401 });
  }
}
```

---

## Operational Notes

- **Never log secret values.** `console.log` output is captured in app logs.
- **`getSecret` is request-time only.** It is not available during module initialization — call it inside the request handler, not at the top level of the module.
- **Always check for `null`.** A misconfigured secret should return 500, not crash with a 531 runtime error.
- **Rotate secrets via the API or portal**, not by redeploying the binary.
- **`crypto.subtle.encrypt`, `decrypt`, `generateKey`, `deriveKey`, `exportKey` are NOT available.** See the runtime constraints reference for the full crypto capability matrix and SAML/library compatibility notes.

---

## See Also

- `examples/crypto-hmac-jwt/` — complete HMAC JWT verification example with fixtures
- `examples/secret-rotation/` — `getSecretEffectiveAt` slot-based rotation patterns
- runtime constraints reference — full crypto matrix, unavailable APIs, SAML library compatibility
