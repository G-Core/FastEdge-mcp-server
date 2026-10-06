import fs from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";

import { TOKEN_PATTERN } from "./credentials.js";
import { PORTAL_ORIGINS, SESSION_DIR } from "./session.js";

export type LoginOutcome = "ok" | "denied" | "timeout";

/** Exit codes from PROTOCOL.md §3. */
export class LoginError extends Error {
  constructor(
    message: string,
    public readonly exitCode: 2 | 4,
  ) {
    super(message);
  }
}

export interface LoginOptions {
  apiOrigin: string;
  port: number;
  host: string;
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

/** Temp file + fsync + rename, so a reader never sees a half-written session (S15). */
function writeSession(dir: string, session: object): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  const tmp = join(dir, `.session-${randomBytes(8).toString("hex")}.tmp`);
  try {
    const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o644);
    try {
      fs.writeSync(fd, JSON.stringify(session));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    // 0644, not 0600: the MCP server runs as a different, per-workspace UID (PROTOCOL.md §2).
    fs.chmodSync(tmp, 0o644);
    fs.renameSync(tmp, join(dir, "session.json"));
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Binds the loopback listener, then returns the approval URL to print (S12: bind first).
 * Accepts exactly one valid callback, writes the session cache, and resolves.
 * Never logs request bodies or headers (PROTOCOL.md §6).
 */
export async function startLogin(opts: LoginOptions): Promise<LoginHandle> {
  const portalOrigin = PORTAL_ORIGINS[opts.apiOrigin];
  if (!portalOrigin) {
    throw new LoginError(
      `Session login is not available for ${opts.apiOrigin}. Use GCORE_API_KEY instead.`,
      2,
    );
  }

  const state = randomBytes(32).toString("base64url");
  const sessionDir = opts.sessionDir ?? SESSION_DIR;
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

      const f = Object.fromEntries(FIELDS.map((name) => [name, form.get(name) ?? ""]));
      const expiresAt = Date.parse(f.expires_at);
      if (
        f.api_origin !== opts.apiOrigin ||
        !TOKEN_PATTERN.test(f.token) ||
        !ID_PATTERN.test(f.token_id) ||
        !ID_PATTERN.test(f.client_id) ||
        Number.isNaN(expiresAt) ||
        expiresAt <= Date.now()
      ) {
        return reject();
      }

      try {
        writeSession(sessionDir, {
          version: 1,
          generation: randomBytes(16).toString("hex"),
          token: f.token,
          token_id: Number(f.token_id),
          client_id: Number(f.client_id),
          api_origin: opts.apiOrigin,
          expires_at: new Date(expiresAt).toISOString(),
          created_at: new Date().toISOString(),
        });
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
    settle(outcome);
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        err.code === "EADDRINUSE"
          ? new LoginError(`Port ${opts.port} is in use. Close the other login and try again.`, 4)
          : err,
      );
    });
    server.listen(opts.port, opts.host, () => resolve());
  });

  const port = (server.address() as AddressInfo).port;
  expectedHost = `127.0.0.1:${port}`;
  const api = new URL(opts.apiOrigin).host;
  return {
    url: `${portalOrigin}/fastedge/agent-connect?port=${port}&state=${state}&api=${api}`,
    port,
    result,
  };
}
