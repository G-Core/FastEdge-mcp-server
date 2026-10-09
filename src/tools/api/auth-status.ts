import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { GCORE_API_ORIGIN, GCORE_API_ORIGIN_SOURCE } from "../../api-client.js";
import type { Auth } from "../../auth/credentials.js";

export function registerAuthStatusTool(server: McpServer, auth: Auth) {
  server.registerTool(
    "fastedge-auth-status",
    {
      title: "FastEdge sign-in status",
      description:
        "Show which Gcore account this server uses: explicit API key, or portal session (account id, API origin, expiry, and the account this server is locked to). Returns the login command to sign in or switch accounts. Never returns the token. Use it when the user asks which account they are on or wants to switch account.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      // Which environment, and why (task 11): env, a default saved by `login --set-default-origin`, or the image's own.
      const status = { api_origin: GCORE_API_ORIGIN, api_origin_source: GCORE_API_ORIGIN_SOURCE, ...(await auth.status()) };
      return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
    },
  );
}
