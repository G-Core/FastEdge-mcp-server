import type { Workflow } from "../types.js";

export const deleteAppAndBinary: Workflow = {
  name: "delete-app-and-binary",
  description: "Delete a FastEdge app and its associated binary",
  domain: "fastedge",
  params: {
    app_id: {
      type: "number",
      required: true,
      description: "ID of the app to delete",
    },
  },
  steps: [
    {
      method: "GET",
      path: "/fastedge/v1/apps/{{params.app_id}}",
      description: "Get app details to find the binary ID",
      as: "app",
    },
    {
      method: "DELETE",
      path: "/fastedge/v1/apps/{{params.app_id}}",
      description: "Delete the app",
    },
    {
      method: "DELETE",
      path: "/fastedge/v1/binaries/$app.binary",
      description: "Delete the associated binary",
    },
  ],
  notes:
    "Fetches the app first to find its binary ID, then deletes both. " +
    "The app must be deleted before the binary (binary deletion fails if still referenced).",
};
