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
  const stripped = normalizePath(concretePath);
  if (stripped === null) return false;

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

/**
 * Strip the querystring and collapse `.` / `..` segments so the policy match
 * sees the same path the Gcore gateway will route on — `new URL()` in
 * api-client.ts normalizes traversal, so matching the raw string would let
 * "/fastedge/v1/apps/../../../cdn/origin_groups" past the allowlist.
 *
 * Returns null (→ denial) for anything we can't normalize confidently:
 *
 *   - not an absolute-path reference starting with exactly one "/". Anything
 *     else changes the *authority* once api-client.ts concatenates it onto the
 *     base: "@evil.example/../fastedge/v1/apps" normalizes to an allowed path
 *     here, but `new URL("https://api.gcore.com" + p)` parses "api.gcore.com"
 *     as userinfo and sends the operator's API key to evil.example. Same for
 *     "//evil.com/x" (protocol-relative) and bare relative paths.
 *   - backslashes, which WHATWG URL parsing folds into "/" — the normalized
 *     view would differ from the path actually requested.
 *   - percent-encoded dots or slashes, which the gateway may decode into
 *     traversal after we've matched.
 */
export function normalizePath(path: string): string | null {
  // WHATWG URL parsing removes TAB/LF/CR anywhere in the input, so strip them
  // FIRST and run every check on the cleaned string. Otherwise "..%<LF>2f.."
  // reads as harmless here but reaches the gateway as "..%2f..", and
  // "/<LF>/evil.example/x" passes a leading-slash check on the raw input while
  // cleaning into a protocol-relative "//evil.example/x". Any other control
  // character is percent-encoded (or trimmed, when trailing) by the parser; no
  // legitimate Gcore path carries one, so deny rather than reason about it.
  const cleaned = path.replace(/[\t\n\r]/g, "");
  if (/[\u0000-\u001f\u007f]/.test(cleaned)) return null;
  if (!/^\/(?!\/)/.test(cleaned)) return null;
  if (cleaned.includes("\\")) return null;

  // Let the parser split the query/fragment: hand-splitting on "?" first makes
  // a preceding space *trailing* input, which the parser trims here but
  // percent-encodes on the outbound URL — a checked path unequal to the sent one.
  let pathname: string;
  try {
    pathname = new URL(cleaned, "http://policy.invalid").pathname;
  } catch {
    return null;
  }
  if (/%2e|%2f/i.test(pathname)) return null;
  return pathname;
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
