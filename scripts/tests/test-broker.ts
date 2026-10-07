// Token broker (fastedge-coordinator PROTOCOL.md §2a): frames, request policy, and the
// broker/client pair over a real Unix socket. The container isolation itself is tested by
// scripts/tests/test-broker-isolation.sh.
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FrameReader, checkRequest, connectBroker, encodeFrame, readIdentity, serveBroker } from "../../src/auth/broker.js";
import { createAuth, type Auth } from "../../src/auth/credentials.js";

const API = "https://api.preprod.world";
const TOKEN = "4242_CANARY-broker-token-do-not-leak";
const HOUR = 3_600_000;

// --- Frames -------------------------------------------------------------------------

test("frames survive arbitrary chunking, with and without a body", () => {
  const got: Array<[unknown, string | undefined]> = [];
  const reader = new FrameReader(1024, (m) => m.body_bytes ?? 0, (m, body) => got.push([m, body?.toString()]));
  const bytes = Buffer.concat([
    encodeFrame({ a: 1 }),
    encodeFrame({ body_bytes: 5 }),
    Buffer.from("hello"),
    encodeFrame({ b: 2 }),
  ]);
  for (const byte of bytes) reader.push(Buffer.from([byte]));
  assert.deepEqual(got, [
    [{ a: 1 }, undefined],
    [{ body_bytes: 5 }, "hello"],
    [{ b: 2 }, undefined],
  ]);
});

test("an oversized frame or bad JSON throws (the connection is dropped)", () => {
  const reader = new FrameReader(8, () => 0, () => {});
  assert.throws(() => reader.push(encodeFrame({ longer: "than eight bytes" })));
  const bad = Buffer.alloc(7);
  bad.writeUInt32BE(3);
  bad.write("{x}", 4);
  assert.throws(() => new FrameReader(8, () => 0, () => {}).push(bad));
});

// --- Request policy (MUST 6) ------------------------------------------------------------

const req = (path: string, extra: Record<string, unknown> = {}) => ({ op: "request", id: 1, method: "GET", path, ...extra });

test("allowed: policy paths, a trailing slash, and GET /iam/clients/me", () => {
  assert.equal(checkRequest(req("/fastedge/v1/apps"), API), null);
  assert.equal(checkRequest(req("/fastedge/v1/apps/"), API), null);
  assert.equal(checkRequest(req("/fastedge/v1/apps/42"), API), null);
  assert.equal(checkRequest(req("/iam/clients/me"), API), null);
  assert.equal(
    checkRequest(req("/fastedge/v1/binaries/raw", { method: "POST", content_type: "application/octet-stream", body_bytes: 4 }), API),
    null,
  );
});

for (const path of [
  "/fastedge/../iam/users",
  "/fastedge/v1/apps/..",
  "/fastedge/v1/./apps",
  "/fastedge/%2e%2e/iam/users",
  "//evil.example/fastedge/v1/apps",
  "/fastedge//v1/apps",
  "https://evil.example/fastedge/v1/apps",
  "@evil.example/fastedge/v1/apps",
  "/fastedge/v1/apps?x=1",
  "/fastedge/v1/apps#x",
  "/fastedge\\..\\iam",
  "/fastedge/v1/apps\n",
  "fastedge/v1/apps",
  "/iam/users",
  "/iam/clients/me/tokens",
]) {
  test(`denied path: ${JSON.stringify(path)}`, () => {
    assert.notEqual(checkRequest(req(path), API), null);
  });
}

test("denied: other methods, extra fields, bad query, body mismatches, other content types", () => {
  assert.equal(checkRequest(req("/fastedge/v1/apps", { method: "TRACE" }), API), "method not allowed");
  assert.equal(checkRequest(req("/iam/clients/me", { method: "POST" }), API), "operation not allowed by policy");
  assert.equal(checkRequest(req("/fastedge/v1/apps", { headers: { Authorization: "x" } }), API), "unexpected field");
  assert.equal(checkRequest(req("/fastedge/v1/apps", { url: "https://evil.example" }), API), "unexpected field");
  assert.equal(checkRequest(req("/fastedge/v1/apps", { query: "a=1" }), API), "bad query");
  assert.equal(checkRequest(req("/fastedge/v1/apps", { query: { a: 1 } }), API), "bad query");
  assert.equal(checkRequest(req("/fastedge/v1/apps", { query: [] }), API), "bad query");
  assert.equal(checkRequest(req("/fastedge/v1/apps", { body_bytes: 3 }), API), "bad body");
  assert.equal(checkRequest(req("/fastedge/v1/apps", { content_type: "application/json" }), API), "bad body");
  assert.equal(
    checkRequest(req("/fastedge/v1/apps", { method: "POST", content_type: "text/plain", body_bytes: 1 }), API),
    "content type not allowed",
  );
});

