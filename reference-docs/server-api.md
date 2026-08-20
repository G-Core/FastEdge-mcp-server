<!--
  auto-updated: true
  sources:
    - id: fastedge-test
      ref: main
      commit: c79583ecbec74b0d36ae664cd3a148ae34059a75
      updated: 2026-08-20
-->

# Server API — REST and WebSocket Endpoints

The `@gcoredev/fastedge-test` debugger server exposes REST and WebSocket interfaces for loading WASM modules, executing requests, and streaming real-time events.

**Base URL:** `http://localhost:5179`

The port can be overridden via the `PORT` environment variable. When `WORKSPACE_PATH` is set, the active port is written to `$WORKSPACE_PATH/.fastedge-debug/.debug-port` on startup and deleted on shutdown.

> **Note on header values.** Response-side and hook-result headers use `Record<string, string | string[]>` — single-valued headers are a `string`, multi-valued headers (notably `Set-Cookie` per RFC 6265) are a `string[]`. Request-side header inputs are single-valued `Record<string, string>`.

---

## REST Endpoints

### Common Headers

#### X-Source

Accepted by `POST /api/execute`, `POST /api/send`, and `POST /api/config`. Tags the origin of the operation in WebSocket broadcast events.

| Value | Description |
|---|---|
| `ui` | Web UI (default if omitted) |
| `ai_agent` | AI agent |
| `api` | Direct API usage |
| `system` | Automated system |

```http
X-Source: ai_agent
```

---

### Health

#### GET /health

Returns server status and service identity.

**Response**

```typescript
{
  status: "ok";
  service: "fastedge-debugger";
}
```

**Example**

```bash
curl http://localhost:5179/health
```

```json
{
  "status": "ok",
  "service": "fastedge-debugger"
}
```

---

#### GET /api/client-count

Returns the number of currently connected WebSocket clients. Useful in CI tooling to wait until the UI has connected before proceeding.

**Response**

```typescript
{
  count: number;
}
```

**Example**

```bash
curl http://localhost:5179/api/client-count
```

```json
{
  "count": 1
}
```

---

### WASM Loading

#### POST /api/load

Loads a WASM binary into the runner. Accepts a file path or base64-encoded binary. Automatically detects `http-wasm` or `proxy-wasm` type.

**Request Body** — exactly one of `wasmPath` or `wasmBase64` must be provided; providing both is an error.

```typescript
{
  wasmPath?: string;      // Absolute path to a .wasm file on the server filesystem
  wasmBase64?: string;    // Base64-encoded WASM binary; mutually exclusive with wasmPath
  dotenv?: {
    enabled?: boolean;    // Whether to load .env files for this module
    path?: string;        // Directory containing .env files (defaults to server CWD)
  };
  httpPort?: number;      // HTTP-WASM only. Pin the runner subprocess to this port (1024–65535).
                          // Load fails immediately if the port is already in use.
                          // Ignored for proxy-wasm modules.
}
```

**Response**

```typescript
{
  ok: true;
  wasmType: "http-wasm" | "proxy-wasm";
  resolvedPath?: string;  // Absolute path used when wasmPath was provided
}
```

**Example — load from path**

```bash
curl -X POST http://localhost:5179/api/load \
  -H "Content-Type: application/json" \
  -d '{
    "wasmPath": "/home/user/project/build/module.wasm",
    "dotenv": { "enabled": true }
  }'
```

```json
{
  "ok": true,
  "wasmType": "proxy-wasm",
  "resolvedPath": "/home/user/project/build/module.wasm"
}
```

**Example — load from base64**

```bash
curl -X POST http://localhost:5179/api/load \
  -H "Content-Type: application/json" \
  -d '{
    "wasmBase64": "AGFzbQEAAAA...",
    "dotenv": { "enabled": false }
  }'
```

```json
{
  "ok": true,
  "wasmType": "http-wasm"
}
```

**Example — pin HTTP-WASM to a specific port**

