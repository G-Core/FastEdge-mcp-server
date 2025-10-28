import { spawn } from "child_process";
import * as os from "os";
import * as fs from "node:fs";
import * as path from "node:path";
import * as toml from "toml";

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

function rustConfigWasiTarget(startDir: string): string {
  let wasiTarget = "wasm32-wasip1";
  try {
    const configPath = findCargoConfig(startDir);
    if (configPath === null) {
      throw new Error("No .cargo/config.toml found");
    }
    const configContent = fs.readFileSync(configPath, "utf-8");
    const config = toml.parse(configContent);
    if (config?.build?.target) {
      wasiTarget = config.build.target;
    }
  } catch (error) {
    console.error(
      `Failed to read or parse config.toml (fallback target: ${wasiTarget})`
    );
  } finally {
    return wasiTarget;
  }
}

export function compileRustAndFindBinary(
  entryFilePath: string,
  wasmBinaryPath: string,
  cwd: string
) {
  return new Promise<string>(async (resolve, reject) => {
    const isWindows = os.platform() === "win32";
    const shell = isWindows ? "cmd.exe" : "sh";

    const target = rustConfigWasiTarget(entryFilePath);
    const cargoBuild = spawn(
      "cargo",
      ["build", "--message-format=json", `--target=${target}`],
      {
        shell,
        stdio: ["ignore", "pipe", "pipe"],
        cwd,
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
            return resolve(wasmBinaryPath);
          }
        }
      }
    });
  });
}
