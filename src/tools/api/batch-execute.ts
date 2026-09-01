import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  callGcoreApi,
  resolveTimeoutMs,
  type ApiCallOptions,
  type ApiCallResult,
} from "../../api-client.js";
import { checkAllowed } from "../../policy/enforce.js";

export const BATCH_TOTAL_CAP_MS = 180_000;
export const BATCH_MAX_CALLS_DEFAULT = 5;

export function resolveRefs(
  value: unknown,
  results: Record<string, unknown>,
): unknown {
  if (typeof value === "string") {
    return value.replace(
      /\$([a-zA-Z_]\w*)\.([a-zA-Z_][\w.]*)/g,
      (_match, name, dotPath) => {
        const root = results[name];
        if (root === undefined) return _match;
        const parts = (dotPath as string).split(".");
        let current: unknown = root;
        for (const part of parts) {
          if (current === null || current === undefined) return _match;
          if (typeof current === "object") {
            current = (current as Record<string, unknown>)[part];
          } else {
            return _match;
          }
        }
        if (value === `$${name}.${dotPath}`) {
          return String(current);
        }
        return String(current);
      },
    );
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveRefs(item, results));
  }

  if (value !== null && typeof value === "object") {
    const resolved: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      resolved[key] = resolveRefs(val, results);
    }
    return resolved;
  }

  return value;
}

/**
 * Like resolveRefs but preserves non-string types when the entire value
 * is a single reference (e.g. body: { "binary": "$binary.id" } → number).
 */
export function resolveRefsTyped(
  value: unknown,
  results: Record<string, unknown>,
): unknown {
  if (typeof value === "string") {
    const singleRefMatch = value.match(/^\$([a-zA-Z_]\w*)\.([a-zA-Z_][\w.]*)$/);
    if (singleRefMatch) {
      const [, name, dotPath] = singleRefMatch;
      const root = results[name];
      if (root === undefined) return value;
      const parts = dotPath.split(".");
      let current: unknown = root;
      for (const part of parts) {
        if (current === null || current === undefined) return value;
        if (typeof current === "object") {
          current = (current as Record<string, unknown>)[part];
        } else {
          return value;
        }
      }
      return current;
    }
    return resolveRefs(value, results);
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveRefsTyped(item, results));
  }

  if (value !== null && typeof value === "object") {
    const resolved: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      resolved[key] = resolveRefsTyped(val, results);
    }
    return resolved;
  }

  return value;
}

export interface BatchCall {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  as?: string;
  content_type?: string;
  description?: string;
}

interface ToolResponse {
  [x: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
}

function textResult(text: string): ToolResponse {
  return { content: [{ type: "text", text }] };
}

export async function batchExecuteHandler(
  { calls }: { calls: BatchCall[] },
  apiCaller: (opts: ApiCallOptions) => Promise<ApiCallResult> = callGcoreApi,
): Promise<ToolResponse> {
  const maxCallsStr = process.env.BATCH_MAX_CALLS ?? String(BATCH_MAX_CALLS_DEFAULT);
  const maxCalls = Math.max(1, parseInt(maxCallsStr, 10) || BATCH_MAX_CALLS_DEFAULT);

  if (calls.length > maxCalls) {
    return textResult(
      JSON.stringify({
        error: `Batch limited to ${maxCalls} calls (BATCH_MAX_CALLS). Got ${calls.length}.`,
      }),
    );
  }

  const stepTimeouts = calls.map((c) => resolveTimeoutMs(c.path));
  const totalBudget = stepTimeouts.reduce((a, b) => a + b, 0);

  if (totalBudget > BATCH_TOTAL_CAP_MS) {
    return textResult(
      JSON.stringify({
        error: `Batch total budget (${totalBudget}ms) exceeds maximum ${BATCH_TOTAL_CAP_MS}ms. Reduce step count or split into smaller batches.`,
        step_timeouts_ms: stepTimeouts,
      }),
    );
  }

  const policyDenials: Array<{ step: number; method: string; path: string; reason: string }> = [];
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    const denial = checkAllowed(call.method, call.path);
    if (denial) {
      policyDenials.push({
        step: i + 1,
        method: call.method,
        path: call.path,
        reason: denial.reason,
      });
    }
  }
  if (policyDenials.length > 0) {
    return textResult(
      JSON.stringify(
        {
          error: "policy_denied",
          message:
            "Batch is atomic: one or more steps are not permitted by this MCP server's access policy. No steps were executed.",
          denied_steps: policyDenials,
        },
        null,
        2,
      ),
    );
  }

  const batchStart = Date.now();

  const results: Record<string, unknown> = {};
  const completed: Array<{
    step: number;
    description?: string;
    status: number;
    data: unknown;
    as?: string;
  }> = [];