```bash
curl -X POST http://localhost:5179/api/load \
  -H "Content-Type: application/json" \
  -d '{
    "wasmPath": "/home/user/project/build/app.wasm",
    "httpPort": 8100
  }'
```

```json
{
  "ok": true,
  "wasmType": "http-wasm",
  "resolvedPath": "/home/user/project/build/app.wasm"
}
```

**Error Responses**

| Status | Condition |
|---|---|
| `400` | Validation failed, missing both `wasmPath` and `wasmBase64`, invalid path, or path does not end in `.wasm` |
| `400` | `httpPort` is specified and already in use (HTTP-WASM only) |
| `500` | WASM load failed or runner initialization error |

---

#### PATCH /api/dotenv

Applies updated dotenv settings to the currently loaded WASM module without reloading the binary. For Proxy-WASM: resets stores and reloads dotenv in-place. For HTTP-WASM: restarts the underlying process with updated flags.

Requires a WASM module already loaded via `POST /api/load`.

**Request Body**

```typescript
{
  dotenv: {
    enabled: boolean;   // Whether dotenv loading should be enabled
    path?: string;      // Directory containing .env files (defaults to server CWD)
  };
}
```

**Response**

```typescript
{
  ok: true;
}
```

**Example**

```bash
curl -X PATCH http://localhost:5179/api/dotenv \
  -H "Content-Type: application/json" \
  -d '{
    "dotenv": { "enabled": true, "path": "/home/user/project" }
  }'
```

```json
{
  "ok": true
}
```

**Error Responses**

| Status | Condition |
|---|---|
| `400` | `dotenv.enabled` is not a boolean, or no WASM module is loaded |
| `500` | Failed to apply dotenv settings |

---

### Test Execution

#### POST /api/execute

Executes a request through the loaded WASM module. Behavior differs by runner type. Does not use schema validation — fields are read directly from the request body.

Requires a WASM module loaded via `POST /api/load`. Accepts optional `X-Source` header.

**Request Body — HTTP-WASM**

Provide either `path` (preferred) or `url` (legacy). When `path` is given, it is used directly as the request path (e.g. `/api/hello?q=1`). When only `url` is given, the path and query string are extracted from it.

```typescript
{
  path?: string;                     // Request path and query string (preferred)
  url?: string;                      // Full URL — path and query extracted (legacy fallback)
  method?: string;                   // HTTP method (default: "GET")
  headers?: Record<string, string>;  // Request headers (default: {})
  body?: string;                     // Request body (default: "")
}
```

**Request Body — Proxy-WASM**

The top-level `url` field is required. The upstream response is generated at runtime — either by a real fetch against `url`, or by the built-in responder when `url === "built-in"`. The full CDN flow is controlled via nested `request` and `properties` fields.

```typescript
{
  url: string;                          // Request URL, or "built-in" (required)
  request?: {
    method?: string;                    // HTTP method (default: "GET")
    headers?: Record<string, string>;   // Request headers (default: {})
    body?: string;                      // Request body (default: "")
  };
  properties?: Record<string, unknown>; // CDN properties (default: {})
}
```

**Response — HTTP-WASM**

```typescript
{
  ok: true;
  result: {
    status: number;
    statusText: string;
    headers: Record<string, string | string[]>;
    body: string;
    contentType: string | null;
    isBase64?: boolean;
    logs: Array<{ level: number; message: string }>;
  };
}
```

**Response — Proxy-WASM**

```typescript
{
  ok: true;
  hookResults: Record<string, HookResult>;  // Keyed by hook name (e.g. "onRequestHeaders")
  finalResponse: {
    status: number;
    statusText: string;
    headers: Record<string, string | string[]>;
    body: string;
    contentType: string;
    isBase64?: boolean;
  };
  calculatedProperties?: Record<string, unknown>;  // Keys follow request.* pattern
}
```

`calculatedProperties` keys: `request.url`, `request.host`, `request.path`, `request.query`, `request.scheme`, `request.extension`, `request.method`.

**HookResult type** (used across multiple endpoints):

