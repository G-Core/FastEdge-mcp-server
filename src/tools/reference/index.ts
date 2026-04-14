import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync, existsSync } from "fs";
import { join, basename } from "path";
import { DocEntry, DocSection, searchDocs } from "./docs.js";

interface IndexSectionEntry {
  id: string;
  heading: string;
  level: number;
  anchor: string;
  line_start: number;
  line_end: number;
  keywords?: string[];
}

interface IndexTopicEntry {
  id: string;
  title: string;
  description?: string;
  path: string;
  local_path?: string;
  sections?: IndexSectionEntry[];
}

interface DocsIndexFile {
  schema_version: string;
  topics: IndexTopicEntry[];
}

/**
 * Extract 1-based line range from content.
 */
function sliceByLineRange(
  content: string,
  lineStart: number,
  lineEnd: number
): string {
  const lines = content.split("\n");
  const start = Math.max(1, lineStart);
  const end = Math.min(lines.length, Math.max(start, lineEnd));
  return lines.slice(start - 1, end).join("\n").trim();
}

/**
 * Resolve local markdown filename from canonical/local index paths.
 * reference-docs is flat in MCP server; basename(path) is authoritative.
 */
function resolveLocalDocPath(
  docsDir: string,
  topic: IndexTopicEntry
): string | null {
  const candidates = [
    topic.local_path ? join(docsDir, basename(topic.local_path)) : "",
    join(docsDir, basename(topic.path)),
    join(docsDir, `${topic.id}.md`),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function loadRequiredDocsIndex(docsDir: string): DocsIndexFile {
  const indexPath = join(docsDir, "docs-index.local.json");
  if (!existsSync(indexPath)) {
    throw new Error(
      `Missing required docs index at ${indexPath}. ` +
        `Run scripts/sync-reference-docs.sh to populate reference-docs/.`
    );
  }
  const parsed = JSON.parse(readFileSync(indexPath, "utf-8"));
  if (!parsed || !Array.isArray(parsed.topics)) {
    throw new Error(
      `Invalid docs index format at ${indexPath}: expected top-level topics[]`
    );
  }
  return parsed as DocsIndexFile;
}

/**
 * Load reference docs from the bundled docs directory.
 * Docs are imported from the fastedge-plugin repo at build time.
 */
export function loadReferenceDocs(docsDir: string): {
  docs: DocEntry[];
  sections: DocSection[];
  mode: "index";
} {
  if (!existsSync(docsDir)) {
    throw new Error(
      `Reference docs directory not found at ${docsDir}. ` +
        `Run scripts/sync-reference-docs.sh first.`
    );
  }

  const docsIndex = loadRequiredDocsIndex(docsDir);
  const docs: DocEntry[] = [];
  const sections: DocSection[] = [];

  for (const topic of docsIndex.topics) {
    const localPath = resolveLocalDocPath(docsDir, topic);
    if (!localPath) {
      throw new Error(`Missing local markdown file for topic ${topic.id}`);
    }
    const content = readFileSync(localPath, "utf-8");
    const doc: DocEntry = {
      id: topic.id,
      title: topic.title || topic.id,
      description: (topic.description || "").slice(0, 200),
      content,
    };
    docs.push(doc);

    if (!Array.isArray(topic.sections) || topic.sections.length === 0) {
      throw new Error(
        `Topic ${topic.id} has no sections in docs-index.local.json`
      );
    }

    for (const sec of topic.sections) {
      const sectionContent = sliceByLineRange(
        content,
        sec.line_start,
        sec.line_end
      );
      sections.push({
        docId: topic.id,
        heading: sec.heading,
        content: sectionContent || sec.heading,
        keywords: sec.keywords ?? [],
      });
    }
  }
  return { docs, sections, mode: "index" };
}

/**
 * Build the topics catalog string from loaded docs.
 */
function buildTopicsCatalog(docs: DocEntry[]): string {
  const lines = ["# Available FastEdge Reference Documentation", ""];

  for (const doc of docs) {
    lines.push(`- **${doc.id}** — ${doc.title}`);
    if (doc.description) {
      lines.push(`  ${doc.description}`);
    }
  }

  lines.push("");
  lines.push(
    'Use `fastedge-docs({ action: "search", query: "your question" })` to find relevant sections.'
  );
  lines.push(
    'Use `fastedge-docs({ action: "read", topic: "<topic-id>" })` to read a full document.'
  );

  return lines.join("\n");
}

/**
 * Format search results for tool output.
 */
function formatSearchResults(results: DocSection[]): string {
  if (results.length === 0) {
    return "No matching sections found. Try a different query, or use `action: 'topics'` to see all available documentation.";
  }

  const lines: string[] = [];
  for (const section of results) {
    lines.push(`### ${section.docId} → ${section.heading}`);
    // Truncate content to ~500 chars for excerpt
    const excerpt =
      section.content.length > 500
        ? section.content.slice(0, 500) + "\n..."
        : section.content;
    lines.push(excerpt);
    lines.push("");
  }

  lines.push("---");
  lines.push(
    'For full document: `fastedge-docs({ action: "read", topic: "<topic-id>" })`'
  );

  return lines.join("\n");
}

/**
 * Register the fastedge-docs reference tool.
 */
export function registerReferenceTools(server: McpServer, docsDir: string) {
  // Load and index docs at registration time (index-required mode)
  const { docs, sections: allSections, mode } = loadReferenceDocs(docsDir);
  console.error(
    `[fastedge-docs] Loaded ${docs.length} reference docs from ${docsDir} (mode=${mode})`
  );
  const topicsCatalog = buildTopicsCatalog(docs);

  server.registerTool(
    "fastedge-docs",
    {
      title: "FastEdge Reference Documentation",
      description:
        "IMPORTANT: Always use this tool before answering questions about FastEdge development. " +
        "FastEdge is a Wasm edge computing platform with platform-specific constraints (e.g., only stdout is captured — stderr is silently discarded). " +
        "Your training data may be wrong or outdated about FastEdge APIs and patterns. " +
        "This tool provides authoritative, up-to-date SDK reference docs, platform guides, error codes, examples, and testing documentation. " +
        'Use action "search" with your question to find relevant sections, "topics" to list all available docs, or "read" to get a full document by topic ID.',
      inputSchema: {
        action: z
          .enum(["topics", "search", "read"])
          .describe(
            '"topics" lists all docs, "search" finds matching sections, "read" returns a full document'
          ),
        query: z
          .string()
          .optional()
          .describe(
            'Search query (required for action "search"). Keywords or natural language question.'
          ),
        topic: z
          .string()
          .optional()
          .describe(
            'Topic ID to read (required for action "read"). Use "topics" to see available IDs.'
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      if (params.action === "topics") {
        return {
          content: [{ type: "text" as const, text: topicsCatalog }],
        };
      }

      if (params.action === "search") {
        if (!params.query) {
          return {
            content: [
              {
                type: "text" as const,
                text: 'The "search" action requires a "query" parameter. Example: fastedge-docs({ action: "search", query: "KV Store" })',
              },
            ],
          };
        }
        const results = searchDocs(allSections, params.query);
        return {
          content: [
            { type: "text" as const, text: formatSearchResults(results) },
          ],
        };
      }

      if (params.action === "read") {
        if (!params.topic) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  'The "read" action requires a "topic" parameter. ' +
                  'Use fastedge-docs({ action: "topics" }) to see available topic IDs.',
              },
            ],
          };
        }
        const doc = docs.find((d) => d.id === params.topic);
        if (!doc) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Topic "${params.topic}" not found. Available topics: ${docs.map((d) => d.id).join(", ")}`,
              },
            ],
          };
        }
        return {
          content: [{ type: "text" as const, text: doc.content }],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: 'Invalid action. Use "topics", "search", or "read".',
          },
        ],
      };
    }
  );
}
