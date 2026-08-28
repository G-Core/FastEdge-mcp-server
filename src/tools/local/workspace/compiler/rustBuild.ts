import { spawn } from "child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as toml from "toml";
import { wasmOutputPermissions } from "./utils.js";

function findCargoConfig(startDir: string): string | null {
  let dir = startDir;
  while (dir !== path.parse(dir).root) {
    const configPath = path.join(dir, ".cargo", "config.toml");
    if (fs.existsSync(configPath)) {
      return configPath;
    }
    dir = path.dirname(dir);
  }
  return null;
}

function findCargoToml(startDir: string): string | null {
  let dir = startDir;
  while (dir !== path.parse(dir).root) {
    const cargoPath = path.join(dir, "Cargo.toml");
    if (fs.existsSync(cargoPath)) {
      return cargoPath;
    }
    dir = path.dirname(dir);
  }
  return null;
}

function rustConfigWasiTarget(startDir: string): string {
  // Explicit `.cargo/config.toml` `[build] target = ...` wins.
  try {
    const configPath = findCargoConfig(startDir);
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
    const cargoTomlPath = findCargoToml(startDir);
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

export function compileRustAndFindBinary(
  entryFilePath: string,
  wasmBinaryPath: string,
  cwd: string
) {
  return new Promise<string>(async (resolve, reject) => {
    const target = rustConfigWasiTarget(entryFilePath);
    const cargoBuild = spawn(
      "cargo",
      ["build", "--message-format=json", `--target=${target}`],
      {
        // No shell: `target` comes from the project's own .cargo/config.toml,
        // so shell interpolation would be a command-injection sink (ICM-50655).
        stdio: ["ignore", "pipe", "pipe"],
        cwd,
        env: { ...process.env },
      }
    );

    let stdout = "";
    let stderr = "";

    cargoBuild.stdout?.on("data", (data: Buffer) => {
      stdout += data;
    });

    cargoBuild.stderr?.on("data", (data: Buffer) => {
      stderr += data;
    });

    // Without a shell, a missing `cargo` surfaces as an async 'error' event, not
    // an exit code. Unhandled, that kills the whole MCP server process.
    cargoBuild.on("error", (err: Error) => {
      reject(new Error(`failed to start cargo build: ${err.message}`));
    });

    cargoBuild.on("close", (code: number) => {
      if (code !== 0) {
        reject(new Error(`cargo build exited with code ${code}: ${stderr}`));
        return;
      }

      const lines = stdout.split("\n");
      for (const line of lines) {
        if (!line) {
          continue;
        }

        let message;
        try {
          message = JSON.parse(line);
        } catch (err) {
          reject(
            new Error(`Failed to parse cargo output: ${(err as Error).message}`)
          );
          return;
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
            wasmOutputPermissions(wasmBinaryPath, cwd);
            return resolve(wasmBinaryPath);
          }
        }
      }
    });
  });
}
