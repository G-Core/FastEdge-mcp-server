# Storage Semantics — KV Store and Cache

Behaviour of FastEdge's two storage primitives that the SDK references do not state: consistency, write shapes, TTL rules, missing operations, and measured performance. Applies to HTTP apps and CDN filters unless noted. For the per-language API, see the SDK reference for your language.

| | KV Store | Cache |
|---|---|---|
| Scope | Global, account-level, assigned to apps | Per-PoP, shared by every node in the PoP `[source + told]` |
| Consistency | Eventually consistent; **reads cached per node** (below) | Strong within a PoP |
| Writes from app code | ❌ API only | ✅ |
| Atomic primitive | — | `incr` only |

Provenance tags: `[live]` measured on a deployed app · `[source]` read from the runtime source · `[told]` stated by the FastEdge team · `[unverified]` not yet confirmed. Last verified: 2026-08-27.

---

## KV Store

### `get()` is a cached read — ~30 s per node

`[live, production]` Each `get(key)` populates a per-node cache entry that lives ~30 s, **whether or not the key existed**. Until it expires, that node keeps returning the old result — the old value, or "absent" for a key that now exists. Sorted-set reads (`zrangeByScore`) are **not** cached and reflect writes in 0–1 s.

| Reads before the write | Write | Visible after |
|---|---|---|
| none | create `kv` key | 1 s |
| heavy `get()` polling of the absent key | create `kv` key | **31 s** |
| heavy `get()` polling of the existing key | update its value | **30 s, then flapped** |
| heavy `zrangeByScore` polling | add `sorted_set` member | 0 s |

- **Values flap.** Warm and expired nodes answer differently at the same instant, so a polled `kv` flag can turn on, off, and on again during the window. For access gating this is worse than a delay.
- **Polling makes it worse** — every poll refreshes the staleness hiding the change.
- **Absence is not a safe signal.** "Key missing ⇒ not started" fails in the direction of "my change hasn't happened".

**Rule:** use `kv` + `get()` for values written once and read as configuration. For anything polled that must see changes promptly (a "has this happened yet?" flag), use a **sorted set with one member whose score is the timestamp** — uncached and consistent across nodes.

### Writes go through the API only

`[live]` `PUT /fastedge/v1/kv/{store_id}/data` — never from inside an app. Many entries can be batched in one call.

```jsonc
[{ "op": "add",                          // add | del_key | del_entries — REQUIRED
   "key": "…",
   "datatype": "kv",                     // kv | sorted_set | bloom_filter
   "payload": { "value": "…", "encoding": "plain" } }]   // encoding: plain | base64 | sha256
```

- **`sorted_set` nests differently:** its `payload` *is* the member array. The 400 only says `doesn't match any schema from "anyOf"`. To learn a payload shape, write one entry by hand and read it back with `GET /fastedge/v1/kv/{store}/data/{key}` — the read shape mirrors the write shape.
- **`datatype` scopes `del_key`.** Deleting a `kv` key with `datatype: "sorted_set"` returns **200 with `del_count: 0`** and removes nothing; a later `zrangeByScore` on that name then throws a type error. **Check `del_count`** on cleanup writes, especially when migrating a key between datatypes.
- The response includes `revision`, a store-wide monotonic counter — a freshness signal independent of clocks.
- Attaching a store to an app: `stores: {"<name>": {"id": <int>}}`; omit the inner `name` (read-only).

### Missing operations

`[source]` The read surface is exactly `open · get · scan · zrange_by_score · zscan · bf_exists`. There is **no** rank-based `ZRANGE`, `ZCOUNT`, `ZCARD` or `ZSCORE`. Do not emulate them in app code: `zrange_by_score(-inf, +inf)` transfers every member with its score into the wasm instance on every call.

`zrange_by_score` on a missing key returns an empty list, not an error.

---

## Cache

### Interface and atomicity

`[source]` `get · set · delete · exists · incr · expire · purge · purge_prefix`. **`incr` is the only atomic primitive** — no compare-and-set, `SETNX`, scripting, multi-key operations, or `SCAN`. Coordination must be expressible as "increment and compare the returned value".

### TTL rules

`[source + live]`

- **TTLs are silently clamped** to a deployment ceiling (default 4 days). The JS and Rust SDK references describe `set` without a TTL as "no expiry"; the host actually applies the default ceiling (runtime source, and a no-TTL `set` key measured gone within 22 days). **Treat the host behaviour as authoritative** — do not rely on any entry outliving ~4 days. There is no TTL-read primitive, so the clamp is invisible.
- **`incr` sets no TTL and does not index the key.** `incr`-created keys escape both the default-TTL cleanup and `purge_prefix` — measured still present after 22 days. Every `incr` key needs an `expire`, but *when* depends on the key shape — `expire` sets a deadline relative to now, so calling it again pushes the deadline out:
  - **Fixed key** (e.g. `rl:<ip>`): call `expire` only when `incr` returns `1`, and retry that `expire` within the request budget. Expiring on every call resets the window and keeps the key alive under continuous traffic. If the one `expire` fails for good, the key never expires — there is no TTL-read to detect it.
  - **Time-bucketed key** (window id in the name, e.g. `rl:<ip>:<window>`): calling `expire` on every call is safe and self-healing — writes stop when the window passes, so the key expires one TTL after its last write even if earlier `expire` calls failed. Prefer this shape when a permanently leaked key is costly.
- `expire` returns `false` for an absent key and `Err` for a failure. Do not collapse the two.

### Failures are real — retry

`[live, production]` Cache operations fail outright with explicit errors (not timeouts) at ~0.44% overall, bursty and PoP-specific (one PoP showed 1.5%). Plan for retries rather than assuming success, but bound them by the remaining execution budget — a single op can take ~100 ms at the tail, beyond the Basic plan's 50 ms limit. Decide deliberately whether an exhausted retry fails open or closed.

> **CDN filters:** the figures and TTL behaviour on this page were measured through HTTP apps. Proxy-wasm cache support is newer and is `[unverified]` to share the same backend behaviour.

---

## Measured performance

`[live, production]` Point-in-time, one account, mostly one PoP — evidence, not guarantees.

| Metric | Value |
|---|---|
| `Cache.incr` | p50 1 ms · p95 27 ms · max 102 ms |
| `Cache.expire` | p50 2 ms · p95 6 ms · max 21 ms |
| KV write → visible (no prior `get()` polling) | 61 / 80 / 107 ms (min / p50 / max) |
| KV write rate, one client | sustained ~94 writes/s |
| KV sorted-set ingest | ~2,450 members/s; knee at 32–64 concurrent writers |
| Largest single batched `PUT` | ~1,560 entries — bounded by a 30 s gateway timeout, not payload size |
| Sorted-set storage | ~31 bytes/member |
| Intra-PoP clock skew | ≤5 ms, probably ≤1 ms |

### Preprod is not production

Preprod KV propagation was bimodal — typically ~210 ms, but ~1 in 8–15 writes invisible for over 45 s. Production did not do this. Do not benchmark or size designs on preprod. Before attributing a ~30 s delay to either, check the cached-read behaviour above: if something was polling the key with `get()`, or the value flaps once it appears, it is the per-node read cache.

---

## See Also

- [cdn-filter-runtime.md](./cdn-filter-runtime.md) — what a CDN filter can access
- [overview.md](./overview.md) — account-level KV stores, resource limits
