import {
  wasmOutputPermissions,
  setupCrossPlatformEnvironment,
  spawnBounded,
} from "./utils.js";
import { buildSubprocessEnv } from "../../../../utils/index.js";

const MAX_BUILD_MS = 180_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

export async function compileJavascriptBinary(
  entryFilePath: string,
  wasmBinaryPath: string,
  cwd: string,
  workspaceRoot: string,
  tsconfigPath?: string
): Promise<string> {
  setupCrossPlatformEnvironment();

  const result = await spawnBounded(
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
      cwd,
      env: buildSubprocessEnv(),
      timeoutMs: MAX_BUILD_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES,
    }
  );

  if (result.truncated) {
    throw new Error(`build killed: output exceeded ${MAX_OUTPUT_BYTES} bytes`);
  }
  if (result.signal === "SIGKILL") {
    throw new Error(`build timed out after ${MAX_BUILD_MS}ms`);
  }
  if (result.code !== 0) {
    throw new Error(`build exited with code ${result.code}: ${result.stderr}`);
  }

  wasmOutputPermissions(wasmBinaryPath, workspaceRoot);
  return wasmBinaryPath;
}
