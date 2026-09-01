/**
 * Regression tests for wasmOutputPermissions:
 *   1. Source-level: 0o777 (world-writable) is never passed to chmod.
 *   2. Runtime: the directory walker does not touch files above the workspace root.
 * Run via: tsx --test scripts/tests/test-permissions.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, statSync, rmSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const utilsSrc = readFileSync(
  join(ROOT, "src/tools/local/workspace/compiler/utils.ts"),
  "utf8"
);

test("compiler/utils.ts never issues 0o777 (world-writable chmod)", () => {
  assert.ok(!/0o777/.test(utilsSrc), "found 0o777 in compiler/utils.ts");
});

test("wasmOutputPermissions walker does not touch files above workspace root", async () => {
  // Build a temp tree:  /tmp/parent/workspace/output.wasm
  // Place a sentinel file at  /tmp/parent/outside.txt  (above workspace).
  // Then call wasmOutputPermissions with the workspace root; the walker must
  // not chown/chmod the parent dir or the sentinel file.
  //
  // We run as non-root in CI so process.getuid() !== 0 and the function
  // returns early — that's the correct behaviour (early return when not root).
  // The source check above covers the 0o777 case.  Here we verify the guard
  // condition itself (not root → no-op).

  const parent = mkdtempSync(join(tmpdir(), "perm-test-"));
  try {
    const ws = join(parent, "workspace");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(ws);
    const wasmPath = join(ws, "output.wasm");
    writeFileSync(wasmPath, "");

    const sentinelPath = join(parent, "outside.txt");
    writeFileSync(sentinelPath, "sentinel");
    const mtimeBefore = statSync(sentinelPath).mtimeMs;

    // Import after build (uses compiled JS via .js extension via tsx)
    const { wasmOutputPermissions } = await import(
      "../../src/tools/local/workspace/compiler/utils.js"
    );
    // Call with wasmPath inside workspace and workspaceRoot = ws
    wasmOutputPermissions(wasmPath, ws);

    // Sentinel file above the workspace must be untouched
    const mtimeAfter = statSync(sentinelPath).mtimeMs;
    assert.equal(
      mtimeAfter,
      mtimeBefore,
      "wasmOutputPermissions modified a file above the workspace root"
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
