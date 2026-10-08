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
  logoutAccount,
  logoutAll,
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
  /** Task 10: the broker's public key. With it the page offers "Keep me signed in"; unchecked seals the token to it. */
  sealTo?: string;
  /** FASTEDGE_SESSION=ephemeral: always seal, no choice (needs `sealTo`). */
  forced?: boolean;
  /** `--account`: accept only this Gcore account (a renewal, or a switch to a known account). */
  account?: number;
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

/**
 * PROTOCOL.md §6: a handled callback sends the browser to the portal's own outcome page (themed,
 * display-only), so we don't serve an unstyled page. `portalOrigin` comes only from this login's
 * API→portal mapping, never from the request; the URL carries nothing but the outcome. Without a
 * mapping (can't happen: login needs one to start) it falls back to the static page.
 */
function sendOutcome(res: http.ServerResponse, portalOrigin: string | undefined, outcome: "connected" | "denied"): void {
  if (!portalOrigin) {
    res.writeHead(200, PAGE_HEADERS).end(outcome === "connected" ? OK_PAGE : DENIED_PAGE);
    return;
  }
  res
    .writeHead(303, {
      Location: `${portalOrigin}/fastedge/agent-connect?result=${outcome}`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Length": "0",
    })
    .end();
}

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

const MAX_CODE_BYTES = 8192;

/**
 * `fe1.` / `fe2.` + base64url JSON (PROTOCOL.md §3, "Connect code format") → the delivery fields
 * and whether to keep the session, or null. `fe1` = keep; `fe2` = "don't keep" (task 10 v2). A
 * new prefix, so an older login that ignores unknown fields can't save a "don't keep" code.
 */
function decodeConnectCode(code: string): { fields: Record<string, string>; keep: boolean } | null {
  const trimmed = code.trim();
  const version = trimmed.startsWith("fe1.") ? 1 : trimmed.startsWith("fe2.") ? 2 : 0;
  if (!version || trimmed.length > MAX_CODE_BYTES) return null;
  const body = trimmed.slice(4);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) return null;
  try {
    const raw = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof raw !== "object" || raw === null || raw.v !== version) return null;
    const fields = Object.fromEntries(FIELDS.filter((n) => n !== "state").map((n) => [n, raw[n] == null ? "" : String(raw[n])]));
    return { fields, keep: version === 1 };
  } catch {
    return null;
  }
}

type How = "keep" | "seal";

/**
 * The callback's `persist` field against this login's own policy (task 10 v2, MoM rule 5). The
 * policy comes from how login was started, never from the delivery: forced never keeps; choice
 * needs exactly one 0|1; a login without a key can't honour "don't keep". Null → reject.
 */
export function decidePersist(values: string[], mode: { sealTo?: string; forced?: boolean }): How | null {
  if (values.length > 1) return null;
  const v = values[0];
  if (mode.forced) return v === undefined || v === "0" ? "seal" : null;
  if (mode.sealTo) return v === "0" ? "seal" : v === "1" ? "keep" : null;
  return v === undefined || v === "1" ? "keep" : null;
}

/** Ephemeral mode: a valid 32-byte base64url recipient key, or exit 2 before anything else happens. */
export function requireSealKey(sealTo: string | undefined): string {
  if (!isValidRecipient(sealTo)) {
    throw new LoginError(
      "Login needs the MCP server's key (--seal-to): use the exact login command the MCP server printed.",
      2,
    );
  }
  return sealTo;
}

const capFor = (how: How) => (how === "seal" ? EPHEMERAL_MAX_LIFETIME_MS : MAX_LIFETIME_MS);

/**
 * Saves a validated delivery: sealed to the broker, or plaintext. Plaintext housekeeping (POC
 * migration, expired accounts) runs only now, once a "keep" delivery is known (MoM rule 6).
 */
function store(sessionDir: string, delivered: Delivery, how: How, sealTo: string | undefined): void {
  if (how === "seal") {
    writeSealed(sessionDir, sealTo!, seal(sealTo!, { ...delivered, created_at: new Date().toISOString() }));
    return;
  }
  cleanup(sessionDir);
  saveSession(sessionDir, delivered);
}

