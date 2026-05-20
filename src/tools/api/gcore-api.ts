import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  callGcoreApi,
  type ApiCallOptions,
  type ApiCallResult,
} from "../../api-client.js";
import { checkAllowed } from "../../policy/enforce.js";

export interface GcoreApiInput {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
}

interface ToolResponse {
  [x: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
}

export async function gcoreApiHandler(
  { method, path, query, body }: GcoreApiInput,
  apiCaller: (opts: ApiCallOptions) => Promise<ApiCallResult> = callGcoreApi,
): Promise<ToolResponse> {
  const denial = checkAllowed(method, path);
  if (denial) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: "policy_denied",
              method,
              path,
              reason: denial.reason,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  const result = await apiCaller({ method, path, query, body });
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}

/**
 * Body must be a JSON object or array — never a JSON-encoded string. The MCP
 * transport already serializes the structured input on the wire; pre-stringifying
 * the body produces a JSON-quoted string on the outbound HTTP request, which the
 * Gcore gateway's OpenAPI validator rejects with "value must be an object".
 * `api-client.ts:serializeBody` has a safety net that parses string bodies, but
 * this schema rejects them up front for a clearer error path.
 */
export const gcoreApiBodySchema = z
  .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
  .optional()
  .describe(
    "Request body. MUST be a JSON object or array (never a JSON-encoded string). Example: { name: 'foo', binary: 123 }. The MCP layer serializes it before sending; pre-stringifying causes the Gcore gateway to reject with 'value must be an object'.",
  );

export function registerGcoreApiTool(server: McpServer) {
  server.registerTool(
    "gcore_api",
    {
      title: "Gcore API",
      description:
        "Execute any Gcore API call. Use describe_api first to understand available endpoints and their parameter types.",
      inputSchema: {
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        path: z.string().describe("API path, e.g. /fastedge/v1/apps"),
        query: z
          .record(z.string(), z.string())
          .optional()
          .describe("Query parameters"),
        body: gcoreApiBodySchema,
      },
    },
    async (input) => gcoreApiHandler(input as GcoreApiInput),
  );
}
