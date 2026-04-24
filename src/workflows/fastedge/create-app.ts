import type { Workflow } from "../types.js";

export const createApp: Workflow = {
  name: "create-app",
  description: "Upload a WASM binary and create a new FastEdge application",
  domain: "fastedge",
  params: {
    wasm_binary: {
      type: "string",
      required: true,
      description: "Base64-encoded WASM binary",
    },
    name: {
      type: "string",
      required: true,
      description: "Application name (alphanumeric and hyphens, e.g. my-edge-app)",
    },
    status: {
      type: "number",
      required: false,
      description: "Initial status: 0=draft (default), 1=enabled",
      default: 0,
    },
    env: {
      type: "record",
      required: false,
      description: "Environment variables as key-value pairs",
    },
  },
  steps: [
    {
      method: "POST",
      path: "/fastedge/v1/binaries/raw",
      description: "Upload the WASM binary",
      body: "{{params.wasm_binary}}",
      content_type: "application/octet-stream",
      as: "binary",
    },
    {
      method: "POST",
      path: "/fastedge/v1/apps",
      description: "Create the app linked to the uploaded binary",
      body: {
        name: "{{params.name}}",
        binary: "$binary.id",
        status: "{{params.status}}",
        env: "{{params.env}}",
      },
      as: "app",
    },
  ],
  notes:
    "The binary upload expects raw bytes (application/octet-stream). " +
    "The app is created in draft status (0) by default. " +
    "After creation, the app URL is available in $app.url.",
};
