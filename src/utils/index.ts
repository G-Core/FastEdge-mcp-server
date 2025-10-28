import path from "node:path";
import { Language } from "../tools/scaffolding/types.js";

export const INVALID_PATH = "Invalid path: Must be relative to workspace";

export function normalizePath(workspaceRoot: string, filePath: string): string {
  // Security: Ensure the path doesn't escape the workspace
  const normalizedPath = path.normalize(filePath);

  if (normalizedPath.startsWith("..") || path.isAbsolute(normalizedPath)) {
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
