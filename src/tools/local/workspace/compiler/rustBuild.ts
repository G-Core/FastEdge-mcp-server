import * as fs from "node:fs";
import * as path from "node:path";
import * as toml from "toml";
import { wasmOutputPermissions, spawnBounded } from "./utils.js";
import { buildSubprocessEnv } from "../../../../utils/index.js";

const MAX_BUILD_MS = 300_000; // Rust cold builds are legitimately slow
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

function findCargoConfig(startDir: string, workspaceRoot: string): string | null {
  let dir = startDir;
  const root = path.resolve(workspaceRoot);
  while (dir.startsWith(root) && dir !== path.parse(dir).root) {
    const configPath = path.join(dir, ".cargo", "config.toml");
    if (fs.existsSync(configPath)) {
      return configPath;
    }
    dir = path.dirname(dir);
  }
  return null;
}

function findCargoToml(startDir: string, workspaceRoot: string): string | null {
  let dir = startDir;
  const root = path.resolve(workspaceRoot);
  while (dir.startsWith(root) && dir !== path.parse(dir).root) {
    const cargoPath = path.join(dir, "Cargo.toml");
    if (fs.existsSync(cargoPath)) {
      return cargoPath;
    }
    dir = path.dirname(dir);
  }
  return null;
}

function rustConfigWasiTarget(startDir: string, workspaceRoot: string): string {
  // Explicit `.cargo/config.toml` `[build] target = ...` wins.
  try {
    const configPath = findCargoConfig(startDir, workspaceRoot);
    if (configPath !== null) {
      const configContent = fs.readFileSync(configPath, "utf-8");
      const config = toml.parse(configContent);
      if (config?.build?.target) {
        return config.build.target;
      }
    }
  } catch (error) {
    console.error("Failed to read or parse .cargo/config.toml");
  }

  // Otherwise infer from `Cargo.toml` `[dependencies]`: wstd → wasip2, else wasip1.
  let wasiTarget = "wasm32-wasip1";
  try {
    const cargoTomlPath = findCargoToml(startDir, workspaceRoot);
    if (cargoTomlPath !== null) {
      const cargoContent = fs.readFileSync(cargoTomlPath, "utf-8");
      const cargo = toml.parse(cargoContent);
      if (cargo?.dependencies && "wstd" in cargo.dependencies) {
        wasiTarget = "wasm32-wasip2";
      }
    }
  } catch (error) {
    console.error(
      `Failed to read or parse Cargo.toml (fallback target: ${wasiTarget})`
    );
  }
  return wasiTarget;
}

export async function compileRustAndFindBinary(
  entryFilePath: string,
  wasmBinaryPath: string,
  cwd: string,
  workspaceRoot: string
): Promise<string> {
  const target = rustConfigWasiTarget(entryFilePath, workspaceRoot);

  const result = await spawnBounded(
    "cargo",
    ["build", "--message-format=json", `--target=${target}`],
    {
      // No shell: `target` comes from the project's own .cargo/config.toml,
      // so shell interpolation would be a command-injection sink.
      cwd,
      env: buildSubprocessEnv(),
      timeoutMs: MAX_BUILD_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES,
    }
  );

  if (result.truncated) {
    throw new Error(`cargo build killed: output exceeded ${MAX_OUTPUT_BYTES} bytes`);
  }
  if (result.signal === "SIGKILL") {
    throw new Error(`cargo build timed out after ${MAX_BUILD_MS}ms`);
  }
  if (result.code !== 0) {
    throw new Error(`cargo build exited with code ${result.code}: ${result.stderr}`);
  }

  const lines = result.stdout.split("\n");
  for (const line of lines) {
    if (!line) {
      continue;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch (err) {
      throw new Error(`Failed to parse cargo output: ${(err as Error).message}`);
    }

    if (
      message &&
      message.reason === "compiler-artifact" &&
      message.filenames &&
      message.filenames.length === 1
    ) {
      if (/.*\.wasm$/.test(message.filenames[0])) {
        fs.mkdirSync(path.dirname(wasmBinaryPath), { recursive: true });
        fs.copyFileSync(message.filenames[0], wasmBinaryPath);
        fs.unlinkSync(message.filenames[0]);
        wasmOutputPermissions(wasmBinaryPath, workspaceRoot);
        return wasmBinaryPath;
      }
    }
  }

  throw new Error("cargo build succeeded but no .wasm artifact was found in output");
}
