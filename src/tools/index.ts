import { join } from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerFastEdgeApiTools } from "./fastedge/index.js";
import { registerScaffoldTools } from "./scaffolding/index.js";
import { registerWorkspaceTools } from "./workspace/index.js";
import { registerReferenceTools } from "./reference/index.js";

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

  // Reference docs are bundled at build time from the fastedge-plugin repo.
  // See scripts/sync-reference-docs.sh for the import process.
  const docsDir = join(
    new URL(".", import.meta.url).pathname,
    "..",
    "..",
    "reference-docs"
  );
  registerReferenceTools(server, docsDir);
}
