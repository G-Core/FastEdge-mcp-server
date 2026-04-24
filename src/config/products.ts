interface PaginationDefaults {
  defaultLimit: number;
  maxLimit: number;
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
  },
  cdn: {
    specPath: "/cdn/docs/openapi.yaml",
    pagination: { ...defaultPagination },
    notes: [],
    excludeTags: ["internal"],
  },
  dns: {
    specPath: "/dns/docs/openapi.yaml",
    pagination: { ...defaultPagination },
    notes: [],
    excludeTags: [],
  },
  waap: {
    specPath: "/waap/docs/openapi.yaml",
    pagination: { ...defaultPagination },
    notes: [],
    excludeTags: [],
  },
  storage: {
    specPath: "/storage/docs/openapi.yaml",
    pagination: { ...defaultPagination },
    notes: [],
    excludeTags: [],
  },
};

/** Products to generate schemas for in the current build */
export const enabledForGeneration: string[] = ["fastedge", "cdn", "dns", "waap", "storage"];
