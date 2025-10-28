import fs from "node:fs";

import { INVALID_PATH, normalizePath } from "../../../utils/index.js";
import {
  ApiConfig,
  GetBinaryResponse,
  UploadBinaryResponse,
} from "../types.js";

function uploadBinary(
  apiConfig: ApiConfig,
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
      `${apiConfig.apiUrl}/fastedge/v1/binaries/raw`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          Authorization: `APIKey ${apiConfig.apiKey}`,
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

async function getBinary(
  apiConfig: ApiConfig,
  id: string | number
): Promise<GetBinaryResponse> {
  try {
    const response = await fetch(
      `${apiConfig.apiUrl}/fastedge/v1/binaries/${id}`,
      {
        method: "GET",
        headers: {
          Authorization: `APIKey ${apiConfig.apiKey}`,
        },
      }
    );
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const fetchedBinary = (await response.json()) as GetBinaryResponse;
    return {
      ...fetchedBinary,
      id: Number.parseInt(id.toString(), 10), // Ensure ID is included and always a number
    };
  } catch (error) {
    throw new Error(
      `Error fetching binary: ${error instanceof Error ? error.message : error}`
    );
  }
}

export { getBinary, uploadBinary };
