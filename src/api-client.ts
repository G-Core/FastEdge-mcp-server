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

  let body: string | undefined;
  if (opts.body !== undefined && opts.body !== null) {
    const ct = opts.contentType ?? "application/json";
    headers["Content-Type"] = ct;
    body =
      ct === "application/json" ? JSON.stringify(opts.body) : String(opts.body);
  }

  const timeoutMs = resolveTimeoutMs(opts.path);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url.toString(), {
      method: opts.method,
      headers,
      body,
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
