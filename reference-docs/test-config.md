<!--
  auto-updated: true
  sources:
    - id: fastedge-test
      ref: v0.1.4
      commit: 5b7f9b5172519a95a3f28edef45aaa160ff7562e
      updated: 2026-04-09
-->

# test-config Reference

`fastedge-config.test.json` defines the WASM binary, simulated HTTP request, mock origin response, CDN properties, and dotenv loading for a single test scenario — it auto-loads on debugger start and is read programmatically via `loadConfigFile()`.

---

## Schema

The config schema is a union of two variants selected by `appType`:

- **`proxy-wasm`** (CDN mode, default): The WASM module intercepts an upstream HTTP request. Uses `request.url` (full URL). Supports a mock origin `response`.
- **`http-wasm`**: The WASM module acts as an origin HTTP server. Uses `request.path` (path only). No `response` field.

### Top-Level Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `$schema` | string | no | — | Path to `./node_modules/@gcoredev/fastedge-test/schemas/fastedge-config.test.schema.json` for IDE validation and autocompletion |
| `description` | string | no | — | Human-readable label for this test scenario |
| `appType` | string | yes (schema) / CDN has runtime default | `"proxy-wasm"` | App variant. `"proxy-wasm"` for CDN mode; `"http-wasm"` for HTTP mode. HTTP-WASM has no runtime default and must always be specified |
| `wasm` | object | no* | — | WASM binary configuration. Required when running without a programmatic `wasmBuffer` |
| `wasm.path` | string | yes (if `wasm` present) | — | Relative or absolute path to the compiled `.wasm` binary |
| `wasm.description` | string | no | — | Human-readable label for the loaded binary |
| `appType` | string | yes (schema) / CDN has runtime default | `"proxy-wasm"` | App variant. `"proxy-wasm"` for CDN mode; `"http-wasm"` for HTTP mode. HTTP-WASM has no default — must be specified explicitly |
| `request` | object | **yes** | — | Incoming HTTP request to simulate |
| `request.method` | string | yes (schema) / runtime default | `"GET"` | HTTP method (e.g. `"GET"`, `"POST"`) |
| `request.url` | string | **yes** (CDN only) | — | Full URL for the simulated upstream request (e.g. `"https://example.com/api"`). CDN (`proxy-wasm`) mode only |
| `request.path` | string | **yes** (HTTP-WASM only) | — | Request path (e.g. `"/api/submit"`). HTTP-WASM mode only. The WASM module acts as the origin server and receives only the path portion |
| `request.headers` | object | yes (schema) / runtime default | `{}` | Key/value map of request headers. All keys and values must be strings |
| `request.body` | string | yes (schema) / runtime default | `""` | Request body as a plain string |
| `response` | object | no | — | CDN mode only — mock origin response for the WASM filter to inspect and modify. Not applicable to HTTP-WASM |
| `response.headers` | object | yes (if `response` present) | `{}` | Mock origin response headers as string key-value pairs |
| `response.body` | string | yes (if `response` present) | `""` | Mock origin response body as a plain string |
| `properties` | object | yes (schema) / runtime default | `{}` | CDN property key-value pairs passed to the WASM execution context. Values may be any JSON type. Pass `{}` for HTTP-WASM to satisfy the schema requirement |
| `dotenv` | object | no | — | Dotenv file loading configuration |
| `dotenv.enabled` | boolean | no | — | Whether to load a `.env` file before execution |
| `dotenv.path` | string | no | — | Path to the `.env` file. If omitted, resolves `.env` relative to the config file directory |

*`wasm` is optional only if you supply the binary manually via a programmatic `wasmBuffer`. It is required for file-based test runs and debugger auto-load.

### Required vs. Default Distinction

The JSON Schema `required` arrays drive editor validation. Fields like `appType`, `request.method`, `request.headers`, `request.body`, and `properties` appear in the schema's `required` array, so a strict JSON Schema validator will flag them as missing. At runtime the Zod schema fills in their defaults (`"proxy-wasm"`, `"GET"`, `{}`, `""`, and `{}` respectively), so the test runner accepts configs that omit them — with the exception of `appType: "http-wasm"`, which has no Zod default and must always be specified for HTTP-WASM configs.

Supply fields explicitly to avoid editor warnings, or add the `$schema` field and accept that your editor may warn on omission.

---

## Runtime Secrets and Env Vars

`envVars` and `secrets` are **not** fields in `fastedge-config.test.json`. Inject all runtime values via dotenv files — see the dotenv configuration reference for the full setup including prefix scheme, file options, priority order, and gitignore guidance.

---

## CDN Example

```json
{
  "$schema": "./node_modules/@gcoredev/fastedge-test/schemas/fastedge-config.test.schema.json",
  "description": "Geo-filter CDN app",
  "appType": "proxy-wasm",
  "wasm": {
    "path": "./dist/filter.wasm",
    "description": "Geo-filter proxy-wasm binary"
  },
  "request": {
    "method": "GET",
    "url": "https://example.com/page",
    "headers": { "user-agent": "Mozilla/5.0" },
    "body": ""
  },
  "response": {
    "headers": { "content-type": "text/html" },
    "body": "<html>Original content</html>"
  },
  "properties": {
    "request.country": "US",
    "client.ip": "1.2.3.4"
  },
  "dotenv": {
    "enabled": true,
    "path": "./.env.test"
  }
}
```

`response` provides the mock origin response the WASM filter will inspect and optionally modify. `properties` passes CDN context values into the execution environment.

---

## HTTP-WASM Example

```json
{
  "$schema": "./node_modules/@gcoredev/fastedge-test/schemas/fastedge-config.test.schema.json",
  "description": "HTTP-WASM POST handler",
  "appType": "http-wasm",
  "wasm": {
    "path": "./dist/http-handler.wasm"
  },
  "request": {
    "method": "POST",
    "path": "/submit",
    "headers": {
      "content-type": "application/json",
      "authorization": "Bearer test-token"
    },
    "body": "{\"key\": \"value\"}"
  },
  "properties": {}
}
```

`appType` must be `"http-wasm"` — there is no runtime default for this variant. Use `request.path` (not `request.url`); the WASM module acts as the origin server and receives only the path portion of the request. HTTP-WASM apps omit `response` (no mock origin).

---

## What to Commit / Gitignore

**Commit:**
- `fastedge-config.test.json` — encodes the test scenario; useful for teammates; use placeholder values if any field would contain a real secret
- `.env.example` — documents expected variable names with placeholder values so teammates know what to configure locally

**Gitignore:**
```
.env
.env.*
!.env.example
```

---

## See Also

- test-framework — using `loadConfigFile` in test suites, `runFlow`, and the full test framework API
- dotenv — runtime secret injection, prefix scheme, file resolution order, and gitignore guidance
- vscode-debugger — debugger UI, auto-load behaviour, and launch configuration
