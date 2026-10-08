// Task 10 v2: "Keep me signed in" chosen on the Approve page (fastedge-coordinator
// tasks/10-ephemeral-session.md, "v2 design" + the MoM rules). Persistence matrix, no fallback
// from a present sealed file, sealed/plaintext transitions and races, and the commands.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createAuth } from "../../src/auth/credentials.js";
import { LoginError, connectWithCode, decidePersist, startLogin } from "../../src/auth/login-server.js";
import { generateRecipient, seal } from "../../src/auth/seal.js";
import { codeCommand, loginCommand, manualFallback, setSealTo, useCommand } from "../../src/auth/session.js";
import { acquireLock, writeSealed } from "../../src/auth/store.js";

const API = "https://api.preprod.world";
const PLAIN = "4242_CANARY-plaintext-token";
const SEALED = "4242_CANARY-sealed-token";
const HOUR = 3_600_000;
const tmp = () => mkdtempSync(join(tmpdir(), "choice-"));
const get = { method: "GET", path: "/fastedge/v1/apps" };

// --- The persistence decision (MoM rule 5) ---------------------------------------------------

test("persist matrix: forced never keeps; choice needs exactly one 0|1; no key can't honour 0", () => {
  const forced = { sealTo: "k", forced: true };
  const choice = { sealTo: "k" };
  const legacy = {};
  const cases: Array<[object, string[], string | null]> = [
    [forced, [], "seal"], [forced, ["0"], "seal"], [forced, ["1"], null], [forced, ["0", "0"], null], [forced, ["yes"], null],
    [choice, ["0"], "seal"], [choice, ["1"], "keep"], [choice, [], null], [choice, ["0", "1"], null], [choice, [""], null], [choice, ["true"], null],
    [legacy, [], "keep"], [legacy, ["1"], "keep"], [legacy, ["0"], null], [legacy, ["1", "1"], null],
  ];
  for (const [mode, values, want] of cases) assert.equal(decidePersist(values, mode), want, `${JSON.stringify(mode)} ${JSON.stringify(values)}`);
});

// --- Login with a choice -----------------------------------------------------------------------

function post(port: number, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/callback", method: "POST",
        headers: { Host: `127.0.0.1:${port}`, Origin: "null", "Content-Type": "application/x-www-form-urlencoded", "Content-Length": String(Buffer.byteLength(body)) } },
      (res) => { res.resume(); resolve(res.statusCode ?? 0); },
    );
    req.on("error", reject);
    req.end(body);
  });
}
const fields = (state: string, lifetime: number, persist: string[]) => {
  const f = new URLSearchParams({ state, token: SEALED, token_id: "4242", client_id: "123", api_origin: API, expires_at: new Date(Date.now() + lifetime).toISOString() });
  for (const p of persist) f.append("persist", p);
  return f.toString();
};
const filesIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesIn(join(dir, e.name)).map((f) => `${e.name}/${f}`) : [e.name]));
const legacyPoc = (dir: string) => writeFileSync(join(dir, "session.json"), JSON.stringify({ version: 1, generation: "g", token: "4242_old", token_id: 1, client_id: 7, api_origin: API, expires_at: new Date(Date.now() + HOUR).toISOString(), created_at: new Date().toISOString() }));

async function choiceLogin(dir: string) {
  const recipient = generateRecipient();
  const l = await startLogin({ apiOrigin: API, port: 0, host: "127.0.0.1", sessionDir: dir, sealTo: recipient.publicKey });
  return { recipient, l, state: new URL(l.url).searchParams.get("state")! };
}

