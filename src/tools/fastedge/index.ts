import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerFastEdgeAppsTools } from "./apps/index.js";
import { registerFastEdgeBinaryTools } from "./binaries/index.js";
import { registerFastEdgeSecretTools } from "./secrets/index.js";

import { ToolOptions } from "../index.js";

export function registerFastEdgeApiTools(
  server: McpServer,
  options: ToolOptions
) {
  const apiConfig = {
    apiKey: options.fastedgeApiKey,
    apiUrl: options.fastedgeApiUrl,
  };
  registerFastEdgeAppsTools(server, apiConfig);
  registerFastEdgeBinaryTools(server, apiConfig, options.workspaceRoot);
  registerFastEdgeSecretTools(server, apiConfig);
}
