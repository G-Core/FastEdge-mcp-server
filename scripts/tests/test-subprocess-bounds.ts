/**
 * Tests for spawnBounded: process group kill on timeout and output overflow.
 * Run via: tsx --test scripts/tests/test-subprocess-bounds.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { spawnBounded } from "../../src/tools/local/workspace/compiler/utils.js";

test("timeout kills entire process group (no grandchildren survive)", async () => {
  // Use a unique fractional sleep value so pgrep only matches our own grandchild.
  const sleepSec = `60.${Date.now() % 1_000_000}`;
  const start = Date.now();

  // sh -c starts a grandchild sleep; with detached+group-kill the sleep must die too
  const result = await spawnBounded(
    "sh",
    ["-c", `sleep ${sleepSec} & wait`],
    { cwd: "/tmp", env: process.env as NodeJS.ProcessEnv, timeoutMs: 500, maxOutputBytes: 1024 * 1024 }
  );

  const elapsed = Date.now() - start;
  assert.ok(elapsed < 3000, `helper took ${elapsed}ms, expected < 3s`);
  assert.equal(result.signal, "SIGKILL");
  assert.equal(result.truncated, false);

  // Give the OS a moment to reap orphans, then check no matching sleep remains.
  // Use execFileSync (no shell) so pgrep doesn't match the shell process whose
  // argv would itself contain the pattern.
  await new Promise((r) => setTimeout(r, 500));
  let survivors = "";
  try { survivors = execFileSync("pgrep", ["-f", `sleep ${sleepSec}`], { encoding: "utf8" }).trim(); } catch { /* pgrep exits 1 when nothing found */ }
  assert.equal(survivors, "", `grandchild sleep ${sleepSec} survived: pids ${survivors}`);
});

test("output cap triggers truncated flag and kills process", async () => {
  const TEN_MB = 10 * 1024 * 1024;

  const result = await spawnBounded(
    "sh",
    ["-c", "yes | head -c 20000000"],
    { cwd: "/tmp", env: process.env as NodeJS.ProcessEnv, timeoutMs: 30_000, maxOutputBytes: TEN_MB }
  );

  assert.equal(result.truncated, true, "expected truncated=true for output overflow");
  // stdout bytes collected before kill should be <= cap (within one chunk margin)
  const collected = Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr);
  assert.ok(
    collected <= TEN_MB + 128 * 1024,
    `collected ${collected} bytes, expected <= cap + 128KB chunk margin`
  );
});
