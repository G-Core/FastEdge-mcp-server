// Token broker socket contract (fastedge-coordinator PROTOCOL.md §2a). Both sides live here:
// `serveBroker` runs in the broker process (uid 10002, the only reader of the session cache);
// `connectBroker` runs in the MCP server, which never sees a session token.
import fs from "node:fs";
import net from "node:net";

import { GCORE_API_ORIGIN, serializeBody } from "../api-client.js";
import { checkAllowed } from "../policy/enforce.js";
import type { ApiResult, Auth, LocalAuth } from "./credentials.js";
import { decodeB64url } from "./seal.js";
import { getSealTo, setSealTo } from "./session.js";

export const BROKER_ID = 10002;
export const BROKER_SOCKET = "/run/fastedge-broker/sock";
export const BROKER_READY_FIFO = "/run/fastedge-launch/ready";
const HELLO = "fastedge-broker/1";
const MAX_REQUEST_FRAME = 64 * 1024;
const MAX_RESPONSE_FRAME = 64 * 1024 * 1024; // 16 MiB responses, plus JSON escaping
const MAX_BODY_BYTES = 256 * 1024 * 1024;
const MAX_IN_FLIGHT = 8;
const HANDSHAKE_TIMEOUT_MS = 5_000;

// --- Frames ----------------------------------------------------------------------

/** A 4-byte big-endian length, then that many bytes of UTF-8 JSON. */
export function encodeFrame(message: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(json.length);
  return Buffer.concat([header, json]);
}

/**
 * Splits a byte stream into frames, each optionally followed by a raw body whose length
 * `bodyLength` reads from the frame. Throws on an oversized frame, bad JSON or a bad body
 * length; the caller then drops the connection.
 */
export class FrameReader {
  private chunks: Buffer[] = [];
  private size = 0;
  private pending: { message: any; bodyBytes: number } | null = null;

  constructor(
    private readonly maxFrame: number,
    private readonly bodyLength: (message: any) => number,
    private readonly onFrame: (message: any, body?: Buffer) => void,
  ) {}

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    for (;;) {
      if (this.pending) {
        if (this.size < this.pending.bodyBytes) return;
        const { message, bodyBytes } = this.pending;
        this.pending = null;
        this.onFrame(message, this.take(bodyBytes));
        continue;
      }
      if (this.size < 4) return;
      const length = this.flat().readUInt32BE(0);
      if (length > this.maxFrame) throw new Error("frame too large");
      if (this.size < 4 + length) return;
      this.take(4);
      const message = JSON.parse(this.take(length).toString("utf8"));
      const bodyBytes = this.bodyLength(message);
      if (bodyBytes > 0) this.pending = { message, bodyBytes };
      else this.onFrame(message);
    }
  }

  private flat(): Buffer {
    if (this.chunks.length > 1) this.chunks = [Buffer.concat(this.chunks)];
    return this.chunks[0];
  }

  private take(n: number): Buffer {
    const all = this.flat();
    this.chunks = [all.subarray(n)];
    this.size -= n;
    return all.subarray(0, n);
  }
}

// --- Process identity (MUST 1) ------------------------------------------------------

/** IDs and whether every privilege is gone: no capabilities, no groups, no_new_privs. */
export function readIdentity(statusText?: string): { uids: number[]; gids: number[]; dropped: boolean } {
  let status = statusText;
  if (status === undefined) {
    try {
      status = fs.readFileSync("/proc/self/status", "utf8");
    } catch {
      return { uids: [], gids: [], dropped: false };
    }
  }
  const field = (name: string) => status!.match(new RegExp(`^${name}:[ \\t]*(.*)$`, "m"))?.[1].trim();
  const ids = (name: string) => (field(name) ?? "").split(/\s+/).filter(Boolean).map(Number);
  const noCaps = ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"].every((c) => /^0+$/.test(field(c) ?? ""));
  return {
    uids: ids("Uid"),
    gids: ids("Gid"),
    dropped: noCaps && field("NoNewPrivs") === "1" && field("Groups") === "",
  };
}

// --- Broker side ------------------------------------------------------------------

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const CONTENT_TYPES = new Set(["application/json", "application/octet-stream"]);
const REQUEST_KEYS = new Set(["op", "id", "method", "path", "query", "content_type", "body_bytes"]);
// One leading slash, plain segments, an optional trailing slash: no "//", "?", "#", "%", "\" or controls.
const PATH = /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.~-]+)*\/?$/;
const MAX_PATH = 1024;
const MAX_QUERY_KEYS = 64;
const MAX_QUERY_CHARS = 2048;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

