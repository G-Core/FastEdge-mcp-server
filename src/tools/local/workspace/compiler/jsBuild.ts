import { spawn } from "child_process";
import {
  wasmOutputPermissions,
  setupCrossPlatformEnvironment,
} from "./utils.js";

export function compileJavascriptBinary(
  entryFilePath: string,
  wasmBinaryPath: string,
  cwd: string,
  tsconfigPath?: string
) {
  return new Promise<string>(async (resolve, reject) => {
    try {
      setupCrossPlatformEnvironment();

      const jsBuild = spawn(
        "npx",
        [
          "fastedge-build",
          "--input",
          entryFilePath,
          "--output",
          wasmBinaryPath,
          ...(tsconfigPath ? ["--tsconfig", tsconfigPath] : []),
        ],
        {
          // No shell, on any platform: this server only ships as a Linux Docker
          // image (see DEVELOPMENT.md) — native Windows execution of build tooling
          // isn't a supported path, so there's no reason to open a shell for it.
          stdio: ["ignore", "pipe", "pipe"],
          cwd,
          env: { ...process.env },
        }
      );

      let stdout = "";
      let stderr = "";

      jsBuild.stdout?.on("data", (data: Buffer) => {
        stdout += data;
      });

      jsBuild.stderr?.on("data", (data: Buffer) => {
        stderr += data;
      });

      jsBuild.on("close", (code: number) => {
        if (code !== 0) {
          reject(new Error(`build exited with code ${code}: ${stderr}`));
          return;
        }
        wasmOutputPermissions(wasmBinaryPath, cwd);
        resolve(wasmBinaryPath);
      });
    } catch (err) {
      reject(err);
    }
  });
}
