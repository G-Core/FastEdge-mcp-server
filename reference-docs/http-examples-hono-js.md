<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-js
      ref: main
      commit: 36cf4c4af034a19e45e5a92d06aa95adeb9b1ff9
      updated: 2026-06-11
-->

# Hono Patterns on FastEdge (JavaScript/TypeScript)

Hono is the recommended HTTP framework for FastEdge JS apps. It is small, edge-native, and integrates cleanly with the FastEdge `addEventListener('fetch', ...)` Service Worker pattern.

---

## FastEdge Integration

Wire a Hono app into FastEdge by passing `FetchEvent.request` to `app.fetch()`:

```typescript
import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) => c.text("Hello FastEdge!"));

addEventListener("fetch", (event: FetchEvent) => {
  event.respondWith(app.fetch(event.request));
});
```

**Critical constraint**: use `app.fetch(event.request)`, not `app.fire()`. `app.fire()` is deprecated in Hono and registers its own global `fetch` listener, which conflicts with the FastEdge Service Worker `addEventListener('fetch', ...)` integration.

---

## API Reference

### Constructor

```typescript
const app = new Hono();
```

No required arguments. Returns a Hono application instance.

---

### Route Registration

**Signatures:**
```typescript
app.get(path: string, handler: (c: Context) => Response | Promise<Response>): Hono
app.post(path: string, handler: (c: Context) => Response | Promise<Response>): Hono
app.all(path: string, handler: (c: Context) => Response | Promise<Response>): Hono
```

**Basic routes:**
```typescript
app.get("/", (c) => c.text("Home"));
app.get("/health", (c) => c.json({ status: "ok" }));
app.post("/data", async (c) => {
  const body = await c.req.json();
  return c.json({ received: body });
});
```

**Path parameters** — accessed via `c.req.param(name: string)`:
```typescript
app.get("/users/:id", (c) => {
  const id = c.req.param("id");
  return c.json({ userId: id });
});
```

**Wildcards:**
```typescript
app.get("/api/*", (c) => c.text("API route"));
```

---

### Sub-routers — `app.route()`

Mount a child Hono instance under a path prefix:

```typescript
app.route(prefix: string, subRouter: Hono): Hono
```

```typescript
import { Hono } from "hono";
import { api } from "./api/routes.js";

const app = new Hono();

app.route("/api", api);         // mount API sub-router

app.get("*", async (c) => {     // catch-all for static assets
  return staticServer.serveRequest(c.req.raw);
});
```

**Route ordering constraint**: `app.route()` calls must appear before any catch-all `app.get("*", ...)`. If the catch-all is registered first, it absorbs all requests before the sub-router can match.

---

### Middleware — `app.use()`

**Signature:**
```typescript
app.use(path: string, middleware: MiddlewareHandler): Hono
```

#### Built-in Middleware

Import from path-specific submodules (see Tree-shaking section):

```typescript
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";

app.use("/*", cors());
app.use("/*", logger());
app.use("/*", secureHeaders());
```

#### Path-scoped Middleware

```typescript
app.use("/api/*", async (c, next) => {
  const token = c.req.header("Authorization");
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  await next();
});
```

#### Custom Middleware

A custom middleware is an `async (c, next) => { ... }` function. Call `await next()` to continue the chain; return a response without calling `next()` to short-circuit:

```typescript
const requestId = async (c, next) => {
  const id = crypto.randomUUID();
  c.header("X-Request-Id", id);
  await next();
};

app.use("/*", requestId);
```

For authentication middleware using `getSecret`, see the auth patterns reference.

---

### Error Handling

```typescript
app.onError(handler: (err: Error, c: Context) => Response): Hono
app.notFound(handler: (c: Context) => Response): Hono
```

```typescript
app.onError((err, c) => {
  console.error("Unhandled error:", err.message);
  return c.json({ error: "Internal Server Error" }, 500);
});

app.notFound((c) => {
  return c.json({ error: "Not Found" }, 404);
});
```

**Constraint**: always register `app.onError`. Without it, an unhandled exception in a route handler surfaces as a FastEdge 531 (runtime error) with no useful response body for the client.

---

### `app.fetch()`

**Signature:**
```typescript
app.fetch(request: Request): Promise<Response>
```

Accepts a `Request` object and returns a `Promise<Response>`. Used in the `addEventListener('fetch', ...)` integration point:

```typescript
addEventListener("fetch", (event: FetchEvent) => {
  event.respondWith(app.fetch(event.request));
});
```

---

## Patterns

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
  if (!body.name) return c.json({ error: "name required" }, 400);
  const result = await createItem(body);
  return c.json(result, 201);
});

app.onError((err, c) => {
  console.error("Unhandled error:", err.message);
  return c.json({ error: "Internal Server Error" }, 500);
});

addEventListener("fetch", (event: FetchEvent) => {
  event.respondWith(app.fetch(event.request));
});
```

---

## Tree-shaking

Import middleware from path-specific submodules, not the umbrella `hono/middleware`:

```typescript
// Correct — only the cors middleware is bundled
import { cors } from "hono/cors";

// Incorrect — pulls in all middleware
import { cors, logger, basicAuth } from "hono/middleware";
```

`fastedge-build` performs tree-shaking, but path-specific imports make bundle contents explicit and keep binary size predictable.

---

## See Also

- react-with-hono-server example — full SPA + Hono API with sub-routers and static asset serving
- Auth patterns reference — bearer-token and JWT validation patterns applicable as Hono middleware
- Proxy patterns reference — outbound fetch and response transform patterns usable inside Hono route handlers
