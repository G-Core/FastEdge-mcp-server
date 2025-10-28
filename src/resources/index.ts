import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { fastedge } from "./fastedge-core/fastedge.js";
import { examples } from "./fastedge-examples/examples.js";
import { docs } from "./fastedge-sdk-js/docs.js";
import { dotenv } from "./dotenv/dotenv.js";

const registerReourceContext = (
  server: McpServer,
  resourceName: string,
  content: string
) => {
  server.registerResource(
    resourceName,
    `file:///${resourceName}.md`,
    {},
    () => ({
      contents: [
        {
          uri: `file:///${resourceName}.md`,
          text: content,
          mimeType: "text/markdown",
        },
      ],
    })
  );
};

export const FastEdgeContext = `
# FastEdge Development Context: \n ${fastedge} \n
# FastEdge Examples: \n ${examples} \n
# FastEdge Javascript SDK Tutorial: \n ${docs}
# FastEdge DotEnv Variables: \n ${dotenv}
`;

/**
 * Register all tools with the MCP server
 * @param server MCP Server instance
 * @param options Configuration options for tools
 */
export function registerAllResources(server: McpServer) {
  registerReourceContext(server, "fastedge-context", FastEdgeContext);
}
