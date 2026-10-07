import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";

import { EPHEMERAL_MAX_LIFETIME_MS } from "./credentials.js";
import { isValidRecipient, seal } from "./seal.js";
import { PORTAL_ORIGINS, SESSION_DIR } from "./session.js";
import {
  LockedError,
  TOKEN_PATTERN,
  acquireLock,
  ensureInstallationId,
  logout,
  migrateLegacy,
  removeExpired,
  saveSession,
  useAccount,
  writeSealed,
  type Session,
} from "./store.js";

export { ensureInstallationId } from "./store.js";

export type LoginOutcome = "ok" | "denied" | "timeout";

/** Exit codes from PROTOCOL.md §3. */
export class LoginError extends Error {
  constructor(
    message: string,
    public readonly exitCode: 2 | 3 | 4 | 7 | 8,
  ) {
    super(message);
  }
}

export interface LoginOptions {
  apiOrigin: string;
  port: number;
  host: string;
  /** Ephemeral mode (task 10): the broker's public key. The token is sealed to it, never saved in plaintext. */
  sealTo?: string;
  /** Test hooks. */
  sessionDir?: string;
  timeoutMs?: number;
}

export interface LoginHandle {
  url: string;
  port: number;
  result: Promise<LoginOutcome>;
}

const MAX_BODY_BYTES = 8192;
const LOGIN_TIMEOUT_MS = 5 * 60_000;
// 7 days (the longest option on the Approve page) plus 5 minutes of clock skew (PROTOCOL.md constants).
export const MAX_LIFETIME_MS = 7 * 24 * 3_600_000 + 5 * 60_000;
const ID_PATTERN = /^[1-9]\d{0,17}$/;
const FIELDS = ["state", "token", "token_id", "client_id", "expires_at", "api_origin"] as const;