/** `login --code` (PROTOCOL.md §3.8): validate a pasted connect code and save it like a browser login. */
export function connectWithCode(
  code: string,
  opts: { apiOrigin: string; sealTo?: string; forced?: boolean; account?: number; sessionDir?: string },
): Delivery & { sealed?: boolean } {
  requirePortal(opts.apiOrigin);
  if (opts.sealTo !== undefined || opts.forced) requireSealKey(opts.sealTo);
  const decoded = decodeConnectCode(code);
  if (decoded && decoded.keep && opts.forced) {
    throw new LoginError(
      'This MCP server only takes sessions that aren\'t kept on this computer. Approve again with "Keep me signed in" unchecked, and copy the new code.',
      8,
    );
  }
  if (decoded && !decoded.keep && !opts.sealTo) {
    throw new LoginError(
      "This code is for a session that isn't kept on this computer, so it needs the login command your AI assistant gave you (it includes this session's key).",
      8,
    );
  }
  const how: How = decoded?.keep ? "keep" : "seal";
  const delivered = decoded && validateDelivery(decoded.fields, opts.apiOrigin, Date.now(), capFor(how));
  if (delivered && opts.account !== undefined && delivered.client_id !== opts.account) {
    throw new LoginError(
      `This code is for account ${delivered.client_id}, but this login is for account ${opts.account}. Switch the portal to account ${opts.account}, approve again, and copy the new code.`,
      8,
    );
  }
  if (!delivered) {
    throw new LoginError(
      `This connect code isn't valid for ${opts.apiOrigin}, or has expired. Approve again on the portal's agent-connect page and copy the new code.`,
      8,
    );
  }
  const sessionDir = opts.sessionDir ?? SESSION_DIR;
  const release = prepare(sessionDir, false);
  try {
    store(sessionDir, delivered, how, opts.sealTo);
    return { ...delivered, sealed: how === "seal" };
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

/** Migrates the POC layout and drops expired accounts. Only before a plaintext save or cache command. */
function cleanup(sessionDir: string): void {
  migrateLegacy(sessionDir);
  removeExpired(sessionDir, Date.now());
}

/**
 * Takes the lock (exit 3 if held), and with `cleanupNow` also runs `cleanup`. Logins that may
 * seal take only the lock: plaintext files are touched only once a "keep" delivery arrives.
 */
function prepare(sessionDir: string, cleanupNow = true): (() => void) & { held: () => boolean } {
  let release: (() => void) & { held: () => boolean };
  try {
    release = acquireLock(sessionDir);
  } catch (err: any) {
    if (err instanceof LockedError) throw new LoginError(err.message, 3);
    throw new LoginError(`Cannot write to the session volume (${sessionDir}): ${err?.code ?? "error"}`, 2);
  }
  if (!cleanupNow) return release;
  try {
    cleanup(sessionDir);
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

/**
 * `login --logout <client_id>` / `login --logout all` (PROTOCOL.md §3.7). Local only: tokens stay
 * valid at Gcore until they expire. `all` covers every API origin on this volume (prod and
 * preprod) and the sealed files. Returns what was removed, for the revocation hint.
 */
export function logoutSessions(opts: {
  apiOrigin: string;
  target: number | "all";
  sessionDir?: string;
}): { sessions: Session[]; sealed: number } {
  requirePortal(opts.apiOrigin);
  const sessionDir = opts.sessionDir ?? SESSION_DIR;
  const release = prepare(sessionDir);
  try {
    if (opts.target === "all") return logoutAll(sessionDir);
    const session = logoutAccount(sessionDir, opts.apiOrigin, opts.target);
    return { sessions: session ? [session] : [], sealed: 0 };
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
  const sealTo = opts.sealTo === undefined && !opts.forced ? undefined : requireSealKey(opts.sealTo);
  const mode = { sealTo, forced: opts.forced };
  // A legacy login (no key) can only keep, so it cleans up now as before; the others wait.
  const release = prepare(sessionDir, !sealTo);

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

    // Oversized bodies are refused as soon as we know, not read to the end (review A6).
    const tooBig = () => {
      res.writeHead(400, { ...PAGE_HEADERS, Connection: "close" }).end(BAD_PAGE);
      req.destroy();
    };
    if (Number(req.headers["content-length"]) > MAX_BODY_BYTES) return tooBig();
    const chunks: Buffer[] = [];
    let size = 0;
    let overflow = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) return void chunks.push(chunk);
      if (!overflow) {
        overflow = true;
        tooBig();
      }
    });
    req.on("end", () => {
      if (done || overflow) return;
      const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      if (!sameSecret(form.get("state") ?? "", state)) return reject();

      if (form.get("denied") === "1") {
        finish("denied");
        sendOutcome(res, portalOrigin, "denied");
        return;
      }

      const how = decidePersist(form.getAll("persist"), mode);
      if (!how) return reject();
      const delivered = validateDelivery(
        Object.fromEntries(FIELDS.map((name) => [name, form.get(name) ?? ""])),
        opts.apiOrigin,
        Date.now(),
        capFor(how),
      );
      if (!delivered) return reject();
      // `--account`: the portal was signed in to another account. Nothing is saved; the page
      // should have warned before Approve (it gets `account=` in the link).
      if (opts.account !== undefined && delivered.client_id !== opts.account) return reject();

      try {
        if (!release.held()) throw Object.assign(new Error("lost the login lock"), { code: "ELOCKLOST" });
        store(sessionDir, delivered, how, sealTo);
      } catch (err: any) {
        console.error(`Could not save the session: ${err?.code ?? "write failed"}`);
        res.writeHead(500, PAGE_HEADERS).end(BAD_PAGE);
        return;
      }
      finish("ok");
      sendOutcome(res, portalOrigin, "connected");
    });
  });

  // Slow or many connections can't hold the one-shot listener (review A6): a browser needs one
  // request, sent at once.
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.maxConnections = 16;
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
  // Task 10. Forced: `ephemeral=1` and no installation id (the page offers 4 h / 8 h, marks and
  // replaces nothing). Choice: `seal=1` plus the id; the page shows "Keep me signed in" and uses
  // the id only when it's checked. Legacy (no key): the id only.
  let install = (opts.forced ? "&ephemeral=1" : sealTo ? "&seal=1" : "") + (opts.account !== undefined ? `&account=${opts.account}` : "");
  if (!opts.forced) {
    try {
      install += `&install=${ensureInstallationId(sessionDir)}`;
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