```typescript
type HookResult = {
  returnCode: number | null;
  logs: Array<{ level: number; message: string }>;
  input: {
    request: { headers: Record<string, string | string[]>; body: string };
    response: { headers: Record<string, string | string[]>; body: string };
    properties?: Record<string, unknown>;
  };
  output: {
    request: { headers: Record<string, string | string[]>; body: string };
    response: { headers: Record<string, string | string[]>; body: string };
    properties?: Record<string, unknown>;
  };
  properties: Record<string, unknown>;
};
```

**Example — HTTP-WASM**

```bash
curl -X POST http://localhost:5179/api/execute \
  -H "Content-Type: application/json" \
  -H "X-Source: api" \
  -d '{
    "path": "/api/data?format=json",
    "method": "GET",
    "headers": { "accept": "application/json" }
  }'
```

```json
{
  "ok": true,
  "result": {
    "status": 200,
    "statusText": "OK",
    "headers": { "content-type": "application/json" },
    "body": "{\"hello\":\"world\"}",
    "contentType": "application/json",
    "isBase64": false,
    "logs": [
      { "level": 2, "message": "request received" }
    ]
  }
}
```

**Example — Proxy-WASM**

```bash
curl -X POST http://localhost:5179/api/execute \
  -H "Content-Type: application/json" \
  -H "X-Source: api" \
  -d '{
    "url": "https://example.com/page",
    "request": {
      "method": "GET",
      "headers": { "host": "example.com" },
      "body": ""
    },
    "properties": {}
  }'
```

```json
{
  "ok": true,
  "hookResults": {
    "onRequestHeaders": {
      "returnCode": 0,
      "logs": [{ "level": 2, "message": "onRequestHeaders called" }],
      "input": {
        "request": { "headers": { "host": "example.com" }, "body": "" },
        "response": { "headers": {}, "body": "" },
        "properties": {}
      },
      "output": {
        "request": { "headers": { "host": "example.com", "x-added": "1" }, "body": "" },
        "response": { "headers": {}, "body": "" }
      },
      "properties": {}
    }
  },
  "finalResponse": {
    "status": 200,
    "statusText": "OK",
    "headers": { "content-type": "text/html" },
    "body": "<html/>",
    "contentType": "text/html"
  },
  "calculatedProperties": {
    "request.url": "https://example.com/page",
    "request.host": "example.com",
    "request.path": "/page",
    "request.query": "",
    "request.scheme": "https",
    "request.extension": "",
    "request.method": "GET"
  }
}
```

**Error Responses**

| Status | Condition |
|---|---|
| `400` | No WASM module loaded, or missing `path`/`url` for HTTP-WASM, or missing `url` for Proxy-WASM |
| `500` | Execution failed |

---

#### POST /api/call

Calls a specific Proxy-WASM CDN hook directly. Only valid for Proxy-WASM modules.

Requires a WASM module loaded via `POST /api/load`.

**Request Body**

```typescript
{
  hook: "onRequestHeaders" | "onRequestBody" | "onResponseHeaders" | "onResponseBody";
  request?: {
    headers: Record<string, string>;  // default: {}
    body: string;                     // default: ""
  };
  response?: {
    headers: Record<string, string>;  // default: {}
    body: string;                     // default: ""
  };
  properties: Record<string, unknown>;  // required; use {} if none
}
```

`request` and `response` default to `{ headers: {}, body: "" }` if omitted.

**Response**

```typescript
{
  ok: true;
  result: HookResult;
}
```

**Example**

```bash
curl -X POST http://localhost:5179/api/call \
  -H "Content-Type: application/json" \
  -d '{
    "hook": "onRequestHeaders",
    "request": {
      "headers": { "host": "example.com", "user-agent": "curl/8.0" },
      "body": ""
    },
    "response": {
      "headers": {},
      "body": ""
    },
    "properties": {
      "client.geo.country": "US"
    }
  }'
```

