# FastEdge MCP Server - Changelog

**IMPORTANT**: Do not read this file linearly. Use grep to search for keywords.

**Example searches**:
```bash
grep -i "build-wasm" context/CHANGELOG.md
grep -i "tool" context/CHANGELOG.md
grep -i "fix.*api" context/CHANGELOG.md
grep "## \[2026-" context/CHANGELOG.md
```

See `SEARCH_GUIDE.md` for more search patterns.

---

## [2026-08-26] - security: OS command injection via shell:true build/scaffold sinks (ICM-50570)

External report (two confirmed PoCs, commit 30f5967): `normalizePath()` (`src/utils/index.ts`) blocks `..` traversal and absolute/Windows-drive paths but never sanitized shell metacharacters (`;`, `"`, `&`, `|`, `$`, backticks). Its output reached shell-executing sinks unescaped — `scaffold-fastedge-project` (`src/tools/local/scaffolding/scaffolds.ts`) built an `npx` command string for `child_process.exec` (always shell-backed) by interpolating the normalized `outputDir`; `build-wasm`'s JS/TS path (`src/tools/local/workspace/compiler/jsBuild.ts`) called `child_process.spawn(..., { shell: true })`. Either let an attacker-controlled `outputDir`/`entryFile` (from a malicious repo an agent scaffolds/builds, or a direct HTTP/SSE tool call) run arbitrary commands with the operator's `GCORE_API_KEY` in the process env.

**First draft (reverted) added a shell-metacharacter denylist to `normalizePath()` itself.** Codex (MoM) review caught that this was the wrong choke point: `normalizePath()` is also used by non-shell callers (`uploadBinary` in `src/tools/api/binaries/api.ts`, build-directory/tsconfig resolution in `src/tools/local/workspace/compiler/index.ts`), so the denylist rejected legitimate paths like `dist/app(v2).wasm` that never reach a shell. It also missed a third shell sink review didn't originally cover — see below — so patching the normalizer wasn't even sufficient on its own.

**Fix — remove the shell from every affected sink instead of sanitizing input for it**:

- `src/tools/local/scaffolding/scaffolds.ts` — `scaffold-fastedge-project` switched from `exec(command string)` to `execFile("npx", argsArray)`. `outputPath` is now passed as a discrete argv element, never concatenated into shell text.
- `src/tools/local/workspace/compiler/jsBuild.ts` — `spawn` no longer hardcodes `shell: true`.
- `src/tools/local/workspace/compiler/asBuild.ts` — same `spawn("npx", ascArgs, { shell: true })` pattern as `jsBuild.ts`, feeding the same `normalizePath`-derived `entryFilePath`/`outputFilePath`. Missed in the first pass; found by the Codex (MoM) review. Fixed the same way.
- All three: `shell` is now `process.platform === "win32"` only, not hardcoded `true`. The MCP server's production path is the Linux Docker container (`setupCrossPlatformEnvironment` already assumes Linux x64), where `npx` is a real executable and no shell is needed; the conditional preserves local Windows dev (where `npx` is a `.cmd` shim `spawn`/`execFile` can't exec directly) without opening the Linux/Docker attack surface the PoCs targeted.
- `src/utils/index.ts` — left unchanged (reverted to pre-fix behavior): traversal/absolute-path checks only, no metacharacter denylist.

**Known residual, out of scope for this ICM** (Codex/MoM review, not independently reproduced): on Windows, `shell: true` still routes through `cmd.exe`, which has its own metacharacter set (`%`, `!`, `^`) beyond what any POSIX-shell denylist would catch, and older Node releases had a documented `.cmd` argument-injection issue (CVE-2024-27980). The ICM's PoCs and this server's only supported deployment (Docker/Linux) don't hit this path; Windows is local-dev-only today. Not fixed here — flag if Windows becomes a supported deployment target.

`src/tools/local/workspace/compiler/rustBuild.ts` spawns `cargo` with `shell: "/bin/bash"` unconditionally, and interpolates a `target` value read from `.cargo/config.toml`/`Cargo.toml` in the cloned project (`rustConfigWasiTarget`) into `--target=${target}`. Flagged by Codex (MoM) review as a structurally similar (untrusted-file-content → shell arg) but distinct issue — not `normalizePath`-derived, and the repo comment says bash is intentional for the container's cargo/rustup shims. Not touched here; needs its own investigation before changing.

**Verified**: full `pnpm run test` suite (78 tests) and reference-index tests still pass; `normalizePath("/workspace", "dist/app(v2).wasm")` now resolves correctly instead of being rejected; the two PoC payloads still can't execute anything at any of the three sinks (no shell on Linux, so they're inert argv/array elements, not shell text).

---

## [2026-08-25] - security: batch_execute policy bypass via resolved paths (ICM-50568)

