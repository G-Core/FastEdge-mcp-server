import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, basename } from "path";
import {
  DocEntry,
  DocSection,
  splitIntoSections,
  searchDocs,
} from "./docs.js";

/**
 * Load reference docs from the bundled docs directory.
 * Docs are imported from the fastedge-plugin repo at build time.
 */
function loadReferenceDocs(docsDir: string): DocEntry[] {
  if (!existsSync(docsDir)) {
    return [];
  }

  const files = readdirSync(docsDir).filter((f) => f.endsWith(".md"));
  return files.map((file) => {
    const content = readFileSync(join(docsDir, file), "utf-8");
    const id = basename(file, ".md");

    // Extract title from first # heading
    const titleMatch = content.match(/^#\s+(.+)/m);
    const title = titleMatch ? titleMatch[1].trim() : id;

    // Extract first paragraph as description
    const lines = content.split("\n");
    let description = "";
    let inFirstPara = false;
    for (const line of lines) {
      if (!inFirstPara && line.trim() && !line.startsWith("#")) {
        inFirstPara = true;
        description = line.trim();
      } else if (inFirstPara && !line.trim()) {
        break;
      } else if (inFirstPara) {
        description += " " + line.trim();
      }
    }

    return { id, title, description: description.slice(0, 200), content };
  });
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
  // Load and index docs at registration time
  const docs = loadReferenceDocs(docsDir);
  const allSections: DocSection[] = docs.flatMap((doc) =>
    splitIntoSections(doc.id, doc.content)
  );
  const topicsCatalog = buildTopicsCatalog(docs);

  server.registerTool(
    "fastedge-docs",
    {
      title: "FastEdge Reference Documentation",
      description:
        "Search and read FastEdge SDK reference docs, platform guides, error codes, and testing documentation. " +
        'Use action "topics" to list available docs, "search" to find relevant sections, or "read" to get a full document.',
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