function bodyLengthOf(message: any): number {
  if (!isPlainObject(message) || message.body_bytes === undefined) return 0;
  const n = message.body_bytes as number;
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_BODY_BYTES) throw new Error("bad body length");
  return n;
}

/** MUST 6. Returns a fixed error message, or null when the request may be sent. */
export function checkRequest(m: Record<string, unknown>, apiOrigin = GCORE_API_ORIGIN): string | null {
  if (Object.keys(m).some((k) => !REQUEST_KEYS.has(k))) return "unexpected field";
  if (typeof m.method !== "string" || !METHODS.has(m.method)) return "method not allowed";
  const path = m.path;
  if (typeof path !== "string" || path.length > MAX_PATH || !PATH.test(path)) return "path not allowed";
  if (path.split("/").some((s) => s === "." || s === "..")) return "path not allowed";
  const url = new URL(apiOrigin + path);
  if (url.origin !== apiOrigin || url.pathname !== path) return "path not allowed";
  const iamMe = m.method === "GET" && path === "/iam/clients/me";
  if (!iamMe && checkAllowed(m.method, path)) return "operation not allowed by policy";

  if (m.query !== undefined) {
    if (!isPlainObject(m.query)) return "bad query";
    const entries = Object.entries(m.query);
    if (entries.length > MAX_QUERY_KEYS) return "bad query";
    const ok = (s: unknown) => typeof s === "string" && s.length <= MAX_QUERY_CHARS;
    if (!entries.every(([k, v]) => ok(k) && ok(v))) return "bad query";
  }
  if ((m.body_bytes === undefined) !== (m.content_type === undefined)) return "bad body";
  if (m.content_type !== undefined && !CONTENT_TYPES.has(m.content_type as string)) return "content type not allowed";
  return null;
}

/**
 * Serves the MCP server's one connection: handshake first, then requests checked by
 * `checkRequest` and sent with the broker's own credential. Never returns the token.
 */
export function serveBroker(socket: net.Socket, auth: LocalAuth, apiOrigin = GCORE_API_ORIGIN): void {
  let greeted = false;
  let inFlight = 0;
  const send = (message: unknown) => {
    if (!socket.destroyed) socket.write(encodeFrame(message));
  };

  const onFrame = (m: any, body?: Buffer) => {
    if (!greeted) {
      if (!isPlainObject(m) || m.hello !== HELLO || Object.keys(m).length !== 1) return void socket.destroy();
      greeted = true;
      // Ephemeral mode: the server needs the public key to build login commands (task 10).
      const sealTo = getSealTo();
      return send(sealTo ? { ok: true, seal_to: sealTo } : { ok: true });
    }
    if (!isPlainObject(m) || !Number.isSafeInteger(m.id)) return void socket.destroy();
    const id = m.id as number;

    if (m.op === "status") {
      if (Object.keys(m).length !== 2) return send({ id, error: "unexpected field" });
      return send({ id, data: auth.status() });
    }
    if (m.op !== "request") return send({ id, error: "unknown op" });
    const denied = checkRequest(m, apiOrigin);
    if (denied) return send({ id, error: denied });
    if (inFlight >= MAX_IN_FLIGHT) return send({ id, error: "too many requests in flight" });

    inFlight++;
    auth
      .call({
        method: m.method as string,
        path: m.path as string,
        query: m.query as Record<string, string> | undefined,
        body: body ?? (m.body_bytes === 0 ? Buffer.alloc(0) : undefined),
        contentType: m.content_type as string | undefined,
      })
      .then(
        (r) => send("authRequired" in r ? { id, auth_required: r.authRequired } : { id, status: r.status, data: r.data }),
        () => send({ id, error: "request failed" }),
      )
      .finally(() => inFlight--);
  };

  const reader = new FrameReader(MAX_REQUEST_FRAME, (m) => (greeted ? bodyLengthOf(m) : 0), onFrame);
  socket.on("data", (chunk: Buffer) => {
    try {
      reader.push(chunk);
    } catch {
      socket.destroy();
    }
  });
  socket.on("error", () => socket.destroy());
}

// --- MCP server side ------------------------------------------------------------------

const unavailable: Auth = {
  call: async () => ({ authRequired: "broker_unavailable" }),
  status: () => ({
    credential: "session",
    state: "broker_unavailable",
    note: "The token broker is not running, so the session cache can't be used. Restart the MCP server, or set GCORE_API_KEY.",
  }),
};

