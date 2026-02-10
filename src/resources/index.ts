import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerScaffoldingResources } from "./scaffolding-guide.js";

/**
 * Register all MCP resources
 * Resources provide documentation and guidance that agents can read
 */
export function registerAllResources(server: McpServer) {
  registerScaffoldingResources(server);
}
