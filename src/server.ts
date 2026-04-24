import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerAllPrompts } from "./prompts/index.js";
import { registerAllTools } from "./tools/index.js";
import { registerAllResources } from "./resources/index.js";

const server = new McpServer({
  name: "FastEdge Vibe Agent",
  version: "1.0.0",
});

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || process.cwd();
const GCORE_API_KEY =
  process.env.GCORE_API_KEY || process.env.FASTEDGE_API_KEY || "";

registerAllTools(server, {
  workspaceRoot: WORKSPACE_ROOT,
  gcoreApiKey: GCORE_API_KEY,
});

registerAllPrompts(server);
registerAllResources(server);

async function main() {
  if (!GCORE_API_KEY) {
    console.error(
      "GCORE_API_KEY is required. Set it to your Gcore API key (or use FASTEDGE_API_KEY).",
    );
    process.exit(1);
  }

  console.warn(`Workspace initialized at: ${WORKSPACE_ROOT}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
