# SA-008 — Workspace confinement is lexical only; symlinks escape it

**Severity:** Medium
**Category:** Improper link resolution before file access / path traversal
(CWE-59, CWE-22)
**Status:** Open
**Affected file:** `src/utils/index.ts:6-22` (`normalizePath`), consumed by
build, scaffold, and upload tools.

## Summary

`normalizePath` is the single confinement gate for every path a tool accepts
(entry file, output file, build dir, scaffold output dir, wasm-to-upload). It
does **purely lexical** validation:

```ts
const posixPath = filePath.replace(/\\/g, "/");
const normalizedPath = path.normalize(posixPath);
if (normalizedPath.startsWith("..") || path.isAbsolute(normalizedPath) || /^[a-zA-Z]:/.test(posixPath))
  return INVALID_PATH;
return path.join(workspaceRoot, normalizedPath);   // never realpath'd
```

It correctly blocks `..` traversal, absolute paths, and Windows drive letters —
**as strings**. It never calls `realpath`/`lstat`, so it does not detect that a
*resolved* path leaves the workspace through a **symlink**. If the untrusted
workspace contains a symlink — e.g. `link → /` or `link → /etc` or
`link → /proc/1/root` — then a tool-supplied path like `link/some/file`:

- passes the lexical check (`"link/some/file"` has no `..`, isn't absolute), and
- `path.join(workspaceRoot, "link/some/file")` resolves through the symlink to
  outside `/workspace` when the filesystem dereferences it.

Under the threat model the workspace is untrusted (a cloned repo the user is
working on can ship a symlink), so this is attacker-plantable.

## Reachable sinks

- `binaries/api.ts:17` — `fs.readFileSync(wasmFilePath)` then uploads the bytes:
  **arbitrary file read + exfiltration to the Gcore API** (e.g. read a host
  secret mounted into the container and upload it as a "binary").
- `compiler/*` — build reads the entry file and **writes** the output wasm
  through the resolved path: **arbitrary file overwrite** (and `chmod`, via
  SA-002) outside the workspace.
- `scaffolds.ts` — project generation writes a tree at the resolved output dir:
  **arbitrary directory creation/write** outside the workspace.

Impact is worst in the SA-004 root-fallback (writes as root anywhere the symlink
points).

## Impact

- **Confidentiality:** read arbitrary container-readable files (incl. bind-
  mounted host secrets) via the upload path.
- **Integrity:** overwrite/create files outside the workspace via build/scaffold.
- Requires the attacker to influence workspace contents (plant a symlink), which
  the untrusted-workspace model grants. Medium.

## Remediation

Make confinement **canonical**, not lexical. After joining, resolve the real
path and re-check containment; handle the not-yet-existing output-path case by
resolving the nearest existing ancestor.

```ts
import { realpathSync } from "fs";
import path from "node:path";

export function normalizePath(workspaceRoot: string, filePath: string): string {
  const posixPath = filePath.replace(/\\/g, "/");
  const normalizedPath = path.normalize(posixPath);
  if (normalizedPath.startsWith("..") || path.isAbsolute(normalizedPath) || /^[a-zA-Z]:/.test(posixPath))
    return INVALID_PATH;

  const rootReal = realpathSync(workspaceRoot);
  const candidate = path.join(rootReal, normalizedPath);

  // Resolve the deepest existing ancestor (output files may not exist yet),
  // then confirm it is still inside the real workspace root.
  let probe = candidate;
  while (!existsSync(probe) && probe !== path.dirname(probe)) probe = path.dirname(probe);
  const probeReal = realpathSync(probe);
  const contained = probeReal === rootReal || probeReal.startsWith(rootReal + path.sep);
  if (!contained) return INVALID_PATH;

  return candidate;
}
```

Notes for the implementer:
- `normalizePath` currently takes `(workspaceRoot, filePath)` — signature is
  unchanged; only the body gains realpath checks. All callers already pass both.
- There is an inherent **TOCTOU** gap between this check and the later
  read/write (a symlink could be swapped in after the check). The realpath check
  closes the common planted-symlink case; for full robustness the file ops
  themselves should use `O_NOFOLLOW`/`openat` semantics, but that is a larger
  change — note it, don't block the primary fix on it.
- Preserve the existing `INVALID_PATH` sentinel and error messages so callers
  keep working.

## Test

Add to `scripts/tests/`: create a temp workspace containing `escape -> /` (or a
temp dir outside the workspace), then assert `normalizePath(ws, "escape/etc/passwd")`
returns `INVALID_PATH`. Also assert a legitimate not-yet-existing output path
inside the workspace (e.g. `"wasm/output.wasm"`) is still accepted.

## Related

- SA-002 (the chmod runs on this resolved path), SA-004 (root amplifies write
  impact).