test("choice login: seal=1 plus the installation id; a bad persist is refused; persist=0 seals and leaves plaintext alone", async () => {
  const dir = tmp();
  legacyPoc(dir); // must not be migrated by a "don't keep" login (MoM rule 6)
  const { l, state } = await choiceLogin(dir);
  const url = new URL(l.url);
  assert.equal(url.searchParams.get("seal"), "1");
  assert.equal(url.searchParams.get("ephemeral"), null);
  assert.match(url.searchParams.get("install") ?? "", /^[0-9a-f]{32}$/);

  for (const bad of [[], ["0", "1"], ["maybe"]]) assert.equal(await post(l.port, fields(state, 8 * HOUR, bad)), 400, JSON.stringify(bad));
  assert.equal(await post(l.port, fields(state, 48 * HOUR, ["0"])), 400, "don't keep is capped at 8 h");
  assert.equal(await post(l.port, fields(state, 8 * HOUR, ["0"])), 303);
  assert.equal(await l.result, "ok");

  const files = filesIn(dir);
  assert.ok(files.includes("session.json"), "legacy file untouched");
  assert.ok(!files.some((f) => f.startsWith("accounts/")), "no plaintext account written");
  assert.ok(files.some((f) => f.startsWith("sealed/")));
  for (const f of files) assert.ok(!readFileSync(join(dir, f), "utf8").includes(SEALED), `${f}: no plaintext token`);
});

test("choice login: persist=1 keeps (plaintext, up to 7 days) and only then migrates", async () => {
  const dir = tmp();
  legacyPoc(dir);
  const { l, state } = await choiceLogin(dir);
  assert.equal(await post(l.port, fields(state, 7 * 24 * HOUR, ["1"])), 303);
  assert.equal(await l.result, "ok");
  const files = filesIn(dir);
  assert.ok(!files.includes("session.json"), "legacy migrated now");
  assert.ok(files.includes("accounts/api.preprod.world_123.json"));
  assert.ok(!files.some((f) => f.startsWith("sealed/")));
});

test("a login without a key refuses persist=0 (it can't seal), and keeps by default", async () => {
  const dir = tmp();
  const l = await startLogin({ apiOrigin: API, port: 0, host: "127.0.0.1", sessionDir: dir });
  const state = new URL(l.url).searchParams.get("state")!;
  assert.equal(new URL(l.url).searchParams.get("seal"), null);
  assert.equal(await post(l.port, fields(state, 8 * HOUR, ["0"])), 400);
  assert.equal(await post(l.port, fields(state, 8 * HOUR, [])), 303);
  assert.ok(existsSync(join(dir, "accounts", "api.preprod.world_123.json")));
});

// --- Connect codes: fe1 keeps, fe2 doesn't (MoM rule 1) ------------------------------------------

const code = (v: 1 | 2, lifetime = 4 * HOUR, extra: Record<string, unknown> = {}) =>
  `fe${v}.` + Buffer.from(JSON.stringify({ v, token: SEALED, token_id: 4242, client_id: 123, api_origin: API, expires_at: new Date(Date.now() + lifetime).toISOString(), ...extra })).toString("base64url");
const isExit8 = (e: unknown) => e instanceof LoginError && e.exitCode === 8;

test("codes: fe2 seals (needs a key, 8 h cap); fe1 keeps; a version/prefix mismatch is refused", () => {
  const recipient = generateRecipient();
  const sealDir = tmp();
  connectWithCode(code(2), { apiOrigin: API, sessionDir: sealDir, sealTo: recipient.publicKey });
  assert.ok(filesIn(sealDir).every((f) => f.startsWith("sealed/") || f === ".lock"), filesIn(sealDir).join());
  assert.throws(() => connectWithCode(code(2, 48 * HOUR), { apiOrigin: API, sessionDir: tmp(), sealTo: recipient.publicKey }), isExit8);
  assert.throws(() => connectWithCode(code(2), { apiOrigin: API, sessionDir: tmp() }), isExit8, "fe2 without a key");

  const keepDir = tmp();
  connectWithCode(code(1, 7 * 24 * HOUR), { apiOrigin: API, sessionDir: keepDir, sealTo: recipient.publicKey });
  assert.ok(existsSync(join(keepDir, "accounts", "api.preprod.world_123.json")));

  const swapped = "fe1." + code(2).slice(4); // fe1 prefix, v:2 body
  assert.throws(() => connectWithCode(swapped, { apiOrigin: API, sessionDir: tmp(), sealTo: recipient.publicKey }), isExit8);
  assert.throws(() => connectWithCode("fe2." + code(1).slice(4), { apiOrigin: API, sessionDir: tmp(), sealTo: recipient.publicKey }), isExit8);
});

