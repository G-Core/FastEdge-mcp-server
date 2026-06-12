# CDN Integration — Attaching FastEdge Apps to CDN Resources

FastEdge **CDN apps** (proxy-wasm filters) run inside Gcore's CDN proxy layer rather than as standalone HTTP handlers. To take effect, a CDN app must be **attached** to a Gcore CDN resource at one or more proxy-wasm lifecycle phases ("hooks"). This document covers the configuration surface that wires a deployed CDN app to a CDN resource — the resource-level attachment block, path-scoped overrides via CDN rulesets, and how to disable FastEdge on specific paths.

This document is about **how the CDN platform invokes a deployed CDN app**, not how to write one. For the proxy-wasm SDK surface (lifecycle methods, header/body manipulation, host services), see the Rust CDN apps reference and the AssemblyScript SDK reference.

## CDN Resource — Where Apps Attach

A CDN resource is the public-facing object on Gcore's CDN — it has a delivery domain (`cname`), an origin group, TLS configuration, and an `options` blob holding feature toggles. The `options.fastedge` sub-block is what attaches a CDN app to traffic flowing through the resource.

API path: `GET /cdn/resources/{resource_id}` — returns the full resource including `options` and `rules`.

### The `options.fastedge` Block

Resource-level FastEdge attachment lives at `options.fastedge`. The shape:

```json
"options": {
  "fastedge": {
    "enabled": true,
    "on_request_headers": {
      "enabled": true,
      "app_id": "781546",
      "interrupt_on_error": true,
      "execute_on_edge": true,
      "execute_on_shield": false
    },
    "on_response_headers": {
      "enabled": true,
      "app_id": "781546",
      "interrupt_on_error": true,
      "execute_on_edge": true,
      "execute_on_shield": false
    }
  }
}
```

| Field | Type | Description |
|---|---|---|
| `enabled` | boolean | Master toggle for FastEdge on this resource. When `false`, no hooks fire regardless of per-hook config. |
| `on_request_headers` | object \| absent | Per-hook config for the proxy-wasm `onRequestHeaders` callback. |
| `on_request_body` | object \| absent | Per-hook config for the `onRequestBody` callback. |
| `on_response_headers` | object \| absent | Per-hook config for the `onResponseHeaders` callback. |
| `on_response_body` | object \| absent | Per-hook config for the `onResponseBody` callback. |

A hook key is **absent** when not configured — the corresponding lifecycle phase simply doesn't run any FastEdge filter. To stop a previously-configured hook, either set its inner `enabled: false` or remove the hook key entirely.

### Per-Hook Configuration

Each per-hook block has the same shape:

| Field | Type | Description |
|---|---|---|
| `enabled` | boolean | Whether this specific hook fires. The outer `fastedge.enabled` and this inner `enabled` must both be true for the hook to run. |
| `app_id` | string | The FastEdge app to invoke at this lifecycle phase. **Note:** this is a string (e.g. `"781546"`), even though `/fastedge/v1/apps` returns `id` as an integer. Quote the numeric ID when writing this field. |
| `interrupt_on_error` | boolean | Behavior if the app errors out. When `true`, the proxy-wasm filter chain is interrupted and the request is rejected. When `false`, the error is logged and processing continues. |
| `execute_on_edge` | boolean | Run this hook on edge PoPs (the default location for CDN traffic). |
| `execute_on_shield` | boolean | Run this hook on the origin-shielding layer (when origin shielding is enabled on the resource). Independent of `execute_on_edge`. |

Different apps can be wired to different hooks — `on_request_headers.app_id` and `on_response_headers.app_id` are independent fields, so request-side and response-side processing can be handled by separate apps. The same app can also be wired to multiple hooks (the live example above uses app `781546` on both header phases).

## Path-Scoped Overrides via CDN Rulesets

CDN rules let you override resource-level options for traffic matching a path pattern. Rules live under the resource and are returned in the `rules[]` array of the resource detail response.

### Rule Shape

```json
{
  "id": 21681757,
  "rule": "/auth/",
  "ruleType": 0,
  "weight": 1,
  "active": true,
  "options": {
    "fastedge": {
      "enabled": true,
      "on_request_headers": {
        "enabled": true,
        "app_id": "755101",
        "interrupt_on_error": true,
        "execute_on_edge": true,
        "execute_on_shield": false
      }
    }
  }
}
```

Key fields:

| Field | Description |
|---|---|
| `rule` | Path pattern. Combined with `ruleType` to determine matching. |
| `ruleType` | `0` for regex matching paths starting with `/`. (Type `1` is legacy.) |
| `weight` | Execution order — lower runs first when multiple rules match. |
| `active` | Whether the rule applies. Disabled rules are skipped entirely. |
| `options.fastedge` | The FastEdge override for matching traffic. Same shape as the resource-level block. |

