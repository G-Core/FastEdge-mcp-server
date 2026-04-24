# AI Agent Instructions for FastEdge MCP Server

## Governance (REQUIRED)

Read `AGENTS.md` for company-wide agent rules. These are mandatory and override any conflicting behavior. Key rules: never go beyond the assigned task, never change code that was not asked to change, never "improve" or "optimize" without a clear request, always distinguish observations from action requests.

---

## CRITICAL: Read Smart, Not Everything

**DO NOT read all context files upfront.** This repository uses a **discovery-based context system** to minimize token usage while maximizing effectiveness.

---

## Getting Started: Discovery Pattern

### Step 1: Read the Index (REQUIRED)

**First action when starting work:** Read `context/CONTEXT_INDEX.md`

This lightweight file gives you:
- Project quick start (what this server does)
- Documentation map organized by topic
- Decision tree for what to read based on your task
- Search patterns for finding information

### Step 2: Read Based on Your Task (JUST-IN-TIME)

Use the decision tree in `CONTEXT_INDEX.md` to determine what to read. **Only read what's relevant to your current task.**

**Examples:**

**Task: "Add a new MCP tool"**
- Read: `context/PROJECT_OVERVIEW.md` (tool system section)
- Read: existing tool as template in `src/tools/local/` or `src/tools/api/`

**Task: "Modify an API tool or fix an API call issue"**
- Read source: `src/tools/api/` (relevant handler)
- Read source: `src/api-client.ts` (HTTP client, timeout layer, `GCORE_API_BASE`)
- Grep: `context/CHANGELOG.md` for "api" or "deploy"

**Task: "Regenerate API schemas"**
- Read: `scripts/generate-schemas.ts` + `src/config/products.ts`
- Run: `SPEC_BASE_URL=https://api.gcore.com pnpm run generate:schemas`

**Task: "Fix WASM build issue"**
- Read source: `src/tools/local/workspace/build.ts` + `compiler/`
- Grep: `context/CHANGELOG.md` for "build" or "wasm"

**Task: "Understand the system"**
- Read: `context/PROJECT_OVERVIEW.md` (~200 lines)
- Read: `context/CONTEXT_INDEX.md` (~180 lines)

### Step 3: Search, Don't Read Everything

- **CHANGELOG.md**: grow-only log — always grep, never read linearly
- **Architecture docs** (scaffolding, prompts): read specific sections
- **Generated schemas** (`src/generated/schemas.ts`, ~200 KB): grep for endpoint names

---

## Decision Tree Reference

| Task Type | What to Read |
|-----------|-------------|
| **Adding a new API tool** | PROJECT_OVERVIEW + existing handler in `src/tools/api/` |
| **Modifying API tools / fixing calls** | `src/tools/api/` + `src/api-client.ts` + grep CHANGELOG |
| **Regenerating schemas** | `scripts/generate-schemas.ts` + `src/config/products.ts` |
| **Adding a product (e.g. re-add cloud)** | `src/config/products.ts` + run `generate:schemas` |
| **Timeout / batch budget** | `src/api-client.ts` (`resolveTimeoutMs`) + `src/tools/api/batch-execute.ts` |
| **Fixing WASM build** | `src/tools/local/workspace/` + grep CHANGELOG for "build" |
| **Scaffolding system** | `context/architecture/SCAFFOLDING-ARCHITECTURE.md` |
| **Adding a workflow** | `src/workflows/types.ts` + existing workflow in `src/workflows/fastedge/` |
| **Env var changes** | `src/server.ts` + DEVELOPMENT.md env table |
| **Preprod setup** | DEVELOPMENT.md ("Preprod recipe" section) |

---

## Anti-Patterns (What NOT to Do)

**Don't:** Read all context docs upfront
**Don't:** Hand-edit `src/generated/` — run `pnpm run generate:schemas` instead
**Don't:** Read `context/CHANGELOG.md` linearly — grep it
**Don't:** Add dependencies without understanding container image impact
**Don't:** Re-introduce `GCORE_API_MCP_URL` / a proxy layer — API calls go direct now

**Do:** Read `AGENTS.md` and `context/CONTEXT_INDEX.md` first
**Do:** Use grep to search CHANGELOG and large files
**Do:** Follow existing patterns in `src/tools/api/` and `src/tools/local/` for new tools
**Do:** Run `pnpm run test` after changes to API tools or timeouts

---

## Critical Working Practices

### Task Checklists (ALWAYS USE)

For multi-step work (3+ steps, multiple files, refactors, features):

1. Use `TaskCreate` to break work into discrete steps
2. Mark tasks `in_progress` when starting, `completed` when done

### Parallel Agents

