import { spawn } from "child_process";
import { chmodSync, chownSync, statSync, existsSync, realpathSync } from "fs";
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

// Install the project's dependencies inside the container before a JS/AS build.
// node_modules installed on the host (e.g. macOS) carry the wrong native bindings
// (esbuild, oxc, wizer), and a fresh project has none at all. Re-running the
// project's own package manager on Linux fixes both: npm swaps the bindings,
// pnpm adds the Linux ones alongside. On an up-to-date tree it is a fast no-op.
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

  if (lockfile && !NPM_LOCKFILES.includes(lockfile) && lockfile !== "pnpm-lock.yaml") {
    throw new Error(
      `${lockfile} found in ${installDir}: build-wasm installs dependencies with npm or pnpm only. ` +
        "Use package-lock.json or pnpm-lock.yaml for this project."
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

export { wasmOutputPermissions, installProjectDependencies };
