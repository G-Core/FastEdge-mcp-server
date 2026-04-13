# FastEdge Platform Overview

## Architecture

Gcore FastEdge runs WebAssembly (Wasm) workloads at the edge on Gcore's global CDN infrastructure. When a request arrives at a PoP, the Wasm runtime instantiates the app, processes the request, and returns the response — all within the same PoP, minimizing latency.

```
User Request → Nearest PoP (210+ worldwide) → Wasm Runtime → App Logic → Response
```

### Key Properties
- **Sub-millisecond cold starts** — Wasm modules are pre-compiled and cached at each PoP
- **Per-request isolation** — Each request runs in its own Wasm sandbox
- **No persistent state between requests** — Use KV store or external APIs for state
- **Global deployment** — Apps are automatically distributed to all PoPs

## Points of Presence (PoPs)

210+ PoPs across 6 continents. Major regions:
- North America, South America
- Europe (dense coverage)
- Asia-Pacific
- Middle East & Africa

Requests are routed to the nearest PoP via Anycast DNS.

## App Types

FastEdge has two fundamentally different app categories. Choosing the right one is the first decision when building.

### HTTP Apps

Run as **standalone serverless functions**. The Wasm module receives an HTTP request and returns a complete HTTP response — like a normal server endpoint.

**Languages:** JavaScript, TypeScript, Rust
**ABI:** HTTP-WASM

Use cases:
- **HTTP Handlers** — Standard request/response apps. Receive an HTTP request, return an HTTP response.
- **API Gateways** — Route requests to different backends, add auth, transform payloads. Hono's routing makes this natural.
- **MCP Servers** — Model Context Protocol servers running at the edge. Use `@hono/mcp` with `StreamableHTTPTransport` on a `/mcp` route.
- **Edge Middleware** — Modify requests/responses in flight via full response control.

### CDN Apps

Run **inside the CDN proxy layer** as HTTP filters using the Proxy-WASM ABI. They intercept traffic flowing through Gcore's CDN infrastructure via phase callbacks, not a request/response handler.

**Languages:** AssemblyScript, Rust
**ABI:** Proxy-WASM

Use cases:
- **Header manipulation** — Add, remove, or modify request/response headers before they reach origin or client.
- **Auth enforcement** — Validate tokens at the CDN edge, block or allow traffic, short-circuit with a local response.
- **URL rewriting & routing** — Rewrite paths, redirect traffic, implement custom routing rules at the CDN level.
- **Traffic filtering** — Bot detection, rate limiting, geo-blocking.
- **Custom caching** — Override CDN cache behaviour based on request properties.

CDN apps use a **callback model**. Key phases:
| Callback | When it fires |
|----------|--------------|
| `onRequestHeaders` | Incoming request headers received |
| `onRequestBody` | Incoming request body chunk received |
| `onResponseHeaders` | Response headers from origin received |
| `onResponseBody` | Response body chunk from origin received |

Return `FilterHeadersStatusValues.Continue` to pass through, or call `stream_context.sendLocalResponse(...)` to short-circuit without hitting origin.

## Request Lifecycle

1. **DNS Resolution** — Request routed to nearest PoP via Anycast
2. **TLS Termination** — Handled by the PoP
3. **Wasm Instantiation** — Module loaded (cached) and instantiated
4. **Request Processing** — App receives Request, returns Response
5. **Response Delivery** — Response sent back to client
6. **Cleanup** — Wasm instance destroyed, memory freed

## Resource Limits

| Resource | Basic Plan | Pro Plan |
|----------|-----------|----------|
| Execution time | 50ms | 200ms |
| Memory | 128MB | 256MB |
| Binary size | 10MB | 10MB |
| Outbound requests | 5 per invocation | 20 per invocation |
| Request body size | 1MB | 5MB |
| Response body size | 1MB | 5MB |

## Plans

- **Basic** — Free tier with reasonable limits, suitable for most edge workloads
- **Pro** — Higher limits for compute-intensive applications

## App Statuses

| Status Code | Meaning |
|-------------|---------|
| 0 | Disabled |
| 1 | Enabled |
| 2 | Suspended (by system) |

## Networking

- Apps can make outbound `fetch()` calls to external APIs
- Outbound requests go through the PoP's network
- DNS resolution for outbound requests uses the PoP's resolver
- WebSocket support is not available (request/response model only)

## Logging & Monitoring

- `console.log()` output is captured in app logs
- View logs in the Gcore portal or via API
- Stats available via `GET /apps/{id}/stats` (requests, errors, latency percentiles)