test("identity check: dropped only with no capabilities, no groups and no_new_privs", () => {
  const status = (caps: string, groups: string, nnp: string) =>
    `Uid:\t10002\t10002\t10002\t10002\nGid:\t10002\t10002\t10002\t10002\nGroups:\t${groups}\n` +
    `CapInh:\t${caps}\nCapPrm:\t${caps}\nCapEff:\t${caps}\nCapBnd:\t${caps}\nCapAmb:\t${caps}\nNoNewPrivs:\t${nnp}\n`;
  const ok = readIdentity(status("0000000000000000", "", "1"));
  assert.deepEqual(ok, { uids: [10002, 10002, 10002, 10002], gids: [10002, 10002, 10002, 10002], dropped: true });
  assert.equal(readIdentity(status("00000000a80425fb", "", "1")).dropped, false);
  assert.equal(readIdentity(status("0000000000000000", "10001", "1")).dropped, false);
  assert.equal(readIdentity(status("0000000000000000", "", "0")).dropped, false);
});

// --- Broker and client over a Unix socket -----------------------------------------------

const tmp = () => mkdtempSync(join(tmpdir(), "broker-"));

function cacheWithSession(token = TOKEN) {
  const dir = tmp();
  mkdirSync(join(dir, "accounts"));
  writeFileSync(
    join(dir, "accounts", "api.preprod.world_123.json"),
    JSON.stringify({
      version: 1,
      generation: "g",
      token,
      token_id: 4242,
      client_id: 123,
      api_origin: API,
      expires_at: new Date(Date.now() + 8 * HOUR).toISOString(),
      created_at: new Date().toISOString(),
    }),
  );
  writeFileSync(join(dir, "active-api.preprod.world.json"), JSON.stringify({ version: 1, api_origin: API, client_id: 123, generation: "p" }));
  return dir;
}

/** Starts a broker on a temp socket; returns the connected client and a way to stop it. */
async function brokerPair(sessionDir = cacheWithSession()) {
  return brokerPairIn(sessionDir);
}

async function brokerPairIn(sessionDir: string) {
  const socketPath = join(tmp(), "sock");
  const conns: net.Socket[] = [];
  const listener = net.createServer((conn) => {
    conns.push(conn);
    serveBroker(conn, createAuth("", { sessionDir, apiOrigin: API }), API);
  });
  await new Promise<void>((resolve) => listener.listen(socketPath, resolve));
  const client = await connectBroker({ socketPath, ownerUid: process.getuid!(), checkProcess: false, expectSeal: false });
  const stop = () => {
    conns.forEach((c) => c.destroy());
    listener.close();
  };
  return { client, stop, socketPath };
}

type Seen = { url: string; method?: string; headers: Record<string, string>; body?: Buffer };

/**
 * Stub fetch: records each request, answers with `respond`. The broker's account check
 * (GET /iam/clients/me) answers `me` (account 123 by default) and is counted in `meCalls`, not `seen`.
 */
function stubFetch(
  respond: (seen: Seen) => Response | Promise<Response>,
  me: (authorization: string) => Response | Promise<Response> = () => json({ id: 123 }),
) {
  const original = globalThis.fetch;
  const seen: Seen[] = [];
  const counts = { meCalls: 0 };
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    if (String(url).endsWith("/iam/clients/me")) {
      counts.meCalls++;
      return me((init.headers as Record<string, string>).Authorization);
    }
    const s: Seen = {
      url: String(url),
      method: init.method,
      headers: { ...(init.headers as Record<string, string>) },
      body: init.body ? Buffer.from(init.body as Uint8Array) : undefined,
    };
    seen.push(s);
    return respond(s);
  }) as typeof fetch;
  return { seen, counts, restore: () => (globalThis.fetch = original) };
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

async function withBroker(respond: (seen: Seen) => Response | Promise<Response>, fn: (client: Auth, seen: Seen[]) => Promise<void>) {
  const stub = stubFetch(respond);
  const { client, stop } = await brokerPair();
  try {
    await fn(client, stub.seen);
  } finally {
    stop();
    stub.restore();
  }
}

test("a request goes out with the session token, a fresh header set and the query split from the path", async () => {
  await withBroker(
    () => json({ apps: [] }),
    async (client, seen) => {
      const r = await client.call({ method: "GET", path: "/fastedge/v1/apps?limit=5", query: { offset: "10" } });
      assert.deepEqual(r, { status: 200, data: { apps: [] } });
      assert.equal(seen[0].url, `${API}/fastedge/v1/apps?limit=5&offset=10`);
      assert.deepEqual(Object.keys(seen[0].headers), ["Authorization"]);
      assert.equal(seen[0].headers.Authorization, `APIKey ${TOKEN}`);
    },
  );
});

