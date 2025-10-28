import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { createApp, getApp, getAppByName, updateApp } from "./api.js";
import { getBinary } from "../binaries/api.js";

import type { ApiConfig } from "../types.js";

/**
 * Register update-or-create-app tool to the MCP server
 * Used for deploying an app to the FastEdge platform
 * @param server MCP Server instance
 * @param options Configuration options for tools
 */
export function registerDeployAppTool(server: McpServer, apiConfig: ApiConfig) {
  server.tool(
    "update-or-create-app",
    "Update or Create a FastEdge application using the FastEdge API",
    {
      binaryId: z
        .string()
        .describe("ID of the WASM binary to use for the application"),
      appId: z
        .string()
        .optional()
        .describe("ID of the FastEdge application, if provided"),
      appName: z
        .string()
        .optional()
        .describe("Name of the FastEdge application, if provided"),
    },
    {
      title: "Update or Create FastEdge Application",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async (params) => {
      const appName = params.appName;
      const appId = params.appId;
      let app = null;

      try {
        let binary = null;
        const binaryId = parseInt(params.binaryId, 10);
        if (isNaN(binaryId)) {
          throw new Error("Invalid binary ID");
        } else {
          binary = await getBinary(apiConfig, binaryId);
          if (!binary) {
            throw new Error("Binary not found");
          }
        }
        if (appId) {
          app = await getApp(apiConfig, appId);
        } else if (appName) {
          app = await getAppByName(apiConfig, appName);
        }

        if (app) {
          // Update existing app
          const updatedApp = await updateApp(apiConfig, {
            id: app.id,
            binary: binary.id,
            name: appName || app.name,
            comment: app.comment,
            status: app.status,
            env: app.env,
            rsp_headers: app.rsp_headers,
            secrets: app.secrets,
          });
          return {
            content: [
              {
                type: "text",
                text: `Successfully Updated the FastEdge Application! { id: ${updatedApp.id}, url: "${updatedApp.url}", name: "${updatedApp.name}" }`,
              },
            ],
          };
        } else {
          // Create new app
          const createdApp = await createApp(apiConfig, {
            binary: binary.id,
            name: appName,
            comment: "",
            status: 1,
            env: {},
            rsp_headers: {},
            secrets: {},
          });
          console.error("Farq: createdApp", createdApp);
          return {
            content: [
              {
                type: "text",
                text: `Successfully Created the FastEdge Application! { id: ${createdApp.id}, url: "${createdApp.url}", name: "${createdApp.name}" }`,
              },
            ],
          };
        }
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to create/update the application: ${
                error?.message || String(error)
              }`,
            },
          ],
        };
      }
    }
  );
}