/** Moves a `?query` in the path into `query` (explicit entries win), as callGcoreApi does. */
function splitQuery(path: string, query?: Record<string, string>) {
  const q = path.indexOf("?");
  if (q < 0) return { path, query };
  return { path: path.slice(0, q), query: { ...Object.fromEntries(new URLSearchParams(path.slice(q + 1))), ...query } };
}

/**
 * Connects to the broker once, at startup, before any tool can run (MUST 5, MUST 9). Any
 * problem gives an Auth that answers `broker_unavailable`: it never falls back to reading the
 * cache. `socketPath`, `ownerUid` and `checkProcess` are test hooks.
 */
export async function connectBroker(
  opts: { socketPath?: string; ownerUid?: number; checkProcess?: boolean } = {},
): Promise<Auth> {
  const socketPath = opts.socketPath ?? BROKER_SOCKET;
  const ownerUid = opts.ownerUid ?? BROKER_ID;
  const fail = (why: string) => {
    console.error(`Session login unavailable: ${why}`);
    return unavailable;
  };

  if (opts.checkProcess ?? true) {
    const me = readIdentity();
    if (!me.dropped || me.uids.length === 0 || me.uids.some((id) => id === 0 || id === BROKER_ID)) {
      return fail("this server isn't running as an unprivileged user (start it from the Docker image's entrypoint).");
    }
  }
  let st: fs.Stats;
  try {
    st = fs.lstatSync(socketPath);
  } catch {
    return fail("no token broker (session login only works in the Docker image).");
  }
  if (!st.isSocket() || st.uid !== ownerUid) return fail("the broker socket is not owned by the broker.");

  const socket = net.connect(socketPath);
  const pending = new Map<number, (r: any) => void>();
  let nextId = 1;
  let closed = false;
  let greeted: (ok: boolean) => void = () => {};
  const handshake = new Promise<boolean>((resolve) => (greeted = resolve));

  const reader = new FrameReader(MAX_RESPONSE_FRAME, () => 0, (m: any) => {
    if (m?.ok === true && !Number.isSafeInteger(m?.id)) {
      if (m.seal_to !== undefined) {
        // It goes into a shell command the agent runs: exactly 32 bytes of base64url, or refuse.
        if (!decodeB64url(m.seal_to, 32)) return void socket.destroy();
        setSealTo(m.seal_to);
      }
      return greeted(true);
    }
    const done = pending.get(m?.id);
    pending.delete(m?.id);
    done?.(m);
  });
  socket.on("data", (chunk: Buffer) => {
    try {
      reader.push(chunk);
    } catch {
      socket.destroy();
    }
  });
  socket.on("error", () => socket.destroy());
  socket.on("close", () => {
    closed = true;
    greeted(false);
    for (const done of pending.values()) done({ auth_required: "broker_unavailable" });
    pending.clear();
  });

  socket.write(encodeFrame({ hello: HELLO }));
  const timer = setTimeout(() => socket.destroy(), HANDSHAKE_TIMEOUT_MS);
  const ok = await handshake;
  clearTimeout(timer);
  if (!ok) return fail("the token broker did not answer.");
  socket.unref(); // the stdio transport keeps the process alive, not this socket

  const send = (message: Record<string, unknown>, body?: Uint8Array): Promise<any> => {
    if (closed) return Promise.resolve({ auth_required: "broker_unavailable" });
    const id = nextId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      socket.write(encodeFrame({ ...message, id }));
      if (body) socket.write(body);
    });
  };

  return {
    async call(call): Promise<ApiResult> {
      const { path, query } = splitQuery(call.path, call.query);
      let body: Uint8Array | undefined;
      let contentType: string | undefined;
      if (call.body !== undefined && call.body !== null) {
        contentType = call.contentType ?? "application/json";
        const serialized = serializeBody(call.body, contentType);
        body = typeof serialized === "string" ? Buffer.from(serialized, "utf8") : serialized;
      }
      const r = await send(
        {
          op: "request",
          method: call.method,
          path,
          ...(query ? { query } : {}),
          ...(body ? { content_type: contentType, body_bytes: body.byteLength } : {}),
        },
        body,
      );
      if (typeof r.auth_required === "string") return { authRequired: r.auth_required };
      if (typeof r.error === "string") return { status: 0, data: { error: `Token broker: ${r.error}` } };
      return { status: r.status, data: r.data };
    },

    async status() {
      const r = await send({ op: "status" });
      return isPlainObject(r.data) ? r.data : (unavailable.status() as Record<string, unknown>);
    },
  };
}
