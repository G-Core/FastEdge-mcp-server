import fs from "node:fs";
import path from "node:path";

import { compileAssemblyScriptBinary } from "./asBuild.js";
import { compileJavascriptBinary } from "./jsBuild.js";
import { compileRustAndFindBinary } from "./rustBuild.js";
import { INVALID_PATH, normalizePath } from "../../../../utils/index.js";

type ProjectLanguage = "rust" | "assemblyscript" | "javascript";

const PROJECT_MARKERS = ["asconfig.json", "Cargo.toml", "package.json"];

// Walk upward from the entry file's directory to find the nearest project root
// (first directory containing one of PROJECT_MARKERS). Stops at workspaceRoot.
// Returns workspaceRoot as fallback if no marker is found.
function deriveBuildDirectory(
  entryFilePath: string,
  workspaceRoot: string
): string {
  let dir = path.dirname(entryFilePath);
  const root = path.resolve(workspaceRoot);
  while (dir.startsWith(root) && dir !== path.parse(dir).root) {
    if (PROJECT_MARKERS.some((m) => fs.existsSync(path.join(dir, m)))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return workspaceRoot;
}

function getActiveFileLanguage(
  entryFilePath: string,
  buildDir: string
): ProjectLanguage {
  const ext = path.extname(entryFilePath).toLowerCase();
  if (ext === ".rs") {
    return "rust";
  }
  if (
    (ext === ".ts" || ext === ".tsx") &&
    fs.existsSync(path.join(buildDir, "asconfig.json"))
  ) {
    return "assemblyscript";
  }
  return "javascript";
}

export async function buildWasmBinary(
  workspaceRoot: string,
  entryFile: string,
  outputFile?: string,
  tsConfigPath?: string,
  buildDirectory?: string
): Promise<string> {
  const entryFilePath = normalizePath(workspaceRoot, entryFile);
  if (entryFilePath === INVALID_PATH) {
    throw new Error("Invalid entry file path: Must be relative to workspace");
  }

  let wasmBinaryPath: string | null = null;
  if (outputFile) {
    const resolved = normalizePath(workspaceRoot, outputFile);
    if (resolved === INVALID_PATH) {
      throw new Error(
        "Invalid output file path: Must be relative to workspace"
      );
    }
    wasmBinaryPath = resolved;
  }

  let tsconfig = tsConfigPath
    ? normalizePath(workspaceRoot, tsConfigPath)
    : undefined;

  if (tsconfig === INVALID_PATH) {
    tsconfig = undefined;
  }

  let currWorkingDir = buildDirectory
    ? normalizePath(workspaceRoot, buildDirectory)
    : undefined;
  if (currWorkingDir === INVALID_PATH) {
    currWorkingDir = undefined;
  }
  if (!currWorkingDir) {
    currWorkingDir = deriveBuildDirectory(entryFilePath, workspaceRoot);
  }

  const language = getActiveFileLanguage(entryFilePath, currWorkingDir);

  if (language === "rust") {
    return await compileRustAndFindBinary(
      entryFilePath,
      wasmBinaryPath ?? path.join(workspaceRoot, "wasm/output.wasm"),
      currWorkingDir,
      workspaceRoot
    );
  }

  if (language === "assemblyscript") {
    return await compileAssemblyScriptBinary(
      entryFilePath,
      wasmBinaryPath,
      currWorkingDir,
      workspaceRoot
    );
  }

  return await compileJavascriptBinary(
    entryFilePath,
    wasmBinaryPath ?? path.join(workspaceRoot, "wasm/output.wasm"),
    currWorkingDir,
    workspaceRoot,
    tsconfig
  );
}
