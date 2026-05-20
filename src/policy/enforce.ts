import { ALLOWED_OPS, type AllowedOp } from "../generated/policy.js";

export interface PolicyDenial {
  reason: string;
}

/**
 * Match a concrete request path (e.g. "/cdn/resources/123/options?x=1")
 * against an OpenAPI path template (e.g. "/cdn/resources/{resource_id}/options").
 *
 * Rules:
 *   - Querystring is stripped before comparison.
 *   - Trailing slashes are ignored.
 *   - Each template segment is either a literal (must equal exactly) or a
 *     {param} placeholder (matches any single non-empty segment).
 *   - Segment counts must match: templates do not implicitly match deeper paths.
 */
export function matchTemplate(template: string, concretePath: string): boolean {
  const stripped = concretePath.split(/[?#]/, 1)[0] ?? "";

  const tParts = trimSlashes(template).split("/");
  const cParts = trimSlashes(stripped).split("/");

  if (tParts.length !== cParts.length) return false;

  for (let i = 0; i < tParts.length; i++) {
    const t = tParts[i];
    const c = cParts[i];
    if (t.startsWith("{") && t.endsWith("}")) {
      if (c.length === 0) return false;
      continue;
    }
    if (t !== c) return false;
  }
  return true;
}

function trimSlashes(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && s.charCodeAt(start) === 47) start++;        // "/"
  while (end > start && s.charCodeAt(end - 1) === 47) end--;
  return s.slice(start, end);
}

/**
 * Decide whether a runtime API call is permitted by the baked-in policy.
 * Closed by default: returns a denial if no allowlist entry matches.
 */
export function checkAllowed(
  method: string,
  path: string,
  allowedOps: ReadonlyArray<AllowedOp> = ALLOWED_OPS,
): PolicyDenial | null {
  const upper = method.toUpperCase();
  for (const entry of allowedOps) {
    if (entry.method !== upper) continue;
    if (matchTemplate(entry.path, path)) return null;
  }
  return {
    reason:
      `Operation ${upper} ${path} is not permitted by this MCP server's access policy. ` +
      `Use describe_api to see available read/write endpoints, or contact the operator if you believe this should be allowed.`,
  };
}