```json
{
  "ok": true,
  "result": {
    "returnCode": 0,
    "logs": [
      { "level": 2, "message": "processing request headers" }
    ],
    "input": {
      "request": {
        "headers": { "host": "example.com", "user-agent": "curl/8.0" },
        "body": ""
      },
      "response": { "headers": {}, "body": "" },
      "properties": { "client.geo.country": "US" }
    },
    "output": {
      "request": {
        "headers": { "host": "example.com", "user-agent": "curl/8.0", "x-country": "US" },
        "body": ""
      },
      "response": { "headers": {}, "body": "" }
    },
    "properties": { "client.geo.country": "US" }
  }
}
```

**Error Responses**

| Status | Condition |
|---|---|
| `400` | Validation failed (invalid hook name, missing `properties`), or no WASM module loaded |
| `500` | Hook execution failed |

---

#### POST /api/send

Executes the full Proxy-WASM CDN request/response flow with stricter Zod schema validation than `POST /api/execute`. Only valid for Proxy-WASM modules.

The upstream response is generated at runtime — either by a real fetch against `url`, or by the built-in responder when `url === "built-in"`.

Requires a WASM module loaded via `POST /api/load`. Accepts optional `X-Source` header.

**Request Body**

```typescript
{
  url: string | "built-in";               // Full request URL, or "built-in" to use the built-in responder
  request?: {
    method?: string;                      // HTTP method (default: "GET")
    url?: string;
    headers?: Record<string, string>;     // Request headers (default: {})
    body?: string;                        // Request body (default: "")
  };
  properties: Record<string, unknown>;    // CDN properties (required; use {} if none)
}
```

**Response**

```typescript
{
  ok: true;
  hookResults: Record<string, HookResult>;  // Keyed by hook name
  finalResponse: {
    status: number;
    statusText: string;
    headers: Record<string, string | string[]>;
    body: string;
    contentType: string;
    isBase64?: boolean;
  };
  calculatedProperties?: Record<string, unknown>;  // Keys follow request.* pattern
}
```

`HookResult` has the same shape as documented under `POST /api/call`. `hookResults` is keyed by hook name. `calculatedProperties` keys follow the `request.*` pattern.

**Example**

```bash
curl -X POST http://localhost:5179/api/send \
  -H "Content-Type: application/json" \
  -H "X-Source: ai_agent" \
  -d '{
    "url": "https://example.com/api/resource",
    "request": {
      "method": "POST",
      "headers": { "content-type": "application/json" },
      "body": "{\"key\":\"value\"}"
    },
    "properties": {
      "client.geo.country": "DE"
    }
  }'
```

```json
{
  "ok": true,
  "hookResults": {
    "onRequestHeaders": {
      "returnCode": 0,
      "logs": [],
      "input": {
        "request": { "headers": { "content-type": "application/json" }, "body": "" },
        "response": { "headers": {}, "body": "" },
        "properties": { "client.geo.country": "DE" }
      },
      "output": {
        "request": { "headers": { "content-type": "application/json" }, "body": "" },
        "response": { "headers": {}, "body": "" }
      },
      "properties": { "client.geo.country": "DE" }
    },
    "onResponseHeaders": {
      "returnCode": 0,
      "logs": [],
      "input": {
        "request": { "headers": { "content-type": "application/json" }, "body": "" },
        "response": { "headers": { "content-type": "application/json" }, "body": "" },
        "properties": { "client.geo.country": "DE" }
      },
      "output": {
        "request": { "headers": { "content-type": "application/json" }, "body": "" },
        "response": { "headers": { "content-type": "application/json" }, "body": "" }
      },
      "properties": { "client.geo.country": "DE" }
    }
  },
  "finalResponse": {
    "status": 200,
    "statusText": "OK",
    "headers": { "content-type": "application/json" },
    "body": "{\"result\":\"ok\"}",
    "contentType": "application/json"
  },
  "calculatedProperties": {
    "request.url": "https://example.com/api/resource",
    "request.host": "example.com",
    "request.path": "/api/resource",
    "request.query": "",
    "request.scheme": "https",
    "request.extension": "",
    "request.method": "POST"
  }
}
```

**Error Responses**

| Status | Condition |
|---|---|
| `400` | Validation failed (missing `url` or `properties`), or no WASM module loaded |
| `500` | Execution failed |

