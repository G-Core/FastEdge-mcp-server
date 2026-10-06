import fs from "node:fs";

import { GCORE_API_ORIGIN } from "../api-client.js";
import { PORTAL_ORIGINS, RESTART_HINT, SESSION_FILE, loginCommand } from "./session.js";

export type AuthRequiredReason = "no_session" | "expired" | "account_changed" | "origin_mismatch" | "rejected";
export type CredentialSource = "explicit" | "session";
export type AuthResolution = { header: string; source: CredentialSource } | { authRequired: AuthRequiredReason };

export interface Auth {
  /** Credential for one request. Pins the account on first use of a session. */
  resolve(): AuthResolution;
  /** Read-only view for the status tool. Never pins, never includes the token. */
  status(): Record<string, unknown>;
}

const MAX_SESSION_BYTES = 4096;
const EXPIRY_MARGIN_MS = 60_000;
// Printable ASCII only, so a tampered file can't smuggle header syntax.
export const TOKEN_PATTERN = /^[\x21-\x7e]{1,1024}$/;

interface Session {
  token: string;
  client_id: number;
  api_origin: string;
  expires_at: string;
}

type SessionCheck =
  | { session: Session }
  | { reason: "no_session" }
  | { reason: "expired" | "origin_mismatch"; session: Session };

function readSessionFile(path: string): unknown {
  let fd: number;
  try {
    // O_NOFOLLOW: a symlinked session.json is refused, not followed.
    fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    if (!fs.fstatSync(fd).isFile()) return null;
    const buf = Buffer.alloc(MAX_SESSION_BYTES + 1);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    if (n > MAX_SESSION_BYTES) return null;
    return JSON.parse(buf.subarray(0, n).toString("utf8"));
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function parseSession(raw: unknown): Session | null {
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Record<string, unknown>;
  if (s.version !== 1) return null;
  if (typeof s.token !== "string" || !TOKEN_PATTERN.test(s.token)) return null;
  if (!Number.isSafeInteger(s.client_id) || (s.client_id as number) <= 0) return null;
  if (typeof s.api_origin !== "string" || typeof s.expires_at !== "string") return null;
  if (Number.isNaN(Date.parse(s.expires_at))) return null;
  return s as unknown as Session;
}

/** PROTOCOL.md §2 checks, without account pinning. */
function checkSession(file: string, apiOrigin: string, now: number): SessionCheck {
  const session = parseSession(readSessionFile(file));
  if (!session) return { reason: "no_session" };
  // S2: the request destination is never taken from the file, only checked against it.
  if (session.api_origin !== apiOrigin) return { reason: "origin_mismatch", session };
  if (Date.parse(session.expires_at) - now <= EXPIRY_MARGIN_MS) return { reason: "expired", session };
  return { session };
}

/** Metadata safe to show the agent: allowlisted fields, normalised values, never the token. */
function describeSession(session: Session) {
  return {
    client_id: session.client_id,
    api_origin: PORTAL_ORIGINS[session.api_origin] ? session.api_origin : "unsupported origin",
    expires_at: new Date(Date.parse(session.expires_at)).toISOString(),
  };
}

/**
 * An explicit key always wins and the session cache is never read (S1). Without one, the
 * session file is re-read and validated on every call, and the first accepted account is
 * pinned for the life of the process (S5). `sessionFile`, `apiOrigin` and `now` are test hooks.
 */
export function createAuth(
  explicitKey: string,
  opts: { sessionFile?: string; apiOrigin?: string; now?: () => number } = {},
): Auth {
  const apiOrigin = opts.apiOrigin ?? GCORE_API_ORIGIN;
  const command = loginCommand(apiOrigin);
  const switchHint = command
    ? `To switch account: run the login command, approve while signed in to the other account, then: ${RESTART_HINT}`
    : "Session login is not available for this API origin; set GCORE_API_KEY instead.";

  if (explicitKey) {
    const header = `APIKey ${explicitKey}`;
    return {
      resolve: () => ({ header, source: "explicit" }),
      status: () => ({
        credential: "explicit_key",
        note: "GCORE_API_KEY is set, so the session cache is not used. The account is not known locally.",
      }),
    };
  }

  const sessionFile = opts.sessionFile ?? SESSION_FILE;
  const now = opts.now ?? Date.now;
  let pinnedClientId: number | undefined;

  return {
    resolve() {
      const check = checkSession(sessionFile, apiOrigin, now());
      if ("reason" in check) return { authRequired: check.reason };
      pinnedClientId ??= check.session.client_id;
      if (check.session.client_id !== pinnedClientId) return { authRequired: "account_changed" };
      return { header: `APIKey ${check.session.token}`, source: "session" };
    },

    status() {
      const check = checkSession(sessionFile, apiOrigin, now());
      const cached = "session" in check ? describeSession(check.session) : null;
      const changed = !("reason" in check) && pinnedClientId !== undefined && check.session.client_id !== pinnedClientId;
      const state = "reason" in check ? check.reason : changed ? "account_changed" : "available";
      return {
        credential: "session",
        state,
        cached_session: cached,
        // The account this server process is locked to; null until the first API call.
        pinned_client_id: pinnedClientId ?? null,
        note: "Local state only: the token was not checked with the API, and it can still have been revoked in the portal.",
        ...(changed ? { next_step: RESTART_HINT } : {}),
        login_command: command,
        switch_account: switchHint,
      };
    },
  };
}

/** PROTOCOL.md §4. Metadata only: never the token or the file contents (S3). */
export function authRequiredResult(
  reason: AuthRequiredReason,
  opts: { apiOrigin?: string; detail?: string } = {},
) {
  const command = loginCommand(opts.apiOrigin ?? GCORE_API_ORIGIN);
  const lines = [`FastEdge is not connected to a Gcore account (${reason}).`];

  if (reason === "account_changed") {
    lines.push("A login for a different account replaced the session this server was using.", RESTART_HINT);
  } else if (!command) {
    lines.push("Session login is not available for this API origin. Set GCORE_API_KEY instead.");
  } else {
    if (reason === "rejected") {
      lines.push(
        "The API rejected the session token (it may have been revoked in the portal).",
        "If a fresh login is rejected too, stop and tell the user instead of logging in again.",
      );
    }
    lines.push(
      "Either set GCORE_API_KEY, or sign in through the Gcore portal for an 8-hour session:",
      "ask the user for permission, then run this command and give them the URL it prints:",
      `  ${command}`,
      opts.detail
        ? "Then retry only what did not complete; no restart is needed."
        : "Then retry this request; no restart is needed.",
    );
  }
  if (opts.detail) lines.push("", opts.detail);

  return { isError: true, content: [{ type: "text" as const, text: lines.join("\n") }] };
}
