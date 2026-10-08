// Session-approval contract shared with the portal page and the plugins:
// fastedge-coordinator context/session-approval/PROTOCOL.md. Change it there first.
import fs from "node:fs";

export const LOGIN_PORT = 47215;
export const SESSION_DIR = "/run/fastedge";

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

// Session sealing (fastedge-coordinator tasks/10-ephemeral-session.md): the broker's public key,
// set once per process (the broker at start, the MCP server from the broker's handshake).
// - Having a key means login can seal: the Approve page then offers "Keep me signed in" (v2).
// - `forced` (FASTEDGE_SESSION=ephemeral) means login must seal: the page offers no choice (v1).
const SEAL_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
let sealTo: string | null = null;
let forced = false;

export function setSealTo(publicKey: string, forcedEphemeral = false): void {
  if (!SEAL_KEY_PATTERN.test(publicKey)) throw new Error("invalid seal key");
  // Set once per process (review B3): commands built earlier and later must agree on the key.
  if (sealTo !== null && (sealTo !== publicKey || forced !== forcedEphemeral)) {
    throw new Error("the seal key is already set for this process");
  }
  sealTo = publicKey;
  forced = forcedEphemeral;
}
export const getSealTo = () => sealTo;
export const isForcedEphemeral = () => forced;

/** Extra `docker run` flags and login arguments: the key whenever there is one; the env only when forced. */
const ephemeralEnv = () => (forced ? " -e FASTEDGE_SESSION=ephemeral" : "");
const sealArg = () => (sealTo ? ` --seal-to ${sealTo}` : "");
// `--account <id>`: login (and the page) accept only that account (a renewal, or a switch to a known account).
const accountArg = (account?: number | string) => (account !== undefined ? ` --account ${account}` : "");

/**
 * The canonical login command, or null when this API origin has no portal to approve it.
 * The origin is written out explicitly: a bare `-e GCORE_API_BASE` would take the agent shell's
 * value, which can differ from this server's. Origins come from the allowlist, so they need no quoting.
 */
export function loginCommand(apiOrigin: string, account?: number | string): string | null {
  if (!PORTAL_ORIGINS[apiOrigin]) return null;
  return `docker run --rm -i -p 127.0.0.1:${LOGIN_PORT}:${LOGIN_PORT} -v fastedge-session:${SESSION_DIR} -e GCORE_API_BASE=${apiOrigin}${ephemeralEnv()} ghcr.io/g-core/fastedge-mcp-server:${IMAGE_TAG} login${sealArg()}${accountArg(account)}`;
}

/** `login --use <client_id>` (PROTOCOL.md §3.6): switch to a cached account, no browser, no port. Not when forced ephemeral. */
export function useCommand(apiOrigin: string): string | null {
  if (!PORTAL_ORIGINS[apiOrigin] || forced) return null;
  return `docker run --rm -i -v fastedge-session:${SESSION_DIR} -e GCORE_API_BASE=${apiOrigin} ghcr.io/g-core/fastedge-mcp-server:${IMAGE_TAG} login --use <client_id>`;
}

/**
 * `login --logout <client_id>` / `login --logout all` (PROTOCOL.md §3.7): removes saved sessions
 * from this computer (all = prod and preprod). No port, no browser, prints no secrets, so an
 * agent may run it with the user's OK. Never sets FASTEDGE_SESSION (logout isn't refused then).
 */
export function logoutCommand(apiOrigin: string): string | null {
  if (!PORTAL_ORIGINS[apiOrigin]) return null;
  return `docker run --rm -i -v fastedge-session:${SESSION_DIR} -e GCORE_API_BASE=${apiOrigin} ghcr.io/g-core/fastedge-mcp-server:${IMAGE_TAG} login --logout <client_id|all>`;
}

/** `login --code` (PROTOCOL.md §3.8): needs the user's own terminal (`-it`), so an agent can't run it. */
export function codeCommand(apiOrigin: string, account?: number | string): string | null {
  if (!PORTAL_ORIGINS[apiOrigin]) return null;
  return `docker run --rm -it -v fastedge-session:${SESSION_DIR} -e GCORE_API_BASE=${apiOrigin}${ephemeralEnv()} ghcr.io/g-core/fastedge-mcp-server:${IMAGE_TAG} login --code${sealArg()}${accountArg(account)}`;
}

/** Manual fallback text for `auth_required` and the status tool (PROTOCOL.md §4). */
export function manualFallback(apiOrigin: string, account?: number): string | null {
  const portal = PORTAL_ORIGINS[apiOrigin];
  const command = codeCommand(apiOrigin, account);
  if (!portal || !command) return null;
  const query = [forced ? "ephemeral=1" : sealTo ? "seal=1" : "", account ? `account=${account}` : ""].filter(Boolean).join("&");
  return [
    `Ask the user to open ${portal}/fastedge/agent-connect${query ? `?${query}` : ""} themselves, choose the manual option, approve,`,
    `and run this in their own terminal (not through you): ${command}`,
    "Never ask them to paste the connect code into this chat.",
  ].join("\n");
}

/** Ephemeral sessions are never replaced while the server runs (task 10, MUST 6). */
export const EPHEMERAL_RESTART_HINT =
  "Restart this MCP server (Claude Code: /mcp, then reconnect; Codex CLI: exit, then `codex resume --last`), then approve again when asked.";

export const RESTART_HINT =
  "Restart this MCP server to use the new account (Claude Code: /mcp, then reconnect; Codex CLI: exit, then `codex resume --last`).";