---

### Configuration

#### GET /api/config

Reads `fastedge-config.test.json` from the `.fastedge-debug/` directory (relative to `WORKSPACE_PATH` if set, otherwise the current working directory) and returns it with a validation result.

**Response**

```typescript
{
  ok: true;
  config: TestConfig;
  valid: boolean;
  validationErrors?: {
    formErrors: string[];
    fieldErrors: Record<string, string[]>;
  };
}
```

**TestConfig type** — discriminated union on `appType`:

```typescript
// Proxy-WASM config (appType defaults to "proxy-wasm")
type ProxyWasmConfig = {
  $schema?: string;
  description?: string;
  appType: "proxy-wasm";
  wasm?: { path: string; description?: string };
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string;
  };
  properties: Record<string, unknown>;
  dotenv?: { enabled?: boolean; path?: string };
};

// HTTP-WASM config
type HttpWasmConfig = {
  $schema?: string;
  description?: string;
  appType: "http-wasm";
  wasm?: { path: string; description?: string };
  httpPort?: number;  // Pin the runner subprocess to this port (1024–65535)
  request: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body: string;
  };
  properties: Record<string, unknown>;
  dotenv?: { enabled?: boolean; path?: string };
};

type TestConfig = ProxyWasmConfig | HttpWasmConfig;
```

**Example**

```bash
curl http://localhost:5179/api/config
```

```json
{
  "ok": true,
  "config": {
    "$schema": "http://localhost:5179/api/schema/fastedge-config.test",
    "appType": "proxy-wasm",
    "request": {
      "method": "GET",
      "url": "https://example.com/",
      "headers": {},
      "body": ""
    },
    "properties": {}
  },
  "valid": true
}
```

**Error Responses**

| Status | Condition |
|---|---|
| `404` | `fastedge-config.test.json` does not exist |

---

#### POST /api/config

Saves the provided configuration to `.fastedge-debug/fastedge-config.test.json` (relative to `WORKSPACE_PATH` if set, otherwise the current working directory). Broadcasts a WebSocket event to connected clients when `properties` is included.

Accepts optional `X-Source` header.

**Request Body**

```typescript
{
  config: TestConfig; // See GET /api/config for the TestConfig type
}
```

The `config` object must match one of the two `TestConfig` variants. `appType` and `properties` are required in both variants. `request` is required and its shape depends on `appType`: `path` for `"http-wasm"`, `url` for `"proxy-wasm"`.

**Response**

```typescript
{
  ok: true;
}
```

**Example**

```bash
curl -X POST http://localhost:5179/api/config \
  -H "Content-Type: application/json" \
  -H "X-Source: api" \
  -d '{
    "config": {
      "$schema": "http://localhost:5179/api/schema/fastedge-config.test",
      "appType": "proxy-wasm",
      "request": {
        "method": "GET",
        "url": "https://example.com/",
        "headers": { "accept": "text/html" },
        "body": ""
      },
      "properties": {
        "client.geo.country": "US"
      }
    }
  }'
```

```json
{
  "ok": true
}
```

**Error Responses**

| Status | Condition |
|---|---|
| `400` | Validation failed (missing `config.appType`, `config.request`, or `config.properties`) |
| `500` | File write failed |

---

#### POST /api/config/save-as

Saves the provided configuration to an arbitrary file path. Creates intermediate directories as needed. Appends `.json` if the path does not already end in `.json`.

**Request Body**

```typescript
{
  config: object;     // The configuration object to serialize as JSON
  filePath: string;   // Target file path (absolute or relative to project root)
}
```

**Response**

```typescript
{
  ok: true;
  savedPath: string;  // Resolved absolute path where the file was written
}
```

**Example**

```bash
curl -X POST http://localhost:5179/api/config/save-as \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "appType": "proxy-wasm",
      "request": {
        "method": "GET",
        "url": "https://example.com/",
        "headers": {},
        "body": ""
      },
      "properties": {}
    },
    "filePath": "configs/staging.test"
  }'
```

