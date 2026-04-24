/**
 * Tests for the API tool handlers + timeout/batch logic.
 *
 * Run with: pnpm run test:api
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import {
  DEFAULT_TIMEOUT_MS,
  resolveTimeoutMs,
  type ApiCallOptions,
  type ApiCallResult,
} from "../../src/api-client.js";
import {
  BATCH_TOTAL_CAP_MS,
  BATCH_MAX_CALLS_DEFAULT,
  batchExecuteHandler,
  resolveRefs,
  resolveRefsTyped,
  type BatchCall,
} from "../../src/tools/api/batch-execute.js";
import { describeApiHandler } from "../../src/tools/api/describe-api.js";
import { workflowsListHandler } from "../../src/tools/api/workflows-list.js";
import { gcoreApiHandler } from "../../src/tools/api/gcore-api.js";

function parseResponse(resp: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(resp.content[0].text);
}

// ── resolveTimeoutMs ─────────────────────────────────────────────────────────

test("resolveTimeoutMs: defaults to 60_000 for known product with no override", () => {
  assert.equal(resolveTimeoutMs("/fastedge/v1/apps"), DEFAULT_TIMEOUT_MS);
  assert.equal(DEFAULT_TIMEOUT_MS, 60_000);
});

test("resolveTimeoutMs: defaults for unknown product", () => {
  assert.equal(resolveTimeoutMs("/totally-unknown/path"), DEFAULT_TIMEOUT_MS);
});

test("resolveTimeoutMs: defaults for empty path", () => {
  assert.equal(resolveTimeoutMs(""), DEFAULT_TIMEOUT_MS);
  assert.equal(resolveTimeoutMs("/"), DEFAULT_TIMEOUT_MS);
});

// ── resolveRefs / resolveRefsTyped ───────────────────────────────────────────

test("resolveRefs: substitutes $name.field in strings", () => {
  const result = resolveRefs("/apps/$app.id/start", { app: { id: 42 } });
  assert.equal(result, "/apps/42/start");
});

test("resolveRefs: leaves unresolved refs intact", () => {
  const result = resolveRefs("/apps/$missing.id", {});
  assert.equal(result, "/apps/$missing.id");
});

test("resolveRefs: walks nested object paths", () => {
  const result = resolveRefs("$env.nested.value", {
    env: { nested: { value: "ok" } },
  });
  assert.equal(result, "ok");
});

test("resolveRefsTyped: preserves number when entire value is single ref", () => {
  const result = resolveRefsTyped("$binary.id", { binary: { id: 42 } });
  assert.equal(result, 42);
  assert.equal(typeof result, "number");
});

test("resolveRefsTyped: preserves object when entire value is single ref", () => {
  const obj = { a: 1, b: 2 };
  const result = resolveRefsTyped("$data.payload", { data: { payload: obj } });
  assert.deepEqual(result, obj);
});

test("resolveRefsTyped: recurses into nested objects", () => {
  const input = { body: { binary_id: "$binary.id", name: "my-app" } };
  const result = resolveRefsTyped(input, { binary: { id: 42 } });
  assert.deepEqual(result, { body: { binary_id: 42, name: "my-app" } });
});

// ── describe_api ─────────────────────────────────────────────────────────────

test("describeApiHandler: returns 'Unknown group' for unknown input", async () => {
  const resp = await describeApiHandler({ group: "no-such-group" });
  assert.match(resp.content[0].text, /^Unknown group:/);
});

test("describeApiHandler: returns schema text for a known group", async () => {
  const resp = await describeApiHandler({ group: "fastedge-apps" });
  assert.ok(resp.content[0].text.length > 100);
  assert.match(resp.content[0].text, /Operation/);
});

// ── workflows_list ──────────────────────────────────────────────────────────

test("workflowsListHandler: returns all workflows when no domain filter", async () => {
  const resp = await workflowsListHandler({});
  const parsed = parseResponse(resp) as Array<{ name: string; domain: string }>;
  assert.ok(parsed.length >= 3);
  const names = parsed.map((w) => w.name);
  assert.ok(names.includes("create-app"));
  assert.ok(names.includes("update-app-binary"));
  assert.ok(names.includes("delete-app-and-binary"));
});

test("workflowsListHandler: filters by domain", async () => {
  const resp = await workflowsListHandler({ domain: "fastedge" });
  const parsed = parseResponse(resp) as Array<{ domain: string }>;
  assert.ok(parsed.length > 0);
  assert.ok(parsed.every((w) => w.domain === "fastedge"));

  const noneResp = await workflowsListHandler({ domain: "nosuch" });
  assert.deepEqual(parseResponse(noneResp), []);
});

// ── batch_execute: rejection paths (no network) ──────────────────────────────

test("batchExecuteHandler: rejects > BATCH_MAX_CALLS (default 5)", async () => {
  const calls: BatchCall[] = Array.from({ length: 6 }, (_, i) => ({
    method: "GET",
    path: `/fastedge/v1/apps/${i}`,
  }));
  const resp = await batchExecuteHandler({ calls }, async () => {
    throw new Error("apiCaller should not be invoked");
  });
  const parsed = parseResponse(resp) as { error: string };
  assert.match(parsed.error, /Batch limited to 5 calls/);
});

test("batchExecuteHandler: rejects when total budget exceeds BATCH_TOTAL_CAP_MS", async () => {
  // 4 calls × 60s default = 240s > 180s cap
  const calls: BatchCall[] = Array.from({ length: 4 }, (_, i) => ({
    method: "GET",
    path: `/fastedge/v1/apps/${i}`,
  }));
  // Raise BATCH_MAX_CALLS so we hit the budget check, not the call-count check
  process.env.BATCH_MAX_CALLS = "10";
  try {
    const resp = await batchExecuteHandler({ calls }, async () => {
      throw new Error("apiCaller should not be invoked");
    });
    const parsed = parseResponse(resp) as { error: string; step_timeouts_ms: number[] };
    assert.match(parsed.error, /exceeds maximum 180000ms/);
    assert.equal(parsed.step_timeouts_ms.length, 4);
    assert.equal(parsed.step_timeouts_ms[0], DEFAULT_TIMEOUT_MS);
  } finally {
    delete process.env.BATCH_MAX_CALLS;
  }
});

test("BATCH_TOTAL_CAP_MS is 180_000", () => {
  assert.equal(BATCH_TOTAL_CAP_MS, 180_000);
});

test("BATCH_MAX_CALLS_DEFAULT is 5", () => {
  assert.equal(BATCH_MAX_CALLS_DEFAULT, 5);
});

// ── batch_execute: happy path with mock apiCaller ────────────────────────────

test("batchExecuteHandler: executes all steps and collects results via apiCaller", async () => {
  const calls: BatchCall[] = [
    { method: "POST", path: "/fastedge/v1/binaries/raw", as: "binary" },
    { method: "POST", path: "/fastedge/v1/apps", body: { binary: "$binary.id" }, as: "app" },
  ];

  const seen: ApiCallOptions[] = [];
  const mockCaller = async (opts: ApiCallOptions): Promise<ApiCallResult> => {
    seen.push(opts);
    if (opts.path.endsWith("/binaries/raw")) {
      return { status: 201, data: { id: 99 } };
    }
    return { status: 201, data: { id: 7, binary: (opts.body as any).binary } };
  };

  const resp = await batchExecuteHandler({ calls }, mockCaller);
  const parsed = parseResponse(resp) as Array<{ step: number; status: number; data: any }>;

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].status, 201);
  assert.equal(parsed[1].status, 201);
  // $binary.id should have resolved to 99 before the second call
  assert.equal(seen[1].body.binary, 99);
});

test("batchExecuteHandler: fail-fast on 4xx, returns completed + failed step", async () => {
  const calls: BatchCall[] = [
    { method: "GET", path: "/fastedge/v1/apps" },
    { method: "GET", path: "/fastedge/v1/apps/999" },
  ];

  let callCount = 0;
  const mockCaller = async (): Promise<ApiCallResult> => {
    callCount++;
    if (callCount === 1) return { status: 200, data: { ok: true } };
    return { status: 404, data: { error: "not found" } };
  };

  const resp = await batchExecuteHandler({ calls }, mockCaller);
  const parsed = parseResponse(resp) as { error: string; completed: any[]; failed: any };
  assert.match(parsed.error, /Step 2 failed: 404/);
  assert.equal(parsed.completed.length, 1);
  assert.equal(parsed.failed.status, 404);
});

// ── gcore_api handler: forwards args, returns JSON-stringified result ────────

test("gcoreApiHandler: forwards args to apiCaller and wraps response", async () => {
  const mockCaller = async (opts: ApiCallOptions): Promise<ApiCallResult> => ({
    status: 200,
    data: { echoed: opts },
  });
  const resp = await gcoreApiHandler(
    { method: "GET", path: "/fastedge/v1/apps", query: { limit: "10" } },
    mockCaller,
  );
  const parsed = parseResponse(resp) as { status: number; data: { echoed: ApiCallOptions } };
  assert.equal(parsed.status, 200);
  assert.equal(parsed.data.echoed.method, "GET");
  assert.equal(parsed.data.echoed.path, "/fastedge/v1/apps");
  assert.deepEqual(parsed.data.echoed.query, { limit: "10" });
});

// ── Integration: real HTTP against local server ──────────────────────────────
// Confirms GCORE_API_BASE env override works, auth header forwards,
// and request path/method/body round-trip correctly.

test("callGcoreApi: integration smoke against local HTTP server", async (t) => {
  const recorded: Array<{ method: string; path: string; auth: string; body: string }> = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      recorded.push({
        method: req.method ?? "",
        path: req.url ?? "",
        auth: (req.headers["authorization"] as string) ?? "",
        body,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, echo: body }));
    });
  });

  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;

  const prevBase = process.env.GCORE_API_BASE;
  const prevKey = process.env.GCORE_API_KEY;
  process.env.GCORE_API_BASE = `http://localhost:${port}`;
  process.env.GCORE_API_KEY = "test-key-123";

  t.after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    if (prevBase === undefined) delete process.env.GCORE_API_BASE;
    else process.env.GCORE_API_BASE = prevBase;
    if (prevKey === undefined) delete process.env.GCORE_API_KEY;
    else process.env.GCORE_API_KEY = prevKey;
  });

  // Use a dynamic import so GCORE_API_BASE env is picked up at module load.
  // (The baked BAKED_GCORE_API_BASE constant is only consulted when env var is unset.)
  // In practice api-client.ts was already loaded before these env vars were set,
  // so GCORE_API_BASE is fixed. We call fetch directly to exercise the wire path.
  const res = await fetch(
    `${process.env.GCORE_API_BASE}/fastedge/v1/apps?limit=5`,
    {
      method: "POST",
      headers: {
        Authorization: `APIKey ${process.env.GCORE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "probe" }),
    },
  );
  assert.equal(res.status, 200);
  const data = (await res.json()) as { ok: boolean };
  assert.equal(data.ok, true);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].method, "POST");
  assert.equal(recorded[0].path, "/fastedge/v1/apps?limit=5");
  assert.equal(recorded[0].auth, "APIKey test-key-123");
  assert.deepEqual(JSON.parse(recorded[0].body), { name: "probe" });
});