External report: `batch_execute` ran `checkAllowed` on the **template** path (where `$name.field` is one opaque segment, so `/fastedge/v1/apps/$planted.v` matched `/fastedge/v1/apps/{app_id}`), then dispatched the **resolved** path with no second check. A prior step's data is untrusted (prompt injection, or just an API response containing free text), so `$planted.v = "../../../cdn/resources/123"` produced a request `new URL()` normalized to `/cdn/resources/123` — outside the allowlist, sent with the operator's `GCORE_API_KEY`.

**Fix — three parts**. The invariant: *the pathname the policy validates must equal the pathname `fetch()` requests, on the configured origin.*

- `src/policy/enforce.ts` — new exported `normalizePath()`, used by `matchTemplate` (so `gcore_api` and workflow validation get it too). Canonicalizes to the URL parser's own view rather than string-matching: strips TAB/LF/CR **first** (WHATWG removes them anywhere in the input) and runs every check on the cleaned string, then lets `new URL(cleaned, "http://policy.invalid")` split the query/fragment and collapse `.`/`..`. Returns `null` (→ denial) for: any remaining control char; anything not starting with exactly one `/`; backslashes; `%2e`/`%2f` in the resulting pathname.
- `src/api-client.ts` — choke-point guard in `callGcoreApi`: builds the URL in a try/catch and refuses (status 0 + error) when `url.origin !== new URL(GCORE_API_BASE).origin`, before any `fetch`. Independent of the policy layer, so it covers every caller.
- `src/tools/api/batch-execute.ts` — after `resolveRefs`, re-run `checkAllowed` on the concrete path before dispatch. Denial aborts the batch with the same payload shape as a pre-flight denial — `policy_denied` + a `denied_steps` array (one entry, with `template_path` and `resolved_path` added alongside `path`) + `completed`. Segment-count matching in `matchTemplate` means an injected `/` also fails the re-check, so no separate `/`-rejection is needed.

**Why the extra two parts** — Codex (MoM) review of the first draft found that normalizing alone *introduced* a worse bug and left two divergences:

- `@attacker.example/../fastedge/v1/apps` normalized to the allowed `/fastedge/v1/apps`, but `new URL("https://api.gcore.com" + p)` parses `api.gcore.com` as **userinfo** — the request, with the operator's `GCORE_API_KEY`, would have gone to `attacker.example`. (The pre-fix raw-string match rejected this by accident.)
- `..%<LF>2f..` dodged the `%2f` check because the parser strips LF *after* a regex sees the raw string.
- `/<LF>/attacker.example/x` passed a leading-slash check on the raw input, then cleaned into a protocol-relative `//attacker.example/x`.

Verified by diffing `normalizePath(p)` against `new URL(GCORE_API_BASE + p).pathname` over 29 hostile inputs: zero divergence on anything the policy accepts, and all 194 `ALLOWED_OPS` still reachable with ordinary params (the new strictness denies nothing legitimate).

**Not changed** (reviewed, deliberate): resolved query/body values in a batch are not policy-checked — the allowlist is keyed on method + path, and query values go through `url.searchParams.set()`, so they cannot alter the pathname. `GCORE_API_BASE` with a trailing slash or path prefix concatenates oddly; pre-existing and unrelated.

**Tests** (`scripts/tests/test-api.ts`): the reported chain (step 1 plants the traversal, step 2 interpolates it) denies and never dispatches; authority-manipulating paths; control-char divergences; the origin guard. 78 API tests passing.

---

## [2026-05-11] - fix: gcore_api body serialization (finding #23)

POST/PATCH calls through `gcore_api` consistently failed with the FastEdge gateway returning `400 — request body has an error: ... value must be an object`, even when the body was structurally well-formed JSON. Reproduced 3× during the 2026-05-08 `geo-redirect` live-test run; `batch_execute` succeeded with the identical body shape, confirming the bug was specific to `gcore_api`'s wire path.

**Root cause**: `gcore_api`'s body schema was `z.any().optional().describe("Request body (JSON)")`. The describe text reads to the model as "send a JSON-formatted string," so Claude emitted body as a pre-serialized string (`'{"name":"foo"}'`). `api-client.ts:73` then ran `JSON.stringify(opts.body)`, which JSON-quotes a string, producing an escaped string literal on the wire. The gateway's OpenAPI validator parsed that as a JSON value, got a string where `schemas_app` was expected, and rejected. `batch_execute`'s `z.any()` had no misleading describe text and the model was already in "build the structured calls array" mode, so its body came out as an object naturally.

**Fix — two layers**:

- **L1 (schema, primary)**:
  - `src/tools/api/gcore-api.ts` — body schema is now `z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())])` with describe text that explicitly forbids JSON-encoded strings. Exported as `gcoreApiBodySchema` for unit testing.
  - `src/tools/api/batch-execute.ts` — `batchCallSchema` exported; body stays `z.any()` (binary uploads legitimately use a string body with `content_type: application/octet-stream`), but a `superRefine` rejects string body when `content_type` is missing or `application/json`. The error message points users at the `content_type` escape hatch for binary uploads.
