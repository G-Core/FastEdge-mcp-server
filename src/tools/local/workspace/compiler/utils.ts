import { spawn } from "child_process";
import { chmodSync, chownSync, statSync, existsSync, mkdirSync, cpSync, realpathSync } from "fs";
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

// Function to setup environment for cross-platform binary compatibility
function setupCrossPlatformEnvironment(): void {
  // MCP Server is running on Linux x64
  const workspaceNodeModules = "/workspace/node_modules/@bytecodealliance";
  const containerNodeModules = "/app/node_modules/@bytecodealliance";

  // Copy required wizer dependency to the /workspace.
  // "npm install" will have platform specific versions, we can just leave them in place.
  try {
    // Ensure the destination directory exists
    if (!existsSync(workspaceNodeModules)) {
      mkdirSync(workspaceNodeModules, { recursive: true });
    }

    // Detect architecture and set source/destination paths for wizer binary
    const arch = process.arch === "arm64" ? "arm64" : "x64";
    const sourceWizerPath = join(containerNodeModules, `wizer-linux-${arch}`);
    const destWizerPath = join(workspaceNodeModules, `wizer-linux-${arch}`);

    // Check if source exists and destination doesn't already exist
    if (existsSync(sourceWizerPath) && !existsSync(destWizerPath)) {
      // Copy the entire folder recursively
      cpSync(sourceWizerPath, destWizerPath, {
        recursive: true,
        force: false, // Don't overwrite if exists
        preserveTimestamps: true,
      });
    } else if (!existsSync(sourceWizerPath)) {
      throw new Error(`Source wizer path not found: ${sourceWizerPath}`);
    }
  } catch (error) {
    console.error("Failed to copy wizer dependencies:", error);
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

export { wasmOutputPermissions, setupCrossPlatformEnvironment };
