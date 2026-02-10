import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerFastEdgeApiTools } from "./fastedge/index.js";
import { registerScaffoldTools } from "./scaffolding/index.js";
import { registerWorkspaceTools } from "./workspace/index.js";

export interface ToolOptions {
  workspaceRoot: string;
  fastedgeApiKey: string;
  fastedgeApiUrl: string;
}

/**
 * Register all tools with the MCP server
 * @param server MCP Server instance
 * @param options Configuration options for tools
 */
export function registerAllTools(server: McpServer, options: ToolOptions) {
  registerFastEdgeApiTools(server, options);
  registerWorkspaceTools(server, options);
  registerScaffoldTools(server, options);
}