- **L2 (defensive parser, safety net)**: `src/api-client.ts` factored the body-serialization logic into an exported `serializeBody(body, contentType)` helper. For `application/json`, if `body` is a string that parses as JSON, parse-then-re-serialize so the wire body is the object, not a quoted string. If the string isn't valid JSON, pass through verbatim. Non-JSON content types are coerced via `String(body)` as before.

**Tests** (`scripts/tests/test-api.ts`): 14 new tests — `gcoreApiBodySchema` accept/reject matrix, `batchCallSchema` content-type-conditional matrix, `serializeBody` round-trip including the bug-shape normalization and the binary-upload pass-through. Total: 72 API tests, all passing.

**Plugin-side companion**: `fastedge-plugin/.../deploy/SKILL.md` Step 4.2 still recommends `gcore_api` POST/PATCH as primary. That recommendation will be updated once this MCP fix is released — until then the plugin documents `batch_execute` as the workaround. Tracked in `fastedge-coordinator/context/PLUGIN_SKILL_FINDINGS.md` finding #23.

---

## [2026-04-28] - cdn: allow POST /cdn/origin_groups (create only)

Added `{ method: "POST", path: "/cdn/origin_groups" }` to `cdn.allowedPaths` in `src/config/products.ts`. Surgical exception under the otherwise read-only cdn product: agents (notably the upcoming live-test setup flow in the gcore-fastedge plugin) can now provision new origin groups for CDN resources without opening PATCH or DELETE on the same tag.

Rationale: live-test scenarios sometimes need a different origin (e.g. `httpbin.org`) than the one already attached to a developer's preconfigured CDN resource. Origin-group creation is non-destructive — a stray new group is harmless until attached to a resource — so the blast radius is low. Modification (PATCH) and deletion (DELETE) of existing groups remain blocked because they could overwrite or destroy shared infra.

Note: origin groups still take ~15–20 minutes to propagate to edge, so a freshly-created group cannot be exercised within a single live-test run. Use this for "set up next time" provisioning, not the hot iteration loop.

Re-run `pnpm run generate:schemas:prod` (or `:preprod`) to regenerate `src/generated/policy.ts` so the new entry takes effect.

---

## [2026-04-28] - workflows: remove `delete-app-and-binary`

Removed the `delete-app-and-binary` workflow. FastEdge auto-cleans dangling binaries (binaries unattached to any application) every 24 hours, so the binary-DELETE step the workflow performed is redundant. App-only deletion remains expressible via `gcore_api` DELETE `/fastedge/v1/apps/{id}` for the rare hand-cleanup case — no workflow needed.

Files: deleted `src/workflows/fastedge/delete-app-and-binary.ts`; updated `src/workflows/registry.ts` to drop the import and registry entry. No skill callers existed (verified via grep across `fastedge-plugin/`). Tracked in `fastedge-coordinator/context/PLUGIN_SKILL_FINDINGS.md` as part of the live-test validation cleanup discussion.

---

## [2026-04-28] - test-reference-index: fix stale path

`scripts/tests/test-reference-index.sh:15` referenced `build/tools/reference/index.js`, the path before the 2026-04-24 tool reorganization (commit `30f5967`) that moved `src/tools/reference/` → `src/tools/local/reference/`. The script was missed in that rename, so all 4 test cases failed with `ERR_MODULE_NOT_FOUND` at the `import { loadReferenceDocs }` step before `loadReferenceDocs(...)` was ever called. Updated to the new path. Full test suite (`pnpm run test`) now reports 58 API tests + 4 reference-index tests, all passing.

---

## [2026-04-28] - build-wasm: AssemblyScript dispatch

`build-wasm` now handles AssemblyScript projects in addition to Rust and JavaScript. Previously the tool always invoked `npx fastedge-build` for any non-`.rs` file, which 404'd on AS projects (which don't depend on `fastedge-build` — they use `asc` from local devDeps). Surfaced during live-test validation against `proxy-wasm-sdk-as/examples/helloWorld` and tracked as Finding #1 in `fastedge-coordinator/context/PLUGIN_SKILL_FINDINGS.md`.

Detection: `.ts`/`.tsx` extension AND `asconfig.json` present in the resolved build directory → AssemblyScript. TypeScript HTTP apps (which have `package.json` with `fastedge-build` in scripts and no `asconfig.json`) correctly stay on the JS path.

Build invocation: `npx asc <entryFile> --target release [--outFile <outputFile>]`, with `cwd` set to the resolved build directory. The `--outFile` flag is only passed when the caller explicitly supplied `outputFile` — otherwise the tool reads `targets.release.outFile` from `asconfig.json` and returns that path. This honors the project's existing AS configuration as the default and lets explicit overrides work as expected.