// --- Broker in normal mode with a key ------------------------------------------------------------

/** Plaintext session for account `clientId` with `PLAIN`, active. */
function plaintext(dir: string, clientId = 123) {
  mkdirSync(join(dir, "accounts"), { recursive: true });
  const s = { version: 1, generation: "g", token: PLAIN, token_id: 1, client_id: clientId, api_origin: API, expires_at: new Date(Date.now() + 24 * HOUR).toISOString(), created_at: new Date().toISOString() };
  writeFileSync(join(dir, "accounts", `api.preprod.world_${clientId}.json`), JSON.stringify(s));
  writeFileSync(join(dir, "active-api.preprod.world.json"), JSON.stringify({ version: 1, api_origin: API, client_id: clientId, generation: `p${clientId}` }));
}
function setup() {
  const recipient = generateRecipient();
  const dir = tmp();
  const auth = createAuth("", { sessionDir: dir, apiOrigin: API, recipient });
  const putSealed = (overrides: Record<string, unknown> = {}, to = recipient.publicKey) =>
    writeSealed(dir, recipient.publicKey, seal(to, { token: SEALED, api_origin: API, client_id: 123, token_id: 9, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 4 * HOUR).toISOString(), ...overrides } as any));
  return { recipient, dir, auth, putSealed };
}

/** Stub fetch. `me(token)` answers /iam/clients/me; `api(token)` the rest. Records the tokens sent. */
function stub(me: (token: string) => Response | Promise<Response> = (t) => json({ id: t === PLAIN ? plainId : 123 }), api: (token: string) => Response | Promise<Response> = () => json({ apps: [] })) {
  const original = globalThis.fetch;
  const sent: string[] = [];
  const meSent: string[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const token = String((init.headers as Record<string, string>).Authorization).replace("APIKey ", "");
    if (String(url).endsWith("/iam/clients/me")) { meSent.push(token); return me(token); }
    sent.push(token);
    return api(token);
  }) as typeof fetch;
  return { sent, meSent, restore: () => (globalThis.fetch = original) };
}
let plainId = 123;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

test("no sealed file: plaintext is used as before", async () => {
  const { dir, auth } = setup();
  plaintext(dir);
  const s = stub();
  try {
    assert.equal(((await auth.call(get)) as any).status, 200);
    assert.deepEqual(s.sent, [PLAIN]);
    assert.equal((auth.status() as any).mode, "persistent");
  } finally { s.restore(); }
});

test("a sealed file wins over plaintext, and the run stays sealed", async () => {
  const { dir, auth, putSealed } = setup();
  plaintext(dir);
  putSealed();
  const s = stub();
  try {
    await auth.call(get);
    await auth.call(get);
    assert.deepEqual(s.sent, [SEALED, SEALED]);
    const st = auth.status() as any;
    assert.equal(st.mode, "ephemeral");
    assert.equal(st.forced, false);
    assert.equal(st.use_command, undefined, "no switching commands in an ephemeral run");
  } finally { s.restore(); }
});

