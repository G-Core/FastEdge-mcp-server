# AI Agent Instructions for FastEdge MCP Server

## 🎯 CRITICAL: Read Smart, Not Everything

**DO NOT read all context files upfront.** This repository uses a **discovery-based context system** to minimize token usage while maximizing effectiveness.

---

## Getting Started: Discovery Pattern

### Step 1: Read the Index (REQUIRED - ~100 lines)

**First action when starting work**: Read `context/CONTEXT_INDEX.md`

This lightweight file gives you:
- MCP server overview and quick start
- Documentation map organized by topic (tools, prompts, resources)
- Decision tree for what to read when
- Search patterns for finding information

### Step 2: Read Based on Your Task (JUST-IN-TIME)

Use the decision tree in CONTEXT_INDEX.md to determine what to read. **Only read what's relevant to your current task.**

**Examples:**

**Task: "Add new MCP tool"**
- Read: `context/tools/TOOL_DEVELOPMENT.md`
- Read: `context/architecture/MCP_PROTOCOL.md`
- Grep: `context/CHANGELOG.md` for similar tools

**Task: "Fix WASM build issue"**
- Read: `context/tools/BUILD_WASM.md`
- Read: `context/architecture/WORKSPACE_UTILS.md`
- Grep: `context/CHANGELOG.md` for "build" or "wasm"

**Task: "Add new prompt workflow"**
- Read: `context/prompts/PROMPT_SYSTEM.md`
- Read: `context/architecture/MCP_PROTOCOL.md`
- Grep: `context/CHANGELOG.md` for "prompt"

**Task: "Update FastEdge API integration"**
- Read: `context/tools/FASTEDGE_API.md`
- Read: `context/architecture/API_CLIENT.md`
- Grep: `context/CHANGELOG.md` for "api"

**Task: "Add new context resource"**
- Read: `context/resources/RESOURCE_SYSTEM.md`
- Grep: `context/CHANGELOG.md` for "resource"

### Step 3: Search, Don't Read Everything

**Use grep and search tools** instead of reading large docs linearly:

- **CHANGELOG.md**: **NEVER read linearly** - use grep to search for keywords
- **Tool docs**: Read specific tool, not all tools
- **Resource docs**: Only read the resource you're working on

See `context/SEARCH_GUIDE.md` for search patterns and examples.

---

## 📋 Decision Tree Reference

**Quick lookup for common tasks:**

| Task Type | What to Read |
|-----------|-------------|
| **Adding new MCP tool** | TOOL_DEVELOPMENT + MCP_PROTOCOL + grep CHANGELOG |
| **Modifying existing tool** | Specific tool doc + TOOL_DEVELOPMENT |
| **Adding new prompt** | PROMPT_SYSTEM + existing prompt docs |
| **Fixing build/deployment** | BUILD_WASM + DEPLOY_APP + grep CHANGELOG |
| **FastEdge API changes** | FASTEDGE_API + API_CLIENT |
| **Adding context resource** | RESOURCE_SYSTEM + existing resource docs |
| **Magic Comments feature** | MAGIC_COMMENTS + DEPLOYMENT_TRACKING |
| **Template/scaffolding** | SCAFFOLDING_SYSTEM + TEMPLATES |
| **Understanding MCP** | PROJECT_OVERVIEW + MCP_PROTOCOL |

---

## 🚫 Anti-Patterns (What NOT to Do)

❌ **Don't**: Read all tool docs upfront (wastes tokens)
❌ **Don't**: Read CHANGELOG.md linearly (use grep instead)
❌ **Don't**: Read all prompts when working on one
❌ **Don't**: Read entire docs when you need specific sections
❌ **Don't**: Start coding without reading MCP_PROTOCOL basics

✅ **Do**: Read CONTEXT_INDEX.md first
✅ **Do**: Use grep to search CHANGELOG and large docs
✅ **Do**: Read only sections relevant to current task
✅ **Do**: Read documentation just-in-time when you need it
✅ **Do**: Follow links in docs to discover related information

---

## ⚡ Critical Working Practices

### Task Checklists (ALWAYS USE)

When starting any non-trivial task (multi-step, multiple files, refactoring, features, etc.):

1. **First action**: Use TaskCreate to break down the work into trackable tasks
2. Update task status as you work (`in_progress` → `completed`)
3. This gives the user real-time visibility into progress

