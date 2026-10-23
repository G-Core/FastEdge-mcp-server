/**
 * Tests for fastedgeBuildArgs: a project with .fastedge/build-config.js builds from it when
 * the SDK can override its output (2.7.0+); otherwise the entry file is built directly.
 * Run via: tsx --test scripts/tests/test-js-build-args.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fastedgeBuildArgs } from "../../src/tools/local/workspace/compiler/jsBuild.js";

function workspace(withConfig: boolean) {
  const ws = realpathSync(mkdtempSync(join(tmpdir(), "js-build-args-")));
  if (withConfig) {
    mkdirSync(join(ws, ".fastedge"));
    writeFileSync(join(ws, ".fastedge", "build-config.js"), "export const config = {};");
  }
  return { ws, entry: join(ws, "src", "index.ts"), out: join(ws, "wasm", "app.wasm") };
}

test("config + SDK 2.7.0 → -c config, --output kept", () => {
  const { ws, entry, out } = workspace(true);
  assert.deepEqual(fastedgeBuildArgs("2.7.0", entry, out, ws, ws, join(ws, "tsconfig.json")), [
    "--config",
    join(ws, ".fastedge", "build-config.js"),
    "--output",
    out,
  ]);
});

test("config + SDK 2.6.x → entry file directly", () => {
  const { ws, entry, out } = workspace(true);
  assert.deepEqual(fastedgeBuildArgs("2.6.3", entry, out, ws, ws), ["--input", entry, "--output", out]);
});

test("no config → entry file directly, with tsconfig", () => {
  const { ws, entry, out } = workspace(false);
  const tsconfig = join(ws, "tsconfig.json");
  assert.deepEqual(fastedgeBuildArgs("2.7.0", entry, out, ws, ws, tsconfig), [
    "--input",
    entry,
    "--output",
    out,
    "--tsconfig",
    tsconfig,
  ]);
});
