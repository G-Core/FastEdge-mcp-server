# SA-002 — Build output made world-writable (`chmod 0o777` up the tree)

**Severity:** Medium (shared-host / shared-runner deployments; lower on a
single-user dev machine)
**Category:** Incorrect permission assignment (CWE-732)
**Status:** Open
**Affected file:** `src/tools/local/workspace/compiler/utils.ts:7-29` (`wasmOutputPermissions`)

## Summary

After every successful build, `wasmOutputPermissions` sets mode `0o777`
(read/write/execute for **everyone**) on the output `.wasm` file and on
**every directory** from the output file's parent upward until the loop hits
`cwd`, `/`, or `.`.

Two problems:

1. **`0o777` is world-writable.** Any other user or process on the host (or
   sharing the bind mount) can replace the built `.wasm` — the exact artifact
   the operator uploads to production via `upload-binary` — or drop files into
   those directories.
2. **The walk escapes the build directory.** The loop terminates only when
   `currentDir === cwd`. When the output dir is **not under `cwd`** — the
   *default* for Rust builds: `compiler/index.ts:96` puts output at
   `<workspaceRoot>/wasm/output.wasm` while `cwd` is the nested project dir
   containing `Cargo.toml` — the loop never meets `cwd` and chmods every
   ancestor up to and **including `/workspace` itself** before stopping at `/`.
   The whole workspace root ends up `0o777`.

## Where it is

```ts
function wasmOutputPermissions(wasmBinaryPath: string, cwd: string) {
  const outputDir = dirname(wasmBinaryPath);
  let currentDir = outputDir;
  while (currentDir !== cwd && currentDir !== "/" && currentDir !== ".") {
    chmodSync(currentDir, 0o777);          // world-writable dir — walks past cwd
    currentDir = dirname(currentDir);      // when output isn't under cwd
  }
  chmodSync(wasmBinaryPath, 0o777);        // world-writable file
}
```

## Why it exists (context — the fix must preserve this)

In the Docker container the build may run as a different UID than the host user
who owns the bind mount (and in the root-fallback case of SA-004, as root), so
output could come out root-owned and unreadable/undeletable by the host user.
The **goal** is "the host user can read/write/delete the output". `0o777` is
the sledgehammer version of that. Any fix that only tightens mode bits (e.g.
`0o770`/`0o660`) **breaks this goal in the root-fallback case**: files stay
root-owned and the host user — different UID, not in root's group — loses
access. Do not apply a mode-only change.

## Impact

- **Integrity:** local tampering with the production-bound WASM artifact, the
  build tree, and (via the escaping walk) the entire workspace root, by any
  local user. Requires local/shared-host access, hence Medium.

## Remediation

Fix **ownership**, not world-writability, and bound the walk:

1. **Chown to the workspace owner instead of chmod 777.** The entrypoint
   already resolves the correct UID/GID (`docker-entrypoint.sh` — workspace
   owner or `HOST_UID`/`HOST_GID`). Apply the same resolution here:

   ```ts
   import { chownSync, statSync } from "fs";

   function fixOutputOwnership(wasmBinaryPath: string, workspaceRoot: string) {
     if (process.getuid?.() !== 0) return; // non-root: entrypoint already
                                           // dropped privs; files are owned
                                           // correctly, nothing to do.
     const { uid, gid } = statSync(workspaceRoot); // owner of the bind mount
     if (uid === 0) return;                        // no meaningful owner to match
     chownSync(wasmBinaryPath, uid, gid);
     chmodSync(wasmBinaryPath, 0o644);             // rw owner, r others, no exec
   }
   ```

   When the server runs non-root (the normal `setpriv` path), output is already
   owned by the right user and **no chmod/chown is needed at all**.

2. **Bound the directory walk to the workspace.** If parent directories were
   *created by the build* under root, chown those too — but stop at
   `workspaceRoot` (not `cwd`, which the output path may not be under), and
   never touch a directory that already existed with correct ownership:

   ```ts
   let dir = dirname(wasmBinaryPath);
   const root = resolve(workspaceRoot);
   while (dir.startsWith(root) && dir !== root) {
     chownSync(dir, uid, gid);   // same guard conditions as above
     dir = dirname(dir);
   }
   ```

3. Replace the exported `wasmOutputPermissions` with this and update the three
   compiler call sites (`jsBuild.ts:59`, `asBuild.ts:77`, `rustBuild.ts:133`)
   to pass `workspaceRoot` instead of `cwd` (thread it through from
   `compiler/index.ts`, which already has it).

## Test

Extend/replace the check in `scripts/tests/`: create a temp "workspace", run
the function as-is, assert (a) no touched path has any world-write bit
(`mode & 0o002 === 0`), (b) no path **outside** the temp workspace root was
modified (the escaping-walk regression), (c) the output file is owned by the
workspace owner when run as root (root-only assertion — skip when the test
runs unprivileged).

## Related

- SA-004 — the root-fallback is *why* ownership fixing is needed at all; if
  SA-004 removes the root path entirely, this function can shrink to a no-op.
