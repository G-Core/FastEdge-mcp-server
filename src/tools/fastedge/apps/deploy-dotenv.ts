import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getApp, getAppByName, updateApp } from "./api.js";

import type { ApiConfig, GetAppResponse } from "../types.js";

/**
 * Register update-app-env-variables tool to the MCP server
 * Used for deploying an app to the FastEdge platform
 * @param server MCP Server instance
 * @param options Configuration options for tools
 */
export function registerDeployDotEnvTool(
  server: McpServer,
  apiConfig: ApiConfig
) {
  server.tool(
    "update-env-vars-app",
    "Update environment variables for a FastEdge application using the FastEdge API",
    {
      appId: z
        .string()
        .optional()
        .describe("ID of the FastEdge application, if provided"),
      appName: z
        .string()
        .optional()
        .describe("Name of the FastEdge application, if provided"),
      envVars: z
        .string()
        .optional()
        .describe(
          "Environment variables for the FastEdge application, if provided (JSON format)"
        ),
      rspHeaders: z
        .string()
        .optional()
        .describe(
          "Response headers for the FastEdge application, if provided (JSON format)"
        ),
      secrets: z
        .string()
        .optional()
        .describe(
          "Secrets for the FastEdge application, if provided (JSON format)"
        ),
      stores: z
        .string()
        .optional()
        .describe(
          "Stores for the FastEdge application, if provided (JSON format)"
        ),
    },
    {
      title:
        'Update "Environment Variables", "Secrets", "Stores" and/or "Response Headers" for FastEdge Application',
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
        if (appId) {
          app = await getApp(apiConfig, appId);
        } else if (appName) {
          app = await getAppByName(apiConfig, appName);
        }

        if (app) {
          // Update existing app
          const updatedApp = await updateApp(apiConfig, {
            id: app.id,
            binary: app.binary,
            name: app.name,
            comment: app.comment,
            status: app.status,
            env: mergeDictionaryWithExisting(app, params.envVars),
            rsp_headers: mergeDictionaryWithExisting(app, params.rspHeaders),
            secrets: mergeResourceBindingWithExisting(app, params.secrets),
            stores: mergeResourceBindingWithExisting(app, params.stores),
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
          throw new Error("Application not found");
        }
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to update the application: ${
                error?.message || String(error)
              }`,
            },
          ],
        };
      }
    }
  );
}

function mergeDictionaryWithExisting(
  app: GetAppResponse,
  newVarsStr: string = "{}"
): Record<string, string> {
  try {
    const newVars = JSON.parse(newVarsStr);
    const mergedVars = { ...app.env, ...newVars };
    return mergedVars;
  } catch {
    return app.env;
  }
}

function mergeResourceBindingWithExisting(
  app: GetAppResponse,
  resourceBindings = "{}"
): Record<string, { id: number }> {
  try {
    const resources = JSON.parse(resourceBindings);
    const newBindings = Object.entries(resources).reduce(
      (acc, [key, value]) => {
        if (!value) return acc;
        if (typeof value === "object" && "id" in value) {
          acc[key] = { id: Number(value.id) };
        } else {
          acc[key] = { id: Number(value) };
        }
        return acc;
      },
      {} as Record<string, { id: number }>
    );
    return { ...app.stores, ...newBindings };
  } catch {
    return app.stores ?? {};
  }
}