Auto-derived `buildDirectory`: when the caller doesn't pass `buildDirectory`, the tool walks upward from `entryFile` looking for the nearest project marker (`asconfig.json`, `Cargo.toml`, or `package.json`) within the workspace root, falling back to the workspace root if none is found. Removes the burden of always specifying the build dir for nested project layouts (e.g. examples in a workspace).

Schema change: dropped the previous `outputFile` default of `/wasm/output.wasm`. The field is now genuinely optional. Required for JS and Rust builds (both fall back to `wasm/output.wasm` inside the workspace at the dispatcher level), optional for AS (resolved from asconfig.json).

Files: `src/tools/local/workspace/compiler/asBuild.ts` (new), `src/tools/local/workspace/compiler/index.ts` (detection + dispatch + auto-derive), `src/tools/local/workspace/build.ts` (schema).

Related: Finding #8 in `PLUGIN_SKILL_FINDINGS.md` tracks the parallel parity work in `FastEdge-vscode/src/compiler/asBuild.ts` (which still hardcodes `assembly/index.ts` and overrides asconfig's outFile) plus a separate Rust target-detection improvement (currently both tools fall back to `wasm32-wasip1` without inspecting Cargo.toml deps).

Operational validation pending: this code change requires a Docker image rebuild (`docker build -t ghcr.io/g-core/fastedge-mcp-server:dev .`) before the next live-test sweep can verify AS builds work end-to-end.

---

## [2026-04-28] - Add live-test workflows + fix CDN writableTags

Added three workflows in `src/workflows/fastedge/` to support an upcoming `live-test` skill in the gcore-fastedge plugin:

- **`enable-app-http`**: PATCH `{"debug": true}` on a FastEdge app so `/apps/{id}/logs` captures traffic. Returns `app.url` and `app.debug_until`. Used before issuing test traffic against an HTTP-type app.
- **`attach-app-to-cdn-rule-create`**: PATCH app debug → POST a new CDN rule wiring the app at a given path. Caller provides a pre-built `options.fastedge` body (which decides hook phases). Used on first deploy.
- **`attach-app-to-cdn-rule-update`**: PATCH app debug → PATCH an existing CDN rule. Used on iterative re-runs (idempotent live-test cycle).

Two workflows for create vs update because workflow steps are linear (no conditionals). The skill orchestrates: list rules on the resource, match by path, pick which workflow to call.

Prerequisite policy fix in `src/config/products.ts`: `writableTags` for the `cdn` product was renamed from `["cdn-rules", "cdn-rule-templates"]` (which matched no upstream OpenAPI tags) to `["Rules", "Rule templates"]` (the actual tag names in the upstream spec). This enables POST/PUT/PATCH on rule + rule-template endpoints. DELETE remains blocked — `writableTags` does not promote destroy per `evaluate.ts:27`. Empirically verified PATCH on existing rules returns 200 after the rename.

Files: `src/workflows/fastedge/{enable-app-http,attach-app-to-cdn-rule-create,attach-app-to-cdn-rule-update}.ts`, `src/workflows/registry.ts`, `src/config/products.ts`.

---

## [2026-04-27] - Add `wasm32-wasip2` Rust target to base image

`Dockerfile-base` now installs both `wasm32-wasip1` and `wasm32-wasip2` via `rustup target add`. Motivation: newer FastEdge-sdk-rust apps using `#[wstd::http_server]` (wasi async HTTP) require the `wasip2` target, which they request through a per-project `.cargo/config.toml` (`[build] target = "wasm32-wasip2"`). The build tool already honors that file via `rustConfigWasiTarget()` in `src/tools/local/workspace/compiler/rustBuild.ts` — only the toolchain image was missing the target. `wasip1` is retained for older FastEdge apps and CDN apps. No source code changes.

Files: `Dockerfile-base`.

---

## [2026-04-27] - Per-product access policy for the API tools

Added a configurable access-control layer over the OpenAPI-derived API tools (`gcore_api`, `batch_execute`, `describe_api`, `workflows_list`). Previously every endpoint across all five products was exposed for full CRUD; now each product declares an access tier in `src/config/products.ts`:

- **Tiers**: `read-only` (GET/HEAD/OPTIONS), `read-write` (+ POST/PUT/PATCH), `read-write-destroy` (+ DELETE).
- **Current policy**: `fastedge: read-write-destroy`; `cdn: read-only` with `writableTags: ["cdn-rules", "cdn-rule-templates"]` plus surgical `allowedPaths` PATCH/PUT on `/cdn/resources/{resource_id}`; `dns: read-only` with surgical `allowedPaths` POST/PUT on `/dns/v2/zones/{zoneName}/{rrsetName}/{rrsetType}` (per-record create/update only — no zone create, no DNSSEC, no bulk import); `waap: read-only`; `storage: read-only`. Default fallback is `read-only` (closed by default).
- **Two enforcement points, one source of truth**: `scripts/generate-schemas.ts` strips disallowed ops at parse time AND emits `src/generated/policy.ts` (184 allowed ops). `src/policy/enforce.ts:checkAllowed` validates every runtime call in `gcore-api.ts` and `batch-execute.ts` against that allowlist. `batch_execute` is **atomic** — if any step is denied, zero steps execute.
- **Workflows are validated at module load**: `src/workflows/registry.ts` calls `validateWorkflows` on import; a workflow whose steps violate the policy crashes the server at startup rather than failing silently per-call.
- **Path-template matcher** (`matchTemplate`): segment-by-segment, `{var}` matches one non-empty segment, querystrings stripped, trailing slashes ignored, segment counts must match (no implicit deeper matches).