**When to create task checklists:**
- Multi-step tasks (3+ steps)
- Tasks involving multiple files or components
- Adding new tools or prompts
- Feature implementation
- Bug fixes that affect multiple areas

### Parallel Agents (USE WHEN POSSIBLE)

When tasks are **independent** (different files, different components, no dependencies):

1. **Spawn multiple agents in parallel** using multiple Task tool calls in a **single message**
2. Each agent works concurrently on its task
3. **Massive time savings**: 10-15x faster than sequential processing

**When to use parallel agents:**
- Updating multiple tool docs
- Creating multiple similar features
- Documentation updates across multiple files

**When NOT to use:**
- Tasks with dependencies (B needs A's output)
- Tasks modifying the same file
- Tasks requiring sequential logic

---

## 📝 Documentation Maintenance

### When to Update Context Files

**After completing major features:**
- Update `context/CHANGELOG.md` - Add detailed entry at the TOP (reverse chronological)
- Update `context/PROJECT_OVERVIEW.md` - Update capabilities list
- Update or create tool/prompt-specific doc in `context/tools/` or `context/prompts/`

**After MCP protocol changes:**
- Update `context/architecture/MCP_PROTOCOL.md`
- Update `context/CHANGELOG.md`

**After significant bug fixes:**
- Update `context/CHANGELOG.md` with the fix
- Update tool/prompt doc's Known Issues section if applicable

**What NOT to document:**
- Trivial typo fixes
- Code formatting changes
- Comment updates
- Routine dependency updates (unless they change functionality)

### Changelog Entry Format

```markdown
## [Date] - [Feature/Tool Name]

### Overview
Brief description of what was accomplished

### 🎯 What Was Completed

#### 1. [Tool/Prompt Name]
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

## 📁 Context Organization

The context folder is organized by topic:

```
context/
├── CONTEXT_INDEX.md          # Read this first (~100 lines)
├── PROJECT_OVERVIEW.md       # Lightweight overview
├── CHANGELOG.md              # Search, don't read linearly
├── SEARCH_GUIDE.md           # How to search effectively
│
├── architecture/             # Read when modifying structure
│   ├── MCP_PROTOCOL.md           # Model Context Protocol basics
│   ├── SERVER_ARCHITECTURE.md    # Server structure and lifecycle
│   ├── API_CLIENT.md             # FastEdge API client
│   └── WORKSPACE_UTILS.md        # Workspace file operations
│
├── tools/                    # Read specific tool when needed
│   ├── TOOL_DEVELOPMENT.md       # How to create/modify tools
│   ├── BUILD_WASM.md             # build-wasm tool
│   ├── UPLOAD_BINARY.md          # upload-binary tool
│   ├── DEPLOY_APP.md             # update-or-create-app tool
│   ├── DEPLOY_ENV_VARS.md        # update-env-vars-app tool
│   ├── SCAFFOLDING_SYSTEM.md     # scaffold-fastedge-project tool
│   ├── MAGIC_COMMENTS.md         # deployment-comments tool
│   └── FASTEDGE_API.md           # FastEdge API integration
│
├── prompts/                  # Read specific prompt when needed
│   ├── PROMPT_SYSTEM.md          # How prompts work
│   ├── CREATE_APP_PROMPT.md      # createFastEdgeApp prompt
│   ├── DEPLOY_APP_PROMPT.md      # deployFastEdgeApp prompt
│   └── ENV_VARS_PROMPT.md        # setEnvironmentVariables prompt
│
├── resources/                # Read specific resource when needed
│   ├── RESOURCE_SYSTEM.md        # How resources work
│   ├── FASTEDGE_CONTEXT.md       # fastedge-context resource
│   └── CONTENT_GENERATION.md     # How context docs are generated
│
└── development/              # Read when implementing/testing
    ├── IMPLEMENTATION_GUIDE.md   # Coding patterns
    ├── TESTING_GUIDE.md          # Testing MCP server
    └── MCP_INSPECTOR.md          # Using MCP inspector for debugging
```

---

## 🔍 Search Tips

**Instead of reading CHANGELOG.md:**
```bash
grep -i "build-wasm" context/CHANGELOG.md
grep -i "tool" context/CHANGELOG.md
grep -i "fix.*api" context/CHANGELOG.md
```

**Find tool documentation:**
```bash
ls context/tools/ | grep -i "build"
```

**Search across all context:**
```bash
grep -r "MCP protocol" context/
grep -r "FastEdge API" context/
```

**See `context/SEARCH_GUIDE.md` for comprehensive search patterns.**

---

## MCP Server Overview

**FastEdge MCP Server** provides Model Context Protocol tools for building, deploying, and scaffolding FastEdge applications with Claude Code.

### Key Capabilities:

**MCP Tools** (callable functions):
- `get-fastedge-context` - Get comprehensive FastEdge documentation
- `scaffold-fastedge-project` - Create new projects from templates
- `list-fastedge-templates` - List available templates
- `build-wasm` - Build WASM binaries from source code
- `upload-binary` - Upload binaries to FastEdge API
- `update-or-create-app` - Deploy or update applications
- `update-env-vars-app` - Deploy environment variables/secrets
- `get-secret-id` - Get secret IDs by name
- `deployment-comments` - Generate Magic Comments

**MCP Resources** (static content):
- `fastedge-context` - Comprehensive FastEdge dev documentation
- Includes SDK docs, examples, best practices

**MCP Prompts** (interactive workflows):
- `createFastEdgeApp` - Guided app creation
- `deployFastEdgeApp` - Full deployment workflow
- `setEnvironmentVariables` - Env var deployment
- `insertMagicComments` - Add deployment tracking

### Tech Stack:
- **Language**: TypeScript
- **MCP SDK**: `@modelcontextprotocol/sdk`
- **FastEdge SDK**: `@gcoredev/fastedge-sdk-js`
- **Build Tool**: esbuild (for bundling)
- **Protocol**: Model Context Protocol (stdio transport)

---

## Quick Reference

**Common Commands:**
```bash
pnpm install
pnpm run build          # Build server (creates docs + compiles)
pnpm run server:dev     # Run server in dev mode
pnpm run server:inspect # Run with MCP inspector
pnpm run create:docs    # Generate context docs
```

**Project Structure:**
```
FastEdge-mcp-server/
├── src/
│   ├── server.ts           # MCP server entry point
│   ├── tools/              # MCP tool implementations
│   │   ├── fastedge/       # FastEdge API tools
│   │   ├── scaffolding/    # Project scaffolding
│   │   ├── workspace/      # Workspace operations
│   │   └── context/        # Context retrieval
│   ├── resources/          # MCP resource providers
│   │   ├── fastedge-core/  # Core FastEdge docs
│   │   ├── fastedge-sdk-js/# SDK documentation
│   │   └── fastedge-examples/ # Example code
│   ├── prompts/            # MCP prompt workflows
│   │   ├── scaffolding.ts  # createFastEdgeApp
│   │   └── deploying.ts    # deployFastEdgeApp, setEnvVars
│   └── utils/              # Shared utilities
├── assets/
│   ├── context/            # Context markdown files
│   └── scripts/            # Build scripts
└── package.json
```

**Key Files:**
- `src/server.ts` - MCP server initialization
- `src/tools/index.ts` - Tool registration
- `assets/context/` - Context docs bundled into resources

---

## Summary: How to Work Efficiently

1. **Read `context/CONTEXT_INDEX.md` first** (~100 lines, ~250 tokens)
2. **Use the decision tree** to identify what docs are relevant
3. **Read only what you need** for your current task (~500-2,000 tokens)
4. **Use grep to search** CHANGELOG and large docs instead of reading linearly
5. **Follow links** in documentation to discover related information
6. **Create task checklists** for non-trivial tasks
7. **Use parallel agents** when tasks are independent
8. **Update documentation** after completing significant work

**Token Savings**: 75-80% reduction vs. reading all docs upfront

**Result**: Faster agent startup, better focus, scalable documentation system

---

## Important Notes

**This is a standalone repository:**
- Can be used independently
- Does not depend on the coordinator structure
- Has its own git repository
- Self-contained with all dependencies

**When working in this repo:**
- Follow the patterns established here
- Update context files in this repo's context/ folder
- Keep documentation focused on the MCP server

**Integration points:**
- FastEdge API (for deployment)
- FastEdge SDK JS (for building)
- Claude Code (MCP client)
- VS Code FastEdge extension (complementary tools)

---

**Last Updated**: February 2026
