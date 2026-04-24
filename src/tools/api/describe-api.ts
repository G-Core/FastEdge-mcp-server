import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { schemaGroups, schemas, type SchemaGroup } from "../../generated/schemas.js";

interface ToolResponse {
  [x: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
}

export function getSchema(group: string): string | null {
  if (!schemaGroups.includes(group as SchemaGroup)) return null;
  return schemas[group as SchemaGroup] ?? null;
}

export async function describeApiHandler({
  group,
}: {
  group: string;
}): Promise<ToolResponse> {
  const schema = getSchema(group);
  if (!schema) {
    return {
      content: [{ type: "text", text: `Unknown group: ${group}` }],
    };
  }
  return {
    content: [{ type: "text", text: schema }],
  };
}

export function registerDescribeApiTool(server: McpServer) {
  server.registerTool(
    "describe_api",
    {
      title: "Describe Gcore API",
      description:
        "Get TypeScript type definitions and endpoint documentation for a Gcore API resource group. Call this before using gcore_api to understand available endpoints and their parameters.",
      inputSchema: {
        group: z
          .enum(schemaGroups as unknown as [string, ...string[]])
          .describe(
            `API resource group to describe. Available: ${schemaGroups.join(", ")}`,
          ),
      },
    },
    async ({ group }) => describeApiHandler({ group }),
  );
}
