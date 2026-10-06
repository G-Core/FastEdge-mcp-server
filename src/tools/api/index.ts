import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerGcoreApiTool } from "./gcore-api.js";
import { registerDescribeApiTool } from "./describe-api.js";
import { registerWorkflowsListTool } from "./workflows-list.js";
import { registerBatchExecuteTool } from "./batch-execute.js";
import { registerUploadBinaryTool } from "./binaries/index.js";
import { registerAuthStatusTool } from "./auth-status.js";
import type { Auth } from "../../auth/credentials.js";

export function registerApiTools(
  server: McpServer,
  options: { workspaceRoot: string; auth: Auth },
) {
  const { auth } = options;
  registerGcoreApiTool(server, auth);
  registerDescribeApiTool(server);
  registerWorkflowsListTool(server);
  registerBatchExecuteTool(server, auth);
  registerUploadBinaryTool(server, auth, options.workspaceRoot);
  registerAuthStatusTool(server, auth);
}
