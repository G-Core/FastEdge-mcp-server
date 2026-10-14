/**
 * Tests for build-tool resolution (installed tool used as-is, install only when
 * missing) and installProjectDependencies: picks the package manager from the
 * nearest lockfile and installs in that directory, with lifecycle scripts off.
 * Run via: tsx --test scripts/tests/test-dep-install.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installProjectDependencies,
  ensureBuildTool,
  packageBin,
  versionAtLeast,
} from "../../src/tools/local/workspace/compiler/utils.js";

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
  await assert.rejects(run(["yarn.lock"]), /yarn\.lock found in .*can only install with npm or pnpm/);
  assert.equal(readFileSync(log, "utf8"), "");
});

test("yarn Plug'n'Play → explicit nodeLinker error, nothing run", async () => {
  await assert.rejects(run(["yarn.lock", ".pnp.cjs"]), /Plug'n'Play .*nodeLinker: node-modules/);
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

function writePkg(dir: string, name: string, version: string) {
  const pkgDir = join(dir, "node_modules", name);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name, version, bin: { tool: "./bin/tool.js" } }));
}

test("build tool already installed → used as-is, no install", async () => {
  const ws = realpathSync(mkdtempSync(join(tmpdir(), "dep-install-ws-")));
  writePkg(ws, "assemblyscript", "0.28.0");
  writeFileSync(log, "");
  const pkg = await ensureBuildTool(ws, ws, env, "assemblyscript");
  assert.equal(pkg.version, "0.28.0");
  assert.equal(packageBin(pkg, "tool"), join(ws, "node_modules/assemblyscript/bin/tool.js"));
  assert.equal(readFileSync(log, "utf8"), "");
});

test("build tool hoisted to a monorepo root → found, no install", async () => {
  const ws = realpathSync(mkdtempSync(join(tmpdir(), "dep-install-ws-")));
  writePkg(ws, "@gcoredev/fastedge-sdk-js", "2.6.0");
  const app = join(ws, "apps/edge");
  mkdirSync(app, { recursive: true });
  writeFileSync(log, "");
  const pkg = await ensureBuildTool(app, ws, env, "@gcoredev/fastedge-sdk-js");
  assert.equal(pkg.dir, join(ws, "node_modules/@gcoredev/fastedge-sdk-js"));
  assert.equal(readFileSync(log, "utf8"), "");
});

test("build tool missing → install, then error if still missing", async () => {
  const ws = realpathSync(mkdtempSync(join(tmpdir(), "dep-install-ws-")));
  writeFileSync(log, "");
  await assert.rejects(ensureBuildTool(ws, ws, env, "assemblyscript"), /assemblyscript is not installed/);
  assert.equal(readFileSync(log, "utf8").trim(), `npm ${ws} install --ignore-scripts --no-audit --no-fund`);
});

test("versionAtLeast", () => {
  assert.equal(versionAtLeast("2.6.0", "2.6.0"), true);
  assert.equal(versionAtLeast("2.10.1", "2.6.0"), true);
  assert.equal(versionAtLeast("3.0.0", "2.6.0"), true);
  assert.equal(versionAtLeast("2.6.0-beta.1", "2.6.0"), true);
  assert.equal(versionAtLeast("2.5.9", "2.6.0"), false);
  assert.equal(versionAtLeast("1.9.0", "2.6.0"), false);
  assert.equal(versionAtLeast("garbage", "2.6.0"), false);
});
