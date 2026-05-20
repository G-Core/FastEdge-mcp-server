import type { Workflow } from "../types.js";

export const enableAppHttp: Workflow = {
  name: "enable-app-http",
  description:
    "Enable debug logging on a FastEdge HTTP app so /apps/{id}/logs captures traffic. Returns the app's public URL and the debug-window expiry.",
  domain: "fastedge",
  params: {
    app_id: {
      type: "number",
      required: true,
      description: "ID of the app to enable for live testing",
    },
  },
  steps: [
    {
      method: "PATCH",
      path: "/fastedge/v1/apps/{{params.app_id}}",
      description: "Enable debug logging (auto-disables after 30 minutes)",
      body: {
        debug: true,
      },
      as: "app",
    },
  ],
  notes:
    "Used by the live-test skill before issuing test traffic against an HTTP-type FastEdge app. " +
    "Debug auto-disables after 30 minutes — re-run to extend. " +
    "Step results: $app.url (public test URL), $app.debug_until (RFC3339 window expiry).",
};
