import { products } from "./config/products.js";
import { GCORE_API_BASE as BAKED_GCORE_API_BASE } from "./generated/config.js";

/**
 * Runtime-resolved Gcore API base URL. Override the baked-in constant via
 * GCORE_API_BASE env var (e.g. for in-house devs pointing a prod-schemas
 * image at preprod endpoints).
 */
export const GCORE_API_BASE =
  process.env.GCORE_API_BASE || BAKED_GCORE_API_BASE;

/**
 * Origins the API key may be sent to. GCORE_API_BASE comes from the
 * environment, which any MCP config can set (e.g. a cloned repo's
 * `.vscode/mcp.json`) — without this list, a config that looks like ours
 * could point the key at any host. Exact origins only (scheme + host + port),
 * no suffix matching, so `http://`, look-alike hosts and odd ports are all
 * rejected. The baked-in base is checked too, not trusted: a build with any
 * other SPEC_BASE_URL fails at startup. Adding a host is a code change and an
 * image release by design — never make this list configurable at runtime.
 */
export const ALLOWED_API_ORIGINS: ReadonlySet<string> = new Set([
  "https://api.gcore.com",
  "https://api.preprod.world",
  "https://api.cdb-staging.cdn.orange.com",
  "https://api.controlcenter.internationalcarriers.orange.com",
]);

/** Origin of `base` if it parses and is on the allowlist, otherwise null. */
export function allowedApiOrigin(base: string): string | null {
  try {
    const url = new URL(base);
    // blob:https://host inherits that origin, so origin alone isn't enough.
    if (url.protocol !== "https:") return null;
    // userinfo would ride along with every request, next to the key.
    if (url.username || url.password) return null;
    return ALLOWED_API_ORIGINS.has(url.origin) ? url.origin : null;
  } catch {
    return null;
  }
}

// Validate the base URL at startup so a misconfigured or hostile
// GCORE_API_BASE fails fast, before any request can carry the key.
const resolvedOrigin = allowedApiOrigin(GCORE_API_BASE);
if (!resolvedOrigin) {
  console.error(
    `Fatal: GCORE_API_BASE "${GCORE_API_BASE}" is not an allowed Gcore API URL (allowed: ${[...ALLOWED_API_ORIGINS].join(", ")}). Unset it to use the default.`,
  );
  process.exit(1);
}
export const GCORE_API_ORIGIN: string = resolvedOrigin;

export const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Resolve the timeout (ms) for a given API path. Uses the per-product
 * `timeout_ms` override from products.ts when the first path segment
 * matches a known product, otherwise falls back to DEFAULT_TIMEOUT_MS.
 */
export function resolveTimeoutMs(path: string): number {
  const firstSegment = path.split("/").filter(Boolean)[0];
  const product = firstSegment ? products[firstSegment] : undefined;
  return product?.timeout_ms ?? DEFAULT_TIMEOUT_MS;
}

export interface ApiCallOptions {
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  authHeader?: string;
  contentType?: string;
}

export interface ApiCallResult {
  status: number;
  data: unknown;
}

/**
 * Serialize a request body for the outbound HTTP call.
 *
 * For `application/json`, JSON-encode objects/arrays normally. If the caller
 * passes a string that parses as JSON, parse-then-re-serialize to avoid
 * double-stringification — callers that hand us pre-serialized JSON (e.g.
 * confused MCP clients emitting body as a JSON-encoded string instead of an
 * object) would otherwise produce an escaped string literal on the wire, and
 * the Gcore gateway's OpenAPI validator rejects that with "value must be an
 * object". If the string isn't valid JSON, pass it through unchanged.
 *
 * For `application/octet-stream`, Uint8Array/Buffer/ArrayBuffer values pass
 * through unchanged; strings are decoded from base64 so the wire body is raw
 * bytes rather than the base64 text representation.
 *
 * For all other content types, coerce to string.
 */
