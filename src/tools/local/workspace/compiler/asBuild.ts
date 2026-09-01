import fs from "fs";
import path from "path";

import { wasmOutputPermissions, spawnBounded } from "./utils.js";
import { buildSubprocessEnv, normalizePath, INVALID_PATH } from "../../../../utils/index.js";

const MAX_BUILD_MS = 180_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

interface AsConfig {
  targets?: Record<string, { outFile?: string }>;
}

function readAsConfigOutFile(
  buildRoot: string,
  targetName: string,
  workspaceRoot: string
): string {
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
  // outFile is user-controlled (from asconfig.json) — validate against workspace
  const rawAbs = path.join(buildRoot, target.outFile);
  const rel = path.relative(workspaceRoot, rawAbs);
  const checked = normalizePath(workspaceRoot, rel);
  if (checked === INVALID_PATH) {
    throw new Error(
      `asconfig.json outFile "${target.outFile}" escapes the workspace boundary`
    );
  }
  return checked;
}

export async function compileAssemblyScriptBinary(
  entryFilePath: string,
  outputFilePath: string | null,
  cwd: string,
  workspaceRoot: string
): Promise<string> {
  const resolvedOutput =
    outputFilePath ?? readAsConfigOutFile(cwd, "release", workspaceRoot);

  const ascArgs = ["asc", entryFilePath, "--target", "release"];
  if (outputFilePath) {
    ascArgs.push("--outFile", outputFilePath);
  }

  const result = await spawnBounded("npx", ascArgs, {
    cwd,
    env: buildSubprocessEnv(),
    timeoutMs: MAX_BUILD_MS,
    maxOutputBytes: MAX_OUTPUT_BYTES,
  });

  if (result.truncated) {
    throw new Error(`asc build killed: output exceeded ${MAX_OUTPUT_BYTES} bytes`);
  }
  if (result.signal === "SIGKILL") {
    throw new Error(`asc build timed out after ${MAX_BUILD_MS}ms`);
  }
  if (result.code !== 0) {
    throw new Error(`asc build exited with code ${result.code}: ${result.stderr}`);
  }

  wasmOutputPermissions(resolvedOutput, workspaceRoot);
  return resolvedOutput;
}
