import { spawn } from "child_process";
import fs from "fs";
import path from "path";

import { wasmOutputPermissions } from "./utils.js";

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
  cwd: string
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
        // shell is only needed on Windows, where npx is a .cmd shim spawn can't
        // exec directly. Avoiding it elsewhere (Docker/Linux, the production path)
        // closes the command-injection surface a shell would otherwise open.
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "pipe"],
        cwd,
        env: { ...process.env },
      });

      let stderr = "";

      asBuild.stderr?.on("data", (data: Buffer) => {
        stderr += data;
      });

      asBuild.on("close", (code: number) => {
        if (code !== 0) {
          reject(new Error(`asc build exited with code ${code}: ${stderr}`));
          return;
        }
        wasmOutputPermissions(resolvedOutput, cwd);
        resolve(resolvedOutput);
      });
    } catch (err) {
      reject(err);
    }
  });
}
