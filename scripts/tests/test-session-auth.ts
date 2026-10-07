/**
 * Session-approval gate tests (fastedge-coordinator context/session-approval/SECURITY.md, phase 1).
 * Run via: tsx --test scripts/tests/test-session-auth.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, statSync, existsSync, readFileSync, lstatSync, chmodSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { authRequiredResult, createAuth, type Auth, type AuthRequiredReason } from "../../src/auth/credentials.js";
import { LoginError, connectWithCode, ensureInstallationId, logoutActive, startLogin, useCachedAccount } from "../../src/auth/login-server.js";
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
const HOST = "api.preprod.world";
const accountFile = (dir: string, clientId = 123) => join(dir, "accounts", `${HOST}_${clientId}.json`);
const activeFile = (dir: string) => join(dir, `active-${HOST}.json`);
const pointer = (clientId: number) => ({ version: 1, api_origin: API, client_id: clientId, generation: `p${clientId}` });
/** Writes an account file (object or raw text) and points this origin at it. Returns the volume dir. */
const writeSession = (dir: string, data: unknown, clientId = (data as { client_id?: number })?.client_id ?? 123) => {
  mkdirSync(join(dir, "accounts"), { recursive: true });
  writeFileSync(accountFile(dir, clientId), typeof data === "string" ? data : JSON.stringify(data));
  writeFileSync(activeFile(dir), JSON.stringify(pointer(clientId)));
  return dir;
};
const authFor = (dir: string, key = "") => createAuth(key, { sessionDir: dir, apiOrigin: API });
const resolverFor = (dir: string) => {
  const auth = authFor(dir);
  return () => auth.resolve();
};
const sessionHeader = (token = TOKEN) => ({ header: `APIKey ${token}`, source: "session" });

// --- Resolver -----------------------------------------------------------------

test("S1: an explicit key wins, even a wrong one, with a valid session present", () => {
  const dir = writeSession(tmp(), session());
  assert.deepEqual(authFor(dir, "wrong-key").resolve(), { header: "APIKey wrong-key", source: "explicit" });
});

test("a valid session yields the session token", () => {
  assert.deepEqual(resolverFor(writeSession(tmp(), session()))(), sessionHeader());
});

const rejected: Array<[string, (dir: string) => string, AuthRequiredReason]> = [
  ["missing", (dir) => dir, "no_session"],
  ["pointing at a missing account", (dir) => (writeFileSync(activeFile(dir), JSON.stringify(pointer(5))), dir), "no_session"],
  [
    "the account file's client_id differs from the pointer's",
    (dir) => writeSession(dir, session({ client_id: 999 }), 123),
    "no_session",
  ],
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
      const elsewhere = join(tmp(), "real.json");
      writeFileSync(elsewhere, JSON.stringify(session()));
      writeSession(dir, session());
      rmSync(accountFile(dir));
      symlinkSync(elsewhere, accountFile(dir));
      return dir;
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
  writeSession(dir, session());
  const resolve = resolverFor(dir);
  assert.ok("header" in resolve());
  writeSession(dir, session({ token: "4243_renewed" }));
  assert.deepEqual(resolve(), sessionHeader("4243_renewed"));
  writeSession(dir, session({ client_id: 999 }));
  assert.deepEqual(resolve(), { authRequired: "account_changed" });
});

