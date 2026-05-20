import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerBuildWasmTools } from "./build.js";
import { registerMagicCommentsTools } from "./magic-comments.js";

import { ToolOptions } from "../../index.js";

export function registerWorkspaceTools(
  server: McpServer,
  options: ToolOptions
) {
  registerBuildWasmTools(server, options.workspaceRoot);
  registerMagicCommentsTools(server);
}