### Critical: Replace Semantics, Not Merge

When a request matches a rule, the rule's `options.fastedge` block **fully replaces** the resource's — there is no per-hook inheritance.

If a rule sets only `on_request_headers` and the resource has both `on_request_headers` and `on_response_headers` configured, then for matching traffic:

- `on_request_headers` fires using the **rule's** `app_id`
- `on_response_headers` does **not** fire (it is not inherited from the resource)
- `on_request_body` / `on_response_body` do not fire

This is the most important operational detail of CDN rule-based overrides. To preserve a resource-level hook on a specific path, **copy** that hook's configuration into the rule alongside whatever you're overriding.

### Public-Route Pattern — Disable FastEdge on a Path

To make a path "public" (skip all FastEdge processing entirely), create a rule for that path and set `options.fastedge.enabled: false`:

```json
{
  "rule": "/never-run-fastedge/",
  "ruleType": 0,
  "weight": 2,
  "active": true,
  "options": {
    "fastedge": {
      "enabled": false
    }
  }
}
```

For traffic matching the rule's pattern, the master toggle is off and no hooks fire — regardless of what the resource-level `options.fastedge` has configured. This is the canonical pattern for paths that must bypass FastEdge (health checks, status endpoints, third-party callbacks that mustn't be modified, public assets, etc.).

### Different App on a Path

To run a different app on a specific path while keeping the resource-level config for everything else, create a rule that fully describes the path's hook set with the alternative `app_id`:

```json
{
  "rule": "/admin/",
  "options": {
    "fastedge": {
      "enabled": true,
      "on_request_headers": {
        "enabled": true,
        "app_id": "999999",
        "interrupt_on_error": true,
        "execute_on_edge": true,
        "execute_on_shield": false
      }
    }
  }
}
```

Remember: the rule's hook set is **complete and replacing**. If you want admin traffic to also hit the resource's `on_response_headers` app, copy that block into the rule's options.

## Reading and Updating

```bash
# Read resource (includes options.fastedge and rules)
curl -s -X GET "https://api.gcore.com/cdn/resources/<resource-id>" \
  -H "Authorization: APIKey $GCORE_API_KEY"

# Patch resource-level fastedge attachment
curl -s -X PATCH "https://api.gcore.com/cdn/resources/<resource-id>" \
  -H "Authorization: APIKey $GCORE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "options": {
      "fastedge": {
        "enabled": true,
        "on_request_headers": {
          "enabled": true,
          "app_id": "781546",
          "interrupt_on_error": true,
          "execute_on_edge": true,
          "execute_on_shield": false
        }
      }
    }
  }'
```

Rules are managed through their own endpoints under `/cdn/resources/{resource_id}/rules`. The full rule API is in the Gcore CDN documentation.

## Operational Notes

- **`app_id` is a string.** The FastEdge apps API (`GET /fastedge/v1/apps`) returns `id` as an integer, but in the `options.fastedge.<hook>.app_id` field it must be quoted as a string. Mixing types is a common source of validation errors.
- **App must already be deployed.** The app referenced by `app_id` must exist and be enabled (`status: 1`) — there is no implicit creation. Deploy via `/gcore-fastedge:deploy` or `POST /fastedge/v1/apps` first, then attach.
- **App type must be `proxy-wasm`.** HTTP apps (`api_type: "wasi-http"`) cannot be attached to CDN resource hooks — they run as standalone serverless functions, not as filters in the CDN proxy chain.
- **Hook absence vs. `enabled: false`.** Both result in the hook not running. Removing the key entirely is cleaner; toggling `enabled: false` preserves the hook's other config for easy re-enable.
- **`execute_on_shield` only matters when origin shielding is on.** If `shielded: false` on the resource, the shield-layer setting has no effect — the hook only ever runs at the edge.
- **Rule weight ordering.** When multiple rules match a request path, only the rule with the lowest weight applies. Rules don't compose.
- **Changes propagate.** CDN configuration changes can take a few minutes to propagate to all PoPs. The resource may briefly be in `status: "processed"` after an update.

## See Also

- Rust CDN apps reference — proxy-wasm lifecycle methods, host services, request/response manipulation in Rust
- AssemblyScript SDK reference — proxy-wasm lifecycle and FastEdge host APIs in AssemblyScript
- Platform overview — CDN apps vs HTTP apps, architecture, request lifecycle
- HTTP apps as CDN origins — routing CDN traffic to a FastEdge HTTP app via origin groups and CDN rules (a different integration model from proxy-wasm hooks)
- The deploy and manage skills — for creating and updating the FastEdge apps that get attached here