  for (let i = 0; i < calls.length; i++) {
    const elapsed = Date.now() - batchStart;
    if (elapsed > totalBudget) {
      return textResult(
        JSON.stringify(
          {
            error: `Batch exceeded total budget of ${totalBudget}ms (elapsed ${elapsed}ms before step ${i + 1}).`,
            completed,
          },
          null,
          2,
        ),
      );
    }

    const call = calls[i];
    const resolvedPath = resolveRefs(call.path, results) as string;
    const resolvedQuery = call.query
      ? (resolveRefs(call.query, results) as Record<string, string>)
      : undefined;
    const resolvedBody =
      call.body !== undefined
        ? resolveRefsTyped(call.body, results)
        : undefined;

    // Re-check the *resolved* path: the pre-flight check above ran on the
    // template, where "$name.field" is a single opaque segment. A prior step's
    // data is untrusted (it can carry "/" or ".."), so the concrete path has to
    // clear the allowlist again before it goes out with the operator's API key.
    const resolvedDenial = checkAllowed(call.method, resolvedPath);
    if (resolvedDenial) {
      return textResult(
        JSON.stringify(
          {
            error: "policy_denied",
            message: `Step ${i + 1} resolved to a path that is not permitted by this MCP server's access policy.`,
            denied_steps: [
              {
                step: i + 1,
                method: call.method,
                path: resolvedPath,
                template_path: call.path,
                resolved_path: resolvedPath,
                reason: resolvedDenial.reason,
              },
            ],
            completed,
          },
          null,
          2,
        ),
      );
    }

    const result = await apiCaller({
      method: call.method,
      path: resolvedPath,
      query: resolvedQuery,
      body: resolvedBody,
      contentType: call.content_type,
    });

    const stepResult = {
      step: i + 1,
      description: call.description,
      status: result.status,
      data: result.data,
      as: call.as,
    };

    if (result.status >= 400) {
      return textResult(
        JSON.stringify(
          {
            error: `Step ${i + 1} failed: ${result.status}`,
            completed,
            failed: stepResult,
          },
          null,
          2,
        ),
      );
    }

    if (call.as) {
      results[call.as] = result.data;
    }

    completed.push(stepResult);
  }

  return textResult(JSON.stringify(completed, null, 2));
}

export const batchCallSchema = z
  .object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    path: z.string(),
    query: z.record(z.string(), z.string()).optional(),
    body: z
      .any()
      .optional()
      .describe(
        "Request body. For application/json calls (default), a JSON object or array — never a JSON-encoded string. For binary uploads, a raw string with content_type set to application/octet-stream. Use $name.field references for values produced by an earlier call (e.g. { binary: '$binary.id' }).",
      ),
    as: z
      .string()
      .optional()
      .describe("Name this result for use in later calls via $name.field syntax"),
    content_type: z
      .string()
      .optional()
      .describe(
        "Override Content-Type header (default: application/json). Use application/octet-stream for binary uploads.",
      ),
    description: z
      .string()
      .optional()
      .describe("Human-readable step description"),
  })
  .superRefine((call, ctx) => {
    // String body is valid only when an explicit non-JSON content_type override
    // is set (e.g. application/octet-stream for binary uploads). A string body
    // on the default JSON path produces a JSON-quoted string on the wire and
    // the Gcore gateway rejects it with "value must be an object". The L2
    // safety net in api-client.ts parse-and-reserializes valid JSON strings,
    // but rejecting at the schema layer surfaces the contract violation
    // immediately with a clearer message.
    if (typeof call.body !== "string") return;
    const ct = call.content_type ?? "application/json";
    if (ct === "application/json") {
      ctx.addIssue({
        code: "custom",
        message:
          "Body for application/json calls must be a JSON object or array, not a JSON-encoded string. If you intend to send a raw string body (e.g. a binary upload), set content_type to application/octet-stream.",
        path: ["body"],
      });
    }
  });

export function registerBatchExecuteTool(server: McpServer, gcoreApiKey: string) {
  const authedCaller = (opts: ApiCallOptions) =>
    callGcoreApi({ ...opts, authHeader: `APIKey ${gcoreApiKey}` });
  server.registerTool(
    "batch_execute",
    {
      title: "Batch Execute",
      description:
        "Execute multiple sequential Gcore API calls. Results from earlier calls can be referenced in later calls using $name.path syntax (e.g. $binary.id). Use workflows_list to discover pre-built call templates. Max calls controlled by BATCH_MAX_CALLS env var (default: 5). Total batch runtime is capped at 3 minutes (sum of per-product timeouts).",
      inputSchema: {
        calls: z.array(batchCallSchema),
      },
    },
    async ({ calls }) => batchExecuteHandler({ calls: calls as BatchCall[] }, authedCaller),
  );
}
