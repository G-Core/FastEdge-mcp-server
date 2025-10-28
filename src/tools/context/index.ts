import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { FastEdgeContext } from "../../resources/index.js";

import { ToolOptions } from "../index.js";

/**
 * Register fastedge-context tools to the MCP server
 * @param server MCP Server instance
 * @param workspaceRoot Root path of the workspace
 */
function registerFastEdgeContextTools(server: McpServer) {
  server.tool(
    "get-fastedge-context",
    "Get comprehensive FastEdge development context and patterns for coding assistance",
    {},
    {
      title: "Get FastEdge Context",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    () => ({
      content: [
        {
          type: "text",
          text: FastEdgeContext,
        },
      ],
    })
  );
}

export function registerContextTools(server: McpServer, options: ToolOptions) {
  registerFastEdgeContextTools(server);
}