test("a present but unusable sealed file blocks plaintext (no fallback, MoM rule 2)", async () => {
  const cases: Array<[string, (x: ReturnType<typeof setup>) => void, string]> = [
    ["corrupt", (x) => { mkdirSync(join(x.dir, "sealed"), { recursive: true }); for (const f of [x.recipient.publicKey]) writeSealed(x.dir, f, { garbage: true }); }, "no_session"],
    ["over 8 h", (x) => x.putSealed({ expires_at: new Date(Date.now() + 9 * HOUR).toISOString() }), "no_session"],
    ["expired", (x) => x.putSealed({ expires_at: new Date(Date.now() - HOUR).toISOString() }), "expired"],
    ["other origin", (x) => x.putSealed({ api_origin: "https://api.gcore.com" }), "origin_mismatch"],
    ["another key", (x) => x.putSealed({}, generateRecipient().publicKey), "no_session"],
  ];
  const s = stub();
  try {
    for (const [label, plant, reason] of cases) {
      const x = setup();
      plaintext(x.dir);
      plant(x);
      assert.deepEqual(await x.auth.call(get), { authRequired: reason }, label);
    }
    assert.deepEqual(s.sent, [], "the plaintext token was never used");
    assert.ok(!s.meSent.includes(PLAIN), "not even for an account check");
  } finally { s.restore(); }
});

test("a sealed token rejected or unverifiable at the account check blocks plaintext too", async () => {
  for (const [me, want] of [
    [() => json({}, 401), { authRequired: "rejected", clientId: 123 }],
    [() => json({ id: 999 }), { authRequired: "account_mismatch" }],
    [() => json({}, 503), null],
  ] as const) {
    const { dir, auth, putSealed } = setup();
    plaintext(dir);
    putSealed();
    const s = stub((t) => (t === SEALED ? me() : json({ id: 123 })));
    try {
      const r = await auth.call(get);
      if (want) assert.deepEqual(r, want);
      else assert.equal((r as any).status, 503, "an IAM outage is an error, not a fallback");
      assert.deepEqual(s.sent, []);
      assert.ok(!s.meSent.includes(PLAIN));
    } finally { s.restore(); }
  }
});

test("a plaintext run switches to a sealed same-account session; another account gives account_changed", async () => {
  const same = setup();
  plaintext(same.dir);
  const s = stub();
  try {
    await same.auth.call(get); // pinned 123 on plaintext
    same.putSealed();
    await same.auth.call(get);
    assert.deepEqual(s.sent, [PLAIN, SEALED]);

    const other = setup();
    plaintext(other.dir);
    await other.auth.call(get);
    other.putSealed({ client_id: 456 });
    assert.deepEqual(await other.auth.call(get), { authRequired: "account_changed" });
  } finally { s.restore(); }
});

test("race: a plaintext call still verifying when a sealed token is adopted goes out with the sealed one", async () => {
  const { dir, auth, putSealed } = setup();
  plaintext(dir);
  let releasePlainMe!: () => void;
  const plainMe = new Promise<void>((r) => (releasePlainMe = r));
  const s = stub(async (t) => { if (t === PLAIN) await plainMe; return json({ id: 123 }); });
  try {
    const first = auth.call(get); // reads plaintext, waits on its account check
    await new Promise((r) => setTimeout(r, 10));
    putSealed();
    await auth.call(get); // adopts the sealed token
    releasePlainMe();
    await first;
    assert.deepEqual(s.sent, [SEALED, SEALED], "nothing went out with the plaintext token");
  } finally { s.restore(); }
});

test("race: a late 401 for a plaintext request doesn't end a sealed session adopted meanwhile", async () => {
  const { dir, auth, putSealed } = setup();
  plaintext(dir);
  let releasePlainApi!: () => void;
  const plainApi = new Promise<void>((r) => (releasePlainApi = r));
  const s = stub(undefined, async (t) => { if (t === PLAIN) { await plainApi; return json({}, 401); } return json({ ok: true }); });
  try {
    const first = auth.call(get); // goes out with the plaintext token, answer held back
    await new Promise((r) => setTimeout(r, 10));
    putSealed();
    assert.equal(((await auth.call(get)) as any).status, 200); // sealed adopted
    releasePlainApi();
    assert.deepEqual(await first, { authRequired: "rejected", clientId: 123 });
    assert.equal(((await auth.call(get)) as any).status, 200, "the sealed session still works");
    assert.equal((auth.status() as any).state, "available");
  } finally { s.restore(); }
});

