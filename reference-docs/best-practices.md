# FastEdge Best Practices

## Hono Routing Patterns

### Basic Routing
```typescript
import { Hono } from "hono";

const app = new Hono();

// Static routes
app.get("/", (c) => c.text("Home"));
app.get("/health", (c) => c.json({ status: "ok" }));

// Path parameters
app.get("/users/:id", (c) => {
  const id = c.req.param("id");
  return c.json({ userId: id });
});

// Wildcards
app.get("/api/*", (c) => c.text("API route"));

// Method-specific
app.post("/data", async (c) => {
  const body = await c.req.json();
  return c.json({ received: body });
});

app.fire();
```

### Middleware
```typescript
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";

// Apply globally
app.use("/*", cors());
app.use("/*", logger());
app.use("/*", secureHeaders());

// Apply to specific paths
app.use("/api/*", async (c, next) => {
  const token = c.req.header("Authorization");
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  await next();
});
```

### Error Handling
```typescript
app.onError((err, c) => {
  console.error("Unhandled error:", err.message);
  return c.json({ error: "Internal Server Error" }, 500);
});

app.notFound((c) => {
  return c.json({ error: "Not Found" }, 404);
});
```

## Binary Size Optimization

Keep the compiled `.wasm` under 10MB. Smaller binaries = faster cold starts.

### JavaScript
- Use only necessary Hono middleware (don't import all of `hono/middleware`)
- Avoid large dependencies — check bundle size with `bundlephobia.com`
- Use tree-shaking-friendly imports: `import { specific } from "lib"` not `import * as lib from "lib"`
- The `fastedge-build` tool handles tree-shaking automatically

### Rust
- Use `[profile.release]` optimizations in `Cargo.toml`:
  ```toml
  [profile.release]
  opt-level = "s"       # Optimize for size
  lto = true            # Link-time optimization
  strip = true          # Strip debug symbols
  codegen-units = 1     # Better optimization
  ```
- Minimize dependencies — each crate adds to binary size
- Use `cargo bloat --release --target wasm32-wasip1` to find size contributors
- Avoid `serde` if you only need simple JSON — consider `miniserde` or manual parsing

## Environment Variables & Secrets

### When to Use Env Vars vs Secrets
- **Env vars** — Non-sensitive configuration (feature flags, API endpoints, app modes)
- **Secrets** — Sensitive data (API keys, tokens, passwords) — encrypted at rest

### Setting via API
```bash
# Set env vars
curl -X PUT "https://api.gcore.com/fastedge/v1/apps/$APP_ID" \
  -H "Authorization: APIKey $GCORE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"env_vars": {"API_URL": "https://api.example.com", "DEBUG": "false"}}'
```

### Best Practices
- Never hardcode secrets in source code
- Use secrets for any credential that could cause damage if leaked
- Keep env var names consistent across environments (local, staging, production)
- Document required env vars in your project README

## KV Store Patterns

### Reading from KV Store
```typescript
import { KvStore } from "fastedge::kv";

// Open with KvStore.open(), not new KvStore()
const store = KvStore.open("my-store-name");

// get() returns ArrayBuffer | null — decode explicitly
const buf = store.get("key");
const text = buf ? new TextDecoder().decode(buf) : null;

// Prefix scan — wildcard required
const keys = store.scan("user:*");  // Array<string>
```

**Note:** The KV store is **read-only** from app code. There is no `set()`, `delete()`, or `list()`. Write data via the Gcore portal or API. Use KV for reading configuration, feature flags, pre-computed data, or lookup tables.

### Lookup Table Pattern
```typescript
import { KvStore } from "fastedge::kv";

const config = KvStore.open("app-config");

app.get("/route", (c) => {
  const buf = config.get("feature-flags");
  const flags = buf ? JSON.parse(new TextDecoder().decode(buf)) : {};
  if (flags.newFeature) {
    return c.json({ version: "new" });
  }
  return c.json({ version: "old" });
});
```

## Testing

### Local Testing
```bash
# Build first
fastedge-build ./src/index.js ./<name>.wasm  # JS
cargo build --release --target wasm32-wasip1  # Rust

# Run locally
fastedge-run http -w ./app.wasm --port 8080

# Test endpoints
curl http://localhost:8080/
curl -X POST http://localhost:8080/api/data -d '{"key":"value"}'
curl -H "Authorization: Bearer test-token" http://localhost:8080/protected
```

### Testing Checklist

Before deploying, verify locally with `npm test` (requires `@gcoredev/fastedge-test`):

#### All apps
- [ ] App builds without errors (`npm run build`)
- [ ] All expected routes return correct status codes
- [ ] Error paths return appropriate error responses
- [ ] Environment variables and secrets are accessed correctly
- [ ] Binary size is under 10MB
- [ ] Execution completes within time limit

#### CDN apps (proxy-wasm)
- [ ] Request headers are modified/passed correctly through `onRequestHeaders` hook
- [ ] Response headers are modified correctly through `onResponseHeaders` hook
- [ ] App handles 530/531/532/533 error scenarios (see error-codes.md)
- [ ] CDN properties (country, city, geo) are read without access violations

#### HTTP-WASM apps
- [ ] All routes respond correctly
- [ ] POST/PUT bodies are parsed correctly

### Set up testing

Use `/gcore-fastedge:test` to generate a complete test suite for CI/CD:

```bash
npm install --save-dev @gcoredev/fastedge-test
npm test                     # run tests headless (CI)
```

### Set up debug fixtures

Use `/gcore-fastedge:debug` to generate scenario configs for the visual debugger:

```bash
npm run debug                # start visual debugger at http://localhost:5179
```

Load any `.test.json` from `fixtures/` to manually explore request/response behaviour.

### FAQ

**How do I test my FastEdge app?**
Run `/gcore-fastedge:test` to generate a test suite with assertions. Tests run headless via `npm test` and are enforced as a pre-deploy gate.

**How do I debug locally?**
Run `/gcore-fastedge:debug` to generate debug fixtures, then `npm run debug` to start the visual debugger. Load different scenario files to test edge cases interactively.

**What's the difference between tests and debug fixtures?**
Tests (`tests/`) are CI assertions — automated, pass/fail. Debug fixtures (`fixtures/`) are scenario configs for the visual debugger — interactive, manual exploration. They are independent; use one, both, or neither.

## Common Patterns

### JSON API
```typescript
const app = new Hono();

app.use("/*", cors());

app.get("/api/items", async (c) => {
  const items = await fetchItemsFromBackend();
  return c.json(items);
});

app.post("/api/items", async (c) => {
  const body = await c.req.json();
  // Validate
  if (!body.name) return c.json({ error: "name required" }, 400);
  // Process
  const result = await createItem(body);
  return c.json(result, 201);
});

app.fire();
```

### Proxy with Transform
```typescript
app.all("/api/*", async (c) => {
  const url = new URL(c.req.url);
  const backendUrl = `https://backend.example.com${url.pathname}`;

  const resp = await fetch(backendUrl, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.method !== "GET" ? await c.req.arrayBuffer() : undefined,
  });

  // Transform response
  const data = await resp.json();
  data.processedAt = new Date().toISOString();
  return c.json(data, resp.status);
});
```

### Auth Middleware
```typescript
import { getSecret } from "fastedge::secret";

const authMiddleware = async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing bearer token" }, 401);
  }
  const token = authHeader.slice(7);
  const validToken = getSecret("AUTH_TOKEN");
  if (token !== validToken) {
    return c.json({ error: "Invalid token" }, 403);
  }
  await next();
};

app.use("/api/*", authMiddleware);
```
