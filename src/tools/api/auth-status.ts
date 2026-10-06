import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

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
    async () => ({ content: [{ type: "text", text: JSON.stringify(auth.status(), null, 2) }] }),
  );
}
