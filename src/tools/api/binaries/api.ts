import fs from "node:fs";

import { INVALID_PATH, normalizePath } from "../../../utils/index.js";
import type { ApiResult, Auth } from "../../../auth/credentials.js";

/**
 * Reads the binary here (workspace paths are confined) and sends the bytes, never a path, so
 * the token broker never touches the workspace.
 */
async function uploadBinary(auth: Auth, workspaceRoot: string, wasmFile: string): Promise<ApiResult> {
  const wasmFilePath = normalizePath(workspaceRoot, wasmFile);
  if (wasmFilePath === INVALID_PATH) {
    throw new Error("Invalid wasm binary file path: Must be relative to workspace");
  }

  return auth.call({
    method: "POST",
    path: "/fastedge/v1/binaries/raw",
    body: fs.readFileSync(wasmFilePath),
    contentType: "application/octet-stream",
  });
}

export { uploadBinary };
