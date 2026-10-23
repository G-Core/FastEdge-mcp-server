import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

import {
  wasmOutputPermissions,
  ensureBuildTool,
  packageBin,
  versionAtLeast,
  spawnBounded,
} from "./utils.js";
import { buildSubprocessEnv, INVALID_PATH, normalizePath } from "../../../../utils/index.js";

const MAX_BUILD_MS = 180_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

const SDK_PKG = "@gcoredev/fastedge-sdk-js";
// First SDK release whose fastedge-build has no native bindings except wizer, and
// honours FASTEDGE_WIZER_PATH. Older SDKs need Linux bindings in node_modules.
const MIN_SDK_VERSION = "2.6.0";
// First SDK release whose `fastedge-build -c <config> -o <path>` writes to <path>. A project
// with a build config is built from it, so config-only steps (entry point, static asset
// manifest, Wasm components) run; the output path is still the caller's.
const CONFIG_OUTPUT_SDK_VERSION = "2.7.0";
const BUILD_CONFIG = path.join(".fastedge", "build-config.js");
// Variable specifier: the package's types aren't needed, only its default export
// (absolute path to this platform's wizer binary, from the image's own node_modules).
const WIZER_PKG: string = "@bytecodealliance/wizer";

/**
 * fastedge-build arguments: the project's build config when it has one and the SDK can
 * override its output, else the entry file directly.
 */
export function fastedgeBuildArgs(
  sdkVersion: string,
  entryFilePath: string,
  wasmBinaryPath: string,
  cwd: string,
  workspaceRoot: string,
  tsconfigPath?: string
): string[] {
  if (versionAtLeast(sdkVersion, CONFIG_OUTPUT_SDK_VERSION)) {
    const config = normalizePath(
      workspaceRoot,
      path.relative(realpathSync(workspaceRoot), path.join(cwd, BUILD_CONFIG))
    );
    if (config !== INVALID_PATH && existsSync(config)) {
      return ["--config", config, "--output", wasmBinaryPath];
    }
  }
  return [
    "--input",
    entryFilePath,
    "--output",
    wasmBinaryPath,
    ...(tsconfigPath ? ["--tsconfig", tsconfigPath] : []),
  ];
}

export async function compileJavascriptBinary(
  entryFilePath: string,
  wasmBinaryPath: string,
  cwd: string,
  workspaceRoot: string,
  tsconfigPath?: string
): Promise<string> {
  const env = buildSubprocessEnv();
  const sdk = await ensureBuildTool(cwd, workspaceRoot, env, SDK_PKG);
  if (!versionAtLeast(sdk.version, MIN_SDK_VERSION)) {
    throw new Error(
      `${SDK_PKG} ${sdk.version} found in ${sdk.dir}; build-wasm needs ${MIN_SDK_VERSION} or later. ` +
        `Install the latest in the project, then build again: "npm install ${SDK_PKG}@latest" ` +
        `(pnpm, yarn or bun: "<pm> add ${SDK_PKG}@latest"). "npm update" can't get past an exact or ~ pin.`
    );
  }
  // The project's node_modules may come from another OS: use the image's wizer.
  env.FASTEDGE_WIZER_PATH = (await import(WIZER_PKG)).default;

  const result = await spawnBounded(
    process.execPath,
    [
      packageBin(sdk, "fastedge-build"),
      ...fastedgeBuildArgs(
        sdk.version,
        entryFilePath,
        wasmBinaryPath,
        cwd,
        workspaceRoot,
        tsconfigPath
      ),
    ],
    {
      cwd,
      env,
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
  if (result.signal) {
    throw new Error(`build killed by signal ${result.signal}: ${result.stderr}`);
  }
  if (result.code !== 0) {
    throw new Error(`build exited with code ${result.code}: ${result.stderr}`);
  }

  wasmOutputPermissions(wasmBinaryPath, workspaceRoot);
  return wasmBinaryPath;
}