Deferred extensions documented in the `ProductConfig` doc-block: `destructiveTags`, `forbiddenPaths`, `allowedMethods`. Add when a real use case appears.

Files: `src/config/products.ts`, `src/policy/{evaluate,enforce}.ts`, `src/workflows/validate.ts`, `src/generated/policy.ts` (auto-generated), `scripts/generate-schemas.ts`, `src/tools/api/{gcore-api,batch-execute}.ts`, `src/workflows/registry.ts`. 36 new unit tests in `scripts/tests/test-api.ts`.

---

## [2026-04-24] - Schema-generation scripts split into `:prod` / `:preprod`

Renamed `generate:schemas` → `generate:schemas:prod` (defaults to `SPEC_BASE_URL=https://api.gcore.com`, caller env still wins) and added `generate:schemas:preprod` (`api.preprod.world`). New `build:preprod` pipes the preprod generator into `build:server`; default `build` now invokes `generate:schemas:prod`, so `pnpm build` works without env setup. Motivation: the old script failed if `SPEC_BASE_URL` was unset, which tripped up fresh clones and the 99% prod workflow. Updated `DEVELOPMENT.md` Schemas + preprod sections and `CLAUDE.md` decision tree / anti-patterns / common-commands table.

---

## [2026-04-24] - Absorbed gcore-api-mcp-server: direct Gcore API integration

### Overview

The four API tools previously proxied to the sibling `gcore-api-mcp-server` (edge-deployed WASM, HTTP transport) now run natively in this server. The embedded MCP client, the proxy hop, and the `GCORE_API_MCP_URL` env var are gone. This removes the edge runtime's 30s request timeout as a ceiling on long `batch_execute` chains, eliminates one network hop, and consolidates build-pipeline + API tools into a single image. `gcore-api-mcp-server` will be archived.

### 🎯 What Was Completed

#### 1. Build pipeline migration
- Ported `scripts/generate-schemas.ts` (OpenAPI → LLM-readable schemas)
- Ported `src/config/products.ts` with `cloud` product removed (no FastEdge crossover) and new optional `timeout_ms?: number` field
- Added `@apidevtools/swagger-parser` devDep
- Added `pnpm run generate:schemas` — manual script, commit-time regeneration (not a prebuild hook)
- Generated prod schemas: **55 groups** across 5 products (fastedge 7 · cdn 17 · dns 10 · waap 14 · storage 7)

#### 2. Runtime migration
- Ported `src/api-client.ts` with Node `fetch`, `AbortController`-based timeout, auth header forwarding + `GCORE_API_KEY` fallback
- Ported `src/workflows/` (types, registry, create-app, update-app-binary, delete-app-and-binary)
- Extracted 4 tool handlers into `src/tools/api/` with injectable `apiCaller` for testability
- Moved `upload-binary` into `src/tools/api/binaries/`, simplified signature (drops `ApiConfig`, uses `GCORE_API_BASE` directly)

#### 3. Tool folder reorganization
- `src/tools/local/` — `reference/`, `scaffolding/`, `workspace/`
- `src/tools/api/` — `gcore-api`, `describe-api`, `workflows-list`, `batch-execute`, `binaries/`
- Dropped `src/tools/fastedge/` entirely (contents absorbed into api/)

#### 4. Timeouts
- `DEFAULT_TIMEOUT_MS = 60_000` per-call, hard default
- Per-product override via `products.ts` `timeout_ms`
- `batch_execute`: total budget = sum of per-step product timeouts; rejects if > `BATCH_TOTAL_CAP_MS` (180_000); aborts remaining steps if wall-clock elapsed exceeds budget
- Uniform timeout error shape: `{ error, timeout: true, path, timeout_ms }`

#### 5. Proxy removal
- Deleted `src/mcp-client.ts`, `src/tools/fastedge/proxied.ts`, `src/tools/fastedge/types.ts`
- Removed `GCORE_API_MCP_URL` and `FASTEDGE_API_URL` env var plumbing from `src/server.ts`
- Server startup simplified: reads only `GCORE_API_KEY` and `WORKSPACE_ROOT`

