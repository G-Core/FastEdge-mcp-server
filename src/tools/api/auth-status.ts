import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { GCORE_API_ORIGIN, GCORE_API_ORIGIN_SOURCE } from "../../api-client.js";
import type { Auth } from "../../auth/credentials.js";
import { PORTAL_ORIGINS, defaultOriginCommand, isForcedEphemeral } from "../../auth/session.js";

/**
 * How to move this server to another environment. Agents guessed hosts before this existed
 * (`api.preprod.gcore.com`), so it lists the only valid ones and says which setting decides.
 */
export function switchEnvironmentHint(keyMode: boolean, source: string, forced: boolean): string {
  const only = "Use only an api_origin listed in environments; never guess another host.";
  if (keyMode) {
    return `${only} This server uses an API key, which belongs to one environment. To switch, the user sets GCORE_API_BASE and a key from that environment's portal where this agent starts, then restarts the MCP server.`;
  }
  if (source === "env") {
    return `${only} GCORE_API_BASE is set in this server's configuration (the MCP config's docker args, or the agent's environment such as the env block in .claude/settings.local.json), so it decides: change or remove it there, then restart the MCP server. A saved default doesn't apply while it's set.`;
  }
  const project =
    "set GCORE_API_BASE=<api_origin> where this agent starts (Claude Code: the env block in .claude/settings.local.json; or -e GCORE_API_BASE=<api_origin> in the MCP config's docker args), then restart the MCP server and sign in if asked.";
  if (forced) return `${only} For this project: ${project} (FASTEDGE_SESSION=ephemeral can't save a default environment.)`;
  return `${only} Don't edit the MCP config: with the user's OK, run that environment's sign_in_and_make_default as a background task, like login_command. The user approves in that environment's portal; it saves the session and makes that environment the default for every MCP server started without GCORE_API_BASE (all projects and agents on this computer). Then restart the MCP server. Only if they want it for one project instead: ${project}`;
}

export function registerAuthStatusTool(server: McpServer, auth: Auth) {
  server.registerTool(
    "fastedge-auth-status",
    {
      title: "FastEdge sign-in status",
      description:
        "Show which Gcore account and environment (API origin) this server uses: explicit API key, or portal session (account id, API origin, expiry, and the account this server is locked to). Returns the login command to sign in or switch accounts, the valid environments and how to switch environment. Never returns the token. Use it when the user asks which account or environment they are on, or wants to switch either.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const auth_status = await auth.status();
      const keyMode = auth_status.credential === "explicit_key";
      const forced = isForcedEphemeral();
      const environments = Object.entries(PORTAL_ORIGINS).map(([api_origin, portal]) => {
        const current = api_origin === GCORE_API_ORIGIN;
        const command = keyMode || current ? null : defaultOriginCommand(api_origin);
        return { api_origin, portal, current, ...(command ? { sign_in_and_make_default: command } : {}) };
      });
      // Which environment, and why (task 11): env, a default saved by `login --set-default-origin`, or the image's own.
      const status = {
        api_origin: GCORE_API_ORIGIN,
        api_origin_source: GCORE_API_ORIGIN_SOURCE,
        ...auth_status,
        environments,
        switch_environment: switchEnvironmentHint(keyMode, GCORE_API_ORIGIN_SOURCE, forced),
      };
      return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
    },
  );
}
