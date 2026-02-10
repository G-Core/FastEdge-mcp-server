import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDeploymentPrompts } from "./deploying.js";
import { registerScaffoldingPrompts } from "./scaffolding.js";
import { registerCreateFastEdgeAppPrompt } from "./scaffolding-scenarios.js";

/**
 * Register all prompts with the MCP server
 * @param server MCP Server instance
 */
export function registerAllPrompts(server: McpServer) {
  registerDeploymentPrompts(server);
  registerScaffoldingPrompts(server); // Only registers explainFastEdgeTemplate now
  registerCreateFastEdgeAppPrompt(server); // Smart /createFastEdgeApp prompt
}
