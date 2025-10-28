import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getApp, getAppByName, updateApp } from "./api.js";

import type { ApiConfig } from "../types.js";

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
    },
    {
      title:
        'Update "Environment Variables", "Secrets" and/or "Response Headers" for FastEdge Application',
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
            env: JSON.parse(params.envVars || "{}"),
            rsp_headers: JSON.parse(params.rspHeaders || "{}"),
            secrets: parseSecretsJson(params.secrets),
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

function parseSecretsJson(secretsParam = "{}"): Record<string, { id: number }> {
  try {
    const secrets = JSON.parse(secretsParam);
    return Object.entries(secrets).reduce((acc, [key, value]) => {
      if (!value) return acc;
      if (typeof value === "object" && "id" in value) {
        acc[key] = { id: Number(value.id) };
      } else {
        acc[key] = { id: Number(value) };
      }
      return acc;
    }, {} as Record<string, { id: number }>);
  } catch {
    return {};
  }
}
