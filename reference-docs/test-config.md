<!--
  auto-updated: true
  sources:
    - id: fastedge-test
      ref: v0.3.1
      commit: ccc68985ba8dcb688c077c04f2a3762ee34f944d
      updated: 2026-11-23
-->

# test-config Reference

`fastedge-config.test.json` defines the WASM binary, simulated HTTP request, CDN properties, client and edge context, origin, and dotenv loading for a single test scenario — it auto-loads on debugger start and is read programmatically via `loadConfigFile()`.

---

## Schema

The config schema is a union of two variants selected by `appType`:

- **`proxy-wasm`** (CDN mode, default): The WASM module intercepts an upstream HTTP request. Uses `request.url` (full URL). The response is generated at runtime — by a real fetch against `request.url`, by the built-in responder when `request.url === "built-in"`, or from the optional `origin` field.
- **`http-wasm`**: The WASM module acts as an origin HTTP server. Uses `request.path` (path only). No mock origin response.

### Top-Level Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `$schema` | string | no | — | Path to `./node_modules/@gcoredev/fastedge-test/schemas/fastedge-config.test.schema.json` for IDE validation and autocompletion |
| `description` | string | no | — | Human-readable label for this test scenario |
| `appType` | string | yes (HTTP-WASM) | `"proxy-wasm"` | App variant. `"proxy-wasm"` for CDN mode; `"http-wasm"` for HTTP mode. HTTP-WASM has no runtime default and must always be specified |
| `wasm` | object | no* | — | WASM binary configuration. Required when running without a programmatic `wasmBuffer` |
| `wasm.path` | string | yes (if `wasm` present) | — | Path to the compiled `.wasm` binary |
| `wasm.description` | string | no | — | Human-readable label for the loaded binary |
| `request` | object | **yes** | — | Incoming HTTP request to simulate |
| `request.method` | string | no | `"GET"` | HTTP method (e.g. `"GET"`, `"POST"`) |
| `request.url` | string | **yes** (CDN only) | — | Full URL for the simulated upstream request (e.g. `"https://example.com/api"`). CDN (`proxy-wasm`) mode only. Use `"built-in"` to invoke the local built-in responder without a real upstream fetch |
| `request.path` | string | **yes** (HTTP-WASM only) | — | Request path (e.g. `"/api/submit"`). HTTP-WASM mode only |
| `request.headers` | object | no | `{}` | Key/value map of request headers. All keys and values must be strings |
| `request.body` | string | no | `""` | Request body as a plain string |
| `properties` | object | no | `{}` | CDN property key-value pairs passed to the WASM execution context. Values may be any JSON type |
| `httpPort` | integer | no | — | HTTP-WASM only. Pin the subprocess to a specific port (1024–65535) instead of dynamic allocation from the 8100–8199 pool. Throws if the port is busy. Not used by `proxy-wasm` configs |
| `dotenv` | object | no | — | Dotenv file loading configuration |
| `dotenv.enabled` | boolean | no | `false` | Whether to load dotenv files before execution |
| `dotenv.path` | string | no | — | Directory containing the dotenv files (not a file path). If omitted, resolves against the process current working directory |
| `stores` | boolean | no | `true` | Enables the local cache and Edge KV. `false`: CDN cache / KV calls fail; HTTP apps use fastedge-run's own per-process cache |
| `dc` | string | no | `"local"` | Cache bucket name. Must be a non-empty string. Runners with the same `dc` share cache entries |
| `client` | object | no | — | Where the client is: a preset plus per-field overrides |
| `client.preset` | string | no | — | Geographic preset: `"de"`, `"nl"`, or `"us"` |
| `client.ip` | string | no | — | Client IP address |
| `client.asn` | string | no | — | Client ASN |
| `client.country` | string | no | — | Client country code |
| `client.countryName` | string | no | — | Client country name |
| `client.city` | string | no | — | Client city |
| `client.region` | string | no | — | Client region |
| `client.continent` | string | no | — | Client continent |
| `client.lat` | string | no | — | Client latitude |
| `client.long` | string | no | — | Client longitude |
| `edge` | object | no | — | Which edge POP runs the app: a preset plus per-field overrides |
| `edge.preset` | string | no | — | POP preset: `"de"`, `"nl"`, or `"us"` |
| `edge.dc` | string | no | — | POP data center; the cache bucket unless top-level `dc` is set |
| `edge.region` | string | no | — | Edge POP region |
| `edge.country` | string | no | — | Edge POP country |
| `edge.city` | string | no | — | Edge POP city |
| `edge.hostname` | string | no | — | Edge POP hostname |
| `edge.popLat` | string | no | — | POP latitude |
| `edge.popLong` | string | no | — | POP longitude |
| `edge.popReg` | string | no | — | POP region |
| `edge.popCity` | string | no | — | POP city |
| `edge.popContinent` | string | no | — | POP continent |
| `edge.popCountryCode` | string | no | — | POP country code |
| `edge.popCountryName` | string | no | — | POP country name |
| `origin` | object | no | — | CDN only. Where the response comes from: `{ "url" }` or `{ "builtIn" }`. When set, `request.url` is only what the client asked for |
| `origin.url` | string | yes (if `origin` is `{ url }` form) | — | Origin URL. `"built-in"` selects the built-in responder |
| `origin.builtIn` | object | yes (if `origin` is `{ builtIn }` form) | — | Declared built-in response: a fixed response or a folder served by request path |
| `origin.builtIn.status` | integer | no | — | Response status (100–599). Cannot be combined with `files` |
| `origin.builtIn.headers` | object | no | — | Response headers. Names must be valid header names; values cannot contain CR, LF, or NUL |
| `origin.builtIn.body` | string | no | — | Response body string. At most one of `body`, `bodyFile`, and `files` |
| `origin.builtIn.bodyFile` | string | no | — | File whose bytes are the body. Relative to the config file |
| `origin.builtIn.files` | string | no | — | Folder served by request path. Relative to the config file. `files` sets its own status (200, or 404 for missing file); cannot be combined with `status` |