const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'",
};
const page = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><p>${text}</p>`;
const OK_PAGE = page("FastEdge connected", "FastEdge is connected. You can close this tab.");
const DENIED_PAGE = page("FastEdge not connected", "Access was denied. You can close this tab.");
const BAD_PAGE = page("Bad request", "This request was not accepted.");

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

type Delivery = Parameters<typeof saveSession>[1];

/**
 * PROTOCOL.md §6 checks 5–6 plus the task 06 cap, shared by the browser callback and
 * `login --code`. Returns what to save, or null.
 */
function validateDelivery(
  f: Record<string, string>,
  apiOrigin: string,
  now: number,
  maxLifetimeMs = MAX_LIFETIME_MS,
): Delivery | null {
  const expiresAt = Date.parse(f.expires_at);
  if (
    f.api_origin !== apiOrigin ||
    !TOKEN_PATTERN.test(f.token) ||
    !ID_PATTERN.test(f.token_id) ||
    !ID_PATTERN.test(f.client_id) ||
    Number.isNaN(expiresAt) ||
    expiresAt <= now ||
    // Task 06 cap (8 h for ephemeral, task 10): a tampered delivery can't plant a longer session than the page allows.
    expiresAt > now + maxLifetimeMs
  ) {
    return null;
  }
  return {
    token: f.token,
    token_id: Number(f.token_id),
    client_id: Number(f.client_id),
    api_origin: apiOrigin,
    expires_at: new Date(expiresAt).toISOString(),
  };
}

const CODE_PREFIX = "fe1.";
const MAX_CODE_BYTES = 8192;

/** `fe1.<base64url JSON>` (PROTOCOL.md §3, "Connect code format") → the delivery fields, or null. */
function decodeConnectCode(code: string): Record<string, string> | null {
  const trimmed = code.trim();
  if (!trimmed.startsWith(CODE_PREFIX) || trimmed.length > MAX_CODE_BYTES) return null;
  const body = trimmed.slice(CODE_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) return null;
  try {
    const raw = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof raw !== "object" || raw === null || raw.v !== 1) return null;
    return Object.fromEntries(FIELDS.filter((n) => n !== "state").map((n) => [n, raw[n] == null ? "" : String(raw[n])]));
  } catch {
    return null;
  }
}

/** Ephemeral mode: a valid 32-byte base64url recipient key, or exit 2 before anything else happens. */
export function requireSealKey(sealTo: string | undefined): string {
  if (!isValidRecipient(sealTo)) {
    throw new LoginError(
      "Ephemeral login needs the MCP server's key (--seal-to). Use the exact login command the MCP server printed.",
      2,
    );
  }
  return sealTo;
}

/** Saves a validated delivery: sealed to the broker in ephemeral mode, plaintext otherwise. */
function store(sessionDir: string, delivered: Delivery, sealTo: string | undefined): void {
  if (sealTo) writeSealed(sessionDir, sealTo, seal(sealTo, { ...delivered, created_at: new Date().toISOString() }));
  else saveSession(sessionDir, delivered);
}

/** `login --code` (PROTOCOL.md §3.8): validate a pasted connect code and save it like a browser login. */
export function connectWithCode(code: string, opts: { apiOrigin: string; sealTo?: string; sessionDir?: string }): Delivery {
  requirePortal(opts.apiOrigin);
  if (opts.sealTo !== undefined) requireSealKey(opts.sealTo);
  const fields = decodeConnectCode(code);
  const cap = opts.sealTo ? EPHEMERAL_MAX_LIFETIME_MS : MAX_LIFETIME_MS;
  const delivered = fields && validateDelivery(fields, opts.apiOrigin, Date.now(), cap);
  if (!delivered) {
    throw new LoginError(
      `This connect code isn't valid for ${opts.apiOrigin}, or has expired. Approve again on the portal's agent-connect page and copy the new code.`,
      8,
    );
  }
  const sessionDir = opts.sessionDir ?? SESSION_DIR;
  const release = prepare(sessionDir, !!opts.sealTo);
  try {
    store(sessionDir, delivered, opts.sealTo);
    return delivered;
  } finally {
    release();
  }
}

function requirePortal(apiOrigin: string): string {
  const portalOrigin = PORTAL_ORIGINS[apiOrigin];
  if (!portalOrigin) {
    throw new LoginError(`Session login is not available for ${apiOrigin}. Use GCORE_API_KEY instead.`, 2);
  }
  return portalOrigin;
}

/**
 * Takes the lock (exit 3 if held), then migrates the POC layout and drops expired accounts.
 * Ephemeral mode only locks: it never touches plaintext files (task 10, MUST 4).
 */
function prepare(sessionDir: string, ephemeral = false): () => void {
  let release: () => void;
  try {
    release = acquireLock(sessionDir);
  } catch (err: any) {
    if (err instanceof LockedError) throw new LoginError(err.message, 3);
    throw new LoginError(`Cannot write to the session volume (${sessionDir}): ${err?.code ?? "error"}`, 2);
  }
  if (ephemeral) return release;
  try {
    migrateLegacy(sessionDir);
    removeExpired(sessionDir, Date.now());
  } catch (err) {
    release();
    throw err;
  }
  return release;
}

/** `login --use <client_id>` (PROTOCOL.md §3.6). */
export function useCachedAccount(opts: { apiOrigin: string; clientId: number; sessionDir?: string }): Session {
  requirePortal(opts.apiOrigin);
  const sessionDir = opts.sessionDir ?? SESSION_DIR;
  const release = prepare(sessionDir);
  try {
    const session = useAccount(sessionDir, opts.apiOrigin, opts.clientId, Date.now());
    if (!session) {
      throw new LoginError(
        `No usable cached session for account ${opts.clientId}. Run the login command and approve while signed in to that account.`,
        7,
      );
    }
    return session;
  } finally {
    release();
  }
}

/** `login --logout` (PROTOCOL.md §3.7). Local only: the token stays valid until it expires. */
export function logoutActive(opts: { apiOrigin: string; sessionDir?: string }): Session | null {
  requirePortal(opts.apiOrigin);
  const sessionDir = opts.sessionDir ?? SESSION_DIR;
  const release = prepare(sessionDir);
  try {
    return logout(sessionDir, opts.apiOrigin);
  } finally {
    release();
  }
}

/**
 * Binds the loopback listener, then returns the approval URL to print (S12: bind first).
 * Accepts exactly one valid callback, writes the session cache, and resolves.
 * Holds the login lock until it resolves. Never logs request bodies or headers (PROTOCOL.md §6).
 */
export async function startLogin(opts: LoginOptions): Promise<LoginHandle> {
  const portalOrigin = requirePortal(opts.apiOrigin);
  const sessionDir = opts.sessionDir ?? SESSION_DIR;
  const sealTo = opts.sealTo === undefined ? undefined : requireSealKey(opts.sealTo);
  const release = prepare(sessionDir, !!sealTo);

  const state = randomBytes(32).toString("base64url");
  let settle!: (outcome: LoginOutcome) => void;
  const result = new Promise<LoginOutcome>((resolve) => (settle = resolve));
  let done = false;
  let expectedHost = "";

  const server = http.createServer((req, res) => {
    const reject = () => {
      res.writeHead(400, PAGE_HEADERS).end(BAD_PAGE);
    };
    const origin = req.headers.origin;
    // Browsers send "Origin: null" here (Q3); `state` is the real control.
    if (
      done ||
      req.method !== "POST" ||
      req.url !== "/callback" ||
      req.headers.host !== expectedHost ||
      (origin !== "null" && origin !== portalOrigin) ||
      !req.headers["content-type"]?.startsWith("application/x-www-form-urlencoded")
    ) {
      req.resume();
      return reject();
    }

    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on("end", () => {
      if (done || size > MAX_BODY_BYTES) return reject();
      const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      if (!sameSecret(form.get("state") ?? "", state)) return reject();

      if (form.get("denied") === "1") {
        finish("denied");
        res.writeHead(200, PAGE_HEADERS).end(DENIED_PAGE);
        return;
      }

      const delivered = validateDelivery(
        Object.fromEntries(FIELDS.map((name) => [name, form.get(name) ?? ""])),
        opts.apiOrigin,
        Date.now(),
        sealTo ? EPHEMERAL_MAX_LIFETIME_MS : MAX_LIFETIME_MS,
      );
      if (!delivered) return reject();

      try {
        store(sessionDir, delivered, sealTo);
      } catch (err: any) {
        console.error(`Could not save the session: ${err?.code ?? "write failed"}`);
        res.writeHead(500, PAGE_HEADERS).end(BAD_PAGE);
        return;
      }
      finish("ok");
      res.writeHead(200, PAGE_HEADERS).end(OK_PAGE);
    });
  });

  const timer = setTimeout(() => finish("timeout"), opts.timeoutMs ?? LOGIN_TIMEOUT_MS);
  function finish(outcome: LoginOutcome) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    server.close();
    server.closeIdleConnections();
    release();
    settle(outcome);
  }

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", (err: NodeJS.ErrnoException) => {
        reject(
          err.code === "EADDRINUSE"
            ? new LoginError(`Port ${opts.port} is in use. Close the other login and try again.`, 4)
            : err,
        );
      });
      server.listen(opts.port, opts.host, () => resolve());
    });
  } catch (err) {
    clearTimeout(timer);
    release();
    throw err;
  }

  const port = (server.address() as AddressInfo).port;
  expectedHost = `127.0.0.1:${port}`;
  const api = new URL(opts.apiOrigin).host;
  // Ephemeral (task 10): the page offers 4 h / 8 h only and gets no installation id, so it marks
  // and replaces no tokens. Normal logins then can't delete live ephemeral tokens either.
  let install = sealTo ? "&ephemeral=1" : "";
  if (!sealTo) {
    try {
      install = `&install=${ensureInstallationId(sessionDir)}`;
    } catch (err: any) {
      // Login still works; the portal just can't replace this machine's earlier tokens.
      console.error(`Could not read or create the installation id: ${err?.code ?? "error"}`);
    }
  }
  return {
    url: `${portalOrigin}/fastedge/agent-connect?port=${port}&state=${state}&api=${api}${install}`,
    port,
    result,
  };
}
