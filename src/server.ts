import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerAllPrompts } from "./prompts/index.js";
import { registerAllTools } from "./tools/index.js";
import { registerAllResources } from "./resources/index.js";
import { createAuth } from "./auth/credentials.js";
import { BROKER_ID, connectBroker, readIdentity } from "./auth/broker.js";

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

// Task 10, MUST 1: forced ephemeral mode wins; never run it with a key (the entrypoint checks too).
if (process.env.FASTEDGE_SESSION === "ephemeral" && GCORE_API_KEY) {
  console.error("FASTEDGE_SESSION=ephemeral can't be combined with GCORE_API_KEY. Remove one of them.");
  process.exit(2);
}

/**
 * Session mode only: refuse to run as root or as the token broker's uid. Build tools run as this
 * process, so either identity could read the session cache directly. The entrypoint prevents this;
 * this is the second line (e.g. a non-canonical HOST_UID). Not running with dropped privileges is
 * allowed here, so the server still starts for local development outside Docker.
 */
function refuseUnsafeIdentity(): void {
  const { uids, gids } = readIdentity();
  if ([...uids, ...gids].some((id) => id === 0 || id === BROKER_ID)) {
    console.error(`Refusing to start without GCORE_API_KEY as root or as uid/gid ${BROKER_ID} (reserved for the token broker).`);
    process.exit(2);
  }
}

async function main() {
  if (!GCORE_API_KEY) refuseUnsafeIdentity();
  // Session mode: connect to the token broker before any tool (and so any build) can run.
  // This process never reads the session cache itself.
  const auth = GCORE_API_KEY ? createAuth(GCORE_API_KEY) : await connectBroker();
  if (!GCORE_API_KEY) {
    console.error(
      "No GCORE_API_KEY set: local tools work, and API tools will ask you to sign in through the Gcore portal.",
    );
  }

  registerAllTools(server, { workspaceRoot: WORKSPACE_ROOT, auth });
  registerAllPrompts(server);
  registerAllResources(server);

  console.warn(`Workspace initialized at: ${WORKSPACE_ROOT}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
