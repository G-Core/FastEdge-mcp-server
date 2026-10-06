/**
 * Session-approval gate tests (fastedge-coordinator context/session-approval/SECURITY.md, phase 1).
 * Run via: tsx --test scripts/tests/test-session-auth.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { mkdtempSync, writeFileSync, symlinkSync, statSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { authRequiredResult, createAuth, type Auth, type AuthRequiredReason } from "../../src/auth/credentials.js";
import { LoginError, startLogin } from "../../src/auth/login-server.js";
import { registerApiTools } from "../../src/tools/api/index.js";

const API = "https://api.preprod.world";
const PORTAL = "https://portal.preprod.world";
const TOKEN = "4242_CANARY-session-token-do-not-leak";
const HOUR = 3_600_000;

const tmp = () => mkdtempSync(join(tmpdir(), "session-auth-"));
const session = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  generation: "g1",
  token: TOKEN,
  token_id: 4242,
  client_id: 123,
  api_origin: API,
  expires_at: new Date(Date.now() + 8 * HOUR).toISOString(),
  created_at: new Date().toISOString(),
  ...overrides,
});
const writeSession = (dir: string, data: unknown) => {
  const file = join(dir, "session.json");
  writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data));
  return file;
};
const authFor = (file: string, key = "") => createAuth(key, { sessionFile: file, apiOrigin: API });
const resolverFor = (file: string) => {
  const auth = authFor(file);
  return () => auth.resolve();
};
const sessionHeader = (token = TOKEN) => ({ header: `APIKey ${token}`, source: "session" });

// --- Resolver -----------------------------------------------------------------

test("S1: an explicit key wins, even a wrong one, with a valid session present", () => {
  const file = writeSession(tmp(), session());
  assert.deepEqual(authFor(file, "wrong-key").resolve(), { header: "APIKey wrong-key", source: "explicit" });
});

test("a valid session yields the session token", () => {
  assert.deepEqual(resolverFor(writeSession(tmp(), session()))(), sessionHeader());
});

const rejected: Array<[string, (dir: string) => string, AuthRequiredReason]> = [
  ["missing", (dir) => join(dir, "session.json"), "no_session"],
  ["malformed", (dir) => writeSession(dir, "{not json"), "no_session"],
  ["wrong version", (dir) => writeSession(dir, session({ version: 2 })), "no_session"],
  ["oversized", (dir) => writeSession(dir, session({ pad: "x".repeat(5000) })), "no_session"],
  ["token with whitespace", (dir) => writeSession(dir, session({ token: "a b" })), "no_session"],
  ["expired", (dir) => writeSession(dir, session({ expires_at: new Date(Date.now() - 1000).toISOString() })), "expired"],
  ["inside the 60 s margin", (dir) => writeSession(dir, session({ expires_at: new Date(Date.now() + 30_000).toISOString() })), "expired"],
  ["wrong origin", (dir) => writeSession(dir, session({ api_origin: "https://api.gcore.com" })), "origin_mismatch"],
  [
    "a symlink",
    (dir) => {
      const real = writeSession(dir, session());
      const link = join(dir, "link.json");
      symlinkSync(real, link);
      return link;
    },
    "no_session",
  ],
];
for (const [label, setup, reason] of rejected) {
  test(`cache is ignored when ${label}`, () => {
    assert.deepEqual(resolverFor(setup(tmp()))(), { authRequired: reason });
  });
}

test("S5: renewal within the account carries on; a different client_id gives account_changed", () => {
  const dir = tmp();
  const file = writeSession(dir, session());
  const resolve = resolverFor(file);
  assert.ok("header" in resolve());
  writeSession(dir, session({ token: "4243_renewed" }));
  assert.deepEqual(resolve(), sessionHeader("4243_renewed"));
  writeSession(dir, session({ client_id: 999 }));
  assert.deepEqual(resolve(), { authRequired: "account_changed" });
});

test("S15: a stray temp file from a crashed write leaves the old session in use", () => {
  const dir = tmp();
  const file = writeSession(dir, session());
  writeFileSync(join(dir, ".session-deadbeef.tmp"), '{"version":1,"token":"half');
  assert.deepEqual(resolverFor(file)(), sessionHeader());
});

test("S3: auth_required results never contain the token", () => {
  for (const reason of ["no_session", "expired", "account_changed", "origin_mismatch", "rejected"] as const) {
    const result = authRequiredResult(reason, { apiOrigin: API });
    assert.equal(result.isError, true);
    assert.ok(!JSON.stringify(result).includes(TOKEN));
  }
});

test("login command names this server's origin explicitly, not the agent shell's", () => {
  const text = authRequiredResult("no_session", { apiOrigin: API }).content[0].text;
  assert.match(text, /-e GCORE_API_BASE=https:\/\/api\.preprod\.world ghcr\.io\/g-core\/fastedge-mcp-server:[A-Za-z0-9_.-]+ login/);
});

test("account_changed says restart, and offers no login", () => {
  const text = authRequiredResult("account_changed", { apiOrigin: API }).content[0].text;
  assert.match(text, /Restart this MCP server/);
  assert.match(text, /codex resume --last/);
  assert.doesNotMatch(text, /docker run/);
});

test("origins without a portal get no login command", () => {
  const text = authRequiredResult("no_session", { apiOrigin: "https://api.cdb-staging.cdn.orange.com" }).content[0].text;
  assert.doesNotMatch(text, /docker run/);
  assert.match(text, /Set GCORE_API_KEY/);
});

// --- Status tool view -------------------------------------------------------------

test("status never pins, and shows pinned vs cached account after a switch", () => {
  const dir = tmp();
  const file = writeSession(dir, session());
  const auth = authFor(file);

  const before = auth.status();
  assert.equal(before.state, "available");
  assert.equal(before.pinned_client_id, null, "reading status must not pin");

  writeSession(dir, session({ client_id: 999 }));
  assert.ok("header" in auth.resolve(), "first real use pins 999, not the account seen earlier");
  writeSession(dir, session({ client_id: 123 }));

  const after = auth.status();
  assert.equal(after.state, "account_changed");
  assert.equal(after.pinned_client_id, 999);
  assert.equal((after.cached_session as { client_id: number }).client_id, 123);
  assert.match(String(after.next_step), /Restart this MCP server/);
  assert.ok(!JSON.stringify(after).includes(TOKEN));
});

test("status with an explicit key ignores the cache", () => {
  const status = authFor(writeSession(tmp(), session()), "a-key").status();
  assert.equal(status.credential, "explicit_key");
  assert.ok(!JSON.stringify(status).includes(TOKEN));
});

test("status reports a missing session with the login command", () => {
  const status = authFor(join(tmp(), "session.json")).status();
  assert.equal(status.state, "no_session");
  assert.equal(status.cached_session, null);
  assert.match(String(status.login_command), / login$/);
});

// --- Tools: a session token rejected by the API (Fix 1) ---------------------------

type ToolText = { isError?: boolean; content: Array<{ type: string; text: string }> };

async function toolsWith(auth: Auth, workspaceRoot = tmp()) {
  const server = new McpServer({ name: "test", version: "0" });
  registerApiTools(server, { workspaceRoot, gcoreApiKey: "", auth });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "t", version: "0" });
  await client.connect(clientSide);
  return (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args }) as Promise<ToolText>;
}

/** Stub fetch: answers each call with the next status in `statuses`. */
function stubFetch(statuses: number[]) {
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = (async () => {
    const status = statuses[Math.min(i++, statuses.length - 1)];
    const body = status === 401 ? { message: "Invalid API token" } : { id: 7, apps: [] };
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return () => (globalThis.fetch = original);
}

test("gcore_api: a session token rejected with 401 becomes auth_required (rejected)", async () => {
  const restore = stubFetch([401]);
  try {
    const call = await toolsWith(authFor(writeSession(tmp(), session())));
    const result = await call("gcore_api", { method: "GET", path: "/fastedge/v1/apps" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /\(rejected\)/);
    assert.match(result.content[0].text, / login/);
    assert.ok(!result.content[0].text.includes(TOKEN));
  } finally {
    restore();
  }
});

test("gcore_api: an explicit key keeps the raw 401 (S1)", async () => {
  const restore = stubFetch([401]);
  try {
    const call = await toolsWith(authFor(writeSession(tmp(), session()), "a-key"));
    const result = await call("gcore_api", { method: "GET", path: "/fastedge/v1/apps" });
    assert.notEqual(result.isError, true);
    assert.match(result.content[0].text, /"status": 401/);
  } finally {
    restore();
  }
});

test("gcore_api: a 403 on a session is passed through, not turned into a login", async () => {
  const restore = stubFetch([403]);
  try {
    const call = await toolsWith(authFor(writeSession(tmp(), session())));
    const result = await call("gcore_api", { method: "GET", path: "/fastedge/v1/apps" });
    assert.notEqual(result.isError, true);
    assert.match(result.content[0].text, /"status": 403/);
  } finally {
    restore();
  }
});

test("batch_execute: a 401 mid-batch keeps the completed steps and says not to repeat them", async () => {
  const restore = stubFetch([200, 401]);
  try {
    const call = await toolsWith(authFor(writeSession(tmp(), session())));
    const result = await call("batch_execute", {
      calls: [
        { method: "GET", path: "/fastedge/v1/apps", as: "first" },
        { method: "GET", path: "/fastedge/v1/apps" },
      ],
    });
    const text = result.content[0].text;
    assert.equal(result.isError, true);
    assert.match(text, /\(rejected\)/);
    assert.match(text, /retry only what did not complete/);
    assert.match(text, /do not repeat them/);
    assert.match(text, /"completed"/);
    assert.match(text, /Step 2 failed: 401/);
  } finally {
    restore();
  }
});

test("upload-binary: a 401 on a session becomes auth_required, using the status not the message", async () => {
  const restore = stubFetch([401]);
  try {
    const ws = tmp();
    writeFileSync(join(ws, "app.wasm"), Buffer.from([0, 97, 115, 109]));
    const call = await toolsWith(authFor(writeSession(tmp(), session())), ws);
    const result = await call("upload-binary", { wasmFile: "app.wasm" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /\(rejected\)/);
  } finally {
    restore();
  }
});

test("fastedge-auth-status tool returns metadata and never the token", async () => {
  const call = await toolsWith(authFor(writeSession(tmp(), session())));
  const result = await call("fastedge-auth-status", {});
  const status = JSON.parse(result.content[0].text);
  assert.equal(status.state, "available");
  assert.equal(status.cached_session.client_id, 123);
  assert.ok(!result.content[0].text.includes(TOKEN));
});

// --- Login listener -------------------------------------------------------------

interface Post {
  path?: string;
  host?: string;
  origin?: string | null;
  body?: string;
}

function post(port: number, { path = "/callback", host, origin = "null", body = "" }: Post): Promise<number> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Host: host ?? `127.0.0.1:${port}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": String(Buffer.byteLength(body)),
    };
    if (origin !== null) headers.Origin = origin;
    const req = http.request({ host: "127.0.0.1", port, path, method: "POST", headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end(body);
  });
}

const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
const stateOf = (url: string) => new URL(url).searchParams.get("state") ?? "";
const goodFields = (state: string) => ({
  state,
  token: TOKEN,
  token_id: "4242",
  client_id: "123",
  expires_at: new Date(Date.now() + 8 * HOUR).toISOString(),
  api_origin: API,
});

async function login(timeoutMs = 10_000) {
  const sessionDir = tmp();
  const handle = await startLogin({ apiOrigin: API, port: 0, host: "127.0.0.1", sessionDir, timeoutMs });
  return { ...handle, sessionDir, state: stateOf(handle.url) };
}

test("login URL points at the matching portal with port, state and api host", async () => {
  const l = await login();
  const url = new URL(l.url);
  assert.equal(url.origin + url.pathname, `${PORTAL}/fastedge/agent-connect`);
  assert.equal(url.searchParams.get("port"), String(l.port));
  assert.match(l.state, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(url.searchParams.get("api"), "api.preprod.world");
  await post(l.port, { body: form({ state: l.state, denied: "1" }) });
});

test("callback rejects bad requests and then accepts Origin: null with a valid state", async () => {
  const l = await login();
  const good = form(goodFields(l.state));
  const bad: Array<[string, Post]> = [
    ["wrong path", { path: "/callback/x", body: good }],
    ["wrong Host", { host: "localhost:1234", body: good }],
    ["missing Origin", { origin: null, body: good }],
    ["foreign Origin", { origin: "https://evil.example", body: good }],
    ["wrong state", { body: form(goodFields("x".repeat(43))) }],
    ["wrong api_origin", { body: form({ ...goodFields(l.state), api_origin: "https://api.gcore.com" }) }],
    ["bad token_id", { body: form({ ...goodFields(l.state), token_id: "abc" }) }],
    ["oversized body", { body: `${good}&pad=${"x".repeat(9000)}` }],
  ];
  for (const [label, req] of bad) {
    assert.equal(await post(l.port, req), 400, label);
  }
  assert.ok(!existsSync(join(l.sessionDir, "session.json")), "nothing written before a valid callback");

  assert.equal(await post(l.port, { body: good }), 200);
  assert.equal(await l.result, "ok");

  const file = join(l.sessionDir, "session.json");
  assert.equal(statSync(file).mode & 0o777, 0o644);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).client_id, 123);
  assert.deepEqual(resolverFor(file)(), sessionHeader());

  // Replay after success: refused (400 on a kept-alive socket, or connection refused).
  assert.notEqual(await post(l.port, { body: good }).catch(() => 0), 200);
});

test("portal origin is accepted as well as null", async () => {
  const l = await login();
  assert.equal(await post(l.port, { origin: PORTAL, body: form(goodFields(l.state)) }), 200);
  assert.equal(await l.result, "ok");
});

test("Deny ends the login with no session written", async () => {
  const l = await login();
  assert.equal(await post(l.port, { body: form({ state: l.state, denied: "1" }) }), 200);
  assert.equal(await l.result, "denied");
  assert.ok(!existsSync(join(l.sessionDir, "session.json")));
});

test("login times out", async () => {
  const l = await login(50);
  assert.equal(await l.result, "timeout");
});

test("S12: a port already in use fails with exit code 4", async () => {
  const blocker = net.createServer();
  await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", r));
  const port = (blocker.address() as net.AddressInfo).port;
  try {
    await assert.rejects(
      startLogin({ apiOrigin: API, port, host: "127.0.0.1", sessionDir: tmp() }),
      (err: unknown) => err instanceof LoginError && err.exitCode === 4,
    );
  } finally {
    blocker.close();
  }
});

test("origins with no portal mapping refuse session login with exit code 2", async () => {
  await assert.rejects(
    startLogin({ apiOrigin: "https://api.cdb-staging.cdn.orange.com", port: 0, host: "127.0.0.1" }),
    (err: unknown) => err instanceof LoginError && err.exitCode === 2,
  );
});
