<!--
  auto-updated: true
  sources:
    - id: fastedge-test
      ref: v0.2.4
      commit: cbb5bebd8bad7e9fee4f1a006a39c8511f951717
      updated: 2026-06-11
-->

# Dotenv — Runtime Secrets and Environment Variables

The test runner and visual debugger inject env vars, secrets, and headers into the WASM app at runtime via dotenv files. These values are **not** fields in `fastedge-config.test.json` — they live in `.env` files only.

---

## Enabling Dotenv

**In fastedge-config.test.json** (for the visual debugger):

```json
{
  "dotenv": {
    "enabled": true
  }
}
```

**In defineTestSuite** (for the test runner):

```typescript
defineTestSuite({
  wasmPath: './build/app.wasm',
  runnerConfig: { dotenvEnabled: true },
  tests: [ ... ],
})
```

---

## Prefix Scheme

All values in a single `.env` file use the `FASTEDGE_VAR_` prefix to declare their type. The prefix is stripped before injection — your app reads the unprefixed name.

| Prefix                     | Type                 | App reads as                     |
| -------------------------- | -------------------- | -------------------------------- |
| `FASTEDGE_VAR_ENV_`        | Environment variable | `getEnv("VAR_NAME")`             |
| `FASTEDGE_VAR_SECRET_`     | Secret               | `getSecret("SECRET_NAME")`       |
| `FASTEDGE_VAR_REQ_HEADER_` | Request header       | Injected into every test request |
| `FASTEDGE_VAR_RSP_HEADER_` | Response header      | Added to every response          |

---

## Option A — Single `.env` File with Prefixes

```bash
# Environment variables (app reads as IDP_ENTITY_ID, etc.)
FASTEDGE_VAR_ENV_IDP_ENTITY_ID=https://idp.example.com
FASTEDGE_VAR_ENV_BASE_URL=https://app.example.com

# Secrets (app reads via getSecret())
FASTEDGE_VAR_SECRET_SESSION_SECRET=local-dev-secret
FASTEDGE_VAR_SECRET_IDP_CERT=-----BEGIN CERTIFICATE-----...

# Request headers injected into every test request
FASTEDGE_VAR_REQ_HEADER_authorization=Bearer test-token

# Response headers added to every response
FASTEDGE_VAR_RSP_HEADER_x-powered-by=FastEdge
```

---

## Option B — Type-Split Files (No Prefix Needed)

Instead of a single `.env` with prefixes, use separate files per type:

```
.env.variables     → env vars
.env.secrets       → secrets
.env.req_headers   → request headers
.env.rsp_headers   → response headers
```

Values in type-split files do not need the `FASTEDGE_VAR_` prefix — the file name determines the type.

---

## Priority Order (Highest to Lowest)

1. Direct `RunnerConfig` values (programmatic test API)
2. `.env` (prefixed)
3. `.env.variables` / `.env.secrets` / `.env.req_headers` / `.env.rsp_headers`
4. `fastedge-config.test.json` fallback

---

## Gitignore Guidance

**Commit:**

- `.env.example` — document expected variable names with placeholder values

**Gitignore:**

```
.env
.env.*
!.env.example
```

Never commit real secrets. Use `.env.example` with placeholder values so teammates know what to configure locally.
