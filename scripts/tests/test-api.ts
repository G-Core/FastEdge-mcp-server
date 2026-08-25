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
  callGcoreApi,
  resolveTimeoutMs,
  serializeBody,
  type ApiCallOptions,
  type ApiCallResult,
} from "../../src/api-client.js";
import {
  BATCH_TOTAL_CAP_MS,
  BATCH_MAX_CALLS_DEFAULT,
  batchCallSchema,
  batchExecuteHandler,
  resolveRefs,
  resolveRefsTyped,
  type BatchCall,
} from "../../src/tools/api/batch-execute.js";
import { describeApiHandler } from "../../src/tools/api/describe-api.js";
import { workflowsListHandler } from "../../src/tools/api/workflows-list.js";
import {
  gcoreApiBodySchema,
  gcoreApiHandler,
} from "../../src/tools/api/gcore-api.js";
import { isOperationAllowed } from "../../src/policy/evaluate.js";
import type { ProductConfig } from "../../src/config/products.js";
import { matchTemplate, checkAllowed } from "../../src/policy/enforce.js";
import type { AllowedOp } from "../../src/generated/policy.js";
import { validateWorkflows } from "../../src/workflows/validate.js";
import { workflows as registeredWorkflows } from "../../src/workflows/registry.js";
import type { Workflow } from "../../src/workflows/types.js";

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

test("batchExecuteHandler: atomic policy denial — one bad step prevents any execution", async () => {
  const calls: BatchCall[] = [
    { method: "GET",    path: "/fastedge/v1/apps" },                  // allowed
    { method: "DELETE", path: "/cdn/resources/123" },              // DENIED (cdn read-only)
    { method: "GET",    path: "/dns/v2/zones/example.com" },           // allowed (read)
  ];

  let callerInvocations = 0;
  const mockCaller = async (): Promise<ApiCallResult> => {
    callerInvocations++;
    return { status: 200, data: null };
  };

  const resp = await batchExecuteHandler({ calls }, mockCaller);
  const parsed = parseResponse(resp) as {
    error: string;
    denied_steps: Array<{ step: number; method: string; path: string }>;
  };
  assert.equal(parsed.error, "policy_denied");
  assert.equal(parsed.denied_steps.length, 1);
  assert.equal(parsed.denied_steps[0].step, 2);
  assert.equal(parsed.denied_steps[0].method, "DELETE");
  assert.equal(callerInvocations, 0, "no apiCaller invocations when batch is atomically denied");
});

test("batchExecuteHandler: reports every denied step, not just the first", async () => {
  const calls: BatchCall[] = [
    { method: "DELETE", path: "/cdn/resources/1" },
    { method: "DELETE", path: "/dns/v2/zones/example.com" },
  ];
  const resp = await batchExecuteHandler({ calls }, async () => ({ status: 200, data: null }));
  const parsed = parseResponse(resp) as { denied_steps: Array<{ step: number }> };
  assert.equal(parsed.denied_steps.length, 2);
  assert.deepEqual(parsed.denied_steps.map((d) => d.step), [1, 2]);
});

test("batchExecuteHandler: resolved path that escapes the allowlist is denied (ICM-50568)", async () => {
  const calls: BatchCall[] = [
    { method: "GET", path: "/fastedge/v1/apps", as: "planted" },
    { method: "DELETE", path: "/fastedge/v1/apps/$planted.v" },
  ];

  const seen: string[] = [];
  const mockCaller = async (opts: ApiCallOptions): Promise<ApiCallResult> => {
    seen.push(opts.path);
    return { status: 200, data: { v: "../../../cdn/resources/123" } };
  };

  const resp = await batchExecuteHandler({ calls }, mockCaller);
  const parsed = parseResponse(resp) as {
    error: string;
    denied_step: { step: number; resolved_path: string };
  };
  assert.equal(parsed.error, "policy_denied");
  assert.equal(parsed.denied_step.step, 2);
  assert.deepEqual(seen, ["/fastedge/v1/apps"], "traversal path must never be dispatched");
});

