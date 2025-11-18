import { chmodSync, existsSync, mkdirSync, cpSync } from "fs";
import { dirname, join } from "path";

// In MCP docker containers, the output WASM files may have restrictive permissions.
// This function ensures that the output file and its parent directories have
// permissions set to allow read/write/execute for the host user.
function wasmOutputPermissions(wasmBinaryPath: string, cwd: string) {
  try {
    // Get the directory containing the output file
    const outputDir = dirname(wasmBinaryPath);
    let currentDir = outputDir;
    while (currentDir !== cwd && currentDir !== "/" && currentDir !== ".") {
      try {
        chmodSync(currentDir, 0o777);
      } catch (dirError) {
        console.warn(`Could not set permissions on ${currentDir}:`, dirError);
      }
      currentDir = dirname(currentDir);
    }
    // Ensure the output WASM file has proper permissions for the host user
    chmodSync(wasmBinaryPath, 0o777);
  } catch (chmodError) {
    console.warn(
      "Failed to set permissions on output file/directory:",
      chmodError
    );
    // Don't reject on chmod failure, just warn
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