test("after a sealed adoption: a 401 means restart, and plaintext is never used again", async () => {
  const { dir, auth, putSealed } = setup();
  plaintext(dir);
  putSealed();
  let status = 200;
  const s = stub(undefined, () => json({}, status));
  try {
    await auth.call(get);
    status = 401;
    assert.deepEqual(await auth.call(get), { authRequired: "restart_required" });
    status = 200;
    assert.deepEqual(await auth.call(get), { authRequired: "restart_required" });
    assert.deepEqual(s.sent, [SEALED, SEALED]);
  } finally { s.restore(); }
});

// --- Commands in choice mode ----------------------------------------------------------------------

test("choice-mode commands carry the key but don't force ephemeral; --use stays; manual link has seal=1", () => {
  const { publicKey } = generateRecipient();
  setSealTo(publicKey, false);
  assert.match(loginCommand(API)!, new RegExp(` login --seal-to ${publicKey}$`));
  assert.doesNotMatch(loginCommand(API)!, /FASTEDGE_SESSION/);
  assert.match(codeCommand(API)!, / login --code --seal-to /);
  assert.doesNotMatch(codeCommand(API)!, /FASTEDGE_SESSION/);
  assert.match(useCommand(API)!, / login --use <client_id>$/);
  assert.match(manualFallback(API)!, /agent-connect\?seal=1 /);
});

/** Resolves once `cond()` holds (an explicit barrier, not a timing guess). */
async function until(cond: () => boolean) {
  for (let i = 0; i < 500 && !cond(); i++) await new Promise((r) => setImmediate(r));
  assert.ok(cond(), "barrier never reached");
}

test("race: a plaintext request for account A is never sent with a sealed token for account B", async () => {
  const { dir, auth, putSealed } = setup();
  plaintext(dir, 123);
  let releasePlainMe!: () => void;
  const plainMe = new Promise<void>((r) => (releasePlainMe = r));
  const s = stub(async (t) => { if (t === PLAIN) { await plainMe; return json({ id: 123 }); } return json({ id: 456 }); });
  try {
    const first = auth.call({ method: "DELETE", path: "/fastedge/v1/apps/1" }); // for account 123
    await until(() => s.meSent.includes(PLAIN));
    putSealed({ client_id: 456 });
    assert.equal(((await auth.call(get)) as any).status, 200); // adopts 456
    releasePlainMe();
    assert.deepEqual(await first, { authRequired: "account_changed" });
    assert.deepEqual(s.sent, [SEALED], "only the second call went out; the DELETE for 123 never did");
  } finally { s.restore(); }
});

test("status: a pending sealed session for another account than the pinned one shows account_changed", async () => {
  const { dir, auth, putSealed } = setup();
  plaintext(dir, 123);
  const s = stub();
  try {
    await auth.call(get); // pins 123
    putSealed({ client_id: 456 });
    assert.equal((auth.status() as any).state, "account_changed");
  } finally { s.restore(); }
});

test("once sealed, deleting or replacing files changes nothing", async () => {
  const { dir, auth, putSealed } = setup();
  putSealed();
  const s = stub();
  try {
    await auth.call(get);
    writeSealed(dir, generateRecipient().publicKey, {}); // noise elsewhere
    putSealed({ token: "4242_a-replacement" });
    plaintext(dir, 123);
    await auth.call(get);
    assert.deepEqual(s.sent, [SEALED, SEALED]);
  } finally { s.restore(); }
});

// --- Login lock: fencing and takeover --------------------------------------------------------------

