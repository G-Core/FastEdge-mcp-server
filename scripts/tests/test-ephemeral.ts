// Ephemeral session mode (fastedge-coordinator tasks/10-ephemeral-session.md, v1): the broker's
// adoption rules, fail-closed behaviour, the sealed login path and the broker handshake.
// The envelope itself is tested in test-seal.ts; the container in test-broker-isolation.sh.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { FrameReader, connectBroker, encodeFrame, serveBroker } from "../../src/auth/broker.js";
import { authRequiredResult, createEphemeralAuth } from "../../src/auth/credentials.js";
import { LoginError, connectWithCode, startLogin } from "../../src/auth/login-server.js";
import { generateRecipient, seal } from "../../src/auth/seal.js";
import { codeCommand, getSealTo, loginCommand, manualFallback, setSealTo, useCommand } from "../../src/auth/session.js";
import { writeSealed } from "../../src/auth/store.js";

const API = "https://api.preprod.world";
const TOKEN = "4242_CANARY-ephemeral-token-do-not-leak";
const HOUR = 3_600_000;
const tmp = () => mkdtempSync(join(tmpdir(), "ephemeral-"));

const payload = (overrides: Record<string, unknown> = {}) => ({
  token: TOKEN,
  api_origin: API,
  client_id: 123,
  token_id: 4242,
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 4 * HOUR).toISOString(),
  ...overrides,
});

/** A broker key, a cache dir and an ephemeral auth over them. */
function setup(now?: () => number) {
  const recipient = generateRecipient();
  const dir = tmp();
  const auth = createEphemeralAuth({ recipient, sessionDir: dir, apiOrigin: API, now });
  const put = (p = payload(), to = recipient.publicKey) => writeSealed(dir, recipient.publicKey, seal(to, p as any));
  return { recipient, dir, auth, put };
}

/** Stub fetch: GET /iam/clients/me answers `me`; anything else `respond`. Records the Authorization headers used. */
function stubFetch(me: () => Response = () => json({ id: 123 }), respond: () => Response = () => json({ apps: [] })) {
  const original = globalThis.fetch;
  const calls = { me: 0, api: 0, auth: [] as string[] };
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.auth.push((init.headers as Record<string, string>).Authorization);
    if (String(url).endsWith("/iam/clients/me")) {
      calls.me++;
      return me();
    }
    calls.api++;
    return respond();
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const get = { method: "GET", path: "/fastedge/v1/apps" };

// --- Broker adoption ---------------------------------------------------------------

test("no sealed file: no_session, and the plaintext cache is never read", async () => {
  const { dir, auth } = setup();
  // A legacy session and a plaintext account with an active pointer, both usable in normal mode.
  const plain = { version: 1, generation: "g", ...payload() };
  writeFileSync(join(dir, "session.json"), JSON.stringify(plain));
  mkdirSync(join(dir, "accounts"));
  writeFileSync(join(dir, "accounts", "api.preprod.world_123.json"), JSON.stringify(plain));
  writeFileSync(join(dir, "active-api.preprod.world.json"), JSON.stringify({ version: 1, api_origin: API, client_id: 123, generation: "g" }));
  const stub = stubFetch();
  try {
    assert.deepEqual(await auth.call(get), { authRequired: "no_session" });
    assert.equal(stub.calls.me + stub.calls.api, 0, "nothing was sent");
    const status = auth.status() as Record<string, unknown>;
    assert.equal(status.state, "no_session");
    assert.equal("cached_accounts" in status, false, "status lists no plaintext accounts");
  } finally {
    stub.restore();
  }
});

test("a sealed token is checked with /iam/clients/me, adopted, then used", async () => {
  const { auth, put } = setup();
  put();
  const stub = stubFetch();
  try {
    const r = await auth.call(get);
    assert.equal((r as { status: number }).status, 200);
    assert.equal(stub.calls.me, 1);
    assert.deepEqual(stub.calls.auth, [`APIKey ${TOKEN}`, `APIKey ${TOKEN}`]);
    const status = auth.status() as Record<string, any>;
    assert.equal(status.mode, "ephemeral");
    assert.equal(status.state, "available");
    assert.equal(status.account_verified, true);
    assert.equal(status.pinned_client_id, 123);
    assert.ok(!JSON.stringify(status).includes(TOKEN));
  } finally {
    stub.restore();
  }
});

test("one token per broker lifetime: an adopted token is never replaced from disk", async () => {
  const { auth, put } = setup();
  put();
  const stub = stubFetch();
  try {
    await auth.call(get);
    put(payload({ token: "4242_second-token", client_id: 123 }));
    await auth.call(get);
    assert.equal(stub.calls.me, 1, "no second adoption");
    assert.equal(stub.calls.auth.at(-1), `APIKey ${TOKEN}`);
  } finally {
    stub.restore();
  }
});

test("concurrent first calls share one adoption", async () => {
  const { auth, put } = setup();
  put();
  const stub = stubFetch();
  try {
    await Promise.all([auth.call(get), auth.call(get), auth.call(get)]);
    assert.equal(stub.calls.me, 1);
    assert.equal(stub.calls.api, 3);
  } finally {
    stub.restore();
  }
});

test("a mislabelled token isn't adopted; a correct one sealed later is", async () => {
  const { auth, put } = setup();
  put();
  let id = 999;
  const stub = stubFetch(() => json({ id }));
  try {
    assert.deepEqual(await auth.call(get), { authRequired: "account_mismatch" });
    assert.equal(stub.calls.api, 0);
    id = 123;
    assert.equal(((await auth.call(get)) as { status: number }).status, 200);
  } finally {
    stub.restore();
  }
});

test("expiry or a 401 after adoption means restart, never a re-read", async () => {
  let clock = Date.now();
  const { auth, put } = setup(() => clock);
  put();
  const stub = stubFetch(undefined, () => json({ error: "unauthorized" }, 401));
  try {
    assert.deepEqual(await auth.call(get), { authRequired: "restart_required" }, "401 after adoption");
    clock += 5 * HOUR;
    put(payload({ expires_at: new Date(clock + HOUR).toISOString() }));
    assert.deepEqual(await auth.call(get), { authRequired: "restart_required" }, "expired");
    assert.equal(stub.calls.me, 1);
    assert.equal((auth.status() as Record<string, unknown>).state, "restart_required");
  } finally {
    stub.restore();
  }
});

test("an envelope beyond the 8 h cap, expired, for another origin, or for another key isn't adopted", async () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ["over 8 h", { expires_at: new Date(Date.now() + 9 * HOUR).toISOString() }, "no_session"],
    ["expired", { expires_at: new Date(Date.now() - HOUR).toISOString() }, "expired"],
    ["other origin", { api_origin: "https://api.gcore.com" }, "origin_mismatch"],
  ];
  const stub = stubFetch();
  try {
    for (const [label, overrides, reason] of cases) {
      const { auth, put } = setup();
      put(payload(overrides));
      assert.deepEqual(await auth.call(get), { authRequired: reason }, label);
    }
    const { auth, put } = setup();
    put(payload(), generateRecipient().publicKey); // at our path, sealed to someone else
    assert.deepEqual(await auth.call(get), { authRequired: "no_session" }, "wrong key");
    assert.equal(stub.calls.me + stub.calls.api, 0);
  } finally {
    stub.restore();
  }
});

