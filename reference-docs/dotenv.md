<!--
  auto-updated: true
  sources:
    - id: fastedge-test
      ref: v0.3.1
      commit: ccc68985ba8dcb688c077c04f2a3762ee34f944d
      updated: 2026-11-23
-->

# Dotenv — Runtime Secrets and Environment Variables

The test runner and visual debugger inject env vars, secrets, and headers into the WASM app at runtime via dotenv files. These values are **not** fields in `fastedge-config.test.json` — they live in `.env` files only.

---

## Enabling Dotenv

**In fastedge-config.test.json** (for the visual debugger):

```json
{
  "dotenv": {
    "enabled": true,
    "path": "./fixtures"
  }
}
```

**In defineTestSuite** (for the test runner):

```typescript
defineTestSuite({
  wasmPath: './build/app.wasm',
  runnerConfig: { dotenv: { enabled: true, path: './fixtures' } },
  tests: [ ... ],
})
```

`enabled` defaults to `false`. `path` is a **directory** containing the dotenv files, not a file. When `path` is omitted, the process current working directory is used. In the config file, a relative `path` is resolved against the directory containing the config file.

---

## Prefix Scheme

In a single `.env` file, a key may use a `FASTEDGE_VAR_` prefix to declare its type; an unprefixed key is an env var. The prefix is stripped before injection — the app reads the unprefixed name.

| Prefix                     | Type                 | How app reads it                    | App types          |
| -------------------------- | -------------------- | ----------------------------------- | ------------------ |
| `FASTEDGE_VAR_ENV_`        | Environment variable | `getEnv("VAR_NAME")`                | CDN and HTTP-WASM  |
| `FASTEDGE_VAR_SECRET_`     | Secret               | `getSecret("SECRET_NAME")`          | CDN and HTTP-WASM  |
| `FASTEDGE_VAR_REQ_HEADER_` | Request header       | Injected into every test request    | HTTP-WASM only     |
| `FASTEDGE_VAR_RSP_HEADER_` | Response header      | Added to every response             | HTTP-WASM only     |

---

## Option A — Single `.env` File with Prefixes

```bash
# Environment variables (app reads as IDP_ENTITY_ID, BASE_URL)
FASTEDGE_VAR_ENV_IDP_ENTITY_ID=https://idp.example.com
FASTEDGE_VAR_ENV_BASE_URL=https://app.example.com

# Secrets (app reads via getSecret())
FASTEDGE_VAR_SECRET_SESSION_SECRET=local-dev-secret
FASTEDGE_VAR_SECRET_IDP_CERT=-----BEGIN CERTIFICATE-----...

# Request headers injected into every test request (HTTP-WASM only)
FASTEDGE_VAR_REQ_HEADER_authorization=Bearer test-token

# Response headers added to every response (HTTP-WASM only)
FASTEDGE_VAR_RSP_HEADER_x-powered-by=FastEdge
```

The prefix is stripped before injection. An unprefixed key in `.env` is treated as an env var — the `FASTEDGE_VAR_ENV_` prefix is optional for env vars.

---

## Option B — Type-Split Files (No Prefix Needed)

Instead of a single `.env` with prefixes, use separate files per type. Values in type-split files do not use the `FASTEDGE_VAR_` prefix — the file name determines the type.

| File               | Type              | App types         |
| ------------------ | ----------------- | ----------------- |
| `.env.variables`   | Env vars          | CDN and HTTP-WASM |
| `.env.secrets`     | Secrets           | CDN and HTTP-WASM |
| `.env.req_headers` | Request headers   | HTTP-WASM only    |
| `.env.rsp_headers` | Response headers  | HTTP-WASM only    |

Missing files are skipped.

---

## Key Rules

The following rules apply equally to CDN (proxy-wasm) and HTTP-WASM apps — the CDN runner applies the same logic as `fastedge-run --dotenv`:

- An unprefixed key in `.env` is an env var.
- A key with `FASTEDGE_VAR_ENV_` in `.env` is an env var; `FASTEDGE_VAR_SECRET_` is a secret. The prefix is stripped.
- Any other `FASTEDGE_VAR_` key in `.env` (e.g. headers, KV) is neither an env var nor a secret.
- Keys starting with `FASTEDGE_VAR_` inside `.env.variables` or `.env.secrets` are skipped.
- `.env` is read first. For the same key, `.env` wins over `.env.variables` and `.env.secrets`.
- Dotenv files are the only source: there is no `RunnerConfig` env-var field and no `fastedge-config.test.json` fallback.

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

## See Also

- TEST_CONFIG reference — `dotenv` field schema, path resolution, and `loadConfigFile` behaviour
- TEST_FRAMEWORK reference — using `defineTestSuite` with `runnerConfig`
- VSCode debugger reference — visual debugger dotenv integration