test("JSON and binary bodies arrive byte for byte", async () => {
  await withBroker(
    () => json({ id: 7 }),
    async (client, seen) => {
      await client.call({ method: "POST", path: "/fastedge/v1/apps", body: { name: "x" } });
      assert.equal(seen[0].headers["Content-Type"], "application/json");
      assert.equal(seen[0].body?.toString(), '{"name":"x"}');

      const wasm = Buffer.from(Array.from({ length: 300_000 }, (_, i) => i % 256));
      await client.call({ method: "POST", path: "/fastedge/v1/binaries/raw", body: wasm, contentType: "application/octet-stream" });
      assert.equal(seen[1].headers["Content-Type"], "application/octet-stream");
      assert.ok(seen[1].body?.equals(wasm));
    },
  );
});

test("a policy denial is a broker error, and nothing is sent", async () => {
  await withBroker(
    () => json({}),
    async (client, seen) => {
      const r = await client.call({ method: "GET", path: "/iam/users" });
      assert.deepEqual(r, { status: 0, data: { error: "Token broker: operation not allowed by policy" } });
      assert.equal(seen.length, 0);
    },
  );
});

test("a 401 on the session token becomes rejected; a 403 passes through", async () => {
  let status = 401;
  await withBroker(
    () => json({ message: "Invalid API token" }, status),
    async (client) => {
      assert.deepEqual(await client.call({ method: "GET", path: "/fastedge/v1/apps" }), { authRequired: "rejected" });
      status = 403;
      assert.equal(((await client.call({ method: "GET", path: "/fastedge/v1/apps" })) as { status: number }).status, 403);
    },
  );
});

test("redirects are not followed", async () => {
  await withBroker(
    () => new Response(null, { status: 302, headers: { location: `${API}/fastedge/v1/other` } }),
    async (client, seen) => {
      const r = (await client.call({ method: "GET", path: "/fastedge/v1/apps" })) as { status: number; data: { error: string } };
      assert.equal(r.status, 0);
      assert.match(r.data.error, /redirect/);
      assert.equal(seen.length, 1);
    },
  );
});

test("responses over 16 MiB become an error", async () => {
  await withBroker(
    () => new Response("x".repeat(16 * 1024 * 1024 + 1), { headers: { "content-type": "text/plain" } }),
    async (client) => {
      const r = (await client.call({ method: "GET", path: "/fastedge/v1/apps" })) as { status: number; data: { error: string } };
      assert.equal(r.status, 0);
      assert.match(r.data.error, /larger than/);
    },
  );
});

test("Authorization canary: a failing request never returns the token", async () => {
  await withBroker(
    (seen) => {
      throw new Error(`upstream echoed ${seen.headers.Authorization}`);
    },
    async (client) => {
      const r = await client.call({ method: "GET", path: "/fastedge/v1/apps" });
      assert.deepEqual(r, { status: 0, data: { error: "Token broker: request failed" } });
      assert.ok(!JSON.stringify(r).includes(TOKEN));
    },
  );
});

test("Authorization canary: a response that echoes the token is withheld", async () => {
  await withBroker(
    (seen) => json({ echoed: seen.headers.Authorization }, 400),
    async (client) => {
      const r = await client.call({ method: "GET", path: "/fastedge/v1/apps" });
      assert.equal((r as { status: number }).status, 0);
      assert.match(JSON.stringify(r), /withheld/);
      assert.ok(!JSON.stringify(r).includes(TOKEN));
    },
  );
});

test("status comes from the broker and never includes the token", async () => {
  await withBroker(
    () => json({}),
    async (client) => {
      const status = (await client.status()) as Record<string, any>;
      assert.equal(status.credential, "session");
      assert.equal(status.active_session.client_id, 123);
      assert.ok(!JSON.stringify(status).includes(TOKEN));
    },
  );
});

test("no session gives no_session through the broker", async () => {
  const stub = stubFetch(() => json({}));
  const { client, stop } = await brokerPair(tmp());
  try {
    assert.deepEqual(await client.call({ method: "GET", path: "/fastedge/v1/apps" }), { authRequired: "no_session" });
    assert.equal(stub.seen.length, 0);
  } finally {
    stop();
    stub.restore();
  }
});

test("when the broker goes away, every call is broker_unavailable (no reconnect, no fallback)", async () => {
  const { client, stop } = await brokerPair();
  stop();
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(await client.call({ method: "GET", path: "/fastedge/v1/apps" }), { authRequired: "broker_unavailable" });
  assert.equal(((await client.status()) as Record<string, unknown>).state, "broker_unavailable");
});

test("the client refuses a socket owned by someone other than the broker", async () => {
  const { socketPath, stop } = await brokerPair();
  try {
    const client = await connectBroker({ socketPath, ownerUid: 12345, checkProcess: false });
    assert.deepEqual(await client.call({ method: "GET", path: "/fastedge/v1/apps" }), { authRequired: "broker_unavailable" });
  } finally {
    stop();
  }
});

