import path from "node:path";
import { Language } from "../tools/local/scaffolding/types.js";

export const INVALID_PATH = "Invalid path: Must be relative to workspace";

export function normalizePath(workspaceRoot: string, filePath: string): string {
  // Security: Ensure the path doesn't escape the workspace
  // Convert Windows-style paths to POSIX-style for cross-platform compatibility
  const posixPath = filePath.replace(/\\/g, "/");
  const normalizedPath = path.normalize(posixPath);

  // Check for path traversal attempts or absolute paths (including Windows drive letters)
  if (
    normalizedPath.startsWith("..") ||
    path.isAbsolute(normalizedPath) ||
    /^[a-zA-Z]:/.test(posixPath)
  ) {
    return INVALID_PATH;
  }

  return path.join(workspaceRoot, normalizedPath);
}

export function isJsDerivedLanguage(lang: Language) {
  return (
    lang === "javascript" || lang === "typescript" || lang === "assemblyscript"
  );
}

export function parseCdnAppLanguage(lang: Language): Language {
  if (isJsDerivedLanguage(lang)) {
    return "assemblyscript";
  }
  return lang;
}
