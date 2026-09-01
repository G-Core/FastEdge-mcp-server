import path from "node:path";
import { realpathSync, existsSync } from "node:fs";
import { Language } from "../tools/local/scaffolding/types.js";

export const INVALID_PATH = "Invalid path: Must be relative to workspace";

export function normalizePath(workspaceRoot: string, filePath: string): string {
  const posixPath = filePath.replace(/\\/g, "/");
  const normalizedPath = path.normalize(posixPath);

  if (
    normalizedPath.startsWith("..") ||
    path.isAbsolute(normalizedPath) ||
    /^[a-zA-Z]:/.test(posixPath)
  ) {
    return INVALID_PATH;
  }

  const rootReal = realpathSync(workspaceRoot);
  const candidate = path.join(rootReal, normalizedPath);

  // For output paths that don't exist yet, resolve the nearest existing ancestor.
  let probe = candidate;
  while (!existsSync(probe) && probe !== path.dirname(probe)) probe = path.dirname(probe);
  const probeReal = realpathSync(probe);
  if (probeReal !== rootReal && !probeReal.startsWith(rootReal + path.sep)) {
    return INVALID_PATH;
  }

  return candidate;
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
    if (process.env[k]) env[k] = process.env[k];
  }
  // CC_*/CXX_* per-target cross-compiler vars set by the Dockerfile for wasm builds.
  for (const k of Object.keys(process.env)) {
    if (/^(CC|CXX|CFLAGS|CXXFLAGS)_/.test(k) && process.env[k]) env[k] = process.env[k];
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
