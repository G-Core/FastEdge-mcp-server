import path from "node:path";
import { realpathSync, lstatSync } from "node:fs";
import { Language } from "../tools/local/scaffolding/types.js";

export const INVALID_PATH = "Invalid path: Must be relative to workspace";

/**
 * Resolve a workspace-relative filePath to an absolute path, rejecting anything
 * that escapes the workspace root.
 *
 * Symlinks are rejected outright — even dangling ones that existsSync misses.
 * A symlink swapped in after this check is not detected (TOCTOU); accepted limitation.
 */
export function normalizePath(workspaceRoot: string, filePath: string): string {
  if (filePath.includes("\0")) return INVALID_PATH; // path contains null byte

  const posixPath = filePath.replace(/\\/g, "/");
  const normalizedPath = path.normalize(posixPath);

  if (
    normalizedPath.startsWith("..") ||
    path.isAbsolute(normalizedPath) ||
    /^[a-zA-Z]:/.test(posixPath)
  ) {
    return INVALID_PATH;
  }

  let rootReal: string;
  try { rootReal = realpathSync(workspaceRoot); } catch { return INVALID_PATH; }
  const candidate = path.join(rootReal, normalizedPath);

  // For output paths that don't exist yet, walk up to the nearest existing ancestor.
  let probe = candidate;
  while (probe !== path.dirname(probe)) {
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(probe);
    } catch (e: any) {
      if (e?.code === "ENOENT") { probe = path.dirname(probe); continue; }
      return INVALID_PATH;
    }
    if (stat.isSymbolicLink()) return INVALID_PATH; // symlinks rejected
    let probeReal: string;
    try { probeReal = realpathSync(probe); } catch { return INVALID_PATH; }
    if (probeReal !== rootReal && !probeReal.startsWith(rootReal + path.sep)) {
      return INVALID_PATH;
    }
    return candidate;
  }

  return INVALID_PATH; // walked to filesystem root — outside workspace
}

/**
 * Minimal environment for build/scaffold child processes.
 * Allowlist avoids leaking ambient secrets (e.g. API keys) to untrusted
 * build code (build.rs, proc-macros, npm lifecycle scripts). The allowlist
 * is intentionally narrow; if a build fails with a missing var, add it here
 * rather than reverting to `process.env` spread.
 */
export function buildSubprocessEnv(): NodeJS.ProcessEnv {
  const PASSTHROUGH = [
    "PATH", "HOME", "LANG", "LC_ALL", "TERM",
    "CARGO_HOME", "RUSTUP_HOME", "WASI_SYSROOT",
    "npm_config_cache", "NODE_PATH",
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const k of PASSTHROUGH) {
    if (process.env[k] !== undefined) env[k] = process.env[k];
  }
  // CC_*/CXX_* per-target cross-compiler vars set by the Dockerfile for wasm builds.
  for (const k of Object.keys(process.env)) {
    if (/^(CC|CXX|CFLAGS|CXXFLAGS)_/.test(k) && process.env[k] !== undefined) env[k] = process.env[k];
  }
  return env;
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