test("S15: a stray temp file from a crashed write leaves the old session in use", () => {
  const dir = tmp();
  writeSession(dir, session());
  writeFileSync(join(dir, "accounts", ".tmp-deadbeef"), '{"version":1,"token":"half');
  assert.deepEqual(resolverFor(dir)(), sessionHeader());
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
  writeSession(dir, session());
  const auth = authFor(dir);

  const before = auth.status();
  assert.equal(before.state, "available");
  assert.equal(before.pinned_client_id, null, "reading status must not pin");

  writeSession(dir, session({ client_id: 999 }));
  assert.ok("header" in auth.resolve(), "first real use pins 999, not the account seen earlier");
  writeSession(dir, session({ client_id: 123 }));

  const after = auth.status();
  assert.equal(after.state, "account_changed");
  assert.equal(after.pinned_client_id, 999);
  assert.equal((after.active_session as { client_id: number }).client_id, 123);
  const cached = (after.cached_accounts as Array<{ client_id: number; usable: boolean }>).map((a) => a.client_id).sort();
  assert.deepEqual(cached, [123, 999]);
  assert.match(String(after.next_step), /Restart this MCP server/);
  assert.ok(!JSON.stringify(after).includes(TOKEN));
});

test("status with an explicit key ignores the cache", () => {
  const status = authFor(writeSession(tmp(), session()), "a-key").status();
  assert.equal(status.credential, "explicit_key");
  assert.ok(!JSON.stringify(status).includes(TOKEN));
});

test("status reports a missing session with the login command", () => {
  const status = authFor(tmp()).status();
  assert.equal(status.state, "no_session");
  assert.equal(status.active_session, null);
  assert.deepEqual(status.cached_accounts, []);
  assert.match(String(status.login_command), / login$/);
  assert.match(String(status.use_command), / login --use <client_id>$/);
  // Renewing the same account needs no restart; only switching does.
  assert.match(String(status.renew_session), /No restart is needed/);
  assert.match(String(status.switch_account), /^Only to use a different account: .*Restart this MCP server/);
});

// --- Tools: a session token rejected by the API (Fix 1) ---------------------------

type ToolText = { isError?: boolean; content: Array<{ type: string; text: string }> };

