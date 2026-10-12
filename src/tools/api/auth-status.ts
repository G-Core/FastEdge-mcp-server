import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { GCORE_API_ORIGIN, GCORE_API_ORIGIN_SOURCE } from "../../api-client.js";
import type { Auth } from "../../auth/credentials.js";
import { PORTAL_ORIGINS, defaultOriginCommand, isForcedEphemeral, useDefaultOriginCommand } from "../../auth/session.js";

const RULES =
  "Use only an api_origin listed in environments; never guess another host. Never edit MCP configuration or agent settings (.mcp.json, .claude/settings*.json, ~/.codex/config.toml, .vscode/mcp.json) yourself: if a change there is needed, tell the user exactly what to change. After a switch command, this server stays on the old environment until it restarts: tell the user to restart it (Claude Code: /mcp, then Reconnect), and make no API calls until they have.";

/**
 * How to move this server to another environment. Agents guessed hosts (`api.preprod.gcore.com`)
 * and edited MCP configs before this existed, so it lists the only valid ones and the commands.
 */
export function switchEnvironmentHint(keyMode: boolean, source: string, forced: boolean): string {
  if (keyMode) {
    return `${RULES} This server uses an API key, which belongs to one environment. To switch, the user sets GCORE_API_BASE and a key from that environment's portal where this agent starts, then restarts the MCP server.`;
  }
  if (source === "env") {
    return `${RULES} GCORE_API_BASE is set in this server's configuration (the MCP config's docker args, or the agent's environment such as the env block in .claude/settings.local.json), so it decides and a saved default doesn't apply: tell the user to change or remove it there, then restart the MCP server.`;
  }
  const project =
    "tell the user to set GCORE_API_BASE=<api_origin> where this agent starts (Claude Code: the env block in .claude/settings.local.json), then restart the MCP server.";
  if (forced) return `${RULES} FASTEDGE_SESSION=ephemeral can't save a default environment: ${project}`;
  return `${RULES} With the user's OK, run the target environment's switch_to_saved command (no browser; pick the account with them if there are several) or, if it has none, its sign_in_and_make_default command as a background task, like login_command (the user approves in that environment's portal). Either makes that environment the default for every MCP server started without GCORE_API_BASE, on this computer. Only if they want it for one project instead: ${project}`;
}

/**
 * Sign-in choice 4. Here, not in the docs index, so it works with any image, and only on demand.
 * In a test an agent told the user to write the key into .mcp.json.
 */
export const API_KEY_SETUP =
  "Tell the user these steps; they make the edits. Never put the key in this chat, in an MCP config, or in any file git tracks. " +
  "1. The MCP config's docker args must pass the variable by name only: \"-e\", \"GCORE_API_KEY\" (no value). The FastEdge plugin's config already does; a hand-written config (e.g. a project's .mcp.json) may need that line added. " +
  "2. Give it a value where the agent starts. Claude Code, one project: \"env\": { \"GCORE_API_KEY\": \"<key>\" } in .claude/settings.local.json (git-ignored; never .claude/settings.json); every project: the same block in ~/.claude/settings.json. " +
  "Codex: export GCORE_API_KEY in the shell that starts codex (one project: direnv .envrc, git-ignored). Cursor: export it in the shell that starts Cursor (macOS app: launchctl setenv GCORE_API_KEY …), then restart Cursor. " +
  "VS Code: an input with \"password\": true, referenced as ${input:<id>} in the server's env. Or, in any agent: export it in the shell before starting the agent, with no file at all. " +
  "For another environment, also set GCORE_API_BASE the same way, with a key from that environment's portal. " +
  "3. Restart the MCP server. fastedge-auth-status then shows credential explicit_key and the key's account. " +
  "Keys come from the portal's API tokens page (prod https://portal.gcore.com, preprod https://portal.preprod.world).";

type Saved = { client_id: number; expires_at: string; usable: boolean };

export function registerAuthStatusTool(server: McpServer, auth: Auth) {
  server.registerTool(
    "fastedge-auth-status",
    {
      title: "FastEdge sign-in status",
      description:
        "Show which Gcore account and environment (API origin) this server uses: explicit API key, or portal session (account id, API origin, expiry, and the account this server is locked to). Returns the login command to sign in or switch accounts, the valid environments and how to switch environment. Never returns the token. Use it when the user asks which account or environment they are on. Before switching account or environment, call this and use only the commands it returns: never edit MCP configs, create volumes, or build your own login commands.",
      inputSchema: {},
      // With an explicit key it asks the API which account the key belongs to.
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      const { other_environments, ...auth_status } = await auth.status();
      const keyMode = auth_status.credential === "explicit_key";
      const forced = isForcedEphemeral();
      const saved = new Map(
        ((other_environments ?? []) as Array<{ api_origin: string; cached_accounts: Saved[] }>).map((e) => [
          e.api_origin,
          e.cached_accounts.filter((a) => a.usable),
        ]),
      );
      const environments = Object.entries(PORTAL_ORIGINS).map(([api_origin, portal]) => {
        const current = api_origin === GCORE_API_ORIGIN;
        if (keyMode || current || forced) return { api_origin, portal, current };
        // A usable saved session there: switch to it, no approval. Otherwise a new sign-in.
        const usable = saved.get(api_origin) ?? [];
        if (usable.length > 0) {
          const switch_to_saved = usable
            .map((a) => ({ client_id: a.client_id, expires_at: a.expires_at, command: useDefaultOriginCommand(api_origin, a.client_id) }))
            .filter((a) => a.command);
          return { api_origin, portal, current, switch_to_saved };
        }
        const command = defaultOriginCommand(api_origin);
        return { api_origin, portal, current, ...(command ? { sign_in_and_make_default: command } : {}) };
      });
      // Which environment, and why: env, a default saved by `login --set-default-origin`, or the image's own.
      const status = {
        api_origin: GCORE_API_ORIGIN,
        api_origin_source: GCORE_API_ORIGIN_SOURCE,
        ...auth_status,
        ...(keyMode ? {} : { api_key_setup: API_KEY_SETUP }),
        environments,
        switch_environment: switchEnvironmentHint(keyMode, GCORE_API_ORIGIN_SOURCE, forced),
      };
      return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
    },
  );
}
