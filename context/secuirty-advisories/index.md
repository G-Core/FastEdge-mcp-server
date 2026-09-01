# FastEdge MCP Server — Security Advisories

Tracking index for security findings in `FastEdge-mcp-server`. Each open item
has its own `SA-XXX-*.md` file with reproduction, impact, and a concrete fix a
non-expert agent can apply.

**Audit date:** 2026-09-01
**Scope reviewed:** `src/` (all tools, api-client, policy), `Dockerfile`,
`Dockerfile-base`, `docker-entrypoint.sh`, production dependency tree.

## Threat model (read this first)

This MCP server runs as a **Docker container with a bind-mounted `/workspace`**
and the operator's **`GCORE_API_KEY` in its environment**. Its local tools
(`build-wasm`, `scaffold-fastedge-project`, `list-fastedge-templates`) **execute
build tooling against code in that workspace** — `cargo build` (runs `build.rs`
+ proc-macros), `npx fastedge-build` / `asc` (run project `node_modules` code),
and `create-fastedge-app` + `npm install` (run network-fetched package
lifecycle scripts). **Executing workspace/third-party code is by design.** The
security question is therefore *not* "can workspace code run" (it must) but
"what does that code get access to, and what does it leave behind". Several open
findings below are about exactly that: the API key is handed to every build
subprocess, and build output is made world-writable.

## Severity scale

CVSS-style qualitative bands: **Critical / High / Medium / Low**. Scores are
this-context estimates, not NVD vectors.

## Open findings

| ID | Title | Severity | File | Status |
|----|-------|----------|------|--------|
| SA-001 | Operator API key exposed to every build/scaffold subprocess | **High** | [SA-001-api-key-env-exposure.md](SA-001-api-key-env-exposure.md) | Open |
| SA-002 | Build output made world-writable (`chmod 0o777`, walk escapes to `/workspace`) | **Medium** | [SA-002-world-writable-build-output.md](SA-002-world-writable-build-output.md) | Open |
| SA-004 | Container falls back to running as root | **Medium** | [SA-004-docker-root-fallback.md](SA-004-docker-root-fallback.md) | Open |
| SA-005 | Scaffolding: mutable `@beta` + workspace-controlled npm registry | **Medium** | [SA-005-supply-chain-beta-tag.md](SA-005-supply-chain-beta-tag.md) | Open |
| SA-007 | Build subprocesses have no timeout or output limit (DoS) | **Medium** | [SA-007-unbounded-build-processes.md](SA-007-unbounded-build-processes.md) | Open |
| SA-008 | Workspace confinement is lexical only; symlinks escape it | **Medium** | [SA-008-symlink-path-escape.md](SA-008-symlink-path-escape.md) | Open |
| SA-003 | Vulnerable transitive dependencies (3 high, via MCP SDK) | **Low** shipped / latent High | [SA-003-vulnerable-dependencies.md](SA-003-vulnerable-dependencies.md) | Open |
| SA-006 | Unused direct `qs` dependency (hygiene) | **Low** | [SA-006-unused-qs-dependency.md](SA-006-unused-qs-dependency.md) | Open |
| SA-009 | Docker base images use mutable tags (not digest-pinned) | **Low** | [SA-009-mutable-base-images.md](SA-009-mutable-base-images.md) | Open |

**Suggested fix order:** SA-001 → SA-004 → SA-008 → SA-007 → SA-002 → SA-005 →
SA-003 → SA-006 → SA-009. The first four cap the worst blast radius (credential
reach, root, arbitrary file access, DoS); SA-002 depends on SA-004's UID
resolution; the rest are hardening/hygiene.

> **Reviewed 2026-09-01** by a second independent model (cross-examination) and
> each load-bearing claim re-verified against the code before these were
> finalized. Corrections applied: SA-001 remediation now removes the key from
> `process.env` (env-strip alone is bypassable via `/proc/<pid>/environ`);
> SA-002 fixes ownership + the `/workspace`-escaping walk, not just mode bits;
> SA-003 uses exact patched versions (the earlier "10 high" was duplicate paths
> — 3 unique high) and no longer claims base images are pinned; SA-004 keeps
> root for UID selection instead of a broken `USER app`; SA-005 raised to Medium
> (workspace `.npmrc` registry redirect); SA-006 no longer claims removal clears
> the audit advisory (`qs` is also transitive). SA-007/008/009 added.

## Fixed / historical (do not re-open)

These are the shell/OS-command-injection reports that prompted this audit. They
are **already fixed** — verify the fix is intact if you touch these files, but
no new work is needed.

| Area | What was fixed | Commit(s) | Verified intact |
|------|----------------|-----------|-----------------|
| Compiler builds (`cargo`, `asc`, `fastedge-build`) | Switched from shell-string exec to `spawn()` with an args array and **no shell**, so a project-controlled cargo `target` / paths can't inject shell syntax (ICM-50655) | `4143ce1`, `355d0d0` | `src/tools/local/workspace/compiler/*.ts` — `spawn(cmd, [args], {stdio,...})`, no `shell:true` |
| Scaffolding (`create-fastedge-app`) | Switched to `execFile("npx", args)` (args array, no shell) so `outputPath` can't be interpreted as shell syntax | `355d0d0` | `src/tools/local/scaffolding/scaffolds.ts` — `execFileAsync` for scaffold. **Note:** `list-fastedge-templates` still uses `execAsync` on a *constant* string (no user input) — safe, but see SA-005 |
| API path SSRF / key exfiltration | `api-client.ts` rejects any path whose resolved `URL.origin` differs from `GCORE_API_BASE`; `policy/evaluate.ts` `normalizePath` denies traversal, backslashes, `%2e/%2f`, control chars, protocol-relative and userinfo-authority paths before the allowlist match | (part of policy layer) | `src/api-client.ts:97-116`, `src/policy/evaluate.ts:58-82` |

> **Note on the two `normalizePath`s — they are different functions, don't
> conflate them.** `policy/evaluate.ts:normalizePath` (API *URL* paths) is
> hardened and fine. `utils/index.ts:normalizePath` (local *filesystem* paths)
> is the lexical-only one with the symlink gap — that's **SA-008**, still open.
| Batch path re-injection | `batch_execute` re-runs `checkAllowed` on the **resolved** path (post `$ref` substitution) because prior-step data is untrusted and can carry `/` or `..` | `3141bcc` | `src/tools/api/batch-execute.ts:216` |

## How to work these

1. Pick the lowest-numbered open item, open its file.
2. Apply the fix in the "Remediation" section. Keep the diff minimal.
3. Run `pnpm run test` (and `pnpm run test:compiler-injection` for compiler
   changes).
4. Flip the row's **Status** to `Fixed` here and add the commit hash.
