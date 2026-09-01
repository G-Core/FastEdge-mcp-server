# SA-003 — Vulnerable transitive dependencies

**Severity:** Low as currently shipped (stdio transport — the vulnerable HTTP
code paths are never started); **latent High** if an HTTP/SSE transport is ever
enabled. Track it, fix it, but do not treat it as a live Medium.
**Category:** Vulnerable and outdated components (CWE-1035 / CWE-937)
**Status:** Open
**Affected:** `package.json` production tree — everything below is transitive
under `@modelcontextprotocol/sdk@1.30.0` (via `express`/`hono`), except `qs`
which is *also* a direct (unused) dep — see SA-006.

## Summary

`pnpm audit --prod` (2026-09-01) reports **8 unique advisories** in the
production tree: 3 high, 3 moderate, 2 low. (Audit tools may print larger
totals — e.g. "50 vulnerabilities" — because they count every dependency *path*;
the unique-advisory list below is what actually needs patching.)

`src/server.ts:35` uses `StdioServerTransport` only, so the Express/Hono HTTP
stack that contains almost all of these is present in the image but never
started. Reachability today is therefore negligible; the risk is latent (a
future transport change makes them live) plus audit-gate/compliance noise.

## Unique advisories (exact versions — apply these, no guessing)

| Severity | Package | Vulnerable | Patched | Advisory | Reachable via stdio? |
|----------|---------|-----------|---------|----------|----------------------|
| high | `@hono/node-server` | `<1.19.10` | `>=1.19.10` | GHSA-wc8c-qw6v-h7f6 | No (HTTP static serving) |
| high | `path-to-regexp` | `>=8.0.0 <8.4.0` | `>=8.4.0` | GHSA-j3q9-mxjg-w52f | No (HTTP routing) |
| high | `fast-uri` | `>=3.0.0 <=3.1.3` | `>=3.1.4` | GHSA-v2hh-gcrm-f6hx | Unlikely (ajv URI parsing) |
| moderate | `hono` | `<4.11.7` | `>=4.11.7` | GHSA-9r54-q6cx-xmh5 | No |
| moderate | `ajv` | `>=7.0.0-alpha.0 <8.18.0` | `>=8.18.0` | GHSA-2g4f-4pwh-qvx6 | Unlikely |
| moderate | `picomatch` | `>=4.0.0 <4.0.4` | `>=4.0.4` | GHSA-3v7f-55p6-f55p | No |
| low | `qs` | `>=6.7.0 <=6.14.1` | `>=6.14.2` | GHSA-w7fw-mjwx-w883 | No (see SA-006) |
| low | `body-parser` | `>=2.0.0 <2.3.0` | `>=2.3.0` | GHSA-v422-hmwv-36x6 | No |

## Remediation (mechanical, in this order)

1. **Check for a newer `@modelcontextprotocol/sdk` patch/minor within `^1.x`**
   (current: `1.30.0`). Do **not** jump majors:
   ```bash
   pnpm outdated @modelcontextprotocol/sdk   # look for a 1.x bump only
   ```
   If a newer 1.x exists, take it, then re-run `pnpm audit --prod` — it may
   clear several rows.
2. **Pin the remainder with `pnpm.overrides`** using the exact patched versions
   from the table (all are semver-compatible bumps within the same major, so
   they are safe to force):
   ```json
   "pnpm": {
     "overrides": {
       "@hono/node-server@<1.19.10": ">=1.19.10",
       "path-to-regexp@>=8.0.0 <8.4.0": ">=8.4.0",
       "fast-uri@>=3.0.0 <=3.1.3": ">=3.1.4",
       "hono@<4.11.7": ">=4.11.7",
       "ajv@>=7.0.0-alpha.0 <8.18.0": ">=8.18.0",
       "picomatch@>=4.0.0 <4.0.4": ">=4.0.4",
       "qs@>=6.7.0 <=6.14.1": ">=6.14.2",
       "body-parser@>=2.0.0 <2.3.0": ">=2.3.0"
     }
   }
   ```
3. `pnpm install`, then `pnpm run build && pnpm run test` — the full suite must
   pass before this counts as fixed.
4. Rebuild the Docker image so the lockfile change ships.

## Verification

`pnpm audit --prod` reports 0 advisories. Add a CI step
`pnpm audit --prod --audit-level high` so regressions fail the build.

## Notes

- Base-image tag pinning was previously (incorrectly) declared "in good shape"
  here — that's a separate real finding now tracked as **SA-009** (mutable
  `rust:1.95-slim` and `:latest` base tags).