test("a login that lost its lock (another took over) saves nothing", async () => {
  const dir = tmp();
  const { l, state } = await choiceLogin(dir);
  writeFileSync(join(dir, ".lock"), "another-login"); // as after a takeover
  assert.equal(await post(l.port, fields(state, 8 * HOUR, ["1"])), 500);
  assert.ok(!existsSync(join(dir, "accounts")), "no plaintext written");
  assert.ok(!existsSync(join(dir, "sealed")), "nothing sealed either");
  assert.equal(await post(l.port, new URLSearchParams({ state, denied: "1" }).toString()), 303); // end the login
  await l.result;
});

test("lock: held() follows ownership; a fresh foreign lock blocks; release leaves a foreign lock alone", () => {
  const dir = tmp();
  const release = acquireLock(dir);
  assert.equal(release.held(), true);
  writeFileSync(join(dir, ".lock"), "someone-else");
  assert.equal(release.held(), false);
  assert.throws(() => acquireLock(dir), /in progress/);
  release();
  assert.equal(readFileSync(join(dir, ".lock"), "utf8"), "someone-else");
});

// --- Outcome redirect (PROTOCOL §6): a handled callback goes back to the portal's outcome page ------

/** POST with full control of headers; resolves to the status and Location. */
function postRaw(port: number, body: string, headers: Record<string, string> = {}): Promise<{ status: number; location?: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/callback", method: "POST",
        headers: { Host: `127.0.0.1:${port}`, Origin: "null", "Content-Type": "application/x-www-form-urlencoded", "Content-Length": String(Buffer.byteLength(body)), ...headers } },
      (res) => { res.resume(); resolve({ status: res.statusCode ?? 0, location: res.headers.location }); },
    );
    req.on("error", reject);
    req.end(body);
  });
}
const OUTCOME = "https://portal.preprod.world/fastedge/agent-connect?result=";

test("outcome redirect: 303 to the mapped portal page in legacy, choice (0 and 1) and forced modes", async () => {
  const key = generateRecipient().publicKey;
  const modes: Array<[string, object, string[]]> = [
    ["legacy", {}, []],
    ["choice keep", { sealTo: key }, ["1"]],
    ["choice don't keep", { sealTo: key }, ["0"]],
    ["forced", { sealTo: key, forced: true }, []],
  ];
  for (const [label, mode, persist] of modes) {
    for (const deny of [false, true]) {
      const l = await startLogin({ apiOrigin: API, port: 0, host: "127.0.0.1", sessionDir: tmp(), ...mode });
      const state = new URL(l.url).searchParams.get("state")!;
      const body = deny ? new URLSearchParams({ state, denied: "1" }).toString() : fields(state, 4 * HOUR, persist);
      const r = await postRaw(l.port, body);
      assert.equal(r.status, 303, `${label} ${deny ? "deny" : "approve"}`);
      assert.equal(r.location, OUTCOME + (deny ? "denied" : "connected"), label);
      await l.result;
    }
  }
});

test("outcome redirect: the target comes only from the mapping, and carries nothing but the result", async () => {
  const dir = tmp();
  const l = await startLogin({ apiOrigin: API, port: 0, host: "127.0.0.1", sessionDir: dir });
  const state = new URL(l.url).searchParams.get("state")!;
  const body = fields(state, 4 * HOUR, []) + "&location=https%3A%2F%2Fevil.example&portal=https%3A%2F%2Fevil.example&result=pwned&redirect=%2F%2Fevil.example";
  const r = await postRaw(l.port, body, { Origin: "https://portal.preprod.world", Referer: "https://evil.example/x" });
  assert.equal(r.status, 303);
  assert.equal(r.location, OUTCOME + "connected");
  for (const secret of [SEALED, "4242", state]) assert.ok(!r.location!.includes(secret), `Location leaks ${secret}`);
  // State consumed and the session written before the redirect: the file exists, a replay is a 400.
  assert.ok(existsSync(join(dir, "accounts", "api.preprod.world_123.json")));
  assert.ok(!(await postRaw(l.port, body).catch(() => ({ status: 0 }))).location, "a replay is never redirected");
});