export function serializeBody(
  body: unknown,
  contentType: string,
): string | Uint8Array | undefined {
  if (body === undefined || body === null) return undefined;
  // Raw bytes are already the wire body (upload-binary, and every body relayed by the token broker).
  if (body instanceof Uint8Array) return body;
  if (contentType === "application/json") {
    if (typeof body === "string") {
      try {
        return JSON.stringify(JSON.parse(body));
      } catch {
        return body;
      }
    }
    return JSON.stringify(body);
  }
  if (contentType === "application/octet-stream") {
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (typeof body === "string") return Buffer.from(body, "base64");
  }
  return String(body);
}

/**
 * Extra limits the token broker applies to session-token requests (fastedge-coordinator
 * PROTOCOL.md §2a). Explicit-key calls don't use them.
 */
export interface TransportLimits {
  /** Return 3xx as an error instead of following it (a same-origin redirect would keep the token). */
  manualRedirect?: boolean;
  /** Cap on the response body; larger responses become an error. */
  maxResponseBytes?: number;
}

/** Reads the body, failing once it exceeds `max` bytes rather than buffering it all. */
async function readCapped(response: Response, max: number): Promise<Buffer | null> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > max) {
    await response.body?.cancel();
    return null;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body ?? []) {
    total += chunk.byteLength;
    if (total > max) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function callGcoreApi(
  opts: ApiCallOptions,
  limits: TransportLimits = {},
): Promise<ApiCallResult> {
  const authorization = opts.authHeader ?? null;
  if (!authorization) {
    return {
      status: 0,
      data: {
        error:
          "No authorization provided. Set GCORE_API_KEY (or FASTEDGE_API_KEY) in your environment.",
      },
    };
  }

  // Last line of defence: the Authorization header carries the operator's API
  // key, so it must only ever leave for the configured Gcore origin. A path
  // that manipulates the authority once concatenated (e.g. "@evil.example/...",
  // which WHATWG URL parsing reads as userinfo) would otherwise send the key to
  // an attacker-controlled host. The policy layer rejects these too; this guard
  // does not depend on it.
  let url: URL;
  try {
    url = new URL(`${GCORE_API_BASE}${opts.path}`);
  } catch {
    return { status: 0, data: { error: `Invalid API path: ${opts.path}` } };
  }
  if (url.origin !== GCORE_API_ORIGIN) {
    return {
      status: 0,
      data: {
        error: `Refusing to send an authenticated request to ${url.origin}: path "${opts.path}" escapes the configured Gcore API base ${GCORE_API_BASE}.`,
      },
    };
  }
  if (opts.query) {
    for (const [key, value] of Object.entries(opts.query)) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {
    Authorization: authorization,
  };

  let body: string | Uint8Array | undefined;
  if (opts.body !== undefined && opts.body !== null) {
    const ct = opts.contentType ?? "application/json";
    headers["Content-Type"] = ct;
    body = serializeBody(opts.body, ct);
  }

  const timeoutMs = resolveTimeoutMs(opts.path);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url.toString(), {
      method: opts.method,
      headers,
      // Uint8Array is valid BodyInit in Node 18+ but missing from @types/node fetch overloads
      body: body as BodyInit | undefined,
      signal: controller.signal,
      ...(limits.manualRedirect ? { redirect: "manual" as const } : {}),
    });

    if (limits.manualRedirect && response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      return { status: 0, data: { error: `The API answered ${response.status} (a redirect), which is not followed.` } };
    }

    let data: unknown;
    const contentType = response.headers.get("content-type") ?? "";
    if (limits.maxResponseBytes !== undefined) {
      const bytes = await readCapped(response, limits.maxResponseBytes);
      if (!bytes) {
        return { status: 0, data: { error: `The API response is larger than ${limits.maxResponseBytes} bytes.` } };
      }
      const text = bytes.toString("utf8");
      data = contentType.includes("application/json") ? JSON.parse(text) : text.length > 0 ? text : null;
    } else if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      const text = await response.text();
      data = text.length > 0 ? text : null;
    }

    return { status: response.status, data };
  } catch (err) {
    if (controller.signal.aborted) {
      return {
        status: 0,
        data: {
          error: `Request timed out after ${timeoutMs}ms`,
          timeout: true,
          path: opts.path,
          timeout_ms: timeoutMs,
        },
      };
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