The schema rejects unrecognised fields in `client`, `edge`, `origin`, and `origin.builtIn`.

*`wasm` is optional only if you supply the binary manually via a programmatic `wasmBuffer`. It is required for file-based test runs and debugger auto-load.

Explicit `properties` and request headers take precedence over values derived from `client` and `edge`. `edge.dc` is the cache bucket unless the top-level `dc` field is set.

### Required vs. Default Distinction

The JSON Schema `required` arrays drive editor validation. Fields that carry a `default` in the schema (`request.method`, `request.headers`, `request.body`, `properties`, and `appType` on the CDN variant) are not in those arrays, so a strict JSON Schema validator does not flag them when missing. At runtime the Zod schema fills in their defaults (`"GET"`, `{}`, `""`, `{}`, and `"proxy-wasm"` respectively), so `loadConfigFile` accepts configs that omit them.

`appType` is required in the `http-wasm` variant and has no default. A config without `appType` is validated as a CDN (`proxy-wasm`) config.

`request.url` (CDN) and `request.path` (HTTP-WASM) are required and have no default.

Omitting the defaulted fields passes both editor validation and `loadConfigFile`.

### HTTP Port Pinning

`httpPort` is an optional integer (1024–65535) available only in HTTP-WASM configs (`appType: "http-wasm"`). It pins the `fastedge-run` subprocess to a fixed port instead of allocating one from the 8100–8199 dynamic pool. The field is defined only in the `http-wasm` variant; proxy-wasm configs do not use it.

Without `httpPort`, the runner allocates a port from the 8100–8199 range for each run. The allocated port is not stable across runs.

Use port pinning for:
- **Codespaces / Docker port-forwarding**: forward rules reference a specific port number. Without pinning, the port changes between runs and breaks the rule.
- **Stable live-preview URLs**: browser tabs or external tooling pointing at a fixed URL (e.g. `http://localhost:8250`).
- **External tooling integration**: monitoring, load testing, or proxy configurations that hard-code a target address.

If the pinned port is already in use, `HttpWasmRunner.load()` throws immediately; there is no fallback to dynamic allocation:

```
fastedge-run port 8250 is not available — release it or choose a different httpPort in fastedge-config.test.json
```

Pinning a port inside the 8100–8199 pool is allowed by the schema but risks collisions with other debug sessions. In shared environments choose a port outside the pool (e.g. 8250).

### Built-In Responder

For CDN (`proxy-wasm`) configs, setting `request.url` to `"built-in"` makes the runner generate a local response and skip the upstream fetch, so the scenario does not depend on network reachability.

The default built-in response is a full JSON echo of the request. Override it with control headers on the request (deprecated):
- `x-debugger-status` — sets the HTTP status code
- `x-debugger-content: status-only` — omits the body
- `x-debugger-content: body-only` — echoes only the request body, with its inferred content-type

To declare the response in the config instead, set `origin.builtIn`. It takes precedence over the `x-debugger-*` headers, and `request.url` stays the URL the client asked for. `origin.builtIn` accepts `status`, `headers`, and one of `body`, `bodyFile`, or `files`. Use `files` to serve a folder by request path (GET `/a/b.png` answers with `<folder>/a/b.png`; dotfiles are never served; `"."` is the config file's own folder).

---

## Runtime Secrets and Env Vars

`envVars` and `secrets` are **not** fields in `fastedge-config.test.json`. Inject all runtime values via dotenv files — see the dotenv configuration reference for the full setup including prefix scheme, file options, priority order, and gitignore guidance.

---

## CDN Example

```json
{
  "$schema": "./node_modules/@gcoredev/fastedge-test/schemas/fastedge-config.test.schema.json",
  "description": "CDN handler with feature flags and auth secret",
  "appType": "proxy-wasm",
  "wasm": {
    "path": "./dist/handler.wasm",
    "description": "Production CDN handler"
  },
  "request": {
    "method": "GET",
    "url": "https://example.com/api/data",
    "headers": {
      "accept": "application/json",
      "x-request-id": "test-001"
    },
    "body": ""
  },
  "properties": {
    "FEATURE_FLAG_NEW_CACHE": "true",
    "UPSTREAM_HOST": "origin.example.com"
  },
  "client": {
    "preset": "de",
    "ip": "203.0.113.7"
  },
  "edge": {
    "preset": "nl",
    "city": "Amsterdam"
  },
  "dotenv": {
    "enabled": true,
    "path": "./fixtures"
  }
}
```

`properties` passes CDN context values into the execution environment. `client` and `edge` supply geographic context — explicit `properties` and request headers take precedence over values derived from these objects. `dotenv` loads runtime secrets from a local dotenv directory without embedding them in the config.

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

`appType` must be `"http-wasm"` — there is no runtime default for this variant. Use `request.path` (not `request.url`); the WASM module acts as the origin server and receives only the path portion of the request. To pin the subprocess to a fixed port (e.g. for Codespaces or Docker port-forwarding), add `"httpPort": 8250`.

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
