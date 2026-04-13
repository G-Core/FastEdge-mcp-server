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

**Task: Modify deployment tools**
→ Read source: `src/tools/deploy-app.ts`
→ Read source: `src/tools/upload-binary.ts`
→ Grep: `CHANGELOG.md` for "deploy"

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
→ Read source: `src/tools/upload-binary.ts`
→ Read source: `src/tools/deploy-app.ts`
→ Read source: `src/utils/fastedge-api.ts`
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
├── server.ts              # Main entry point, tool/resource registration
├── tools/                 # All 8 MCP tools
│   ├── build-wasm.ts      # Build WASM binaries
│   ├── upload-binary.ts   # Upload to FastEdge API
│   ├── deploy-app.ts      # Deploy applications
│   ├── deploy-env-vars.ts # Manage env vars
│   ├── create-fastedge-app.ts  # Smart scaffolding (3 scenarios)
│   └── ...                # Other tools
├── prompts/               # MCP prompts
│   └── scaffolding-scenarios.ts  # Smart scaffolding prompt
├── resources/             # MCP resources
│   ├── index.ts           # Resource registration
│   └── scaffolding-guide.ts  # Agent guidance resource
└── utils/                 # Shared utilities
    ├── fastedge-api.ts    # API client
    └── workspace.ts       # File operations
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
   - Example: `build-wasm`, `upload-binary`, `deploy-app`, `create-fastedge-app`
   - Defined with schemas (input/output)
   - Registered using modern `server.registerTool()` API
   - All 8 tools migrated to new API (Feb 2026)

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
- Upload binaries
- Create/update applications
- Manage environment variables and secrets
- Requires API token (FASTEDGE_API_TOKEN environment variable)

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

## Recent Changes (February 2026)

**Major refactoring completed**:
- ✅ All 8 tools migrated to modern MCP SDK (`registerTool`)
- ✅ Removed deprecated `server.tool()` API (0 instances remain)
- ✅ Replaced simple scaffolding with intelligent 3-scenario system
- ✅ Added MCP resources for agent guidance
- ✅ Full mixed-language support (TypeScript + Rust)
- ✅ Context detection and validation
- ✅ Enhanced tool enforcement (prevents `npx create-fastedge-app` bypass)

See `REFACTORING_FEB_2026.md` for complete refactoring details (2,500+ lines).

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
