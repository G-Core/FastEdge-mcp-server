/**
 * Tests for normalizePath workspace confinement, including symlink rejection.
 * Run via: tsx --test scripts/tests/test-path-confinement.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { normalizePath, INVALID_PATH } from "../../src/utils/index.js";

function withTempWorkspace(fn: (ws: string) => void) {
  const ws = mkdtempSync(join(tmpdir(), "test-workspace-"));
  try {
    fn(ws);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
}

// Outside target that exists
const outsideExisting = mkdtempSync(join(tmpdir(), "outside-"));

test("(a) symlink -> existing path outside workspace is rejected", () => {
  withTempWorkspace((ws) => {
    symlinkSync(outsideExisting, join(ws, "link"));
    assert.equal(normalizePath(ws, "link"), INVALID_PATH);
  });
});

test("(b) dangling symlink -> missing path outside workspace is rejected", () => {
  withTempWorkspace((ws) => {
    symlinkSync("/tmp/outside-missing-xyzzy", join(ws, "link"));
    assert.equal(normalizePath(ws, "link"), INVALID_PATH);
  });
});

test("(c) dir/link -> ../../ (traversal via symlink) is rejected", () => {
  withTempWorkspace((ws) => {
    mkdirSync(join(ws, "dir"));
    symlinkSync("../../", join(ws, "dir", "link"));
    assert.equal(normalizePath(ws, "dir/link"), INVALID_PATH);
  });
});

test("(d) plain nested path inside workspace is accepted", () => {
  withTempWorkspace((ws) => {
    mkdirSync(join(ws, "sub"));
    writeFileSync(join(ws, "sub", "file.wasm"), "");
    const result = normalizePath(ws, "sub/file.wasm");
    assert.notEqual(result, INVALID_PATH);
    assert.ok(result.startsWith(ws));
  });
});

test("(e) workspace root itself is accepted (via empty relative path normalizes to .)", () => {
  withTempWorkspace((ws) => {
    // normalizePath("ws", ".") should be accepted
    const result = normalizePath(ws, ".");
    assert.notEqual(result, INVALID_PATH);
  });
});

test("(f) ../x path traversal is rejected", () => {
  withTempWorkspace((ws) => {
    assert.equal(normalizePath(ws, "../escape"), INVALID_PATH);
  });
});

test("null byte in path is rejected", () => {
  withTempWorkspace((ws) => {
    assert.equal(normalizePath(ws, "foo\0bar"), INVALID_PATH);
  });
});

test("default output path wasm/output.wasm is rejected when a symlink sits there", () => {
  withTempWorkspace((ws) => {
    mkdirSync(join(ws, "wasm"));
    symlinkSync(outsideExisting, join(ws, "wasm", "output.wasm"));
    assert.equal(normalizePath(ws, "wasm/output.wasm"), INVALID_PATH);
  });
});

// Cleanup outside dir after all tests
process.on("exit", () => {
  try { rmSync(outsideExisting, { recursive: true, force: true }); } catch { /* ignore */ }
});
