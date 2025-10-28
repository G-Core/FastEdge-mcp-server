import path from "node:path";

import { compileJavascriptBinary } from "./jsBuild.js";
import { compileRustAndFindBinary } from "./rustBuild.js";
import { INVALID_PATH, normalizePath } from "../../../utils/index.js";

function getActiveFileLanguage(entryFilePath: string): "rust" | "javascript" {
  const ext = path.extname(entryFilePath).toLowerCase();
  if (ext === ".rs") {
    return "rust";
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

  const outputFilePath = outputFile ?? "/.vscode/output.wasm";
  const wasmBinaryPath = normalizePath(workspaceRoot, outputFilePath);
  if (wasmBinaryPath === INVALID_PATH) {
    throw new Error("Invalid output file path: Must be relative to workspace");
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

  if (getActiveFileLanguage(entryFilePath) === "rust") {
    // Compile Rust code
    return await compileRustAndFindBinary(
      entryFilePath,
      wasmBinaryPath,
      currWorkingDir ?? workspaceRoot
    );
  }
  // Compile JavaScript code
  return await compileJavascriptBinary(
    entryFilePath,
    wasmBinaryPath,
    currWorkingDir ?? workspaceRoot,
    tsconfig
  );
}
