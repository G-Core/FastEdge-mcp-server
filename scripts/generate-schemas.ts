#!/usr/bin/env tsx
/**
 * Schema generator — fetches OpenAPI specs and produces LLM-readable schema files.
 *
 * Usage: SPEC_BASE_URL=https://api.gcore.com tsx scripts/generate-schemas.ts
 *
 * Reads: src/config/products.ts (product registry)
 * Writes: src/generated/schemas.ts, src/generated/config.ts
 */

import SwaggerParser from "@apidevtools/swagger-parser";
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import {
  products,
  enabledForGeneration,
  type ProductConfig,
} from "../src/config/products.js";
import { isOperationAllowed } from "../src/policy/evaluate.js";

const SPEC_BASE_URL = process.env.SPEC_BASE_URL;
if (!SPEC_BASE_URL) {
  console.error(
    "Error: SPEC_BASE_URL environment variable is required.\n" +
      "Example: SPEC_BASE_URL=https://api.gcore.com tsx scripts/generate-schemas.ts",
  );
  process.exit(1);
}

// ── Types ────────────────────────────────────────────────────────────────────

interface OpenAPISchema {
  type?: string;
  format?: string;
  properties?: Record<string, OpenAPISchema>;
  items?: OpenAPISchema;
  required?: string[];
  enum?: string[];
  readOnly?: boolean;
  writeOnly?: boolean;
  description?: string;
  additionalProperties?: OpenAPISchema | boolean;
  allOf?: OpenAPISchema[];
  oneOf?: OpenAPISchema[];
  anyOf?: OpenAPISchema[];
  nullable?: boolean;
  $ref?: string;
}

interface OpenAPIParam {
  name: string;
  in: string;
  required?: boolean;
  schema?: OpenAPISchema;
  description?: string;
}

interface OpenAPIOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenAPIParam[];
  requestBody?: {
    content?: Record<
      string,
      { schema?: OpenAPISchema }
    >;
    required?: boolean;
  };
  responses?: Record<
    string,
    {
      description?: string;
      content?: Record<string, { schema?: OpenAPISchema }>;
    }
  >;
  deprecated?: boolean;
}