```json
{
  "ok": true,
  "savedPath": "/home/user/project/configs/staging.test.json"
}
```

**Error Responses**

| Status | Condition |
|---|---|
| `400` | Missing `config` or `filePath` |
| `500` | File write or directory creation failed |

---

### Schema

#### GET /api/schema/:name

Serves a JSON Schema file by name. The `:name` parameter is the schema name without the `.schema.json` suffix. Returns the JSON Schema document with `Content-Type: application/json`.

**Request Schemas**

| Name | Description |
|---|---|
| `api-load` | Request body schema for `POST /api/load` |
| `api-send` | Request body schema for `POST /api/send` |
| `api-call` | Request body schema for `POST /api/call` |
| `api-config` | Request body schema for `POST /api/config` |

**Response / Type Schemas**

| Name | Description |
|---|---|
| `fastedge-config.test` | Schema for `fastedge-config.test.json` config files |
| `hook-result` | Shape of a single `HookResult` object |
| `hook-call` | Shape of a `HookCall` input object |
| `full-flow-result` | Shape of the `FullFlowResult` returned by full-flow endpoints |
| `http-request` | Shape of an `HttpRequest` for HTTP-WASM execution |
| `http-response` | Shape of an `HttpResponse` returned by HTTP-WASM execution |

**Example**

```bash
curl http://localhost:5179/api/schema/api-send
```

```bash
curl http://localhost:5179/api/schema/fastedge-config.test
```

**Using the schema in a config file**

```json
{
  "$schema": "http://localhost:5179/api/schema/fastedge-config.test",
  "appType": "proxy-wasm",
  "request": {
    "method": "GET",
    "url": "https://example.com/",
    "headers": {},
    "body": ""
  },
  "properties": {}
}
```

**Error Responses**

| Status | Condition |
|---|---|
| `404` | Schema name not found |

---

### Error Handling

All error responses follow a consistent shape:

```typescript
{
  ok: false;
  error: string | { formErrors: string[]; fieldErrors: Record<string, string[]> };
}
```

When a request body fails schema validation (Zod), `error` is a flattened Zod error object with `formErrors` and `fieldErrors`. For runtime errors, `error` is a plain string.

**Common status codes**

| Status | Meaning |
|---|---|
| `400` | Invalid request body, missing required fields, or precondition not met (e.g. no WASM loaded) |
| `404` | Resource not found (config file, schema file) |
| `500` | Internal server error during execution or I/O |

---

## WebSocket Protocol

### Connection

Connect to:

```
ws://localhost:{port}/ws
```

Default port: `5179`.

```javascript
const ws = new WebSocket('ws://localhost:5179/ws');

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  console.log(msg.type, msg.data);
});
```

### Lifecycle

1. **Connect** — server accepts all connections and immediately sends a `connection_status` event confirming the connection and current client count.
2. **Ping / pong** — server sends WebSocket `ping` frames every 15 seconds. Clients that have not responded within 30 seconds are terminated. Standard WebSocket clients handle pong automatically.
3. **Disconnect** — when a client disconnects, the server broadcasts an updated `connection_status` to remaining clients.

### Event Envelope

Every event shares a common envelope:

```typescript
interface BaseEvent {
  type: string;       // event discriminant
  timestamp: number;  // Unix ms
  source: 'ui' | 'ai_agent' | 'api' | 'system';
  data: object;       // event-specific payload
}
```

### Event Types

#### wasm_loaded

Fired when a WASM binary has been loaded and is ready to handle requests.

```typescript
{
  type: 'wasm_loaded';
  timestamp: number;
  source: 'ui' | 'ai_agent' | 'api' | 'system';
  data: {
    filename: string;
    size: number;                          // File size in bytes
    runnerPort?: number | null;            // Port the runner is listening on, if applicable
    wasmType: 'proxy-wasm' | 'http-wasm';
    resolvedPath?: string | null;          // Absolute filesystem path to the loaded binary
  };
}
```

**Example**