test("a 401 after adoption ends the session: nothing more is sent with that token", async () => {
  const { auth, put } = setup();
  put();
  let status = 401;
  const stub = stubFetch(undefined, () => json({}, status));
  try {
    assert.deepEqual(await auth.call(get), { authRequired: "restart_required" });
    status = 200; // even if the API would now accept it
    assert.deepEqual(await auth.call(get), { authRequired: "restart_required" });
    assert.equal(stub.calls.api, 1, "the rejected token was not sent again");
    assert.equal((auth.status() as Record<string, unknown>).state, "restart_required");
  } finally {
    stub.restore();
  }
});

// --- What the agent is told -----------------------------------------------------------

test("restart_required offers no login, only a restart", () => {
  const text = authRequiredResult("restart_required", { apiOrigin: API }).content[0].text;
  assert.match(text, /Restart this MCP server/);
  assert.doesNotMatch(text, /docker run/);
});

// --- Login: sealed delivery -------------------------------------------------------------

function post(port: number, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/callback",
        method: "POST",
        headers: {
          Host: `127.0.0.1:${port}`,
          Origin: "null",
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": String(Buffer.byteLength(body)),
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
const delivery = (state: string, lifetime = 8 * HOUR) =>
  new URLSearchParams({
    state,
    token: TOKEN,
    token_id: "4242",
    client_id: "123",
    expires_at: new Date(Date.now() + lifetime).toISOString(),
    api_origin: API,
  }).toString();

/** Every file under `dir`, relative. */
const filesIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesIn(join(dir, e.name)).map((f) => `${e.name}/${f}`) : [e.name],
  );

test("ephemeral login: ephemeral=1, no installation id, and only a sealed file is written", async () => {
  const recipient = generateRecipient();
  const dir = tmp();
  writeFileSync(join(dir, "session.json"), "{}"); // a legacy file is left alone (no migration)
  const l = await startLogin({ apiOrigin: API, port: 0, host: "127.0.0.1", sessionDir: dir, sealTo: recipient.publicKey });
  const url = new URL(l.url);
  assert.equal(url.searchParams.get("ephemeral"), "1");
  assert.equal(url.searchParams.get("install"), null);
  const state = url.searchParams.get("state")!;

  assert.equal(await post(l.port, delivery(state, 9 * HOUR)), 400, "over the 8 h cap");
  assert.equal(await post(l.port, delivery(state)), 200);
  assert.equal(await l.result, "ok");

  const files = filesIn(dir);
  assert.equal(files.length, 2, files.join(", "));
  assert.ok(files.includes("session.json"));
  assert.ok(files.some((f) => /^sealed\/[0-9a-f]{64}\.json$/.test(f)));
  for (const f of files) assert.ok(!readFileSync(join(dir, f), "utf8").includes(TOKEN), `${f} holds no plaintext token`);
  assert.equal(existsSync(join(dir, "installation_id")), false);

  // The broker with the matching key can adopt it.
  const auth = createEphemeralAuth({ recipient, sessionDir: dir, apiOrigin: API });
  const stub = stubFetch();
  try {
    assert.equal(((await auth.call(get)) as { status: number }).status, 200);
  } finally {
    stub.restore();
  }
});

test("ephemeral login refuses a missing or malformed key before listening", async () => {
  const lowOrder = Buffer.from("e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800", "hex").toString("base64url");
  for (const sealTo of ["", "short", "A".repeat(44), "A".repeat(42) + "+", "A".repeat(43) /* all-zero point */, lowOrder]) {
    await assert.rejects(
      startLogin({ apiOrigin: API, port: 0, host: "127.0.0.1", sessionDir: tmp(), sealTo }),
      (e: unknown) => e instanceof LoginError && e.exitCode === 2,
      JSON.stringify(sealTo),
    );
  }
});

test("--code seals too, with the 8 h cap", () => {
  const recipient = generateRecipient();
  const code = (lifetime: number) =>
    "fe1." +
    Buffer.from(
      JSON.stringify({ v: 1, token: TOKEN, token_id: 4242, client_id: 123, api_origin: API, expires_at: new Date(Date.now() + lifetime).toISOString() }),
    ).toString("base64url");
  const dir = tmp();
  assert.throws(
    () => connectWithCode(code(7 * 24 * HOUR), { apiOrigin: API, sessionDir: dir, sealTo: recipient.publicKey }),
    (e: unknown) => e instanceof LoginError && e.exitCode === 8,
  );
  connectWithCode(code(4 * HOUR), { apiOrigin: API, sessionDir: dir, sealTo: recipient.publicKey });
  const files = filesIn(dir);
  assert.equal(files.length, 1);
  assert.match(files[0], /^sealed\//);
  assert.ok(!readFileSync(join(dir, files[0]), "utf8").includes(TOKEN));
});

// --- Handshake and commands ----------------------------------------------------------------

test("the broker's handshake carries its key; the server's login commands then seal to it", async () => {
  const recipient = generateRecipient();
  setSealTo(recipient.publicKey); // the broker side, in this process
  const dir = tmp();
  const socketPath = join(tmp(), "sock");
  const conns: net.Socket[] = [];
  const listener = net.createServer((c) => {
    conns.push(c);
    serveBroker(c, createEphemeralAuth({ recipient, sessionDir: dir, apiOrigin: API }), API);
  });
  await new Promise<void>((resolve) => listener.listen(socketPath, resolve));
  try {
    await connectBroker({ socketPath, ownerUid: process.getuid!(), checkProcess: false });
    assert.equal(getSealTo(), recipient.publicKey);
    assert.match(loginCommand(API)!, new RegExp(` -e FASTEDGE_SESSION=ephemeral .* login --seal-to ${recipient.publicKey}$`));
    assert.match(codeCommand(API)!, / -e FASTEDGE_SESSION=ephemeral .* login --code --seal-to /);
    assert.equal(useCommand(API), null, "no --use in ephemeral mode");
    assert.match(manualFallback(API)!, /agent-connect\?ephemeral=1 /, "the manual path tells the page too");
  } finally {
    conns.forEach((c) => c.destroy());
    listener.close();
  }
});

test("a malformed seal_to in the handshake is refused (broker_unavailable)", async () => {
  const socketPath = join(tmp(), "sock");
  const listener = net.createServer((c) => {
    const reader = new FrameReader(1024, () => 0, () => c.write(encodeFrame({ ok: true, seal_to: "$(id)" })));
    c.on("data", (chunk: Buffer) => reader.push(chunk));
  });
  await new Promise<void>((resolve) => listener.listen(socketPath, resolve));
  try {
    const auth = await connectBroker({ socketPath, ownerUid: process.getuid!(), checkProcess: false });
    assert.deepEqual(await auth.call(get), { authRequired: "broker_unavailable" });
  } finally {
    listener.close();
  }
});

test("forced ephemeral: a handshake with no key, or an all-zero key, is refused", async () => {
  for (const hello of [{ ok: true }, { ok: true, seal_to: "A".repeat(43) }]) {
    const socketPath = join(tmp(), "sock");
    const listener = net.createServer((c) => {
      const reader = new FrameReader(1024, () => 0, () => c.write(encodeFrame(hello)));
      c.on("data", (chunk: Buffer) => reader.push(chunk));
    });
    await new Promise<void>((resolve) => listener.listen(socketPath, resolve));
    try {
      const auth = await connectBroker({ socketPath, ownerUid: process.getuid!(), checkProcess: false, expectSeal: true });
      assert.deepEqual(await auth.call(get), { authRequired: "broker_unavailable" }, JSON.stringify(hello));
    } finally {
      listener.close();
    }
  }
});