test("the client refuses to connect from an unhardened process", async () => {
  const { socketPath, stop } = await brokerPair();
  try {
    // This test process has no no_new_privs, so the real check fails.
    const client = await connectBroker({ socketPath, ownerUid: process.getuid!() });
    assert.equal(((await client.status()) as Record<string, unknown>).state, "broker_unavailable");
  } finally {
    stop();
  }
});

test("the broker drops a connection that skips the handshake", async () => {
  const socketPath = join(tmp(), "sock");
  const listener = net.createServer((conn) => serveBroker(conn, createAuth("", { sessionDir: tmp(), apiOrigin: API }), API));
  await new Promise<void>((resolve) => listener.listen(socketPath, resolve));
  try {
    const closed = await new Promise<boolean>((resolve) => {
      const s = net.connect(socketPath, () => s.write(encodeFrame(req("/fastedge/v1/apps"))));
      s.on("data", () => resolve(false));
      s.on("close", () => resolve(true));
    });
    assert.equal(closed, true);
  } finally {
    listener.close();
  }
});

// --- Account check before a token's first use -----------------------------------------

async function withMe(me: (authorization: string) => Response | Promise<Response>, fn: (client: Auth, seen: Seen[], counts: { meCalls: number }) => Promise<void>) {
  const stub = stubFetch(() => json({ apps: [] }), me);
  const { client, stop } = await brokerPair();
  try {
    await fn(client, stub.seen, stub.counts);
  } finally {
    stop();
    stub.restore();
  }
}

test("a token is checked once with /iam/clients/me, then used; concurrent first calls share the check", async () => {
  await withMe(
    () => json({ id: 123, users: [] }),
    async (client, seen, counts) => {
      const calls = await Promise.all([1, 2, 3].map(() => client.call({ method: "GET", path: "/fastedge/v1/apps" })));
      calls.forEach((r) => assert.deepEqual(r, { status: 200, data: { apps: [] } }));
      await client.call({ method: "GET", path: "/fastedge/v1/apps" });
      assert.equal(counts.meCalls, 1);
      assert.equal(seen.length, 4);
      assert.equal(((await client.status()) as Record<string, unknown>).account_verified, true);
    },
  );
});

test("a token that belongs to another account is never used (account_mismatch), and nothing is pinned", async () => {
  await withMe(
    () => json({ id: 999 }),
    async (client, seen) => {
      assert.deepEqual(await client.call({ method: "GET", path: "/fastedge/v1/apps" }), { authRequired: "account_mismatch" });
      assert.equal(seen.length, 0);
      const status = (await client.status()) as Record<string, unknown>;
      assert.equal(status.pinned_client_id, null);
      assert.equal(status.account_verified, false);
    },
  );
});

test("the account check: a 401 is rejected; an IAM outage or 403 is an error, not a login or a fallback", async () => {
  await withMe(
    () => json({ message: "Invalid API token" }, 401),
    async (client) => {
      assert.deepEqual(await client.call({ method: "GET", path: "/fastedge/v1/apps" }), { authRequired: "rejected" });
    },
  );
  for (const status of [403, 429, 503]) {
    await withMe(
      () => json({ message: "nope" }, status),
      async (client, seen) => {
        const r = (await client.call({ method: "GET", path: "/fastedge/v1/apps" })) as { status: number; data: { error: string } };
        assert.equal(r.status, status);
        assert.match(r.data.error, /Couldn't confirm which account/);
        assert.equal(seen.length, 0);
      },
    );
  }
});

test("a missing or non-numeric id in the account check counts as a mismatch", async () => {
  await withMe(
    () => json({ id: "123" }),
    async (client) => {
      assert.deepEqual(await client.call({ method: "GET", path: "/fastedge/v1/apps" }), { authRequired: "account_mismatch" });
    },
  );
});

test("after pinning, a replacement token claiming the same account but belonging to another is refused", async () => {
  const dir = cacheWithSession();
  const stub = stubFetch(
    () => json({ apps: [] }),
    (authorization) => json({ id: authorization.includes("PLANTED") ? 999 : 123 }),
  );
  const { client, stop } = await brokerPairIn(dir);
  try {
    assert.equal(((await client.call({ method: "GET", path: "/fastedge/v1/apps" })) as { status: number }).status, 200);
    // Same claimed account (123), different real owner.
    const planted = cacheWithSession("4242_PLANTED-token");
    const file = "accounts/api.preprod.world_123.json";
    writeFileSync(join(dir, file), readFileSync(join(planted, file)));
    assert.deepEqual(await client.call({ method: "GET", path: "/fastedge/v1/apps" }), { authRequired: "account_mismatch" });
    assert.equal(stub.seen.length, 1);
  } finally {
    stop();
    stub.restore();
  }
});