async function toolsWith(auth: Auth, workspaceRoot = tmp()) {
  const server = new McpServer({ name: "test", version: "0" });
  registerApiTools(server, { workspaceRoot, auth });
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
  globalThis.fetch = (async (url: string) => {
    // The broker's one-time account check (GET /iam/clients/me) answers for account 123.
    if (String(url).endsWith("/iam/clients/me")) {
      return new Response(JSON.stringify({ id: 123 }), { status: 200, headers: { "content-type": "application/json" } });
    }
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
  assert.equal(status.active_session.client_id, 123);
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
  assert.ok(!existsSync(accountFile(l.sessionDir)), "nothing written before a valid callback");

  assert.equal(await post(l.port, { body: good }), 200);
  assert.equal(await l.result, "ok");

  const file = accountFile(l.sessionDir);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(activeFile(l.sessionDir)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).client_id, 123);
  assert.equal(JSON.parse(readFileSync(activeFile(l.sessionDir), "utf8")).client_id, 123);
  assert.deepEqual(resolverFor(l.sessionDir)(), sessionHeader());

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
  assert.ok(!existsSync(accountFile(l.sessionDir)));
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

// --- Installation id (task 05) ----------------------------------------------------

const ID = /^[0-9a-f]{32}$/;

test("login creates the installation id once (0644) and puts it in the URL", async () => {
  const sessionDir = tmp();
  const first = await startLogin({ apiOrigin: API, port: 0, host: "127.0.0.1", sessionDir });
  const id = new URL(first.url).searchParams.get("install") ?? "";
  assert.match(id, ID);
  const file = join(sessionDir, "installation_id");
  assert.equal(readFileSync(file, "utf8"), id);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  await post(first.port, { body: form({ state: stateOf(first.url), denied: "1" }) });

  const second = await startLogin({ apiOrigin: API, port: 0, host: "127.0.0.1", sessionDir });
  assert.equal(new URL(second.url).searchParams.get("install"), id, "reused, never rotated");
  await post(second.port, { body: form({ state: stateOf(second.url), denied: "1" }) });
});

test("a malformed installation id is replaced", () => {
  const dir = tmp();
  writeFileSync(join(dir, "installation_id"), "not-an-id");
  const id = ensureInstallationId(dir);
  assert.match(id, ID);
  assert.equal(ensureInstallationId(dir), id);
});

test("a symlinked installation id is not followed; it is replaced by a real file", () => {
  const dir = tmp();
  const target = join(tmp(), "elsewhere");
  writeFileSync(target, "0".repeat(32));
  symlinkSync(target, join(dir, "installation_id"));
  const id = ensureInstallationId(dir);
  assert.match(id, ID);
  assert.ok(!lstatSync(join(dir, "installation_id")).isSymbolicLink());
  assert.equal(readFileSync(target, "utf8"), "0".repeat(32), "the link target is untouched");
});

test("login refuses with exit 2 when the volume isn't writable (it could never save a session)", async () => {
  // A cache dir that can't be created (read-only parent), as with a volume owned by someone else.
  const parent = tmp();
  chmodSync(parent, 0o555);
  try {
    await assert.rejects(
      startLogin({ apiOrigin: API, port: 0, host: "127.0.0.1", sessionDir: join(parent, "cache") }),
      (err: unknown) => err instanceof LoginError && err.exitCode === 2,
    );
  } finally {
    chmodSync(parent, 0o755);
  }
});

// --- Per-account cache (task 07) ---------------------------------------------------

const PROD = "https://api.gcore.com";
const usable = (overrides: Record<string, unknown> = {}) => session(overrides);
const expiredSession = (overrides: Record<string, unknown> = {}) =>
  session({ expires_at: new Date(Date.now() - HOUR).toISOString(), ...overrides });

test("legacy session.json is read until the first login migrates it", () => {
  const dir = tmp();
  writeFileSync(join(dir, "session.json"), JSON.stringify(session()));
  assert.deepEqual(resolverFor(dir)(), sessionHeader(), "reader falls back while there's no pointer");

  useCachedAccount({ apiOrigin: API, clientId: 123, sessionDir: dir }); // takes the lock → migrates
  assert.ok(!existsSync(join(dir, "session.json")));
  assert.ok(existsSync(accountFile(dir)));
  assert.equal(JSON.parse(readFileSync(activeFile(dir), "utf8")).client_id, 123);
  assert.deepEqual(resolverFor(dir)(), sessionHeader());
});

test("--use switches to a cached account without a new token, and refuses unusable ones (exit 7)", () => {
  const dir = tmp();
  writeSession(dir, usable({ client_id: 111, token: "111_a" }));
  writeSession(dir, usable({ client_id: 222, token: "222_b" }));
  assert.deepEqual(resolverFor(dir)(), sessionHeader("222_b"));

  const switched = useCachedAccount({ apiOrigin: API, clientId: 111, sessionDir: dir });
  assert.equal(switched.client_id, 111);
  assert.deepEqual(resolverFor(dir)(), sessionHeader("111_a"), "a fresh process uses the switched account");

  const isExit7 = (err: unknown) => err instanceof LoginError && err.exitCode === 7;
  assert.throws(() => useCachedAccount({ apiOrigin: API, clientId: 999, sessionDir: dir }), isExit7);
  writeSession(dir, expiredSession({ client_id: 333 }));
  writeSession(dir, usable({ client_id: 111, token: "111_a" }));
  assert.throws(() => useCachedAccount({ apiOrigin: API, clientId: 333, sessionDir: dir }), isExit7);
});

test("a running server stays pinned when the active account switches (S5)", () => {
  const dir = tmp();
  writeSession(dir, usable({ client_id: 111 }));
  writeSession(dir, usable({ client_id: 222 }));
  const resolve = resolverFor(dir);
  assert.ok("header" in resolve());
  useCachedAccount({ apiOrigin: API, clientId: 111, sessionDir: dir });
  assert.deepEqual(resolve(), { authRequired: "account_changed" });
});

test("expired accounts and dangling pointers are removed under the lock", () => {
  const dir = tmp();
  writeSession(dir, expiredSession({ client_id: 333 }));
  writeSession(dir, usable({ client_id: 111 }));
  writeFileSync(join(dir, "active-api.gcore.com.json"), JSON.stringify({ ...pointer(5), api_origin: PROD }));
  useCachedAccount({ apiOrigin: API, clientId: 111, sessionDir: dir });
  assert.ok(!existsSync(accountFile(dir, 333)));
  assert.ok(existsSync(accountFile(dir, 111)));
  assert.ok(!existsSync(join(dir, "active-api.gcore.com.json")), "pointer to a missing account removed");
});

test("prod and preprod sessions don't affect each other", () => {
  const dir = tmp();
  writeSession(dir, usable({ client_id: 111, token: "111_pre" }));
  mkdirSync(join(dir, "accounts"), { recursive: true });
  writeFileSync(join(dir, "accounts", "api.gcore.com_777.json"), JSON.stringify(session({ client_id: 777, api_origin: PROD, token: "777_prod" })));
  writeFileSync(join(dir, "active-api.gcore.com.json"), JSON.stringify({ ...pointer(777), api_origin: PROD }));

  assert.deepEqual(resolverFor(dir)(), sessionHeader("111_pre"));
  const prod = createAuth("", { sessionDir: dir, apiOrigin: PROD });
  assert.deepEqual(prod.resolve(), sessionHeader("777_prod"));
  const listed = (authFor(dir).status().cached_accounts as Array<{ client_id: number }>).map((a) => a.client_id);
  assert.deepEqual(listed, [111], "status lists only this origin's accounts");
});

test("--logout removes only the active account (local only) and is a no-op when signed out", () => {
  const dir = tmp();
  writeSession(dir, usable({ client_id: 111 }));
  writeSession(dir, usable({ client_id: 222 }));
  const out = logoutActive({ apiOrigin: API, sessionDir: dir });
  assert.equal(out?.client_id, 222);
  assert.ok(!existsSync(accountFile(dir, 222)));
  assert.ok(!existsSync(activeFile(dir)));
  assert.ok(existsSync(accountFile(dir, 111)), "other cached accounts stay");
  assert.equal(logoutActive({ apiOrigin: API, sessionDir: dir }), null);
});

test("a second login while one is running fails with exit 3; the lock is released afterwards", async () => {
  const sessionDir = tmp();
  const first = await startLogin({ apiOrigin: API, port: 0, host: "127.0.0.1", sessionDir });
  const isExit3 = (err: unknown) => err instanceof LoginError && err.exitCode === 3;
  await assert.rejects(startLogin({ apiOrigin: API, port: 0, host: "127.0.0.1", sessionDir }), isExit3);
  assert.throws(() => useCachedAccount({ apiOrigin: API, clientId: 1, sessionDir }), isExit3);

  await post(first.port, { body: form({ state: stateOf(first.url), denied: "1" }) });
  assert.equal(await first.result, "denied");
  assert.ok(!existsSync(join(sessionDir, ".lock")));
  const again = await startLogin({ apiOrigin: API, port: 0, host: "127.0.0.1", sessionDir });
  await post(again.port, { body: form({ state: stateOf(again.url), denied: "1" }) });
});

test("a fresh lock blocks; a lock without a heartbeat for 30 s is taken over (a killed login)", async () => {
  const sessionDir = tmp();
  writeFileSync(join(sessionDir, ".lock"), "someone-else");
  const isExit3 = (err: unknown) => err instanceof LoginError && err.exitCode === 3;
  await assert.rejects(startLogin({ apiOrigin: API, port: 0, host: "127.0.0.1", sessionDir }), isExit3);
  const old = new Date(Date.now() - 31_000);
  utimesSync(join(sessionDir, ".lock"), old, old);
  const l = await startLogin({ apiOrigin: API, port: 0, host: "127.0.0.1", sessionDir });
  assert.notEqual(readFileSync(join(sessionDir, ".lock"), "utf8"), "someone-else", "now ours");
  // A lock that isn't ours any more (taken over) is left alone on release.
  writeFileSync(join(sessionDir, ".lock"), "a-newer-login");
  await post(l.port, { body: form({ state: stateOf(l.url), denied: "1" }) });
  await l.result;
  assert.equal(readFileSync(join(sessionDir, ".lock"), "utf8"), "a-newer-login");
});

test("cached accounts in status never include tokens", () => {
  const dir = tmp();
  writeSession(dir, usable({ client_id: 111 }));
  writeSession(dir, expiredSession({ client_id: 333 }));
  writeSession(dir, usable({ client_id: 111 }));
  const status = authFor(dir).status();
  const accounts = status.cached_accounts as Array<{ client_id: number; usable: boolean }>;
  assert.deepEqual(accounts.map((a) => [a.client_id, a.usable]).sort(), [[111, true], [333, false]]);
  assert.ok(!JSON.stringify(status).includes(TOKEN));
});

// --- Lifetime cap (task 06) ---------------------------------------------------------

test("callback accepts a 7-day expiry and rejects anything past 7 days + 5 minutes", async () => {
  const sevenDays = 7 * 24 * HOUR;

  const ok = await login();
  const atCap = form({ ...goodFields(ok.state), expires_at: new Date(Date.now() + sevenDays).toISOString() });
  assert.equal(await post(ok.port, { body: atCap }), 200);
  assert.equal(await ok.result, "ok");

  const over = await login();
  const tooLong = form({ ...goodFields(over.state), expires_at: new Date(Date.now() + sevenDays + 6 * 60_000).toISOString() });
  assert.equal(await post(over.port, { body: tooLong }), 400);
  assert.ok(!existsSync(accountFile(over.sessionDir)));
  await post(over.port, { body: form({ state: over.state, denied: "1" }) });
});

test("auth_required no longer promises a fixed 8-hour session", () => {
  const text = authRequiredResult("no_session", { apiOrigin: API }).content[0].text;
  assert.match(text, /time-limited session/);
  assert.doesNotMatch(text, /8-hour/);
});

// --- Manual connect code (task 08) --------------------------------------------------

const encode = (payload: Record<string, unknown>) =>
  `fe1.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
const codePayload = (overrides: Record<string, unknown> = {}) => ({
  v: 1,
  token: TOKEN,
  token_id: 4242,
  client_id: 123,
  expires_at: new Date(Date.now() + 8 * HOUR).toISOString(),
  api_origin: API,
  ...overrides,
});

test("a valid connect code saves a session exactly like a browser login", () => {
  const dir = tmp();
  const saved = connectWithCode(`  ${encode(codePayload())}\n`, { apiOrigin: API, sessionDir: dir });
  assert.equal(saved.client_id, 123);
  assert.equal(statSync(accountFile(dir)).mode & 0o777, 0o600);
  assert.deepEqual(resolverFor(dir)(), sessionHeader());
  assert.ok(!existsSync(join(dir, ".lock")), "lock released");
});

const badCodes: Array<[string, string]> = [
  ["a raw token", TOKEN],
  ["the wrong prefix", encode(codePayload()).replace("fe1.", "fe2.")],
  ["not base64url", "fe1.@@@"],
  ["not JSON", `fe1.${Buffer.from("nope").toString("base64url")}`],
  ["the wrong version", encode(codePayload({ v: 2 }))],
  ["another origin", encode(codePayload({ api_origin: "https://api.gcore.com" }))],
  ["an expired session", encode(codePayload({ expires_at: new Date(Date.now() - 1000).toISOString() }))],
  ["a lifetime past the 7-day cap", encode(codePayload({ expires_at: new Date(Date.now() + 8 * 24 * HOUR).toISOString() }))],
  ["a bad token", encode(codePayload({ token: "a b" }))],
  ["a missing client_id", encode(codePayload({ client_id: undefined }))],
];
for (const [label, code] of badCodes) {
  test(`login --code rejects ${label} (exit 8, nothing written)`, () => {
    const dir = tmp();
    assert.throws(
      () => connectWithCode(code, { apiOrigin: API, sessionDir: dir }),
      (err: unknown) => err instanceof LoginError && err.exitCode === 8 && !String(err.message).includes(TOKEN),
    );
    assert.ok(!existsSync(join(dir, "accounts")));
  });
}

test("login --code refuses to read from a pipe (exit 2)", () => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "src/login.ts", "--code"], {
    input: `${encode(codePayload())}\n`,
    env: { ...process.env, GCORE_API_BASE: API },
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /own terminal/);
});

test("auth_required and status offer the manual fallback, and warn against pasting into chat", () => {
  const text = authRequiredResult("no_session", { apiOrigin: API }).content[0].text;
  assert.match(text, /https:\/\/portal\.preprod\.world\/fastedge\/agent-connect/);
  assert.match(text, /docker run --rm -it .* login --code/);
  assert.match(text, /Never ask them to paste the connect code into this chat/);
  const status = authFor(tmp()).status();
  assert.match(String(status.code_command), / -it .* login --code$/);
});

// --- Broker-only storage modes (task 09 phase 2) ------------------------------------

test("every cache writer is owner-only: 0700 directories, 0600 files (lock and installation id too)", async () => {
  const sessionDir = tmp();
  chmodSync(sessionDir, 0o755); // a loose root dir gets tightened
  const l = await startLogin({ apiOrigin: API, port: 0, host: "127.0.0.1", sessionDir });
  assert.equal(statSync(join(sessionDir, ".lock")).mode & 0o777, 0o600, "lock held during login");
  assert.equal(statSync(join(sessionDir, "installation_id")).mode & 0o777, 0o600);
  assert.equal(await post(l.port, { body: form(goodFields(stateOf(l.url))) }), 200);
  assert.equal(await l.result, "ok");
  assert.equal(statSync(sessionDir).mode & 0o777, 0o700);
  assert.equal(statSync(join(sessionDir, "accounts")).mode & 0o777, 0o700);
  assert.equal(statSync(accountFile(sessionDir)).mode & 0o777, 0o600);
  assert.equal(statSync(activeFile(sessionDir)).mode & 0o777, 0o600);

  const dir = tmp();
  connectWithCode(encode(codePayload({ client_id: 777 })), { apiOrigin: API, sessionDir: dir });
  for (const p of [dir, join(dir, "accounts")]) assert.equal(statSync(p).mode & 0o777, 0o700, p);
  assert.equal(statSync(accountFile(dir, 777)).mode & 0o777, 0o600);
});

test("an interrupted login (SIGINT/SIGTERM) releases the lock", () => {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const dir = tmp();
    const script = `
      import { startLogin } from "./src/auth/login-server.ts";
      process.on("SIGINT", () => process.exit(130));
      process.on("SIGTERM", () => process.exit(143));
      await startLogin({ apiOrigin: "${API}", port: 0, host: "127.0.0.1", sessionDir: ${JSON.stringify(dir)} });
      process.kill(process.pid, "${signal}");
      setTimeout(() => {}, 10_000);
    `;
    const r = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, GCORE_API_BASE: API },
    });
    assert.equal(r.status, signal === "SIGINT" ? 130 : 143, r.stderr);
    assert.ok(!existsSync(join(dir, ".lock")), `lock left behind after ${signal}`);
  }
});

test("auth_required offers three choices: browser here, remote with a code, not now", () => {
  const text = authRequiredResult("no_session", { apiOrigin: API }).content[0].text;
  assert.match(text, /multiple-choice question/);
  assert.match(text, /1\. Browser on this computer \(recommended\)/);
  assert.match(text, /2\. Remote .*\n.*agent-connect.*\n.*login --code/);
  assert.match(text, /3\. Not now/);
  assert.match(text, /Never ask them to paste the connect code/);
  assert.match(text, /After 1 or 2, retry this request/);
});
