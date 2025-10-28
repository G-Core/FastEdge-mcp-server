import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getSecretByName } from "./api.js";
import { ApiConfig } from "../types.js";

/**
 * Register fastedge-secret-related tools to the MCP server
 * @param server MCP Server instance
 * @param options Configuration options for tools
 */
export function registerFastEdgeSecretTools(
  server: McpServer,
  apiConfig: ApiConfig
) {
  server.tool(
    "get-secret-id",
    "Get the ID of a FastEdge secret using the FastEdge API",
    {
      secretName: z
        .string()
        .describe("Name of the FastEdge secret to retrieve"),
    },
    {
      title: "Get FastEdge Secret ID from the FastEdge API",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async (params) => {
      try {
        const secret = await getSecretByName(apiConfig, params.secretName);

        if (!secret) {
          throw new Error("Failed to retrieve secret: No secret found");
        }

        if (!secret.id) {
          throw new Error("Failed to retrieve secret: No ID returned");
        }

        return {
          content: [
            {
              type: "text",
              text: `Successfully retrieved the FastEdge secret! { id: ${secret.id} }`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to retrieve the FastEdge secret: ${
                error?.message || String(error)
              }`,
            },
          ],
        };
      }
    }
  );
}
