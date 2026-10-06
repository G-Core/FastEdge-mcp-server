import fs from "node:fs";

import { GCORE_API_BASE } from "../../../api-client.js";
import { INVALID_PATH, normalizePath } from "../../../utils/index.js";
import { UploadBinaryResponse } from "./types.js";

/** Carries the HTTP status, so callers never have to parse it out of the message. */
export class UploadError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function uploadBinary(
  authorization: string,
  workspaceRoot: string,
  wasmFile: string
): Promise<UploadBinaryResponse> {
  const wasmFilePath = normalizePath(workspaceRoot, wasmFile);
  if (wasmFilePath === INVALID_PATH) {
    throw new Error("Invalid wasm binary file path: Must be relative to workspace");
  }

  const wasmBuffer = fs.readFileSync(wasmFilePath);
  const response = await fetch(
    `${GCORE_API_BASE}/fastedge/v1/binaries/raw`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        Authorization: authorization,
      },
      body: wasmBuffer,
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new UploadError(
      `Failed to upload binary: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`,
      response.status,
    );
  }

  return response.json() as Promise<UploadBinaryResponse>;
}

export { uploadBinary };
