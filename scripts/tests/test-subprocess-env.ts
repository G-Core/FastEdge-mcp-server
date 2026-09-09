/**
 * Regression tests for buildSubprocessEnv: confirms that credential-bearing
 * env vars from the host are not forwarded to build subprocesses.
 * Run via: tsx --test scripts/tests/test-subprocess-env.ts
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildSubprocessEnv } from "../../src/utils/index.js";

// Sensitive vars injected into process.env for the duration of these tests.
const INJECTED: Record<string, string> = {
  GCORE_API_KEY: "secret-gcore",
  FASTEDGE_API_KEY: "secret-fastedge",
  MY_TOKEN: "secret-token",
  MY_SECRET: "secret-value",
};

before(() => {
  for (const [k, v] of Object.entries(INJECTED)) process.env[k] = v;
});

after(() => {
  for (const k of Object.keys(INJECTED)) delete process.env[k];
});

test("buildSubprocessEnv strips credential-bearing keys", () => {
  const env = buildSubprocessEnv();
  const credPattern = /GCORE|API_KEY|TOKEN|SECRET/i;
  const leaked = Object.keys(env).filter((k) => credPattern.test(k));
  assert.deepEqual(leaked, [], `leaked keys: ${leaked.join(", ")}`);
});

test("buildSubprocessEnv retains PATH", () => {
  const env = buildSubprocessEnv();
  assert.ok("PATH" in env, "PATH must be present");
});

test("buildSubprocessEnv retains HOME", () => {
  const env = buildSubprocessEnv();
  assert.ok("HOME" in env, "HOME must be present");
});
