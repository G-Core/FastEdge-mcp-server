/**
 * Reference documentation content.
 *
 * At build time, these are populated from the fastedge-plugin repo's
 * pipeline-generated reference docs. For now, they're read from a
 * co-located docs/ directory that's copied during the build step.
 *
 * Each entry maps a topic ID to its markdown content.
 */

export interface DocEntry {
  id: string;
  title: string;
  description: string;
  content: string;
}

export interface DocSection {
  docId: string;
  heading: string;
  content: string;
  keywords: string[];
}

/**
 * Split a markdown document into sections by heading level.
 * Uses ## if present, falls back to ### if no ## headings exist.
 */
export function splitIntoSections(
  docId: string,
  content: string
): DocSection[] {
  const hasH2 = /^## /m.test(content);
  const splitPattern = hasH2 ? /^## /m : /^### /m;
  const parts = content.split(splitPattern);

  // First part is content before the first heading (intro)
  const sections: DocSection[] = [];

  if (parts[0].trim()) {
    sections.push({
      docId,
      heading: "Introduction",
      content: parts[0].trim(),
      keywords: extractKeywords(parts[0]),
    });
  }

  // Remaining parts each start with the heading text (split removed the ## prefix)
  for (let i = 1; i < parts.length; i++) {
    const lines = parts[i].split("\n");
    const heading = lines[0].trim();
    const body = lines.slice(1).join("\n").trim();

    sections.push({
      docId,
      heading,
      content: `${hasH2 ? "##" : "###"} ${heading}\n\n${body}`,
      keywords: extractKeywords(`${heading}\n${body}`),
    });
  }

  return sections;
}

/**
 * Extract keywords from text for search matching.
 * Takes heading + first paragraph, lowercases, splits on word boundaries.
 */
function extractKeywords(text: string): string[] {
  // Take first 500 chars to focus on heading + first paragraph
  const sample = text.slice(0, 500).toLowerCase();

  // Split on non-word characters, filter short words and noise
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "must",
    "shall",
    "can",
    "need",
    "dare",
    "ought",
    "used",
    "to",
    "of",
    "in",
    "for",
    "on",
    "with",
    "at",
    "by",
    "from",
    "as",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "between",
    "and",
    "but",
    "or",
    "not",
    "no",
    "nor",
    "so",
    "yet",
    "both",
    "either",
    "neither",
    "each",
    "every",
    "all",
    "any",
    "few",
    "more",
    "most",
    "other",
    "some",
    "such",
    "than",
    "too",
    "very",
    "just",
    "also",
    "this",
    "that",
    "these",
    "those",
    "it",
    "its",
    "if",
    "then",
    "else",
    "when",
    "where",
    "how",
    "what",
    "which",
    "who",
    "whom",
    "why",
  ]);

  return [
    ...new Set(
      sample
        .split(/[^a-z0-9_.-]+/)
        .filter((w) => w.length > 2 && !stopWords.has(w))
    ),
  ];
}

/**
 * Search across all doc sections for a query string.
 * Returns top N matching sections with excerpts.
 */
export function searchDocs(
  sections: DocSection[],
  query: string,
  maxResults: number = 5
): DocSection[] {
  const queryWords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);

  const scored = sections
    .map((section) => {
      let score = 0;
      for (const word of queryWords) {
        // Exact keyword match
        if (section.keywords.some((k) => k.includes(word))) {
          score += 2;
        }
        // Heading match (higher weight)
        if (section.heading.toLowerCase().includes(word)) {
          score += 5;
        }
        // Content match
        if (section.content.toLowerCase().includes(word)) {
          score += 1;
        }
      }
      return { section, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  return scored.map((s) => s.section);
}