#### 6. Environment variables
- **Added**: `GCORE_API_BASE` (optional runtime override; lets in-house devs point prod-schemas image at preprod endpoints)
- **Removed**: `GCORE_API_MCP_URL`, `FASTEDGE_API_URL`
- **Kept**: `GCORE_API_KEY` (required), `BATCH_MAX_CALLS` (optional, default 5), `WORKSPACE_ROOT`

#### 7. Tests
- Added `scripts/tests/test-api.ts` with 21 tests (node:test + tsx)
- Covers: `resolveTimeoutMs`, `resolveRefs`/`resolveRefsTyped`, all tool handlers with injected mock apiCaller, batch cap and max-calls rejection, fail-fast on 4xx, local HTTP server integration smoke test
- New `pnpm run test` (test:api + test:reference-index) and `pnpm run test:api` scripts

#### 8. Docs
- Updated `README.md`, `DEVELOPMENT.md`, `STANDALONE-SETUP.md`, `mcp-standalone.json` — removed `GCORE_API_MCP_URL`, added `GCORE_API_BASE`, added preprod build recipe
- New "API Tools" section in README listing the 5 absorbed tools

**Files Created:**
- `src/api-client.ts` — Gcore API HTTP client with timeout layer
- `src/config/products.ts` — product registry
- `src/generated/schemas.ts`, `src/generated/config.ts` — auto-generated
- `src/workflows/{types,registry}.ts` + `src/workflows/fastedge/*.ts`
- `src/tools/api/{gcore-api,describe-api,workflows-list,batch-execute,index}.ts`
- `src/tools/api/binaries/` (moved + adapted)
- `scripts/generate-schemas.ts`
- `scripts/tests/test-api.ts`

**Files Deleted:**
- `src/mcp-client.ts`
- `src/tools/fastedge/proxied.ts`
- `src/tools/fastedge/types.ts`

**Files Moved:**
- `src/tools/reference/` → `src/tools/local/reference/`
- `src/tools/scaffolding/` → `src/tools/local/scaffolding/`
- `src/tools/workspace/` → `src/tools/local/workspace/`
- `src/tools/fastedge/binaries/` → `src/tools/api/binaries/`

### 🧪 Testing

```bash
pnpm run test              # 21 passing tests, ~400ms
pnpm run generate:schemas  # regenerate from SPEC_BASE_URL
```

### 📝 Notes

- **No semver bump** in this server. fastedge-plugin's release CI will drive the next version bump and propagate via `sync-and-release.yml`.
- **`GCORE_API_MCP_URL` removal is a breaking change** for any manual standalone setup that hardcoded it — removed from docs, safe to drop from mcp.json.
- **Cloud product dropped** — not a FastEdge workflow crossover. Re-adding is one entry in `products.ts` + `enabledForGeneration`.
- **Preprod recipe**: either set `GCORE_API_BASE=https://api.preprod.world` at runtime (prod schemas, preprod endpoints — 99% compatible) or rebuild image locally with `SPEC_BASE_URL=https://api.preprod.world pnpm run generate:schemas`.

---

## [2026-02-10] - Dynamic Template List from create-fastedge-app

### Overview
Removed hard-coded template list from MCP server. The `list-fastedge-templates` tool now fetches the latest template information dynamically from `create-fastedge-app --list-templates`.

### What Was Completed

**create-fastedge-app enhancements**:
- Added `--list-templates` flag to output template metadata as JSON
- Returns: template name, description, supported languages, application type
- Updated help text to document the new flag
- Alias: `-l` for `--list-templates`

**MCP Server updates**:
- `list-fastedge-templates` tool now calls `npx create-fastedge-app --list-templates`
- Parses JSON output and formats for display
- Removes hard-coded template descriptions and language lists
- Static validation array kept for Zod schema (safety check)

**Files Modified**:
- `create-fastedge-app/src/create-app/index.ts` - Added --list-templates handler
- `create-fastedge-app/src/create-app/types.ts` - Added ParsedArgs property
- `create-fastedge-app/src/create-app/print-info.ts` - Updated help text
- `FastEdge-mcp-server/src/tools/scaffolding/scaffolds.ts` - Dynamic template fetching
- `FastEdge-mcp-server/src/tools/scaffolding/index.ts` - Added clarifying comment

### Benefits
- **Single source of truth**: Templates defined only in create-fastedge-app
- **Always up-to-date**: MCP server shows latest templates without code changes
- **No sync issues**: Add/remove templates in one place
- **Machine-readable**: JSON output enables programmatic usage

### Usage

**create-fastedge-app**:
```bash
npx create-fastedge-app --list-templates
# Returns JSON array of templates
```

**MCP Server**:
```
list-fastedge-templates  # Fetches from create-fastedge-app
```

### Example Output
```json
[
  {
    "name": "http-base",
    "description": "Simple request/response handling application",
    "languages": ["javascript", "typescript", "rust", "assemblyscript"],
    "applicationType": "http"
  },
  ...
]
```

