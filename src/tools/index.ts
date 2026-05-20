import { join } from "path";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerApiTools } from "./api/index.js";
import { registerScaffoldTools } from "./local/scaffolding/index.js";
import { registerWorkspaceTools } from "./local/workspace/index.js";
import { registerReferenceTools } from "./local/reference/index.js";

export interface ToolOptions {
  workspaceRoot: string;
  gcoreApiKey: string;
}

export function registerAllTools(server: McpServer, options: ToolOptions) {
  // API tools — direct Gcore API calls (formerly proxied via gcore-api-mcp-server)
  registerApiTools(server, options);

  // Local tools — run in the MCP server process (Docker container)
  registerWorkspaceTools(server, options);
  registerScaffoldTools(server, options);

  // Reference docs are bundled at build time from the fastedge-plugin repo.
  // See scripts/sync-reference-docs.sh for the import process.
  const docsDir = join(
    fileURLToPath(new URL(".", import.meta.url)),
    "..",
    "..",
    "reference-docs"
  );
  registerReferenceTools(server, docsDir);
}