```json
{
  "type": "wasm_loaded",
  "timestamp": 1742734800000,
  "source": "api",
  "data": {
    "filename": "filter.wasm",
    "size": 204800,
    "runnerPort": 8081,
    "wasmType": "proxy-wasm",
    "resolvedPath": "/workspace/filter.wasm"
  }
}
```

---

#### request_started

Fired when the server begins processing an incoming request through the WASM filter.

```typescript
{
  type: 'request_started';
  timestamp: number;
  source: 'ui' | 'ai_agent' | 'api' | 'system';
  data: {
    url: string;
    method: string;
    headers: Record<string, string | string[]>;
  };
}
```

**Example**

```json
{
  "type": "request_started",
  "timestamp": 1742734800100,
  "source": "api",
  "data": {
    "url": "https://example.com/api/resource",
    "method": "GET",
    "headers": {
      "host": "example.com",
      "user-agent": "curl/8.0"
    }
  }
}
```

---

#### hook_executed

Fired after each individual Proxy-WASM hook completes. Multiple events are emitted per request — one per hook phase that runs. Hook names are camelCase: `onRequestHeaders`, `onRequestBody`, `onResponseHeaders`, `onResponseBody`.

```typescript
{
  type: 'hook_executed';
  timestamp: number;
  source: 'ui' | 'ai_agent' | 'api' | 'system';
  data: {
    hook: string;               // e.g. "onRequestHeaders"
    returnCode: number | null;  // Return code from the WASM filter, or null if unavailable
    logCount: number;           // Number of log lines emitted during this hook
    input: {
      request: { headers: Record<string, string | string[]>; body: string };
      response: { headers: Record<string, string | string[]>; body: string };
    };
    output: {
      request: { headers: Record<string, string | string[]>; body: string };
      response: { headers: Record<string, string | string[]>; body: string };
    };
  };
}
```

**Example**

```json
{
  "type": "hook_executed",
  "timestamp": 1742734800200,
  "source": "api",
  "data": {
    "hook": "onRequestHeaders",
    "returnCode": 0,
    "logCount": 2,
    "input": {
      "request": { "headers": { "host": "example.com" }, "body": "" },
      "response": { "headers": {}, "body": "" }
    },
    "output": {
      "request": { "headers": { "host": "example.com", "x-injected": "true" }, "body": "" },
      "response": { "headers": {}, "body": "" }
    }
  }
}
```

---

#### request_completed

Fired when all hook phases have completed and a final response is available. `hookResults` keys are camelCase hook names.

```typescript
{
  type: 'request_completed';
  timestamp: number;
  source: 'ui' | 'ai_agent' | 'api' | 'system';
  data: {
    hookResults: Record<string, any>;  // Keyed by hook name
    finalResponse: {
      status: number;
      statusText: string;
      headers: Record<string, string | string[]>;
      body: string;                    // May be base64 if isBase64 is true
      contentType: string;
      isBase64?: boolean;
    };
    calculatedProperties?: Record<string, unknown>;
  };
}
```

**Example**

```json
{
  "type": "request_completed",
  "timestamp": 1742734800500,
  "source": "api",
  "data": {
    "hookResults": {
      "onRequestHeaders": { "returnCode": 0 },
      "onResponseHeaders": { "returnCode": 0 }
    },
    "finalResponse": {
      "status": 200,
      "statusText": "OK",
      "headers": { "content-type": "application/json" },
      "body": "{\"ok\":true}",
      "contentType": "application/json",
      "isBase64": false
    },
    "calculatedProperties": {}
  }
}
```

---

#### request_failed

Fired when request processing fails before a response can be produced.

```typescript
{
  type: 'request_failed';
  timestamp: number;
  source: 'ui' | 'ai_agent' | 'api' | 'system';
  data: {
    error: string;     // Short error message
    details?: string;  // Extended error detail or stack trace, if available
  };
}
```

**Example**

```json
{
  "type": "request_failed",
  "timestamp": 1742734800300,
  "source": "api",
  "data": {
    "error": "WASM execution error",
    "details": "RuntimeError: memory access out of bounds"
  }
}
```

---

#### properties_updated

