import type { Workflow } from "../types.js";

export const updateAppBinary: Workflow = {
  name: "update-app-binary",
  description: "Upload a new WASM binary and update an existing app to use it",
  domain: "fastedge",
  params: {
    app_id: {
      type: "number",
      required: true,
      description: "ID of the app to update",
    },
    wasm_binary: {
      type: "string",
      required: true,
      description: "Base64-encoded WASM binary",
    },
  },
  steps: [
    {
      method: "POST",
      path: "/fastedge/v1/binaries/raw",
      description: "Upload the new WASM binary",
      body: "{{params.wasm_binary}}",
      content_type: "application/octet-stream",
      as: "binary",
    },
    {
      method: "PATCH",
      path: "/fastedge/v1/apps/{{params.app_id}}",
      description: "Update the app to use the new binary",
      body: {
        binary: "$binary.id",
      },
      as: "app",
    },
  ],
  notes:
    "Uploads a new binary then patches the app to point to it. " +
    "The old binary is not deleted — use delete-binary separately if needed.",
};