test("checkAllowed: normalizes traversal before matching", () => {
  assert.ok(
    checkAllowed("DELETE", "/fastedge/v1/apps/../../../cdn/origin_groups", sampleAllowlist),
    "traversal must not match",
  );
  assert.equal(
    checkAllowed("GET", "/fastedge/v1/apps/x/..", sampleAllowlist),
    null,
    "traversal that normalizes back onto an allowed path stays allowed",
  );
  assert.ok(
    checkAllowed("DELETE", "/fastedge/v1/apps/%2e%2e%2f%2e%2e", sampleAllowlist),
    "percent-encoded traversal must be denied",
  );
});

test("checkAllowed: policy view matches the outbound URL for control chars", () => {
  // WHATWG URL parsing strips TAB/LF/CR anywhere, so "%<LF>2f" would otherwise
  // dodge the encoded-separator check and reach the gateway as "%2f".
  assert.ok(
    checkAllowed("DELETE", "/fastedge/v1/apps/..%\n2f..%\n2fcdn", sampleAllowlist),
    "LF-obfuscated encoded slash must be denied",
  );
  // A space before "?" is trailing input once you hand-split on "?" (parser
  // trims it) but is percent-encoded on the wire — the two views must agree.
  const denial = checkAllowed("GET", "/fastedge/v1/apps ?x=1", sampleAllowlist);
  assert.ok(denial, "path that dispatches as /fastedge/v1/apps%20 must not match /fastedge/v1/apps");
  // A control char between two slashes: passes a leading-slash check on the raw
  // input, but the parser strips it into a protocol-relative "//host/...".
  for (const path of [
    "/\n/attacker.example/fastedge/v1/apps",
    "/\t/attacker.example/fastedge/v1/apps",
    "/\r/attacker.example/../fastedge/v1/apps",
  ]) {
    assert.ok(
      checkAllowed("GET", path, sampleAllowlist),
      `expected denial for ${JSON.stringify(path)}`,
    );
  }
});

test("callGcoreApi: refuses to send the API key off the configured origin", async () => {
  // No fetch happens: the guard returns before the request is made.
  const result = await callGcoreApi({
    method: "GET",
    path: "@attacker.example/../fastedge/v1/apps",
    authHeader: "APIKey test",
  });
  assert.equal(result.status, 0);
  assert.match(
    (result.data as { error: string }).error,
    /attacker\.example/,
    "expected an origin-escape refusal",
  );
});