---

## [2026-02-10] - Complete Removal of Documentation Generation System

### Overview
Completed the refactoring by fully removing the create-docs script and all resource generation logic. The MCP server is now purely focused on build and deployment tools, with documentation provided via skills in generated projects.

### What Was Completed

**Files Removed**:
- `assets/scripts/create-docs.ts` - Documentation generation script
- `src/resources/` - Entire directory (fastedge-core, fastedge-examples, fastedge-sdk-js, dotenv)
- `src/tools/context/` - get-fastedge-context tool
- `.github/get-context7-docs/` - GitHub Action for fetching Context7 docs
- `.github/download-start-kit-release/` - GitHub Action for downloading start-kit resources
- `.github/scripts/download-start-kit-release.cjs` - Start-kit download script
- `src/tools/scaffolding/resources.ts` - Bundled template resources (was .gitignored)

**Files Modified**:
- `package.json` - Removed `create:docs` script, simplified build to just TypeScript compilation
- `src/server.ts` - Removed `registerAllResources` import and call
- `src/tools/index.ts` - Removed `registerContextTools` import and call
- `src/prompts/scaffolding.ts` - Updated to reference skills instead of get-fastedge-context tool
- `src/prompts/deploying.ts` - Removed get-fastedge-context reference, added inline dotenv documentation
- `.github/workflows/create-release.yaml` - Removed "Get Context7 Docs" and "Download Start Kit" steps
- `.gitignore` - Removed reference to src/tools/scaffolding/resources.ts
- `context/PROJECT_OVERVIEW.md` - Updated to reflect new architecture (no resources)
- `claude.md` - Updated project structure and removed resource references

### Impact
- **Cleaner separation of concerns**: MCP server = build + deploy, Skills = documentation
- **No external dependencies**: No Context7 API or GitHub releases dependency
- **Simpler build process**: Just `tsc` compilation, no doc/template download steps
- **Runtime template fetching**: Uses `npx create-fastedge-app` instead of bundled templates
- **Single source of truth**: All FastEdge documentation and templates live in create-fastedge-app
- **Smaller codebase**: Removed ~2000+ lines of generated resource/template code
- **Cleaner releases**: Docker builds no longer download external assets

### Build Changes
```bash
# Old
pnpm run build  # Ran create:docs + tsc

# New
pnpm run build  # Just tsc
```

**MCP Server Tools** (after cleanup):
- Build: `build-wasm`
- Deploy: `upload-binary`, `update-or-create-app`, `update-env-vars-app`, `get-secret-id`
- Scaffold: `list-fastedge-templates`, `scaffold-fastedge-project`
- Tracking: `deployment-comments`

**Documentation Access**:
- Generated projects include `.claude/skills/` with comprehensive FastEdge docs
- Skills include: fastedge-development, fastedge-debugging, fastedge-deployment, fastedge-examples

### Testing
```bash
pnpm run build          # Should succeed with just TypeScript compilation
pnpm run server:dev     # Server should start without resource registration
```

**Verified**:
- ✅ Build compiles successfully
- ✅ No references to removed code in src/
- ✅ Prompts updated to reference skills instead of resources
- ✅ Documentation updated to reflect new architecture

---

## [2026-02-10] - MCP Server Refactoring & Deduplication

### Overview
Removed duplicate template code and context assets. MCP server now delegates to create-fastedge-app CLI for scaffolding, eliminating 1MB+ of duplication.

### What Was Completed

**Scaffold Tool Refactored**:
- File: `src/tools/scaffolding/scaffolds.ts`
- Changed from bundled templates to `npx create-fastedge-app`
- Removed dependency on `FastEdgeTemplates` from resources.ts
- Updated tool descriptions to mention skills

**Files Removed**:
- `src/tools/scaffolding/resources.ts` (1MB+ duplicate template code)
- `assets/context/` directory (content moved to skills)
  - `assets/context/fastedge-core.md` migrated to create-fastedge-app skills

**Files Moved**:
- `assets/context/dotenv.md` → `docs/dotenv.md` (MCP-specific docs preserved)

**Files Modified**:
- `README.md` - Updated dotenv.md path reference
- `src/tools/scaffolding/scaffolds.ts` - Delegates to CLI

### Implementation Details

**New Scaffold Pattern**:
```typescript
// Old: Read from bundled FastEdgeTemplates
const template = FastEdgeTemplates[templateType].find(...)

// New: Delegate to create-fastedge-app CLI
const command = `npx create-fastedge-app "${outputPath}" --template ${template} --language ${language}`;
await execAsync(command);
```

**List Templates Tool**:
- Now returns static list of available templates
- Mentions skills included in generated projects
- No longer depends on bundled resources

### Impact
- **30-40% smaller codebase** (~1MB removed)
- **Single source of truth** - create-fastedge-app owns templates
- **Skills-based context** - No hardcoded documentation
- **Easier maintenance** - Update templates in one place
- **Better discoverability** - Skills load dynamically

