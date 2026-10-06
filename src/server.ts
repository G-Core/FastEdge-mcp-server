import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerAllPrompts } from "./prompts/index.js";
import { registerAllTools } from "./tools/index.js";
import { registerAllResources } from "./resources/index.js";

function readApiKey(): string | undefined {
  try {
    const k = fs.readFileSync(3, "utf8").trim();
    if (k) return k;
  } catch {}
  // Fallback for non-Docker local development (env var not passed via fd 3).
  const k = process.env.GCORE_API_KEY ?? process.env.FASTEDGE_API_KEY;
  // Keeps the key out of {...process.env} spreads; does not remove it from
  // /proc/<pid>/environ — the fd 3 path in docker-entrypoint.sh handles that
  // for Docker.
  delete process.env.GCORE_API_KEY;
  delete process.env.FASTEDGE_API_KEY;
  return k;
}

const server = new McpServer({
  name: "FastEdge Vibe Agent",
  version: "1.0.0",
});

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || process.cwd();
const GCORE_API_KEY = readApiKey() ?? "";

registerAllTools(server, {
  workspaceRoot: WORKSPACE_ROOT,
  gcoreApiKey: GCORE_API_KEY,
});

registerAllPrompts(server);
registerAllResources(server);

async function main() {
  if (!GCORE_API_KEY) {
    console.error(
      "No GCORE_API_KEY set: local tools work, and API tools will ask you to sign in through the Gcore portal.",
    );
  }

  console.warn(`Workspace initialized at: ${WORKSPACE_ROOT}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
