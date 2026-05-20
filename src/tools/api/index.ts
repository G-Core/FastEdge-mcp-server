import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerGcoreApiTool } from "./gcore-api.js";
import { registerDescribeApiTool } from "./describe-api.js";
import { registerWorkflowsListTool } from "./workflows-list.js";
import { registerBatchExecuteTool } from "./batch-execute.js";
import { registerUploadBinaryTool } from "./binaries/index.js";

export function registerApiTools(
  server: McpServer,
  options: { workspaceRoot: string; gcoreApiKey: string },
) {
  registerGcoreApiTool(server);
  registerDescribeApiTool(server);
  registerWorkflowsListTool(server);
  registerBatchExecuteTool(server);
  registerUploadBinaryTool(server, options.gcoreApiKey, options.workspaceRoot);
}