interface CollectedOp {
  method: string;
  path: string;
  op: OpenAPIOperation;
  summary: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert snake_case to PascalCase. Preserves already-PascalCase names. */
function toPascal(s: string): string {
  if (/^[A-Z][a-zA-Z0-9]*$/.test(s)) return s;
  return s
    .split(/[_\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

/** Strip HTML tags and clean up whitespace */
function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Merge allOf schemas into a single flat schema.
 * Handles the common pattern: [base_schema, { required: [...] }]
 */
function mergeAllOf(schemas: OpenAPISchema[]): OpenAPISchema {
  const merged: OpenAPISchema = { type: "object", properties: {}, required: [] };
  for (const s of schemas) {
    if (s.properties) {
      Object.assign(merged.properties!, s.properties);
    }
    if (s.required) {
      merged.required!.push(...s.required);
    }
    if (s.type && s.type !== "object") merged.type = s.type;
  }
  if (merged.required!.length === 0) delete merged.required;
  if (Object.keys(merged.properties!).length === 0) delete merged.properties;
  return merged;
}

/** Map OpenAPI type/format to compact TS-like notation */
function toTsType(schema: OpenAPISchema | undefined): string {
  if (!schema) return "unknown";

  if (schema.enum) {
    return schema.enum.map((v) => `"${v}"`).join(" | ");
  }

  if (schema.allOf) {
    const merged = mergeAllOf(schema.allOf);
    return toTsType(merged);
  }
  if (schema.oneOf || schema.anyOf) {
    const parts = (schema.oneOf || schema.anyOf)!.map((s) => toTsType(s));
    return parts.join(" | ");
  }

  if (schema.type === "array") {
    const itemType = toTsType(schema.items);
    return `${itemType}[]`;
  }

  if (
    schema.type === "object" &&
    schema.additionalProperties &&
    typeof schema.additionalProperties === "object"
  ) {
    return `Record<string, ${toTsType(schema.additionalProperties)}>`;
  }

  if (schema.type === "object" && schema.properties) {
    const entries = Object.entries(schema.properties);
    if (entries.length <= 3) {
      const fields = entries.map(([k, v]) => {
        const opt = schema.required?.includes(k) ? "" : "?";
        return `${k}${opt}: ${toTsType(v)}`;
      });
      return `{ ${fields.join(", ")} }`;
    }
    return "object";
  }

  switch (schema.type) {
    case "string":
      if (schema.format === "date-time") return "datetime";
      if (schema.format === "binary") return "binary";
      return "string";
    case "integer":
    case "number":
      return "int";
    case "boolean":
      return "boolean";
    default:
      return schema.type || "unknown";
  }
}

/** Format a property line for type definitions */
function formatProp(
  name: string,
  schema: OpenAPISchema,
  isRequired: boolean,
): string {
  const opt = isRequired ? "" : "?";
  const type = toTsType(schema);
  const parts: string[] = [];
  if (schema.description) parts.push(stripHtml(schema.description));
  if (schema.format === "int64") parts.push("int64");
  const comment = parts.length > 0 ? `  // ${parts.join(", ")}` : "";
  return `${name}${opt}: ${type}${comment}`;
}

// ── Schema name extraction ───────────────────────────────────────────────────

/**
 * Extract $ref schema names from the raw (unresolved) spec.
 * Returns a map: "METHOD /path body|response" → schema name
 */
function extractRefNames(
  rawPaths: Record<string, Record<string, unknown>>,
): Map<string, string> {
  const map = new Map<string, string>();

  function refName(ref: string): string {
    const parts = ref.split("/");
    return parts[parts.length - 1];
  }

  for (const [path, methods] of Object.entries(rawPaths)) {
    for (const [method, rawOp] of Object.entries(methods as Record<string, any>)) {
      if (typeof rawOp !== "object" || !rawOp) continue;

      const bodySchema =
        rawOp.requestBody?.content?.["application/json"]?.schema;
      if (bodySchema?.$ref) {
        map.set(`${method.toUpperCase()} ${path} body`, refName(bodySchema.$ref));
      }

      for (const [code, resp] of Object.entries(rawOp.responses || {})) {
        if (!code.startsWith("2")) continue;
        const respSchema = (resp as any)?.content?.["application/json"]?.schema;
        if (respSchema?.$ref) {
          map.set(`${method.toUpperCase()} ${path} response`, refName(respSchema.$ref));
        }
        if (respSchema?.properties) {
          for (const [, propVal] of Object.entries(respSchema.properties)) {
            const prop = propVal as any;
            if (prop?.items?.$ref) {
              map.set(
                `${method.toUpperCase()} ${path} response_item`,
                refName(prop.items.$ref),
              );
            }
          }
        }
        if (respSchema?.items?.$ref) {
          map.set(
            `${method.toUpperCase()} ${path} response_item`,
            refName(respSchema.items.$ref),
          );
        }
      }
    }
  }

  return map;
}

// ── Format D output generation ───────────────────────────────────────────────

function generateSchemaText(
  productKey: string,
  tag: string,
  ops: CollectedOp[],
  refNames: Map<string, string>,
  config: ProductConfig,
): string {
  const lines: string[] = [];
  const typeDefs: Map<string, string> = new Map();

  lines.push(
    `| Operation | Method + Path | Body | Response |`,
    `|-----------|---------------|------|----------|`,
  );

  for (const { method, path, op, summary } of ops) {
    const deprecated = op.deprecated ? " (DEPRECATED)" : "";
    const opName = summary + deprecated;

    let bodyLabel = "—";
    const bodySchema =
      op.requestBody?.content?.["application/json"]?.schema ??
      op.requestBody?.content?.["application/octet-stream"]?.schema;
    const isOctetStream = !!op.requestBody?.content?.["application/octet-stream"];

    if (isOctetStream) {
      bodyLabel = "binary (application/octet-stream)";
    } else if (bodySchema) {
      const refKey = `${method} ${path.replace(`/${productKey}`, "")} body`;
      const rawName = refNames.get(refKey);
      if (rawName) {
        const typeName = getBodyTypeName(method, rawName, tag);
        bodyLabel = typeName;
        const def = renderRequestType(typeName, bodySchema);
        if (def) typeDefs.set(typeName, def);
      } else {
        bodyLabel = renderInlineBody(bodySchema);
      }
    }

    let respLabel = "204";
    const successResp = op.responses?.["200"] || op.responses?.["201"];
    const respSchema =
      successResp?.content?.["application/json"]?.schema;
    if (respSchema) {
      const respRefKey = `${method} ${path.replace(`/${productKey}`, "")} response`;
      const itemRefKey = `${method} ${path.replace(`/${productKey}`, "")} response_item`;
      const rawRespName = refNames.get(respRefKey);
      const rawItemName = refNames.get(itemRefKey);

      if (respSchema.type === "array" && rawItemName) {
        const typeName = toPascal(rawItemName);
        respLabel = `${typeName}[]`;
        const itemSchema = respSchema.items;
        if (itemSchema) {
          const def = renderResponseType(typeName, itemSchema);
          if (def) typeDefs.set(typeName, def);
        }
      } else if (
        respSchema.type === "object" &&
        respSchema.properties &&
        rawItemName
      ) {
        const typeName = toPascal(rawItemName);
        const scalarFields = Object.entries(respSchema.properties)
          .filter(([, v]) => (v as OpenAPISchema).type !== "array")
          .map(([k, v]) => `${k}: ${toTsType(v as OpenAPISchema)}`);
        const arrayField = `${findArrayFieldName(respSchema)}: ${typeName}[]`;
        const allFields = [...scalarFields, arrayField].join(", ");
        respLabel = `{ ${allFields} }`;
        const itemSchema = findArrayItemSchema(respSchema);
        if (itemSchema) {
          const def = renderResponseType(typeName, itemSchema);
          if (def) typeDefs.set(typeName, def);
        }
      } else if (rawRespName) {
        const typeName = toPascal(rawRespName);
        respLabel = typeName;
        const def = renderResponseType(typeName, respSchema);
        if (def) typeDefs.set(typeName, def);
      } else {
        respLabel = renderInlineResponse(respSchema);
      }
    }

    lines.push(
      `| ${opName} | \`${method} ${path}\` | ${bodyLabel} | \`${respLabel}\` |`,
    );
  }

  lines.push("");

  for (const { method, path, op } of ops) {
    const queryParams = (op.parameters || []).filter((p) => p.in === "query");
    if (queryParams.length === 0) continue;

    const shortPath = path.replace(`/${productKey}/v1`, "");
    lines.push(`### Query: ${method} ${shortPath}`);
    const parts = queryParams.map((p) => {
      const type = toTsType(p.schema);
      const rawDesc = p.description
        ? stripHtml(p.description.split("\n")[0])
        : "";
      const desc = rawDesc ? `, ${rawDesc.slice(0, 80)}` : "";
      return `${p.name} (${type}${desc})`;
    });
    lines.push(parts.join(" · "));
    lines.push("");
  }

  if (typeDefs.size > 0) {
    for (const [, def] of typeDefs) {
      lines.push(def);
      lines.push("");
    }
  }

  if (config.notes && config.notes.length > 0) {
    for (const note of config.notes) {
      lines.push(`- ${note}`);
    }
  }

  if (config.pagination) {
    lines.push(
      `- Pagination: default limit ${config.pagination.defaultLimit}, max ${config.pagination.maxLimit}`,
    );
  }

  return lines.join("\n").trim();
}

function getBodyTypeName(
  method: string,
  rawRefName: string,
  _tag: string,
): string {
  const base = toPascal(rawRefName);
  const lower = rawRefName.toLowerCase();

  if (method === "POST") {
    if (lower.startsWith("create") || lower.startsWith("add") || lower.startsWith("new")) {
      return base;
    }
    return `Create${base}`;
  }
  if (method === "PUT") {
    if (lower.startsWith("update") || lower.startsWith("change") || lower.startsWith("modify")) {
      return base;
    }
    return `Update${base}`;
  }
  if (method === "PATCH") {
    if (lower.startsWith("patch")) return `Partial<${base}>`;
    return `Partial<${base}>`;
  }
  return base;
}

function renderRequestType(
  typeName: string,
  schema: OpenAPISchema,
): string | null {
  if (typeName.startsWith("Partial<")) return null;

  const flat = schema.allOf ? mergeAllOf(schema.allOf) : schema;
  if (!flat.properties) return null;

  const fields: string[] = [];
  for (const [name, prop] of Object.entries(flat.properties)) {
    if (prop.readOnly) continue;
    const isRequired = flat.required?.includes(name) ?? false;
    fields.push(formatProp(name, prop, isRequired));
  }

  if (fields.length === 0) return null;
  return `### ${typeName} (request body)\n${fields.join("\n")}`;
}

function renderResponseType(
  typeName: string,
  schema: OpenAPISchema,
): string | null {
  if (!schema.properties) return null;

  const fields: string[] = [];
  for (const [name, prop] of Object.entries(schema.properties)) {
    if (prop.writeOnly) continue;
    const isRequired = schema.required?.includes(name) ?? false;
    fields.push(formatProp(name, prop, isRequired));
  }

  if (fields.length === 0) return null;
  return `### ${typeName} (response)\n${fields.join("\n")}`;
}

function renderInlineBody(schema: OpenAPISchema): string {
  const flat = schema.allOf ? mergeAllOf(schema.allOf) : schema;
  if (!flat.properties) return toTsType(flat);
  const fields = Object.entries(flat.properties)
    .filter(([, v]) => !v.readOnly)
    .map(([k, v]) => {
      const opt = flat.required?.includes(k) ? "" : "?";
      return `${k}${opt}: ${toTsType(v)}`;
    });
  return `{ ${fields.join(", ")} }`;
}

function renderInlineResponse(schema: OpenAPISchema): string {
  if (!schema.properties) return toTsType(schema);
  const fields = Object.entries(schema.properties)
    .filter(([, v]) => !v.writeOnly)
    .map(([k, v]) => {
      const opt = schema.required?.includes(k) ? "" : "?";
      return `${k}${opt}: ${toTsType(v)}`;
    });
  return `{ ${fields.join(", ")} }`;
}

function findArrayFieldName(schema: OpenAPISchema): string {
  if (!schema.properties) return "items";
  for (const [k, v] of Object.entries(schema.properties)) {
    if ((v as OpenAPISchema).type === "array") return k;
  }
  return "items";
}

function findArrayItemSchema(
  schema: OpenAPISchema,
): OpenAPISchema | null {
  if (!schema.properties) return null;
  for (const [, v] of Object.entries(schema.properties)) {
    if ((v as OpenAPISchema).type === "array" && (v as OpenAPISchema).items) {
      return (v as OpenAPISchema).items!;
    }
  }
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

interface ProductGenerationResult {
  schemas: Map<string, string>;
  allowedOps: Array<{ method: string; path: string }>;
}

async function generateForProduct(
  productKey: string,
  config: ProductConfig,
): Promise<ProductGenerationResult> {
  const specUrl = `${SPEC_BASE_URL}${config.specPath}`;
  console.log(`  Fetching ${specUrl}`);

  const raw = (await SwaggerParser.parse(specUrl)) as any;
  const refNames = extractRefNames(raw.paths || {});

  const api = (await SwaggerParser.dereference(specUrl)) as any;

  const tagGroups = new Map<string, CollectedOp[]>();
  const excludeTags = new Set(config.excludeTags || []);
  const allowedOps: Array<{ method: string; path: string }> = [];
  const allowedSeen = new Set<string>();
  let deniedCount = 0;

  for (const [specPath, methods] of Object.entries(api.paths || {})) {
    for (const [method, op] of Object.entries(
      methods as Record<string, OpenAPIOperation>,
    )) {
      if (typeof op !== "object" || !op || !op.tags) continue;

      const fullPath = specPath.startsWith(`/${productKey}/`)
        ? specPath
        : `/${productKey}${specPath}`;
      const upperMethod = method.toUpperCase();
      const summary =
        op.summary || op.operationId || `${upperMethod} ${specPath}`;

      if (!isOperationAllowed(upperMethod, fullPath, op.tags, config)) {
        deniedCount++;
        continue;
      }

      const dedupeKey = `${upperMethod} ${fullPath}`;
      if (!allowedSeen.has(dedupeKey)) {
        allowedSeen.add(dedupeKey);
        allowedOps.push({ method: upperMethod, path: fullPath });
      }

      for (const tag of op.tags) {
        if (excludeTags.has(tag)) continue;

        if (!tagGroups.has(tag)) tagGroups.set(tag, []);
        tagGroups.get(tag)!.push({
          method: upperMethod,
          path: fullPath,
          op,
          summary,
        });
      }
    }
  }

  if (deniedCount > 0) {
    console.log(`  Policy denied ${deniedCount} operation(s) — stripped from schemas`);
  }

  const schemas = new Map<string, string>();
  for (const [tag, ops] of tagGroups) {
    const normalizedTag = tag
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+$/, "");
    // Some OpenAPI specs already prefix tags with the product name (e.g. CDN
    // tag "CDN resources"). Strip a leading product prefix so we don't emit
    // keys like "cdn-cdn-resources" or "storage-storage".
    const tagSuffix =
      normalizedTag === productKey
        ? ""
        : normalizedTag.startsWith(`${productKey}-`)
          ? normalizedTag.slice(productKey.length + 1)
          : normalizedTag;
    const groupKey = tagSuffix ? `${productKey}-${tagSuffix}` : productKey;
    const text = generateSchemaText(productKey, tag, ops, refNames, config);
    schemas.set(groupKey, text);
  }

  return { schemas, allowedOps };
}

async function main() {
  console.log(`Generating schemas from ${SPEC_BASE_URL}`);
  console.log(`Products: ${enabledForGeneration.join(", ")}`);

  const allSchemas = new Map<string, string>();
  const allAllowedOps: Array<{ method: string; path: string }> = [];

  for (const productKey of enabledForGeneration) {
    const config = products[productKey];
    if (!config) {
      console.error(`  Error: product "${productKey}" not found in products.ts`);
      process.exit(1);
    }

    console.log(`\nProcessing ${productKey}...`);
    const { schemas: productSchemas, allowedOps } = await generateForProduct(
      productKey,
      config,
    );

    for (const [key, text] of productSchemas) {
      allSchemas.set(key, text);
    }
    allAllowedOps.push(...allowedOps);

    console.log(
      `  Generated ${productSchemas.size} schema groups: ${[...productSchemas.keys()].join(", ")}`,
    );
  }

  const sortedKeys = [...allSchemas.keys()].sort();

  const schemasFile = [
    "// Auto-generated by scripts/generate-schemas.ts — do not edit",
    `// Source: ${SPEC_BASE_URL}`,
    `// Generated: ${new Date().toISOString()}`,
    "",
    `export const schemaGroups = ${JSON.stringify(sortedKeys)} as const;`,
    "",
    "export type SchemaGroup = (typeof schemaGroups)[number];",
    "",
    "export const schemas: Record<SchemaGroup, string> = {",
    ...sortedKeys.map(
      (key) => `  "${key}": ${JSON.stringify(allSchemas.get(key))},`,
    ),
    "};",
    "",
  ].join("\n");

  const outDir = resolve(import.meta.dirname, "..", "src", "generated");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "schemas.ts"), schemasFile);
  console.log(`\nWrote src/generated/schemas.ts (${sortedKeys.length} groups)`);

  const configFile = [
    "// Auto-generated by scripts/generate-schemas.ts — do not edit",
    `// Source: ${SPEC_BASE_URL}`,
    `// Generated: ${new Date().toISOString()}`,
    "",
    `export const GCORE_API_BASE = "${SPEC_BASE_URL}";`,
    "",
  ].join("\n");

  writeFileSync(resolve(outDir, "config.ts"), configFile);
  console.log("Wrote src/generated/config.ts");

  const sortedOps = [...allAllowedOps].sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return a.method < b.method ? -1 : 1;
  });
  const policyFile = [
    "// Auto-generated by scripts/generate-schemas.ts — do not edit",
    `// Source: ${SPEC_BASE_URL}`,
    `// Generated: ${new Date().toISOString()}`,
    "//",
    "// Runtime allowlist of (method, path-template) tuples that survived the",
    "// access-policy filter in src/config/products.ts. The MCP server consults",
    "// this list before dispatching any free-form gcore_api or batch_execute",
    "// call. Closed by default: any method+path not present here is denied.",
    "",
    "export interface AllowedOp {",
    "  method: string;",
    "  path: string;",
    "}",
    "",
    `export const ALLOWED_OPS: ReadonlyArray<AllowedOp> = ${JSON.stringify(sortedOps, null, 2)};`,
    "",
  ].join("\n");

  writeFileSync(resolve(outDir, "policy.ts"), policyFile);
  console.log(`Wrote src/generated/policy.ts (${sortedOps.length} allowed ops)`);

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Schema generation failed:", err);
  process.exit(1);
});
