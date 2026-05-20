import { z } from "zod";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { buildWasmBinary } from "./compiler/index.js";

/**
 * Register workspace build tools to the MCP server
 * @param server MCP Server instance
 * @param workspaceRoot Root path of the workspace
 */
export function registerBuildWasmTools(
  server: McpServer,
  workspaceRoot: string
) {
  server.registerTool(
    "build-wasm",
    {
      title: "Build FastEdge WASM Binary",
      description: "Build a FastEdge WASM binary within the workspace",
      inputSchema: {
        entryFile: z
          .string()
          .describe(
            "Relative path to the current active file within the workspace"
          ),
        outputFile: z
          .string()
          .optional()
          .describe(
            "Relative path and filename to the output WASM binary within the workspace. " +
              "Optional for AssemblyScript projects — when omitted, the output path is read from " +
              "asconfig.json targets.release.outFile. Required for JavaScript and Rust projects."
          ),
        tsConfigPath: z
          .string()
          .optional()
          .describe(
            `Relative path to the tsconfig.json file within the workspace. ( Only provided from "Magic Comments" )`
          ),
        buildDirectory: z
          .string()
          .optional()
          .describe(
            `Relative path to the build directory within the workspace. ( Only provided from "Magic Comments" )
          Individual application folders may have their own package.json / node_modules files at nested levels.
          The workspace-root is not always the level to build from. Escape hatch to provide a cwd for "npx fastedge-build" command`
          ),
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
        const wasmBinaryPath = await buildWasmBinary(
          workspaceRoot,
          params.entryFile,
          params.outputFile,
          params.tsConfigPath,
          params.buildDirectory
        );

        return {
          content: [
            {
              type: "text",
              text: `Successfully built the WASM binary: ${wasmBinaryPath}`,
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