Fired when the set of active properties changes (e.g. after a properties configuration update).

```typescript
{
  type: 'properties_updated';
  timestamp: number;
  source: 'ui' | 'ai_agent' | 'api' | 'system';
  data: {
    properties: Record<string, string>;  // Full current property map after the update
  };
}
```

**Example**

```json
{
  "type": "properties_updated",
  "timestamp": 1742734800050,
  "source": "ui",
  "data": {
    "properties": {
      "plugin.name": "my-filter",
      "plugin.version": "1.0.0"
    }
  }
}
```

---

#### http_wasm_request_completed

Fired when an http-wasm filter finishes processing a request and a response is available.

`response.headers` mirrors Node's `IncomingHttpHeaders` — `undefined` values are dropped during JSON serialization and will not appear on the wire.

```typescript
{
  type: 'http_wasm_request_completed';
  timestamp: number;
  source: 'ui' | 'ai_agent' | 'api' | 'system';
  data: {
    response: {
      status: number;
      statusText: string;
      headers: Record<string, string | string[] | undefined>;  // undefined values omitted in JSON
      body: string;                   // May be base64 if isBase64 is true
      contentType: string | null;
      isBase64?: boolean;
    };
  };
}
```

**Example**

```json
{
  "type": "http_wasm_request_completed",
  "timestamp": 1742734800600,
  "source": "api",
  "data": {
    "response": {
      "status": 200,
      "statusText": "OK",
      "headers": { "content-type": "text/plain" },
      "body": "Hello, world!",
      "contentType": "text/plain",
      "isBase64": false
    }
  }
}
```

---

#### http_wasm_log

Fired in real-time as the http-wasm filter emits log lines during execute and live modes. One event per log line.

```typescript
{
  type: 'http_wasm_log';
  timestamp: number;
  source: 'ui' | 'ai_agent' | 'api' | 'system';
  data: {
    level: number;    // Log level (follows proxy-wasm log level conventions)
    message: string;
  };
}
```

**Example**

```json
{
  "type": "http_wasm_log",
  "timestamp": 1742734800250,
  "source": "api",
  "data": {
    "level": 2,
    "message": "processing request to /api/resource"
  }
}
```

---

#### connection_status

Fired in three situations: (1) immediately after a client connects (sent only to that client), (2) when any client connects or disconnects (broadcast to all clients), (3) in response to a client `ping` message.

```typescript
{
  type: 'connection_status';
  timestamp: number;
  source: 'system';
  data: {
    connected: boolean;  // Always true when received
    clientCount: number; // Total connected clients including this one
  };
}
```

**Example**

```json
{
  "type": "connection_status",
  "timestamp": 1742734800010,
  "source": "system",
  "data": {
    "connected": true,
    "clientCount": 1
  }
}
```

---

### Client Messages

The server accepts one client-to-server message type.

#### ping

Requests a `connection_status` response from the server. Verifies the connection at the application level, independent of WebSocket ping/pong frames.

```json
{ "type": "ping" }
```

The server responds by sending a `connection_status` event to the requesting client.

All other operations (loading WASM, triggering requests, updating properties) are submitted via the REST API.

---

## Server Startup

Start the debugger server programmatically via the `@gcoredev/fastedge-test/server` export:

```javascript
import { startServer } from '@gcoredev/fastedge-test/server';
```

The server listens on port `5179` by default. Override with the `PORT` environment variable. When the preferred port is busy, the server tries up to 10 sequential ports before failing.

When `WORKSPACE_PATH` is set, the active port is written to `$WORKSPACE_PATH/.fastedge-debug/.debug-port` on startup and removed on shutdown. Use this file to discover the port dynamically in CI or multi-process tooling.

---

## See Also

- API reference: REST endpoints for triggering requests, loading WASM, and managing configuration
- WEBSOCKET reference: WebSocket protocol and event types
- DEBUGGER reference: Server startup, configuration, and environment variables
- TEST_FRAMEWORK reference: Programmatic test framework API
- RUNNER reference: Runner API and WASM type detection
