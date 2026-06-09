# FastEdge HTTP Apps as CDN Origins

FastEdge **HTTP apps** (`wasi-http`) can be used as the origin for a CDN resource — either as the resource's default origin or on specific URL paths via CDN rules. This routes CDN traffic directly to a FastEdge app instead of a conventional web server.

> **App type constraint**: Only `wasi-http` apps can be attached as CDN origins. `proxy-wasm` apps are CDN filter apps and attach via `options.fastedge` hooks — see the CDN Integration reference.

This is distinct from CDN apps (proxy-wasm filters): a CDN app intercepts traffic in flight; an HTTP app used as an origin *is* the traffic destination. The two are composable — a CDN resource can have proxy-wasm hooks active while also routing specific paths to a FastEdge HTTP app origin. The proxy-wasm filter runs first at the edge, then the CDN fetches from the matched origin.

---

## FastEdge Origin Group

To use a FastEdge HTTP app as an origin, create an origin group via the `gcore_api` tool (`POST /cdn/origin_groups`). The source entry uses `origin_type: "fastedge"` instead of a `source` domain:

```json
{
  "name": "my-auth-app",
  "sources": [
    {
      "origin_type": "fastedge",
      "config": {
        "app_id": "816998"
      },
      "enabled": true,
      "backup": false,
      "tag": "default"
    }
  ]
}
```

`app_id` is the FastEdge app's numeric ID as a **string**. There is no `source` field — the platform resolves the app internally. The response includes the origin group `id` needed for attaching it to a resource or rule.

To inspect an existing FastEdge origin group: `gcore_api` `GET /cdn/origin_groups/{origin_group_id}`. You can distinguish FastEdge origin groups from regular ones by the presence of `origin_type: "fastedge"` in the source.

---

## Attaching as the CDN Resource's Default Origin

Set the `originGroup` field on the CDN resource (`PATCH /cdn/resources/{resource_id}`) to the FastEdge origin group ID. All traffic on that resource is then forwarded to the FastEdge app.

```json
{
  "originGroup": 25877874,
  "originProtocol": "HTTPS"
}
```

---

## Path-Based Routing via CDN Rules

To keep a regular origin for most traffic and route only specific paths to a FastEdge app, create a rule on the resource (`POST /cdn/resources/{resource_id}/rules`):

```json
{
  "name": "auth-to-fastedge",
  "rule": "^/auth",
  "ruleType": 0,
  "originGroup": 25877874,
  "overrideOriginProtocol": "HTTPS",
  "weight": 1,
  "active": true
}
```

| Field | Description |
|---|---|
| `rule` | Regex path pattern. Must start with `^/` or `/`. Case-insensitive. `^/auth` matches `/auth`, `/auth/login`, `/auth/callback`. |
| `ruleType` | `0` — standard regex path-matching rule type. |
| `originGroup` | ID of the FastEdge origin group. |
| `overrideOriginProtocol` | `"HTTPS"` / `"HTTP"` / `"MATCH"` — protocol to reach the FastEdge app. |
| `weight` | Lower = higher priority when multiple rules match the same path. |

List rules on a resource with `gcore_api` `GET /cdn/resources/{resource_id}/rules`.

---

## Example — Path-based Routing to a FastEdge Auth App

CDN resource `cdn.example.com` serves a static site from origin `example.com` but handles `/auth/*` via a FastEdge app:

```
cdn.example.com/
  ├── /auth/*   →  FastEdge HTTP app  (origin group: my-auth-app)
  └── /*        →  example.com        (resource default origin group)
```

The FastEdge app receives the full original request (path, headers, body) and its response is returned to the client through the CDN.

---

## CDN Origin vs CDN Filter — When to Use Each

| Goal | Mechanism |
|---|---|
| Replace the origin (for all traffic or a specific path) | HTTP app as CDN origin (this document) |
| Intercept or modify traffic passing through the CDN | CDN app (proxy-wasm filter) via `options.fastedge` hooks |

---

## API Reference

All operations go through the `gcore_api` MCP tool.

| Operation | Method + Path |
|---|---|
| Create FastEdge origin group | `POST /cdn/origin_groups` |
| Get origin group | `GET /cdn/origin_groups/{origin_group_id}` |
| Set resource default origin | `PATCH /cdn/resources/{resource_id}` — `originGroup` field |
| Create path rule | `POST /cdn/resources/{resource_id}/rules` |
| List rules | `GET /cdn/resources/{resource_id}/rules` |

## See Also

- CDN Integration — attaching proxy-wasm CDN apps via `options.fastedge` hooks
- Platform Overview — CDN apps vs HTTP apps, architecture
- The deploy and manage skills — for creating and updating the FastEdge HTTP apps used as origins
