/**
 * Regression tests for the scaffolding package pin: confirms that
 * create-fastedge-app is referenced at an exact semver, not @beta or @latest.
 * Run via: tsx --test scripts/tests/test-scaffold-pin.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const scaffoldsSrc = readFileSync(
  join(ROOT, "src/tools/local/scaffolding/scaffolds.ts"),
  "utf8"
);

test("scaffolds.ts contains no @beta package tag (outside comments)", () => {
  // Strip single-line comments so the "do not use @beta" advisory comment is ignored.
  const withoutComments = scaffoldsSrc.replace(/\/\/.*/g, "");
  assert.ok(!/@beta/.test(withoutComments), "found @beta package tag in scaffolds.ts (outside a comment)");
});

test("CREATE_APP_PKG uses a pinned semver (no @latest or floating tag)", () => {
  // Matches: create-fastedge-app@X.Y.Z (digits only, no suffix like @beta/@latest)
  const match = scaffoldsSrc.match(/CREATE_APP_PKG\s*=\s*"([^"]+)"/);
  assert.ok(match, "CREATE_APP_PKG constant not found in scaffolds.ts");
  const pkg = match![1];
  assert.match(
    pkg,
    /^create-fastedge-app@\d+\.\d+\.\d+$/,
    `CREATE_APP_PKG "${pkg}" is not a pinned semver (expected create-fastedge-app@X.Y.Z)`
  );
});
