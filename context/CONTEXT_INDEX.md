# FastEdge MCP Server - Context Index

**READ THIS FIRST** - This is your navigation hub for understanding the FastEdge MCP Server.

---

## Quick Overview

**FastEdge MCP Server** provides Model Context Protocol (MCP) tools, resources, and prompts for building and deploying FastEdge applications using Claude Code.

**Provides**:
- **Tools**: Build WASM, upload binaries, deploy apps, manage env vars, scaffold projects
- **Resources**: Scaffolding guidance for agents
- **Prompts**: Interactive workflows for app creation

**Tech Stack**: TypeScript, MCP SDK (@modelcontextprotocol/sdk ^1.25.2), FastEdge SDK, Node.js

**Protocol**: Model Context Protocol (stdio transport)

---

## Decision Tree: What to Read When

Use this tree to find relevant documentation for your task:

### Understanding the System

**Task: Understand the MCP server and recent changes**
→ Read: `PROJECT_OVERVIEW.md` (~200 lines)
→ Read: `REFACTORING_FEB_2026.md` (comprehensive refactoring details)

**Task: Understand scaffolding system**
→ Read: `architecture/SCAFFOLDING-ARCHITECTURE.md` (detailed architecture)
→ Read: `architecture/MIXED-LANGUAGE-EXAMPLES.md` (examples)
→ Grep: `CHANGELOG.md` for "scaffold"

**Task: Understand prompts and migration**
→ Read: `architecture/PROMPT-MIGRATION.md` (prompt system details)
→ Read: `REFACTORING_FEB_2026.md` (sections on prompts)

### Working with Tools

**Task: Understand tool system (registerTool vs deprecated API)**
→ Read: `REFACTORING_FEB_2026.md` (section: Tool Migration)
→ Read: `PROJECT_OVERVIEW.md` (section: Tools)
→ Grep source: `src/server.ts` for `registerTool` examples

**Task: Modify build-wasm tool**
→ Read source: `src/tools/build-wasm.ts`
→ Grep: `CHANGELOG.md` for "build-wasm"

**Task: Modify deployment / API tools**
→ Read source: `src/tools/api/` (gcore-api, describe-api, workflows-list, batch-execute handlers)
→ Read source: `src/tools/api/binaries/index.ts` (upload-binary)
→ Read source: `src/api-client.ts` (HTTP client + timeout layer)
→ Grep: `CHANGELOG.md` for "deploy" or "api"

**Task: Modify scaffolding (createFastEdgeApp)**
→ Read: `architecture/SCAFFOLDING-ARCHITECTURE.md` (complete architecture)
→ Read: `architecture/MIXED-LANGUAGE-EXAMPLES.md` (usage examples)
→ Read source: `src/tools/create-fastedge-app.ts`
→ Read source: `src/prompts/scaffolding-scenarios.ts`

### Working with Resources

**Task: Understand MCP resources**
→ Read: `REFACTORING_FEB_2026.md` (section: Resources)
→ Read source: `src/resources/index.ts`
→ Read source: `src/resources/scaffolding-guide.ts`

**Task: Add new resource**
→ Read source: `src/resources/index.ts` (see registerAllResources pattern)
→ Grep: `CHANGELOG.md` for "resource"

### Fixing Bugs or Issues

**Task: Debug tool execution**
→ Enable debug mode: `DEBUG=mcp* npx ...`
→ Use MCP Inspector: `npx @modelcontextprotocol/inspector npx ...`
→ Grep: `CHANGELOG.md` for relevant error messages

**Task: Fix WASM build issue**
→ Read source: `src/tools/build-wasm.ts`
→ Read: `architecture/MIXED-LANGUAGE-EXAMPLES.md` (build patterns)
→ Grep: `CHANGELOG.md` for "build" or "wasm"

**Task: Fix API upload/deployment issue**
→ Read source: `src/tools/api/binaries/api.ts` (upload-binary API call)
→ Read source: `src/api-client.ts` (HTTP client, timeout resolution, GCORE_API_BASE override)
→ Read source: `src/tools/api/batch-execute.ts` (batch handler, $ref resolution, budget enforcement)
→ Grep: `CHANGELOG.md` for "api" or "deploy"

### Testing & Development

**Task: Test MCP server locally**
→ Run: `npm run dev` (starts in dev mode)
→ Use Claude Code with mcp.json configuration
→ Use MCP Inspector: `npx @modelcontextprotocol/inspector npx @gcoredev/fastedge-mcp-server`

**Task: Test scaffolding scenarios**
→ Read: `architecture/SCAFFOLDING-ARCHITECTURE.md` (section: Testing)
→ Try each scenario from docs/MIXED-LANGUAGE-EXAMPLES.md

---

## Documentation Map

### Core Starting Points

