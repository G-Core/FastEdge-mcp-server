interface PaginationDefaults {
  defaultLimit: number;
  maxLimit: number;
}

/**
 * Access-control tier for a product. Method classification:
 *   read-only          → GET / HEAD / OPTIONS
 *   read-write         → + POST / PUT / PATCH (create + modify, no destroy)
 *   read-write-destroy → + DELETE (full CRUD)
 */
export type AccessPolicy = "read-only" | "read-write" | "read-write-destroy";

export type WriteMethod = "POST" | "PUT" | "PATCH" | "DELETE";

export interface AllowedPathOverride {
  method: WriteMethod;
  /** OpenAPI path template, including the /${productKey} prefix as emitted by generate-schemas.ts. */
  path: string;
}

export interface ProductConfig {
  /** Path appended to SPEC_BASE_URL, e.g. "/fastedge/docs/openapi.yaml" */
  specPath: string;
  pagination?: PaginationDefaults;
  /** Human-written notes baked into generated schema output */
  notes?: string[];
  /** OpenAPI tags to exclude from generation */
  excludeTags?: string[];
  /** Override the default per-call timeout (ms) for this product's endpoints. Falls back to api-client default when unset. */
  timeout_ms?: number;

  /**
   * Default access tier for every endpoint in this product.
   * Falls back to "read-only" — closed by default — when omitted.
   */
  policy?: AccessPolicy;
  /**
   * OpenAPI tags whose endpoints are promoted to "read-write" even when the
   * product policy is "read-only". Forward-compatible: new endpoints upstream
   * inherit the elevated tier on next schema regeneration. Does NOT enable
   * DELETE; use allowedPaths for surgical destroy exceptions.
   */
  writableTags?: string[];
  /**
   * Surgical per-endpoint exceptions. Method is explicit, so an entry can
   * authorise any write method (including DELETE). Wins over policy + tag rules.
   * Path must match the OpenAPI template exactly as emitted by the generator.
   */
  allowedPaths?: AllowedPathOverride[];

  /*
   * Deliberately deferred extensions (record of design intent for future agents):
   *
   *   destructiveTags?: string[]
   *     Promote a tag to read-write-destroy (DELETE allowed within the tag).
   *     Skipped in v1 — no current product needs tag-level destroy carve-outs.
   *     Single-endpoint DELETE exceptions are expressible via allowedPaths.
   *
   *   forbiddenPaths?: AllowedPathOverride[]
   *     Denylist that wins over every allow rule. Useful for action-style POSTs
   *     that are destructive in spirit (e.g. POST /…/{id}:purge) when the
   *     containing product is otherwise read-write. Add when a real case
   *     appears; until then, simply omit such ops from allowedPaths.
   *
   *   allowedMethods?: HttpMethod[]
   *     Per-product method allowlist for finer control than the three tiers
   *     (e.g. "POST yes, PATCH no"). No use case yet.
   */
}

const defaultPagination: PaginationDefaults = {
  defaultLimit: 50,
  maxLimit: 200,
};

export const products: Record<string, ProductConfig> = {
  fastedge: {
    specPath: "/fastedge/docs/openapi.yaml",
    pagination: { ...defaultPagination },
    notes: [
      "Binary uploads (POST /binaries/raw) use application/octet-stream, not JSON",
      "App status codes: 0=draft, 1=enabled, 2=disabled, 3=hourly limit, 4=daily limit, 5=suspended",
    ],
    excludeTags: [],
    policy: "read-write-destroy",
  },
  cdn: {
    specPath: "/cdn/docs/openapi.yaml",
    pagination: { ...defaultPagination },
    notes: [],
    excludeTags: ["internal"],
    policy: "read-only",
    writableTags: ["cdn-rules", "cdn-rule-templates"],
    allowedPaths: [
      { method: "PATCH", path: "/cdn/resources/{resource_id}" },
      { method: "PUT",   path: "/cdn/resources/{resource_id}" },
    ],
  },
  dns: {
    specPath: "/dns/docs/openapi.yaml",
    pagination: { ...defaultPagination },
    notes: [],
    excludeTags: [],
    policy: "read-only",
    allowedPaths: [
      { method: "POST", path: "/dns/v2/zones/{zoneName}/{rrsetName}/{rrsetType}" },
      { method: "PUT",  path: "/dns/v2/zones/{zoneName}/{rrsetName}/{rrsetType}" },
    ],
  },
  waap: {
    specPath: "/waap/docs/openapi.yaml",
    pagination: { ...defaultPagination },
    notes: [],
    excludeTags: [],
    policy: "read-only",
  },
  storage: {
    specPath: "/storage/docs/openapi.yaml",
    pagination: { ...defaultPagination },
    notes: [],
    excludeTags: [],
    policy: "read-only",
  },
};

/** Products to generate schemas for in the current build */
export const enabledForGeneration: string[] = ["fastedge", "cdn", "dns", "waap", "storage"];