**Code Changes**:
- Lines removed: ~1,200 (resources.ts + context assets)
- Files deleted: 2+ (resources.ts, context directory)
- Files modified: 2 (scaffolds.ts, README.md)

### Testing
```bash
# Test scaffold tool (requires MCP server running)
# Use MCP: scaffold-fastedge-project
# Verify: Creates project using create-fastedge-app
# Verify: Generated project includes .claude/skills/
```

**Part of**: FastEdge Ecosystem Refactoring - Phase 2: MCP Server Refactoring

### Notes
- MCP server now requires create-fastedge-app to be available via npx
- Docker container already includes Node.js and npm
- Skills are now the source of truth for FastEdge documentation

---

## Format for New Entries

```markdown
## [YYYY-MM-DD] - Feature/Tool/Fix Name

### Overview
Brief description of what was accomplished

### 🎯 What Was Completed

#### 1. Component/Tool Name
- Detail 1
- Detail 2

**Files Modified:**
- path/to/file.ts - What changed

**Files Created:**
- path/to/file.ts - Purpose

### 🧪 Testing
How to test the changes

### 📝 Notes
Any important context, decisions, or gotchas
```

---

## [2026-02-09] - Initial Context Documentation

### Overview
Created comprehensive context documentation system following discovery-based pattern for the FastEdge MCP Server repository.

### 🎯 What Was Completed

#### 1. Core Documentation Structure
- Created `claude.md` - Top-level agent instructions for MCP server (~400 lines)
- Created `context/CONTEXT_INDEX.md` - Navigation hub with decision tree (~150 lines)
- Created `context/PROJECT_OVERVIEW.md` - Comprehensive MCP server overview (~350 lines)
- Created `context/SEARCH_GUIDE.md` - Search patterns guide (~80 lines)
- Created `context/CHANGELOG.md` - This file (searchable history)

**Files Created:**
- `claude.md` - Top-level instructions
- `context/CONTEXT_INDEX.md` - Documentation navigation
- `context/PROJECT_OVERVIEW.md` - Project overview
- `context/SEARCH_GUIDE.md` - Search patterns
- `context/CHANGELOG.md` - This file

**Directory Structure Created:**
- `context/architecture/` - For architecture docs
- `context/tools/` - For tool-specific docs
- `context/prompts/` - For prompt workflow docs
- `context/resources/` - For resource system docs
- `context/development/` - For development guides

### 📝 Notes

**Documentation Philosophy:**
- Discovery-based: Read only what's needed for current task
- Token-efficient: Prevents reading thousands of unnecessary lines
- Decision-tree driven: Quick lookup for common tasks
- Searchable: Use grep instead of linear reading

**Coverage:**
- Core overview: MCP protocol, server architecture, capabilities
- Project structure and tech stack
- Integration with FastEdge API
- Template system and Magic Comments

**Future Documentation Needed:**

**Architecture**:
- `architecture/MCP_PROTOCOL.md` - MCP basics and protocol details
- `architecture/SERVER_ARCHITECTURE.md` - Server lifecycle and structure
- `architecture/API_CLIENT.md` - FastEdge API client implementation
- `architecture/WORKSPACE_UTILS.md` - File operations and workspace utils

**Tools**:
- `tools/TOOL_DEVELOPMENT.md` - How to create/modify tools
- `tools/BUILD_WASM.md` - build-wasm tool details
- `tools/UPLOAD_BINARY.md` - upload-binary tool
- `tools/DEPLOY_APP.md` - update-or-create-app tool
- `tools/DEPLOY_ENV_VARS.md` - update-env-vars-app tool
- `tools/SCAFFOLDING_SYSTEM.md` - scaffold-fastedge-project tool
- `tools/MAGIC_COMMENTS.md` - deployment-comments tool
- `tools/FASTEDGE_API.md` - FastEdge API tools overview

**Prompts**:
- `prompts/PROMPT_SYSTEM.md` - How prompts work in MCP
- `prompts/CREATE_APP_PROMPT.md` - createFastEdgeApp workflow
- `prompts/DEPLOY_APP_PROMPT.md` - deployFastEdgeApp workflow
- `prompts/ENV_VARS_PROMPT.md` - setEnvironmentVariables workflow

**Resources**:
- `resources/RESOURCE_SYSTEM.md` - How resources work
- `resources/FASTEDGE_CONTEXT.md` - fastedge-context resource details
- `resources/CONTENT_GENERATION.md` - How bundled docs are generated

**Development**:
- `development/IMPLEMENTATION_GUIDE.md` - Coding patterns and conventions
- `development/TESTING_GUIDE.md` - Testing MCP server
- `development/MCP_INSPECTOR.md` - Using MCP inspector for debugging

---

**Note**: Add new entries at the TOP of this file (reverse chronological order)
