import { spawn } from "child_process";
import fs from "fs";
import path from "path";

import { wasmOutputPermissions } from "./utils.js";
import { buildSubprocessEnv } from "../../../../utils/index.js";

const MAX_BUILD_MS = 180_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

interface AsConfig {
  targets?: Record<string, { outFile?: string }>;
}

function readAsConfigOutFile(buildRoot: string, targetName: string): string {
  const configPath = path.join(buildRoot, "asconfig.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `asconfig.json not found in ${buildRoot} — required for AssemblyScript builds.`
    );
  }
  let parsed: AsConfig;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (err: any) {
    throw new Error(
      `Failed to parse asconfig.json at ${configPath}: ${err?.message ?? err}`
    );
  }
  const target = parsed.targets?.[targetName];
  if (!target?.outFile) {
    throw new Error(
      `asconfig.json at ${configPath} has no targets.${targetName}.outFile — ` +
        "either supply an explicit outputFile to build-wasm, or configure the target in asconfig.json."
    );
  }
  return path.join(buildRoot, target.outFile);
}

export function compileAssemblyScriptBinary(
  entryFilePath: string,
  outputFilePath: string | null,
  cwd: string,
  workspaceRoot: string
) {
  return new Promise<string>(async (resolve, reject) => {
    try {
      const resolvedOutput =
        outputFilePath ?? readAsConfigOutFile(cwd, "release");

      const ascArgs = ["asc", entryFilePath, "--target", "release"];
      if (outputFilePath) {
        ascArgs.push("--outFile", outputFilePath);
      }

      const asBuild = spawn("npx", ascArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        cwd,
        env: buildSubprocessEnv(),
        timeout: MAX_BUILD_MS,
        killSignal: "SIGKILL",
      });

      let stderr = "";
      let truncated = false;

      asBuild.stderr?.on("data", (data: Buffer) => {
        if (stderr.length + data.length > MAX_OUTPUT_BYTES) {
          truncated = true;
          asBuild.kill("SIGKILL");
          return;
        }
        stderr += data;
      });

      asBuild.on("error", (err: Error) => {
        reject(new Error(`failed to start asc build: ${err.message}`));
      });

      asBuild.on("close", (code: number | null, signal: string | null) => {
        if (signal === "SIGKILL") {
          reject(new Error(truncated ? `asc build killed: output exceeded ${MAX_OUTPUT_BYTES} bytes` : `asc build timed out after ${MAX_BUILD_MS}ms`));
          return;
        }
        if (code !== 0) {
          reject(new Error(`asc build exited with code ${code}: ${stderr}`));
          return;
        }
        wasmOutputPermissions(resolvedOutput, workspaceRoot);
        resolve(resolvedOutput);
      });
    } catch (err) {
      reject(err);
    }
  });
}