| Document | Lines | When to Read |
|----------|-------|--------------|
| **CONTEXT_INDEX.md** | ~180 | **Always read first** |
| **PROJECT_OVERVIEW.md** | ~200 | Understanding the MCP server overview |
| **REFACTORING_FEB_2026.md** | ~2,500 | **Primary documentation** - refactoring details |
| **SEARCH_GUIDE.md** | ~50 | Learning how to search docs |
| **CHANGELOG.md** | Variable | **Never read linearly** - use grep |

### Architecture (context/architecture/)

| Document | Focus | Read When |
|----------|-------|-----------|
| **SCAFFOLDING-ARCHITECTURE.md** | Complete scaffolding system (prompts + tools + resources) | Working with project scaffolding |
| **MIXED-LANGUAGE-EXAMPLES.md** | Mixed-language repository examples | Multi-language projects |
| **PROMPT-MIGRATION.md** | Old → new prompt migration notes | Understanding prompt system |

### User-Facing Documentation (docs/)

| Document | Focus |
|----------|-------|
| **dotenv.md** | How to provide env vars, secrets, response headers via .env files |

### Source Code Organization

**Key files to explore**:
```
src/
├── server.ts                  # Entry point, env vars (GCORE_API_KEY only)
├── api-client.ts              # HTTP client: GCORE_API_BASE override, AbortController timeout
├── config/
│   └── products.ts            # Product registry (specPath, pagination, timeout_ms)
├── generated/                 # Auto-generated by scripts/generate-schemas.ts
│   ├── schemas.ts             # 55 schema groups (FastEdge, CDN, DNS, WAAP, Storage)
│   └── config.ts              # Baked GCORE_API_BASE constant
├── workflows/
│   ├── types.ts, registry.ts
│   └── fastedge/              # create-app, update-app-binary, delete-app-and-binary
├── tools/
│   ├── index.ts               # registerAllTools (ToolOptions interface)
│   ├── api/                   # Direct Gcore API tools
│   │   ├── gcore-api.ts       # Execute any API call
│   │   ├── describe-api.ts    # Schema docs per resource group
│   │   ├── workflows-list.ts  # Multi-step workflow templates
│   │   ├── batch-execute.ts   # Sequential batch + $ref + budget cap
│   │   └── binaries/          # upload-binary (direct API POST)
│   └── local/                 # Workspace/scaffolding/reference tools
│       ├── reference/         # fastedge-docs
│       ├── scaffolding/       # scaffold-fastedge-project, list-fastedge-templates
│       └── workspace/         # build-wasm, deployment-comments
├── prompts/                   # MCP prompts (scaffolding, deploying)
├── resources/                 # MCP resources (scaffolding-guide)
└── utils/                     # Shared utilities (normalizePath)
```

---

## Search Patterns

**Don't read CHANGELOG.md linearly** - Use these search patterns:

```bash
# Find tool changes
grep -i "build-wasm" context/CHANGELOG.md
grep -i "tool" context/CHANGELOG.md
grep -i "scaffold" context/CHANGELOG.md

# Find prompt changes
grep -i "prompt" context/CHANGELOG.md
grep -i "createFastEdgeApp" context/CHANGELOG.md

# Find API changes
grep -i "api" context/CHANGELOG.md
grep -i "deploy" context/CHANGELOG.md

# Find specific fixes
grep -i "fix.*wasm" context/CHANGELOG.md
grep -i "fix.*upload" context/CHANGELOG.md
```

**Search source code**:
```bash
# Find tool implementations
ls src/tools/

# Find all registerTool calls
grep -r "registerTool" src/

# Find API usage
grep -r "fastedge-api" src/
```

See `SEARCH_GUIDE.md` for more patterns.

---

## Token Efficiency Strategy

**Estimated token costs:**
- This file (CONTEXT_INDEX.md): ~400 tokens
- PROJECT_OVERVIEW.md: ~500 tokens
- REFACTORING_FEB_2026.md: ~6,000 tokens (comprehensive, but contains everything)
- SCAFFOLDING-ARCHITECTURE.md: ~2,000 tokens
- CHANGELOG.md: **Don't read** - grep only

**Typical task token usage:**
- Simple bug fix: ~400-900 tokens (this file + grep CHANGELOG)
- Understanding scaffolding: ~2,400 tokens (this file + SCAFFOLDING-ARCHITECTURE.md)
- Complete system understanding: ~7,000 tokens (this file + REFACTORING_FEB_2026.md + docs)

**Compare to reading everything upfront: ~10,000+ tokens**

**Best practice**: Start with this file, then read only what you need based on decision tree.

---

## Key Concepts

### MCP Components

**Model Context Protocol (MCP)**:
- Protocol for connecting AI assistants to external tools/data
- Uses stdio transport (stdin/stdout communication)
- JSON-RPC messages between client (Claude Code) and server (this)