test("checkAllowed: denies paths that manipulate the request authority", () => {
  // Each of these normalizes onto an allowlisted path, but concatenating it
  // onto GCORE_API_BASE changes the host or the requested path.
  for (const path of [
    "@attacker.example/../fastedge/v1/apps",   // → https://attacker.example/fastedge/v1/apps
    "//attacker.example/fastedge/v1/apps",
    "fastedge/v1/apps",                          // no leading slash
    "/\\attacker.example/../fastedge/v1/apps",
    "\\/attacker.example/../fastedge/v1/apps",
  ]) {
    assert.ok(
      checkAllowed("GET", path, sampleAllowlist),
      `expected denial for ${JSON.stringify(path)}`,
    );
  }
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

test("gcoreApiHandler: denies a forbidden call without invoking apiCaller", async () => {
  let called = false;
  const mockCaller = async (): Promise<ApiCallResult> => {
    called = true;
    return { status: 200, data: null };
  };
  const resp = await gcoreApiHandler(
    { method: "DELETE", path: "/cdn/resources/123" },
    mockCaller,
  );
  const parsed = parseResponse(resp) as { error: string; method: string; path: string };
  assert.equal(parsed.error, "policy_denied");
  assert.equal(parsed.method, "DELETE");
  assert.equal(parsed.path, "/cdn/resources/123");
  assert.equal(called, false, "apiCaller must not be invoked when policy denies");
});

test("gcoreApiHandler: allows a surgical write granted via allowedPaths", async () => {
  let called = false;
  const mockCaller = async (opts: ApiCallOptions): Promise<ApiCallResult> => {
    called = true;
    return { status: 200, data: { id: opts.path } };
  };
  const resp = await gcoreApiHandler(
    { method: "PATCH", path: "/cdn/resources/abc-123" },
    mockCaller,
  );
  assert.equal(called, true, "PATCH on /cdn/resources/{resource_id} must reach apiCaller");
  const parsed = parseResponse(resp) as { status: number };
  assert.equal(parsed.status, 200);
});

test("gcoreApiHandler: denies DELETE on a DNS path (read-write product)", async () => {
  let called = false;
  const mockCaller = async (): Promise<ApiCallResult> => {
    called = true;
    return { status: 200, data: null };
  };
  const resp = await gcoreApiHandler(
    { method: "DELETE", path: "/dns/v2/zones/example.com" },
    mockCaller,
  );
  const parsed = parseResponse(resp) as { error: string };
  assert.equal(parsed.error, "policy_denied");
  assert.equal(called, false);
});

// ── body-serialization fix (#23) ─────────────────────────────────────────────
// Schema-layer rejection + api-client safety-net normalization keep the
// "value must be an object" gateway rejection from happening when a caller
// supplies body as a JSON-encoded string instead of an object.

test("gcoreApiBodySchema: accepts object body", () => {
  const result = gcoreApiBodySchema.safeParse({ name: "foo", binary: 123 });
  assert.equal(result.success, true);
});

test("gcoreApiBodySchema: accepts array body", () => {
  const result = gcoreApiBodySchema.safeParse([{ key: "k", value: "v" }]);
  assert.equal(result.success, true);
});

test("gcoreApiBodySchema: accepts undefined (optional field)", () => {
  const result = gcoreApiBodySchema.safeParse(undefined);
  assert.equal(result.success, true);
});

test("gcoreApiBodySchema: rejects a JSON-encoded string body (the #23 bug shape)", () => {
  const result = gcoreApiBodySchema.safeParse('{"name":"foo","binary":123}');
  assert.equal(result.success, false);
});

test("gcoreApiBodySchema: rejects a raw string body", () => {
  const result = gcoreApiBodySchema.safeParse("not-json");
  assert.equal(result.success, false);
});

test("batchCallSchema: accepts object body on default (JSON) content type", () => {
  const result = batchCallSchema.safeParse({
    method: "POST",
    path: "/fastedge/v1/apps",
    body: { name: "foo", binary: 123 },
  });
  assert.equal(result.success, true);
});

test("batchCallSchema: rejects JSON-encoded string body when content_type is unset (defaults to JSON)", () => {
  const result = batchCallSchema.safeParse({
    method: "POST",
    path: "/fastedge/v1/apps",
    body: '{"name":"foo"}',
  });
  assert.equal(result.success, false);
});

test("batchCallSchema: rejects string body when content_type is explicitly application/json", () => {
  const result = batchCallSchema.safeParse({
    method: "POST",
    path: "/fastedge/v1/apps",
    body: '{"name":"foo"}',
    content_type: "application/json",
  });
  assert.equal(result.success, false);
});

test("batchCallSchema: accepts string body when content_type is application/octet-stream (binary upload)", () => {
  const result = batchCallSchema.safeParse({
    method: "POST",
    path: "/fastedge/v1/binaries/raw",
    body: "<base64-encoded-wasm-bytes>",
    content_type: "application/octet-stream",
  });
  assert.equal(result.success, true);
});

test("serializeBody: stringifies an object for application/json", () => {
  const out = serializeBody({ name: "foo", n: 1 }, "application/json");
  assert.equal(out, '{"name":"foo","n":1}');
});

test("serializeBody: normalizes a JSON-encoded string body to a JSON object on the wire", () => {
  const out = serializeBody('{"name":"foo","n":1}', "application/json");
  // Parsed and re-serialized — wire body is the object, not the quoted string.
  assert.equal(out, '{"name":"foo","n":1}');
  // Crucially, NOT the double-stringified `"{\"name\":\"foo\",\"n\":1}"` shape
  // that triggers the gateway's "value must be an object" rejection.
  assert.notEqual(out, JSON.stringify('{"name":"foo","n":1}'));
});

test("serializeBody: passes through unparseable string verbatim for application/json", () => {
  const out = serializeBody("not-json-just-text", "application/json");
  assert.equal(out, "not-json-just-text");
});

test("serializeBody: decodes a base64 string to Uint8Array for application/octet-stream", () => {
  // "hello wasm" base64-encoded
  const input = "aGVsbG8gd2FzbQ==";
  const out = serializeBody(input, "application/octet-stream");
  assert.ok(out instanceof Uint8Array);
  const decoded = new TextDecoder().decode(out as Uint8Array);
  assert.equal(decoded, "hello wasm");
});

test("serializeBody: passes a Uint8Array through unchanged for application/octet-stream", () => {
  const bytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d]);
  const out = serializeBody(bytes, "application/octet-stream");
  assert.strictEqual(out, bytes);
});

