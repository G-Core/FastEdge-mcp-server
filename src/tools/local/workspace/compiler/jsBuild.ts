import { spawn } from "child_process";
import {
  wasmOutputPermissions,
  setupCrossPlatformEnvironment,
} from "./utils.js";
import { buildSubprocessEnv } from "../../../../utils/index.js";

const MAX_BUILD_MS = 180_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

export function compileJavascriptBinary(
  entryFilePath: string,
  wasmBinaryPath: string,
  cwd: string,
  workspaceRoot: string,
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
          stdio: ["ignore", "pipe", "pipe"],
          cwd,
          env: buildSubprocessEnv(),
          timeout: MAX_BUILD_MS,
          killSignal: "SIGKILL",
        }
      );

      let stdout = "";
      let stderr = "";
      let truncated = false;

      jsBuild.stdout?.on("data", (data: Buffer) => {
        if (stdout.length + data.length > MAX_OUTPUT_BYTES) {
          truncated = true;
          jsBuild.kill("SIGKILL");
          return;
        }
        stdout += data;
      });

      jsBuild.stderr?.on("data", (data: Buffer) => {
        if (stderr.length + data.length > MAX_OUTPUT_BYTES) {
          jsBuild.kill("SIGKILL");
          return;
        }
        stderr += data;
      });

      jsBuild.on("error", (err: Error) => {
        reject(new Error(`failed to start build: ${err.message}`));
      });

      jsBuild.on("close", (code: number | null, signal: string | null) => {
        if (signal === "SIGKILL") {
          reject(new Error(truncated ? `build killed: output exceeded ${MAX_OUTPUT_BYTES} bytes` : `build timed out after ${MAX_BUILD_MS}ms`));
          return;
        }
        if (code !== 0) {
          reject(new Error(`build exited with code ${code}: ${stderr}`));
          return;
        }
        wasmOutputPermissions(wasmBinaryPath, workspaceRoot);
        resolve(wasmBinaryPath);
      });
    } catch (err) {
      reject(err);
    }
  });
}