**Three MCP primitives**:

1. **Tools** - Functions Claude can call
   - Local (workspace ops): `build-wasm`, `scaffold-fastedge-project`, `list-fastedge-templates`, `fastedge-docs`, `deployment-comments`
   - API (direct Gcore API calls): `upload-binary`, `gcore_api`, `describe_api`, `workflows_list`, `batch_execute`
   - Defined with Zod schemas, registered using `server.registerTool()` API

2. **Resources** - Static content Claude can read
   - Example: `fastedge://guides/scaffolding`
   - URI-based addressing
   - Returns markdown/text content for agent guidance

3. **Prompts** - Interactive workflows
   - Example: `createFastEdgeApp` (smart scaffolding with 3 scenarios)
   - Can include arguments and messages
   - Guide users through multi-step processes

### FastEdge Integration

**FastEdge API**:
- All API calls go direct from `src/api-client.ts` — no proxy, no embedded MCP client
- Requires `GCORE_API_KEY` environment variable
- `GCORE_API_BASE` (optional) runtime overrides the build-time baked API base URL (useful for in-house preprod testing with prod schemas)
- Per-call timeout: 60s default, per-product override via `src/config/products.ts`
- `batch_execute` total budget capped at 3 min (sum of per-step product timeouts)

**Build Process**:
- Rust: `cargo build --target wasm32-wasip1`
- JavaScript/TypeScript: `npx fastedge-build <input> <output>`
- AssemblyScript: `asc <input> -o <output>`
- Mixed-language: TypeScript frontend + Rust logic

**Deployment Flow**:
1. Build WASM binary from source code
2. Upload binary to FastEdge API (returns binary ID)
3. Create/update app with binary ID
4. Deploy env vars/secrets (optional)

### Smart Scaffolding (3 Scenarios)

**New scaffolding system** (Feb 2026) intelligently handles:

**Scenario A**: Empty directory or new project
- Creates complete project structure
- Delegates to `create-fastedge-app` CLI
- Supports all templates and languages

**Scenario B**: Existing FastEdge project (has `.claude/skills/fastedge-*`)
- Detects existing project
- Warns user, offers to continue or switch directories
- Preserves existing structure

**Scenario C**: Mixed-language project (TypeScript + Rust)
- Detects TypeScript entrypoint (package.json)
- Prompts for Rust crate location
- Sets up build pipeline for both
- Validates rust/ folder exists

See `context/architecture/SCAFFOLDING-ARCHITECTURE.md` for complete details.

---

## Recent Changes

**April 2026** — Absorbed gcore-api-mcp-server:
- ✅ 4 API tools now native (`gcore_api`, `describe_api`, `workflows_list`, `batch_execute`)
- ✅ Build pipeline (OpenAPI spec → generated schemas) lives here
- ✅ Removed proxy hop, `GCORE_API_MCP_URL` env, embedded MCP client
- ✅ Added `GCORE_API_BASE` runtime override for preprod testing
- ✅ Per-call + per-product + batch-total timeout layer
- ✅ Tool folders split: `src/tools/local/` vs `src/tools/api/`
- ✅ Added `pnpm run test` (node:test + tsx, 21 tests)

See the top entry of `CHANGELOG.md` for details.

**February 2026** — Tool system migration:
- ✅ All tools migrated to modern MCP SDK (`registerTool`)
- ✅ Scaffolding: intelligent 3-scenario system + mixed-language support

See `REFACTORING_FEB_2026.md` for details on the Feb 2026 refactor.

---

## Getting Help

**Common questions:**

1. **How do I add a new tool?**
   → Study existing tools in `src/tools/`
   → Follow `server.registerTool()` pattern from `src/server.ts`
   → Read `REFACTORING_FEB_2026.md` (section: Tool Migration)

2. **How does MCP work?**
   → Read `PROJECT_OVERVIEW.md` (MCP basics)
   → Explore `src/server.ts` (registration patterns)

3. **How do I test my changes?**
   → Run `npm run dev` for development mode
   → Use MCP Inspector: `npx @modelcontextprotocol/inspector npx @gcoredev/fastedge-mcp-server`
   → Test with Claude Code + `.claude/mcp.json`

4. **How does scaffolding work?**
   → Read `context/architecture/SCAFFOLDING-ARCHITECTURE.md` (complete architecture)
   → Read `context/architecture/MIXED-LANGUAGE-EXAMPLES.md` (examples)

5. **How does the reference docs tool work?**
   → Read source: `src/tools/reference/index.ts`
   → The `fastedge-docs` tool serves pipeline-generated reference docs from `reference-docs/`
   → Three modes: `topics` (catalog), `search` (section keyword match), `read` (full doc)

---

**Last Updated**: April 2026
**MCP SDK Version**: ^1.25.2
