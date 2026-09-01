import { chmodSync, chownSync, statSync, existsSync, mkdirSync, cpSync } from "fs";
import { dirname, join, resolve } from "path";

// Fix ownership of the build output so the host user (who owns the bind-mounted
// workspace) can read/write/delete it after the container writes it.
// Only meaningful when running as root (the SA-004 fallback path); when setpriv
// already dropped to the workspace owner, files are owned correctly and this
// function is a no-op.
function wasmOutputPermissions(wasmBinaryPath: string, workspaceRoot: string) {
  try {
    if (process.getuid?.() !== 0) return;
    const { uid, gid } = statSync(workspaceRoot);
    if (uid === 0) return; // root-owned mount — no meaningful owner to match
    chownSync(wasmBinaryPath, uid, gid);
    chmodSync(wasmBinaryPath, 0o644);
    // Fix any directories the build created under workspaceRoot.
    const root = resolve(workspaceRoot);
    let dir = dirname(wasmBinaryPath);
    while (dir.startsWith(root) && dir !== root) {
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

export { wasmOutputPermissions, setupCrossPlatformEnvironment };
