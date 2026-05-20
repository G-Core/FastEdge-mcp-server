import { products } from "./config/products.js";
import { GCORE_API_BASE as BAKED_GCORE_API_BASE } from "./generated/config.js";

/**
 * Runtime-resolved Gcore API base URL. Override the baked-in constant via
 * GCORE_API_BASE env var (e.g. for in-house devs pointing a prod-schemas
 * image at preprod endpoints).
 */
export const GCORE_API_BASE =
  process.env.GCORE_API_BASE || BAKED_GCORE_API_BASE;

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

export async function callGcoreApi(
  opts: ApiCallOptions,
): Promise<ApiCallResult> {
  const authorization =
    opts.authHeader ??
    (process.env.GCORE_API_KEY
      ? `APIKey ${process.env.GCORE_API_KEY}`
      : null);
  if (!authorization) {
    return {
      status: 0,
      data: {
        error:
          "No authorization provided. Set GCORE_API_KEY env var or pass an Authorization header.",
      },
    };
  }

  const url = new URL(`${GCORE_API_BASE}${opts.path}`);
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
    });

    let data: unknown;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
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
