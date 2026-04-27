import type { ProductConfig } from "../config/products.js";

const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Decide whether a single OpenAPI operation should be exposed under the given
 * product's policy. Used at schema-generation time (to strip forbidden ops from
 * the generated schemas) AND as the source of truth for the runtime allowlist.
 *
 * Precedence: read methods → product policy → tag exception → path override.
 * Path overrides win over everything (including DELETE), enabling surgical
 * carve-outs through any tier.
 */
export function isOperationAllowed(
  method: string,
  pathTemplate: string,
  tags: ReadonlyArray<string>,
  config: ProductConfig,
): boolean {
  const upper = method.toUpperCase();

  if (READ_METHODS.has(upper)) return true;

  const productLevel = config.policy ?? "read-only";
  const isDestroy = upper === "DELETE";

  if (isDestroy) {
    if (productLevel === "read-write-destroy") return true;
  } else {
    if (productLevel === "read-write" || productLevel === "read-write-destroy") {
      return true;
    }
    if (config.writableTags && config.writableTags.length > 0) {
      const writable = new Set(config.writableTags);
      if (tags.some((t) => writable.has(t))) return true;
    }
  }

  if (config.allowedPaths && config.allowedPaths.length > 0) {
    for (const entry of config.allowedPaths) {
      if (entry.method === upper && entry.path === pathTemplate) return true;
    }
  }

  return false;
}
