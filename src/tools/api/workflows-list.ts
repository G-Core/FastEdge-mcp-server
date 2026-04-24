import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { workflows } from "../../workflows/registry.js";

interface ToolResponse {
  [x: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
}

export const workflowDomains = [
  ...new Set(Object.values(workflows).map((w) => w.domain)),
].sort();

export async function workflowsListHandler({
  domain,
}: {
  domain?: string;
}): Promise<ToolResponse> {
  const filtered = Object.values(workflows)
    .filter((w) => !domain || w.domain === domain)
    .sort((a, b) => a.name.localeCompare(b.name));

  const result = filtered.map((w) => ({
    name: w.name,
    domain: w.domain,
    description: w.description,
    params: w.params,
    template: w.steps.map((s) => ({
      method: s.method,
      path: s.path,
      ...(s.query ? { query: s.query } : {}),
      ...(s.body !== undefined ? { body: s.body } : {}),
      ...(s.as ? { as: s.as } : {}),
      ...(s.content_type ? { content_type: s.content_type } : {}),
      description: s.description,
    })),
    notes: w.notes,
  }));

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}

export function registerWorkflowsListTool(server: McpServer) {
  server.registerTool(
    "workflows_list",
    {
      title: "List Workflows",
      description:
        `Discover available multi-step API workflows. Returns batch_execute-compatible templates. ` +
        `Available domains: ${workflowDomains.join(", ")}. ` +
        `Use the returned template with batch_execute — replace {{params.X}} placeholders with actual values.`,
      inputSchema: {
        domain: z
          .string()
          .optional()
          .describe(`Filter by domain: ${workflowDomains.join(", ")}`),
      },
    },
    async ({ domain }) => workflowsListHandler({ domain }),
  );
}
