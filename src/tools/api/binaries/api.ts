import fs from "node:fs";

import { GCORE_API_BASE } from "../../../api-client.js";
import { INVALID_PATH, normalizePath } from "../../../utils/index.js";
import { UploadBinaryResponse } from "./types.js";

function uploadBinary(
  apiKey: string,
  workspaceRoot: string,
  wasmFile: string
): Promise<UploadBinaryResponse> {
  return new Promise(async (resolve, reject) => {
    const wasmFilePath = normalizePath(workspaceRoot, wasmFile);
    if (wasmFilePath === INVALID_PATH) {
      reject("Invalid wasm binary file path: Must be relative to workspace");
    }

    const wasmBuffer = fs.readFileSync(wasmFilePath);
    const response = await fetch(
      `${GCORE_API_BASE}/fastedge/v1/binaries/raw`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          Authorization: `APIKey ${apiKey}`,
        },
        body: wasmBuffer,
      }
    );

    if (!response.ok) {
      reject(`Failed to upload binary: ${response.statusText}`);
    }

    const binary = await response.json();
    resolve(binary);
  });
}

export { uploadBinary };
