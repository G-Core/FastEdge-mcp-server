# SA-006 — Unused direct `qs` dependency (hygiene)

**Severity:** Low (dependency hygiene — no reachable vulnerability; the code
never calls it)
**Category:** Unnecessary dependency (CWE-1071)
**Status:** Open
**Affected file:** `package.json` (`dependencies.qs`, `devDependencies["@types/qs"]`)

## Summary

`package.json` declares `qs` (`^6.14.0`) as a **direct production dependency**,
but nothing in `src/` or `scripts/` imports it (verified by grep — query strings
are built with `URLSearchParams` in `api-client.ts`). It's a dead declaration
that misleads readers and audit triage into thinking the server uses `qs`
directly.

## Important scope limitation (read before fixing)

Removing the direct dep does **NOT** remove `qs` from the production image and
does **NOT** clear the `qs` audit advisory (GHSA-w7fw-mjwx-w883). `qs@6.14.1`
is also resolved **transitively** via
`@modelcontextprotocol/sdk → express → body-parser → qs` (confirmed with
`pnpm why qs`). The transitive copy is handled by the version override in
**SA-003** (`qs >=6.14.2`). This advisory is only about deleting the misleading
direct declaration.

## Impact

- None directly exploitable. Value of fixing: honest dependency manifest,
  smaller direct-dep surface, no accidental future `import qs` landing on an
  unpatched version.

## Remediation

```bash
grep -rn "from ['\"]qs['\"]\|require(['\"]qs['\"])" src/ scripts/   # must be empty
pnpm remove qs @types/qs
pnpm run build && pnpm run test
```

If a future feature needs querystring parsing beyond `URLSearchParams`, re-add
it pinned to `>=6.14.2` at that point.

## Verification

- `pnpm run build` and `pnpm run test` pass.
- `pnpm why qs` shows only the transitive path via `@modelcontextprotocol/sdk`
  (that path disappearing is SA-003's job, not this one's).
- Do **not** use "`pnpm audit` no longer lists qs" as the success criterion for
  this advisory — it will keep listing the transitive copy until SA-003's
  override lands.
