# CDN Filter Runtime — Capabilities and Traps

What a proxy-wasm filter (CDN app) can and cannot do on FastEdge, and the host behaviours that silently differ from generic proxy-wasm or from HTTP apps. **Read this before designing or reviewing a CDN app** — most items here are invisible in local tests and only surface on a deployed app.

Every claim carries its provenance:

| Tag | Meaning |
|---|---|
| `[live]` | Measured against a deployed app on a real CDN resource |
| `[source]` | Read from the FastEdge runtime or SDK source |

Last verified: 2026-08-25 (SDK surface re-checked 2026-09-23).

---

## Capability boundary — filter vs HTTP app

A filter is a core wasm module linked against the proxy-wasm `env` ABI. It is a different execution world from an HTTP app, not a subset of it. Designs that assume symmetry with the HTTP-app SDK fail at deploy.

| Capability | HTTP app | CDN filter |
|---|---|---|
| KV read | ✅ | ✅ same six operations: `open · get · scan · zrange_by_score · zscan · bf_exists` `[source]` |
| KV write | ❌ (API only — see [storage.md](./storage.md)) | ❌ (API only) |
| Cache (`get/set/delete/exists/incr/expire/purge/purgePrefix`) | ✅ | ✅ host-supported; **SDK support varies — check the SDK reference for your language** |
| Secrets / dictionary | ✅ | ✅ via the SDK's proxy-wasm module |
| Outbound `fetch` | ✅ | proxy-wasm `http_call` only |
| Deferred / background work | JS `waitUntil` only (not a timer) | ❌ none |
| State between requests | ❌ | ❌ — consecutive requests hit different nodes `[live]` |

### Use only the SDK's proxy-wasm modules

HTTP-app host APIs are component-model (WIT) imports. A proxy-wasm host cannot resolve them, so **one reference anywhere in a filter makes the app fail to instantiate — HTTP 530 on every path**, including paths that never reach the call `[live]`. It compiles and links with no warning.

- **Rust:** in a filter import only from `fastedge::proxywasm::*`. Never use a top-level `fastedge::` module (`fastedge::cache`, `fastedge::secret`, …) — each has a `fastedge::proxywasm::` counterpart.
- **Check before deploying** — any `gcore:fastedge/...` import in a filter build means a 530 at runtime:
  ```bash
  wasm-tools print app.wasm | grep -o '(import "[^"]*"' | sort -u
  ```

---

## Reading the request — use properties, not headers

Several headers a proxy-wasm developer would reach for are mangled or absent. **All failures are silent** `[live]`.

| Read via | Result |
|---|---|
| property `request.host` | ✅ clean client-requested host (before any origin host rewrite) on the edge tier; on shield nodes it may carry a `shield_` prefix |
| property `request.x_real_ip` | ✅ true client IP, IPv4 and IPv6 |
| property `request.path` | ⚠️ **includes the query string** — see below |
| property `request.query` | ✅ query without `?`; not set by the host when there is no query (how "not set" surfaces — `None`, empty buffer — depends on the SDK) |
| property `request.asn` / `.country` / `.city` / `.region` / `.continent` | ✅ |
| property `source.address` | ❌ does not exist (Envoy's name) — returns nothing |
| header `host` | ❌ mangled to `<domain>_cache_sharded` |
| headers `:path`, `:authority` | ❌ absent |
| headers `x-real-ip`, `x-forwarded-for`, `cookie`, `user-agent` | ✅ intact (`cookie` is visible even with `ignore_cookie: true`) |

### `request.path` includes the query string

```
GET /x?a=1&b=2
request.path  = "/x?a=1&b=2"
request.query = "a=1&b=2"
```

Prefix checks are unaffected; **equality checks silently fail on any request with a query** — auth callbacks are exactly where equality checks live. Split on `?` first. Corollary: because it is path+query, `request.path` works directly as a relative `Location` for a same-origin redirect, which avoids the mangled `host` header.

---

## Security — gating filters

### The CDN does not normalise the path before the filter runs

`[live]` Traversal and separator sequences arrive verbatim:

```bash
curl --path-as-is ".../app/x/../test"  # request.path = "/app/x/../test"
curl --path-as-is ".../app//test"      # request.path = "/app//test"
```

A filter that bypasses auth on a prefix (`/auth/`, `/public/`) will wave through `/auth/../admin`, which the origin may normalise back to `/admin`. **That is an authentication bypass**, and it is the natural way to write the code.

Reject suspicious sequences before any prefix bypass, and **fail closed** — fall through to the auth check. Never normalise the path yourself and proceed; you will not match the origin's rules.

```rust
fn has_suspicious_sequence(path: &str) -> bool {
    if path.contains("..") || path.contains("//") || path.contains('\\') { return true; }
    let lower = path.to_ascii_lowercase();
    lower.contains("%2e") || lower.contains("%2f")
        || lower.contains("%5c") || lower.contains("%25")   // %25 catches double-encoding
}
```

### Filters run before the CDN cache lookup

`[live, edge tier only]` A request-phase filter runs on **every** request, including cache hits.

- **Security:** a cached response cannot bypass a request-phase gate.
- **Cost:** every request pays for whatever the filter does — KV reads, cache ops — even on cache hits.
- A `no-store` response from a filter is not cached. Varying the cache key on a session cookie fragments the cache per visitor.

Only `execute_on_edge` was measured; ordering on the shield tier is unverified.

---

## Synthetic responses

`[live]` A filter can serve a complete response via `send_http_response`: any status, arbitrary headers, multiple `Set-Cookie` headers on one response, and bodies up to at least 1 MB without truncation. Single-app designs (challenge pages, interstitials, error pages) do not need a second HTTP app.

---

## What local testing cannot prove

`@gcoredev/fastedge-test` runs proxy-wasm filters locally and proves **flow logic** — routing, header manipulation, gate decisions. It cannot prove **host behaviour**: property semantics, header mangling, path non-normalisation, instantiation failures, cache interaction. Every trap on this page passes a local suite green. Confirm host-dependent behaviour on a deployed app attached to a real CDN resource.

---

## See Also

- [storage.md](./storage.md) — KV and Cache semantics, limits, measured performance
- [cdn-integration.md](./cdn-integration.md) — attaching filters to CDN resources
- [error-codes.md](./error-codes.md) — 530 diagnosis
