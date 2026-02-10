import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { uploadBinary } from "./api.js";
import { ApiConfig } from "../types.js";

/**
 * Register fastedge-binary-related tools to the MCP server
 * @param server MCP Server instance
 * @param options Configuration options for tools
 */
export function registerFastEdgeBinaryTools(
  server: McpServer,
  apiConfig: ApiConfig,
  workspaceRoot: string
) {
  server.registerTool(
    "upload-binary",
    {
      title: "Upload FastEdge WASM Binary to the FastEdge API",
      description: "Upload a FastEdge WASM binary using the FastEdge API",
      inputSchema: {
        wasmFile: z
          .string()
          .describe("Relative path to the WASM binary file to upload"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const binary = await uploadBinary(
          apiConfig,
          workspaceRoot,
          params.wasmFile
        );

        if (!binary.id) {
          throw new Error("Failed to upload binary: No ID returned");
        }

        return {
          content: [
            {
              type: "text",
              text: `Successfully uploaded the WASM binary! { id: ${binary.id} }`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to build the WASM binary: ${
                error?.message || String(error)
              }`,
            },
          ],
        };
      }
    }
  );
}
