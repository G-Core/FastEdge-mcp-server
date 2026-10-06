// Session-approval contract shared with the portal page and the plugins:
// fastedge-coordinator context/session-approval/PROTOCOL.md. Change it there first.
import fs from "node:fs";

export const LOGIN_PORT = 47215;
export const SESSION_DIR = "/run/fastedge";
export const SESSION_FILE = `${SESSION_DIR}/session.json`;

/** API origin → the portal that approves sessions for it. Other allowed origins have no session login. */
export const PORTAL_ORIGINS: Readonly<Record<string, string>> = {
  "https://api.gcore.com": "https://portal.gcore.com",
  "https://api.preprod.world": "https://portal.preprod.world",
};

// Docker tag grammar. The tag is pasted into a shell command the agent runs, so nothing else gets through.
const TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

// The release pipeline writes the image tag into package.json before building the image.
const IMAGE_TAG: string = JSON.parse(
  fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).version;
if (!TAG_PATTERN.test(IMAGE_TAG)) {
  throw new Error(`package.json version "${IMAGE_TAG}" is not a valid image tag`);
}

/**
 * The canonical login command, or null when this API origin has no portal to approve it.
 * The origin is written out explicitly: a bare `-e GCORE_API_BASE` would take the agent shell's
 * value, which can differ from this server's. Origins come from the allowlist, so they need no quoting.
 */
export function loginCommand(apiOrigin: string): string | null {
  if (!PORTAL_ORIGINS[apiOrigin]) return null;
  return `docker run --rm -i -p 127.0.0.1:${LOGIN_PORT}:${LOGIN_PORT} -v fastedge-session:${SESSION_DIR} -e GCORE_API_BASE=${apiOrigin} ghcr.io/g-core/fastedge-mcp-server:${IMAGE_TAG} login`;
}

/** `login --use <client_id>` (PROTOCOL.md §3.6): switch to a cached account, no browser, no port. */
export function useCommand(apiOrigin: string): string | null {
  if (!PORTAL_ORIGINS[apiOrigin]) return null;
  return `docker run --rm -i -v fastedge-session:${SESSION_DIR} -e GCORE_API_BASE=${apiOrigin} ghcr.io/g-core/fastedge-mcp-server:${IMAGE_TAG} login --use <client_id>`;
}

export const RESTART_HINT =
  "Restart this MCP server to use the new account (Claude Code: /mcp, then reconnect; Codex CLI: exit, then `codex resume --last`).";