test("serializeBody: returns undefined for null/undefined body", () => {
  assert.equal(serializeBody(undefined, "application/json"), undefined);
  assert.equal(serializeBody(null, "application/json"), undefined);
});

// ── Integration: HTTP wire against local server ──────────────────────────────
// Confirms method, path, Authorization header, and JSON body are forwarded
// correctly over the wire. Does NOT exercise callGcoreApi() — that function's
// GCORE_API_BASE resolution is fixed at module-load time, so we call fetch()
// directly to verify the HTTP layer independently of module caching.

test("HTTP wire: integration smoke — method/path/auth/body round-trip against local server", async (t) => {
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

// ── isOperationAllowed (access policy evaluator) ─────────────────────────────

const SPEC_PATH = "/x/docs/openapi.yaml";

const readOnly: ProductConfig = { specPath: SPEC_PATH, policy: "read-only" };
const readWrite: ProductConfig = { specPath: SPEC_PATH, policy: "read-write" };
const fullCrud: ProductConfig = { specPath: SPEC_PATH, policy: "read-write-destroy" };
const cdnLike: ProductConfig = {
  specPath: SPEC_PATH,
  policy: "read-only",
  writableTags: ["cdn-rules"],
  allowedPaths: [
    { method: "PATCH", path: "/cdn/resources/{resource_id}" },
    { method: "DELETE", path: "/cdn/origin_groups/{origin_group_id}" },
  ],
};
const noPolicy: ProductConfig = { specPath: SPEC_PATH };

test("isOperationAllowed: GET always allowed regardless of policy", () => {
  assert.equal(isOperationAllowed("GET", "/x/anything", [], readOnly), true);
  assert.equal(isOperationAllowed("GET", "/x/anything", [], readWrite), true);
  assert.equal(isOperationAllowed("GET", "/x/anything", [], fullCrud), true);
  assert.equal(isOperationAllowed("HEAD", "/x/anything", [], readOnly), true);
  assert.equal(isOperationAllowed("OPTIONS", "/x/anything", [], readOnly), true);
});

test("isOperationAllowed: read methods are case-insensitive", () => {
  assert.equal(isOperationAllowed("get", "/x/anything", [], readOnly), true);
});

test("isOperationAllowed: read-only blocks every write method", () => {
  for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(
      isOperationAllowed(m, "/x/anything", ["any-tag"], readOnly),
      false,
      `${m} should be denied under read-only`,
    );
  }
});

test("isOperationAllowed: missing policy field defaults to read-only (closed by default)", () => {
  assert.equal(isOperationAllowed("POST", "/x/anything", [], noPolicy), false);
  assert.equal(isOperationAllowed("DELETE", "/x/anything", [], noPolicy), false);
});

test("isOperationAllowed: read-write allows POST/PUT/PATCH but blocks DELETE", () => {
  assert.equal(isOperationAllowed("POST", "/x/r", [], readWrite), true);
  assert.equal(isOperationAllowed("PUT", "/x/r", [], readWrite), true);
  assert.equal(isOperationAllowed("PATCH", "/x/r", [], readWrite), true);
  assert.equal(isOperationAllowed("DELETE", "/x/r", [], readWrite), false);
});

test("isOperationAllowed: read-write-destroy allows DELETE", () => {
  assert.equal(isOperationAllowed("DELETE", "/x/r", [], fullCrud), true);
  assert.equal(isOperationAllowed("POST", "/x/r", [], fullCrud), true);
});

test("isOperationAllowed: writableTags promotes a tag from read-only to read-write", () => {
  assert.equal(
    isOperationAllowed("POST", "/cdn/resources/{id}/rules", ["cdn-rules"], cdnLike),
    true,
  );
  assert.equal(
    isOperationAllowed("PATCH", "/cdn/resources/{id}/rules/{r}", ["cdn-rules"], cdnLike),
    true,
  );
});

test("isOperationAllowed: writableTags does NOT enable DELETE", () => {
  assert.equal(
    isOperationAllowed("DELETE", "/cdn/resources/{id}/rules/{r}", ["cdn-rules"], cdnLike),
    false,
  );
});

test("isOperationAllowed: writableTags does not affect non-listed tags", () => {
  assert.equal(
    isOperationAllowed("POST", "/cdn/origins", ["cdn-origins"], cdnLike),
    false,
  );
});

test("isOperationAllowed: allowedPaths grants surgical write through read-only", () => {
  assert.equal(
    isOperationAllowed(
      "PATCH",
      "/cdn/resources/{resource_id}",
      ["cdn-cdn-resources"],
      cdnLike,
    ),
    true,
  );
});

test("isOperationAllowed: allowedPaths can grant DELETE on a single endpoint", () => {
  assert.equal(
    isOperationAllowed(
      "DELETE",
      "/cdn/origin_groups/{origin_group_id}",
      ["cdn-origins"],
      cdnLike,
    ),
    true,
  );
});

test("isOperationAllowed: allowedPaths is exact-match — wrong method denied", () => {
  assert.equal(
    isOperationAllowed("PUT", "/cdn/resources/{resource_id}", [], cdnLike),
    false,
  );
});

test("isOperationAllowed: allowedPaths is exact-match — wrong path denied", () => {
  assert.equal(
    isOperationAllowed("PATCH", "/cdn/resources/something-else", [], cdnLike),
    false,
  );
});

test("isOperationAllowed: empty tags array under read-only stays denied", () => {
  assert.equal(isOperationAllowed("POST", "/x/r", [], readOnly), false);
});

// ── matchTemplate ────────────────────────────────────────────────────────────

test("matchTemplate: literal segments match exactly", () => {
  assert.equal(matchTemplate("/a/b/c", "/a/b/c"), true);
  assert.equal(matchTemplate("/a/b/c", "/a/b/d"), false);
});

test("matchTemplate: {param} matches any non-empty segment", () => {
  assert.equal(matchTemplate("/cdn/resources/{id}", "/cdn/resources/123"), true);
  assert.equal(matchTemplate("/cdn/resources/{id}", "/cdn/resources/abc-xyz"), true);
});

test("matchTemplate: segment count must match", () => {
  assert.equal(matchTemplate("/a/{id}", "/a/123/extra"), false);
  assert.equal(matchTemplate("/a/{id}/sub", "/a/123"), false);
});

test("matchTemplate: empty segment does not satisfy {param}", () => {
  assert.equal(matchTemplate("/cdn/resources/{id}", "/cdn/resources/"), false);
});

test("matchTemplate: trailing slash is ignored", () => {
  assert.equal(matchTemplate("/a/b/c", "/a/b/c/"), true);
  assert.equal(matchTemplate("/a/b/c/", "/a/b/c"), true);
});

test("matchTemplate: querystring is stripped before matching", () => {
  assert.equal(matchTemplate("/a/{id}", "/a/123?limit=5&q=x"), true);
});

test("matchTemplate: fragment is stripped before matching", () => {
  assert.equal(matchTemplate("/a/{id}", "/a/123#anchor"), true);
});

test("matchTemplate: multiple {param} placeholders", () => {
  assert.equal(
    matchTemplate("/cdn/resources/{rid}/rules/{rule_id}", "/cdn/resources/1/rules/99"),
    true,
  );
});

// ── checkAllowed ─────────────────────────────────────────────────────────────

const sampleAllowlist: ReadonlyArray<AllowedOp> = [
  { method: "GET",    path: "/fastedge/v1/apps" },
  { method: "POST",   path: "/fastedge/v1/apps" },
  { method: "DELETE", path: "/fastedge/v1/apps/{app_id}" },
  { method: "PATCH",  path: "/cdn/resources/{resource_id}" },
];

test("checkAllowed: returns null for an allowed op (literal)", () => {
  assert.equal(checkAllowed("GET", "/fastedge/v1/apps", sampleAllowlist), null);
});

test("checkAllowed: returns null for an allowed op (templated path)", () => {
  assert.equal(checkAllowed("DELETE", "/fastedge/v1/apps/42", sampleAllowlist), null);
  assert.equal(
    checkAllowed("PATCH", "/cdn/resources/abc-123", sampleAllowlist),
    null,
  );
});

test("checkAllowed: denies when method matches but no path matches (closed by default)", () => {
  const denial = checkAllowed("PATCH", "/cdn/origins/1", sampleAllowlist);
  assert.ok(denial, "expected denial");
  assert.match(denial!.reason, /not permitted/);
});

test("checkAllowed: denies when path matches but method does not", () => {
  const denial = checkAllowed("DELETE", "/cdn/resources/1", sampleAllowlist);
  assert.ok(denial, "expected denial");
});

test("checkAllowed: denies entirely-unknown path", () => {
  const denial = checkAllowed("GET", "/nonsense/path", sampleAllowlist);
  assert.ok(denial, "expected denial");
});

test("checkAllowed: method comparison is case-insensitive", () => {
  assert.equal(checkAllowed("get", "/fastedge/v1/apps", sampleAllowlist), null);
  assert.equal(checkAllowed("delete", "/fastedge/v1/apps/42", sampleAllowlist), null);
});

test("checkAllowed: querystring on the request path is stripped before match", () => {
  assert.equal(
    checkAllowed("GET", "/fastedge/v1/apps?limit=10", sampleAllowlist),
    null,
  );
});

// ── workflow validation against policy ───────────────────────────────────────

test("validateWorkflows: every registered workflow is policy-compatible", () => {
  const issues = validateWorkflows(registeredWorkflows);
  assert.deepEqual(
    issues,
    [],
    `registered workflows must not violate the policy; got: ${JSON.stringify(issues, null, 2)}`,
  );
});

test("validateWorkflows: synthetic forbidden workflow is rejected", () => {
  const forbidden: Workflow = {
    name: "delete-cdn-resource",
    description: "synthetic — should be rejected by policy",
    domain: "cdn",
    params: {},
    steps: [
      { method: "DELETE", path: "/cdn/resources/{{params.id}}", description: "" },
    ],
  };
  const issues = validateWorkflows({ [forbidden.name]: forbidden });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].workflow, "delete-cdn-resource");
  assert.equal(issues[0].method, "DELETE");
  assert.equal(issues[0].stepIndex, 0);
});

test("validateWorkflows: pinpoints the specific bad step in a multi-step workflow", () => {
  const mixed: Workflow = {
    name: "mixed",
    description: "synthetic — first step ok, second forbidden",
    domain: "cdn",
    params: {},
    steps: [
      { method: "GET",    path: "/cdn/resources",                  description: "" },
      { method: "DELETE", path: "/cdn/resources/{{params.id}}",   description: "" },
      { method: "GET",    path: "/cdn/resources/{{params.id}}",   description: "" },
    ],
  };
  const issues = validateWorkflows({ [mixed.name]: mixed });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].stepIndex, 1);
});

