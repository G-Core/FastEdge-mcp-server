import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Register workspace magic comments tools to the MCP server
 * @param server MCP Server instance
 */
export function registerMagicCommentsTools(server: McpServer) {
  server.tool(
    "deployment-comments",
    'Generate deployment comments ( "Magic Comments" ) for a FastEdge application and insert them in the code file.',
    {
      codeFile: z
        .string()
        .optional()
        .describe(
          "File to insert deployment comments. Defaults to entryFile from build sequence or current active file."
        ),
      appName: z
        .string()
        .optional()
        .describe("Name of the FastEdge application"),
      appId: z
        .string()
        .optional()
        .describe("Unique identifier for the FastEdge application"),
      appUrl: z.string().optional().describe("URL of the FastEdge application"),
      outputFile: z
        .string()
        .optional()
        .describe(
          "Relative path and filename to the output WASM binary within the workspace"
        ),
      buildDirectory: z
        .string()
        .optional()
        .describe("Relative path to the build directory within the workspace"),
    },
    {
      title:
        "Generate Magic Comments for keeping track of deployment info within a code file",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async (params) => {
      const magicComments = (data: Record<string, string | undefined>) => {
        let comments = "/* FastEdge Deployment Magic Comments";
        Object.entries(data).forEach(([key, value]) => {
          if (value) {
            comments += `\n* ${key}: "${value}"`;
          }
        });
        comments += `\n*/\n`;
        return comments;
      };

      return {
        content: [
          {
            type: "text",
            text: magicComments({
              appName: params.appName,
              appId: params.appId,
              appUrl: params.appUrl,
              outputFile: params.outputFile,
              buildDirectory: params.buildDirectory,
            }),
          },
        ],
      };
    }
  );
}
