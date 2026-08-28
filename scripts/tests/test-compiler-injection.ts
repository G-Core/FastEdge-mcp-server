/**
 * Regression tests for the build compilers' command-injection surface (ICM-50570,
 * ICM-50655). The compilers must spawn their toolchain without a shell, so that
 * untrusted values reaching argv — an entry file path, or the `[build] target`
 * read out of a project's own .cargo/config.toml — stay inert argv elements.
 *
 * These tests do not need cargo/npx installed: with a shell, the injected payload
 * runs even when the toolchain binary is missing (the shell executes the whole
 * command string), so the sentinel file is the signal either way.
 *
 * Run with: pnpm run test:compiler-injection
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compileRustAndFindBinary } from "../../src/tools/local/workspace/compiler/rustBuild.js";

test("rust build does not execute an injected payload from .cargo/config.toml", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fe-inject-"));
  const sentinel = join(dir, "PWNED");
  try {
    mkdirSync(join(dir, ".cargo"));
    mkdirSync(join(dir, "src"));
    writeFileSync(
      join(dir, ".cargo", "config.toml"),
      `[build]\ntarget = "wasm32-wasip1; touch ${sentinel}; #"\n`
    );
    writeFileSync(
      join(dir, "Cargo.toml"),
      `[package]\nname = "p"\nversion = "0.1.0"\nedition = "2021"\n`
    );
    writeFileSync(join(dir, "src", "main.rs"), "fn main(){}\n");

    // The build itself must fail — the point is HOW it fails.
    await assert.rejects(
      compileRustAndFindBinary(join(dir, "src", "main.rs"), join(dir, "out.wasm"), dir)
    );
    assert.equal(
      existsSync(sentinel),
      false,
      "injected shell command executed — cargo is being spawned through a shell"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
