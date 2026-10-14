import { spawn } from "child_process";
import { chmodSync, chownSync, statSync, existsSync, realpathSync, readFileSync } from "fs";
import { dirname, join, sep } from "path";

// Fix ownership of the build output so the host user (who owns the bind-mounted
// workspace) can read/write/delete it after the container writes it.
// Only meaningful when running as root (when the entrypoint could not drop root
// privileges via setpriv); when already running as the workspace owner, files
// are owned correctly and this function is a no-op.
function wasmOutputPermissions(wasmBinaryPath: string, workspaceRoot: string) {
  try {
    if (process.getuid?.() !== 0) return;
    const { uid, gid } = statSync(workspaceRoot);
    if (uid === 0) return; // root-owned mount — no meaningful owner to match
    chownSync(wasmBinaryPath, uid, gid);
    chmodSync(wasmBinaryPath, 0o644);
    // Fix any directories the build created under workspaceRoot.
    // Use realpathSync + trailing sep so partial name matches (e.g. /workspace2) are rejected.
    const root = realpathSync(workspaceRoot) + sep;
    let dir = dirname(wasmBinaryPath);
    while (dir.startsWith(root)) {
      try { chownSync(dir, uid, gid); } catch { /* dir may already be owned correctly */ }
      dir = dirname(dir);
    }
  } catch (err) {
    console.warn("Failed to fix output ownership:", err);
  }
}

const MAX_INSTALL_MS = 300_000;
const MAX_INSTALL_OUTPUT_BYTES = 10 * 1024 * 1024;

const LOCKFILES = [
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
];
const NPM_LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json"];

// Install the project's dependencies inside the container. Only used when the build
// tool isn't installed (a fresh project): an existing node_modules may belong to the
// host OS, and reinstalling on Linux would swap its native bindings for Linux ones.
// Lifecycle scripts are skipped: they are untrusted code and the build does not need them.
async function installProjectDependencies(
  cwd: string,
  workspaceRoot: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  // Install where the lockfile lives (workspace root of a monorepo), else in cwd.
  const root = realpathSync(workspaceRoot);
  let dir = realpathSync(cwd);
  let installDir = dir;
  let lockfile: string | undefined;
  while (dir === root || dir.startsWith(root + sep)) {
    lockfile = LOCKFILES.find((f) => existsSync(join(dir, f)));
    if (lockfile) {
      installDir = dir;
      break;
    }
    if (dir === root) break;
    dir = dirname(dir);
  }

  if (existsSync(join(installDir, ".pnp.cjs"))) {
    throw new Error(
      `Yarn Plug'n'Play project in ${installDir}: build-wasm needs a node_modules tree. ` +
        'Set "nodeLinker: node-modules" in .yarnrc.yml, run yarn install on the host, then build again.'
    );
  }
  if (lockfile && !NPM_LOCKFILES.includes(lockfile) && lockfile !== "pnpm-lock.yaml") {
    throw new Error(
      `${lockfile} found in ${installDir} and dependencies aren't installed: build-wasm can only install ` +
        "with npm or pnpm. Install them on the host with the project's package manager, then build again."
    );
  }
  // Mutable install on purpose: an agent may edit package.json without a host toolchain
  // to update the lockfile. A lockfile that already satisfies package.json is left as is.
  const [cmd, args] =
    lockfile === "pnpm-lock.yaml"
      ? ["pnpm", ["install", "--ignore-scripts", "--config.confirmModulesPurge=false"]]
      : ["npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"]];

  const result = await spawnBounded(cmd, args, {
    cwd: installDir,
    env,
    timeoutMs: MAX_INSTALL_MS,
    maxOutputBytes: MAX_INSTALL_OUTPUT_BYTES,
  });
  if (result.truncated) {
    throw new Error(`${cmd} install killed: output exceeded ${MAX_INSTALL_OUTPUT_BYTES} bytes`);
  }
  if (result.signal === "SIGKILL") {
    throw new Error(`${cmd} install timed out after ${MAX_INSTALL_MS}ms`);
  }
  if (result.signal || result.code !== 0) {
    throw new Error(
      `${cmd} install in ${installDir} failed (${result.signal ?? `code ${result.code}`}): ${result.stderr}`
    );
  }
}

export interface SpawnResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: string | null;
  /** true when the process was killed because output exceeded maxOutputBytes */
  truncated: boolean;
}

/**
 * Spawn a child process bounded by a wall-clock timeout and a combined
 * stdout+stderr byte cap. The child runs in its own process group (detached)
 * so the entire group — including grandchildren such as wizer, rustc, and
 * build scripts — is killed together on timeout or overflow.
 */
export function spawnBounded(
  cmd: string,
  args: string[],
  opts: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    maxOutputBytes: number;
  }
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: opts.cwd,
      env: opts.env,
      detached: true, // own process group so we can kill grandchildren
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let totalBytes = 0;

    function killGroup() {
      try { process.kill(-child.pid!, "SIGKILL"); } catch { /* ESRCH — already gone */ }
    }

    const timer = setTimeout(killGroup, opts.timeoutMs);

    child.stdout?.on("data", (data: Buffer) => {
      totalBytes += data.byteLength;
      if (totalBytes > opts.maxOutputBytes) {
        truncated = true;
        killGroup();
        return;
      }
      stdout += data;
    });

    child.stderr?.on("data", (data: Buffer) => {
      totalBytes += data.byteLength;
      if (totalBytes > opts.maxOutputBytes) {
        truncated = true;
        killGroup();
        return;
      }
      stderr += data;
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`failed to start process: ${err.message}`));
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, signal, truncated });
    });
  });
}

interface InstalledPackage {
  dir: string;
  version: string;
  bin?: string | Record<string, string>;
}

// Find an installed package the way Node resolves it: <dir>/node_modules/<name>,
// walking up from cwd to the workspace root, so monorepo-hoisted packages count.
function findInstalledPackage(
  cwd: string,
  workspaceRoot: string,
  name: string
): InstalledPackage | undefined {
  const root = realpathSync(workspaceRoot);
  let dir = realpathSync(cwd);
  while (dir === root || dir.startsWith(root + sep)) {
    const pkgDir = join(dir, "node_modules", name);
    if (existsSync(join(pkgDir, "package.json"))) {
      const { version, bin } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
      return { dir: pkgDir, version, bin };
    }
    if (dir === root) break;
    dir = dirname(dir);
  }
  return undefined;
}

// Resolve the project's own build tool, installing dependencies only when it is
// missing. An existing node_modules is used as-is, whatever OS installed it.
async function ensureBuildTool(
  cwd: string,
  workspaceRoot: string,
  env: NodeJS.ProcessEnv,
  name: string
): Promise<InstalledPackage> {
  let found = findInstalledPackage(cwd, workspaceRoot, name);
  if (!found) {
    await installProjectDependencies(cwd, workspaceRoot, env);
    found = findInstalledPackage(cwd, workspaceRoot, name);
  }
  if (!found) {
    throw new Error(`${name} is not installed after installing dependencies: add it to the project's package.json.`);
  }
  return found;
}

function packageBin(pkg: InstalledPackage, binName: string): string {
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[binName];
  if (!rel) throw new Error(`${pkg.dir} has no "${binName}" executable`);
  return join(pkg.dir, rel);
}

// true when version >= min (major.minor.patch; a prerelease of min counts as min).
function versionAtLeast(version: string, min: string): boolean {
  const a = version.split(/[.-]/).map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

export {
  wasmOutputPermissions,
  installProjectDependencies,
  findInstalledPackage,
  ensureBuildTool,
  packageBin,
  versionAtLeast,
};
