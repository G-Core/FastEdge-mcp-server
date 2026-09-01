# SA-007 — Build subprocesses have no timeout or output limit (DoS)

**Severity:** Medium (reachable under the untrusted-workspace model; availability
only, no data exposure)
**Category:** Uncontrolled resource consumption (CWE-400)
**Status:** Open
**Affected files:**
- `src/tools/local/workspace/compiler/jsBuild.ts:17-61`
- `src/tools/local/workspace/compiler/asBuild.ts:51-79`
- `src/tools/local/workspace/compiler/rustBuild.ts:72-138`

## Summary

All three compiler build paths `spawn` untrusted build tooling with **no
timeout, no cancellation, and no output cap**, then accumulate the child's
stdout/stderr into **unbounded** JavaScript strings:

```ts
// jsBuild.ts (asBuild.ts, rustBuild.ts are equivalent)
const jsBuild = spawn("npx", [...], { stdio: ["ignore", "pipe", "pipe"], cwd, env });
let stdout = "";
jsBuild.stdout?.on("data", (data) => { stdout += data; });  // grows without bound
jsBuild.stderr?.on("data", (data) => { stderr += data; });  // grows without bound
// no timeout, no maxBuffer, no kill path
```

Because the workspace is untrusted (a build runs the project's own `build.rs`,
proc-macros, `package.json` scripts — see the `index.md` threat model), a
malicious or accidentally-pathological project can:

- **Hang the request forever** — a `build.rs` / npm script that sleeps or blocks
  never fires `close`, so `buildWasmBinary`'s promise never resolves. The MCP
  request hangs indefinitely.
- **Exhaust memory** — a build that prints to stdout/stderr in a loop grows the
  `stdout`/`stderr` strings until the Node process is OOM-killed (and Docker
  sets no memory limit by default), taking the whole MCP server down.

Note the scaffolding tools (`scaffolds.ts`) already set `timeout: 120000` and
`maxBuffer: 10MB` on their `exec`/`execFile` calls — the compilers are the
inconsistent, unprotected path and should match them.

## Impact

- **Availability:** a single build against a hostile or broken project hangs or
  kills the MCP server, denying service to the operator. No confidentiality/
  integrity impact. Trigger is ordinary (build a bad project), hence Medium.

## Remediation

Add a timeout with a kill, and cap accumulated output, to all three compilers.
`child_process.spawn` supports `timeout` + `killSignal` directly:

```ts
const MAX_BUILD_MS = 180_000;      // align with batch cap; tune per language
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

const jsBuild = spawn("npx", [...], {
  stdio: ["ignore", "pipe", "pipe"],
  cwd,
  env: buildSubprocessEnv(),       // SA-001
  timeout: MAX_BUILD_MS,           // Node sends killSignal on expiry
  killSignal: "SIGKILL",
});

let stdout = "";
let truncated = false;
jsBuild.stdout?.on("data", (data: Buffer) => {
  if (stdout.length + data.length > MAX_OUTPUT_BYTES) {
    truncated = true;
    stdout = stdout.slice(0, MAX_OUTPUT_BYTES);
    jsBuild.kill("SIGKILL");
    return;
  }
  stdout += data;
});
// same guard for stderr
```

Handle the timeout branch in the `close`/`error` handlers: when the process was
killed by timeout (`signal === "SIGKILL"` / the `error` event with
`err.code === "ETIMEDOUT"`), reject with a clear
`"build timed out after 180000ms"` rather than a generic exit-code message, and
mention truncation if `truncated`.

Apply identically to `asBuild.ts` and `rustBuild.ts`. Consider a shorter default
for JS/AS than Rust (Rust cold builds are legitimately slow); make it overridable
via env if needed, mirroring `BATCH_MAX_CALLS`.

## Test

Add to `scripts/tests/`: a fake build command that (a) sleeps past the timeout —
assert the promise rejects with a timeout error within ~timeout+ε, and (b)
floods stdout — assert memory/accumulated output stays bounded and the process is
killed. A stub replacing `spawn` with a scripted child is enough; no real
toolchain needed.

## Related

- SA-001 (`buildSubprocessEnv`), SA-004 (what the runaway runs as).