test("outcome redirect: every rejection is a static 400, never a redirect", async () => {
  const key = generateRecipient().publicKey;
  const l = await startLogin({ apiOrigin: API, port: 0, host: "127.0.0.1", sessionDir: tmp(), sealTo: key });
  const state = new URL(l.url).searchParams.get("state")!;
  const bad: Array<[string, string, Record<string, string>]> = [
    ["wrong state", fields("x".repeat(43), 4 * HOUR, ["1"]), {}],
    ["missing persist", fields(state, 4 * HOUR, []), {}],
    ["don't keep over 8 h", fields(state, 48 * HOUR, ["0"]), {}],
    ["foreign Origin", fields(state, 4 * HOUR, ["1"]), { Origin: "https://evil.example" }],
    ["bad token_id", fields(state, 4 * HOUR, ["1"]).replace("token_id=4242", "token_id=abc"), {}],
  ];
  for (const [label, body, headers] of bad) {
    const r = await postRaw(l.port, body, headers);
    assert.equal(r.status, 400, label);
    assert.equal(r.location, undefined, `${label}: no redirect`);
  }
  assert.equal((await postRaw(l.port, new URLSearchParams({ state, denied: "1" }).toString())).status, 303); // end it
  await l.result;
});

// --- `--account`: renewals and known switches accept only that account ------------------------------

test("auth_required for an expired/rejected session names the account and pins the commands to it", async () => {
  const { authRequiredResult } = await import("../../src/auth/credentials.js");
  for (const reason of ["expired", "rejected"] as const) {
    const text = authRequiredResult(reason, { apiOrigin: API, clientId: 5724274 }).content[0].text;
    assert.match(text, /This session was for Gcore account 5724274/);
    assert.match(text, /login --seal-to \S+ --account 5724274\n/);
    assert.match(text, /login --code --seal-to \S+ --account 5724274/);
    assert.match(text, /agent-connect\?seal=1&account=5724274 /);
  }
  const fresh = authRequiredResult("no_session", { apiOrigin: API, clientId: 5724274 }).content[0].text;
  assert.doesNotMatch(fresh, /--account/, "only renewals are pinned");
});

test("login --account: the link carries account=; another account's approval is refused and nothing is saved", async () => {
  const dir = tmp();
  const l = await startLogin({ apiOrigin: API, port: 0, host: "127.0.0.1", sessionDir: dir, account: 777 });
  assert.equal(new URL(l.url).searchParams.get("account"), "777");
  const state = new URL(l.url).searchParams.get("state")!;
  assert.equal(await post(l.port, fields(state, 4 * HOUR, [])), 400, "client_id 123 ≠ 777");
  assert.ok(!existsSync(join(dir, "accounts")), "nothing saved");
  const ok = new URLSearchParams({ state, token: SEALED, token_id: "4242", client_id: "777", api_origin: API, expires_at: new Date(Date.now() + 4 * HOUR).toISOString() }).toString();
  assert.equal(await post(l.port, ok), 303);
  assert.ok(existsSync(join(dir, "accounts", "api.preprod.world_777.json")));
});

test("login --code --account: a code for another account is refused", () => {
  assert.throws(() => connectWithCode(code(1), { apiOrigin: API, sessionDir: tmp(), account: 777 }), (e: unknown) => e instanceof LoginError && e.exitCode === 8 && /for account 123, but this login is for account 777/.test((e as Error).message));
});

test("status offers login_for_account for switching to a known account", () => {
  const status = createAuth("", { sessionDir: tmp(), apiOrigin: API }).status() as Record<string, unknown>;
  assert.match(String(status.login_for_account), / --account <client_id>$/);
  assert.match(String(status.switch_account), /login_for_account/);
});
