import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerDeployAppTool } from "./deploy-app.js";
import { registerDeployDotEnvTool } from "./deploy-dotenv.js";

import type { ApiConfig } from "../types.js";

/**
 * Register fastedge-app-related tools to the MCP server
 * @param server MCP Server instance
 * @param options Configuration options for tools
 */
export function registerFastEdgeAppsTools(
  server: McpServer,
  apiConfig: ApiConfig
) {
  registerDeployAppTool(server, apiConfig);
  registerDeployDotEnvTool(server, apiConfig);
}
