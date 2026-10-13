/**
 * Tests for installProjectDependencies: picks the package manager from the
 * nearest lockfile and installs in that directory, with lifecycle scripts off.
 * Run via: tsx --test scripts/tests/test-dep-install.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installProjectDependencies } from "../../src/tools/local/workspace/compiler/utils.js";

// Stub npm/pnpm on PATH that record "<cmd> <cwd> <args>" instead of installing.
const bin = mkdtempSync(join(tmpdir(), "dep-install-bin-"));
const log = join(bin, "calls.log");
for (const cmd of ["npm", "pnpm"]) {
  writeFileSync(join(bin, cmd), `#!/bin/sh\necho "${cmd} $PWD $*" >> ${log}\n`);
  chmodSync(join(bin, cmd), 0o755);
}
const env = { PATH: `${bin}:/usr/bin:/bin` };

async function run(files: string[], subdir = "") {
  const ws = realpathSync(mkdtempSync(join(tmpdir(), "dep-install-ws-")));
  for (const f of files) writeFileSync(join(ws, f), "");
  const cwd = join(ws, subdir);
  mkdirSync(cwd, { recursive: true });
  writeFileSync(log, "");
  await installProjectDependencies(cwd, ws, env);
  return { ws, call: readFileSync(log, "utf8").trim() };
}

test("no lockfile → npm install in cwd, scripts off", async () => {
  const { ws, call } = await run([]);
  assert.equal(call, `npm ${ws} install --ignore-scripts --no-audit --no-fund`);
});

test("pnpm-lock.yaml → pnpm install", async () => {
  const { ws, call } = await run(["pnpm-lock.yaml"]);
  assert.equal(call, `pnpm ${ws} install --ignore-scripts --config.confirmModulesPurge=false`);
});

test("lockfile in an ancestor → install at the ancestor", async () => {
  const { ws, call } = await run(["package-lock.json"], "apps/edge");
  assert.equal(call, `npm ${ws} install --ignore-scripts --no-audit --no-fund`);
});

test("yarn.lock → explicit unsupported error, nothing run", async () => {
  await assert.rejects(run(["yarn.lock"]), /yarn\.lock found in .*npm or pnpm only/);
  assert.equal(readFileSync(log, "utf8"), "");
});

test("failed install throws with stderr", async () => {
  const ws = realpathSync(mkdtempSync(join(tmpdir(), "dep-install-ws-")));
  const failBin = mkdtempSync(join(tmpdir(), "dep-install-fail-"));
  writeFileSync(join(failBin, "npm"), "#!/bin/sh\necho E404 boom >&2\nexit 1\n");
  chmodSync(join(failBin, "npm"), 0o755);
  await assert.rejects(
    installProjectDependencies(ws, ws, { PATH: `${failBin}:/usr/bin:/bin` }),
    /npm install in .* failed \(code 1\): E404 boom/
  );
});
