import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import fs from "node:fs/promises";
import path from "node:path";

import { registerAllPrompts } from "./prompts/index.js";
import { registerAllResources } from "./resources/index.js";
import { registerAllTools } from "./tools/index.js";

const server = new McpServer({
  name: "FastEdge Vibe Agent",
  version: "1.0.0",
  capabilities: {
    resources: {
      listChanged: true,
    },
    tools: {
      listChanged: true,
    },
    prompts: {
      listChanged: true,
    },
  },
});

// Workspace root path - for Docker, this can be mounted volume
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || process.cwd();
const FASTEDGE_API_KEY = process.env.FASTEDGE_API_KEY || "";
const FASTEDGE_API_URL =
  process.env.FASTEDGE_API_URL || "https://api.preprod.world"; // TODO: make this prod: "https://api.gcore.com"

// Add context tools for VSCode Copilot integration
registerAllTools(server, {
  workspaceRoot: WORKSPACE_ROOT,
  fastedgeApiKey: FASTEDGE_API_KEY,
  fastedgeApiUrl: FASTEDGE_API_URL,
});

registerAllResources(server);

registerAllPrompts(server);

async function main() {
  // Create necessary directories
  try {
    await fs.mkdir(path.join(WORKSPACE_ROOT, "apps"), { recursive: true });
    console.warn(`Workspace initialized at: ${WORKSPACE_ROOT}`);
    console.warn(`FASTEDGE_API_KEY: ${FASTEDGE_API_KEY}`);
  } catch (error: any) {
    console.error("Failed to initialize workspace:", error);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