For independent work, spawn parallel agents — research different subsystems, update multiple docs, port multiple files concurrently.

### Documentation Maintenance

- **After adding a feature:** Add a `context/CHANGELOG.md` entry at the top (reverse chronological)
- **After changing env vars:** Update `DEVELOPMENT.md` env table + README
- **After architectural changes:** Update relevant doc in `context/architecture/`
- **After tool changes:** Keep `context/PROJECT_OVERVIEW.md` tool list in sync

---

## Context Organization

```
FastEdge-mcp-server/
├── AGENTS.md                          ← Governance rules (REQUIRED)
├── CLAUDE.md                          ← YOU ARE HERE
├── README.md                          ← User-facing docs
├── DEVELOPMENT.md                     ← Env vars, build, preprod recipe
├── STANDALONE-SETUP.md                ← Docker image quick start
├── context/
│   ├── CONTEXT_INDEX.md               ← Read first (discovery hub)
│   ├── PROJECT_OVERVIEW.md            ← System overview
│   ├── CHANGELOG.md                   ← Agent decision log (grep, don't read)
│   ├── SEARCH_GUIDE.md                ← Search patterns
│   ├── REFACTORING_FEB_2026.md        ← Historical: Feb 2026 tool-system refactor
│   └── architecture/                  ← Scaffolding, prompt migration, mixed-language
├── src/
│   ├── server.ts                      ← Entry point (stdio transport, env vars)
│   ├── api-client.ts                  ← Gcore API HTTP client + timeout layer
│   ├── config/products.ts             ← Product registry (timeouts, pagination)
│   ├── generated/                     ← Auto-generated schemas (do not hand-edit)
│   ├── workflows/                     ← Multi-step batch templates
│   ├── tools/
│   │   ├── api/                       ← Direct Gcore API tools (+ upload-binary)
│   │   └── local/                     ← Workspace / scaffolding / reference tools
│   ├── prompts/                       ← Interactive prompt workflows
│   ├── resources/                     ← Scaffolding guidance resource
│   └── utils/                         ← Shared utilities
├── scripts/
│   ├── generate-schemas.ts            ← OpenAPI → generated schemas
│   ├── sync-reference-docs.sh         ← Sync docs from fastedge-plugin
│   └── tests/                         ← node:test + bash tests
├── reference-docs/                    ← Synced from fastedge-plugin
└── package.json
```

---

## Quick Reference

**Tech Stack:**
- TypeScript · `@modelcontextprotocol/sdk` (^1.25.2) · `@gcoredev/fastedge-sdk-js`
- Node 20+ · pnpm · `tsc` build · stdio transport

**Common Commands:**

| Command | Purpose |
|---------|---------|
| `pnpm install` | Install deps |
| `pnpm run build` | Compile TypeScript |
| `pnpm run server:dev` | Run server via tsx (dev mode) |
| `pnpm run server:inspect` | Run with MCP Inspector |
| `pnpm run generate:schemas` | Regenerate API schemas (needs `SPEC_BASE_URL`) |
| `pnpm run test` | Run full test suite |
| `pnpm run test:api` | Run API handler + timeout tests only |

**Environment Variables:**

| Variable | Required | Purpose |
|----------|----------|---------|
| `GCORE_API_KEY` | Yes | API authentication (legacy `FASTEDGE_API_KEY` also accepted) |
| `GCORE_API_BASE` | No | Runtime override for baked-in Gcore API base URL (preprod testing) |
| `BATCH_MAX_CALLS` | No | Max calls per `batch_execute` (default: 5) |
| `WORKSPACE_ROOT` | No | Workspace root path (default: `/workspace` in Docker) |

See `DEVELOPMENT.md` for the full env var table and preprod build recipe.

---

## Search Tips

**Find all registered tools:**
```bash
grep -r "registerTool" src/
```

**Find tool definitions by name:**
```bash
grep -rn "\"gcore_api\"\|\"describe_api\"\|\"upload-binary\"" src/tools/
```

**Grep CHANGELOG for recent changes:**
```bash
grep -i "api\|tool\|fix" context/CHANGELOG.md
```

**Find API call paths in source:**
```bash
grep -r "/fastedge/v1\|/cdn/" src/
```

See `context/SEARCH_GUIDE.md` for more patterns.

---

## Summary

1. Read `AGENTS.md` for governance rules
2. Read `context/CONTEXT_INDEX.md` first
3. Use the decision tree to find relevant docs
4. Read only what you need for your current task
5. Use grep for CHANGELOG and large files
6. Update context docs after significant changes
7. Use `TaskCreate` for multi-step work

---

**Last Updated**: April 2026
