# FastEdge MCP Server - Context Index

**READ THIS FIRST** - This is your navigation hub for understanding the FastEdge MCP Server.

---

## Quick Overview

**FastEdge MCP Server** provides Model Context Protocol (MCP) tools, resources, and prompts for building and deploying FastEdge applications using Claude Code.

**Provides**:
- **Tools**: Build WASM, upload binaries, deploy apps, manage env vars, scaffold projects
- **Resources**: Comprehensive FastEdge documentation (SDK, examples, patterns)
- **Prompts**: Interactive workflows for app creation and deployment

**Tech Stack**: TypeScript, MCP SDK, FastEdge SDK, Node.js

**Protocol**: Model Context Protocol (stdio transport)

---

## Decision Tree: What to Read When

Use this tree to find relevant documentation for your task:

### Adding or Modifying Tools

**Task: Add new MCP tool**
→ Read: `tools/TOOL_DEVELOPMENT.md`
→ Read: `architecture/MCP_PROTOCOL.md`
→ Grep: `CHANGELOG.md` for similar tools

**Task: Modify build-wasm tool**
→ Read: `tools/BUILD_WASM.md`
→ Read: `architecture/WORKSPACE_UTILS.md`

**Task: Modify deployment tools**
→ Read: `tools/DEPLOY_APP.md` or `tools/DEPLOY_ENV_VARS.md`
→ Read: `tools/FASTEDGE_API.md`

**Task: Add scaffolding template**
→ Read: `tools/SCAFFOLDING_SYSTEM.md`
→ Grep: `CHANGELOG.md` for "template" or "scaffold"

### Working with Prompts

**Task: Add new prompt workflow**
→ Read: `prompts/PROMPT_SYSTEM.md`
→ Read: `architecture/MCP_PROTOCOL.md`

**Task: Modify createFastEdgeApp prompt**
→ Read: `prompts/CREATE_APP_PROMPT.md`
→ Read: `tools/SCAFFOLDING_SYSTEM.md`

**Task: Modify deployFastEdgeApp workflow**
→ Read: `prompts/DEPLOY_APP_PROMPT.md`
→ Read: `tools/BUILD_WASM.md`, `tools/UPLOAD_BINARY.md`, `tools/DEPLOY_APP.md`

### Managing Resources

**Task: Add new context resource**
→ Read: `resources/RESOURCE_SYSTEM.md`
→ Grep: `CHANGELOG.md` for "resource"

**Task: Update FastEdge context docs**
→ Read: `resources/FASTEDGE_CONTEXT.md`
→ Read: `resources/CONTENT_GENERATION.md`

### Fixing Bugs

**Task: Fix WASM build issue**
→ Read: `tools/BUILD_WASM.md`
→ Read: `architecture/WORKSPACE_UTILS.md`
→ Grep: `CHANGELOG.md` for "build" or "wasm"

**Task: Fix API upload/deployment issue**
→ Read: `tools/FASTEDGE_API.md`
→ Read: `architecture/API_CLIENT.md`
→ Grep: `CHANGELOG.md` for "api" or "deploy"

**Task: Fix Magic Comments**
→ Read: `tools/MAGIC_COMMENTS.md`
→ Grep: `CHANGELOG.md` for "magic" or "comment"

### Understanding the System

**Task: Understand MCP protocol basics**
→ Read: `architecture/MCP_PROTOCOL.md`
→ Skim: `PROJECT_OVERVIEW.md`

**Task: Understand server architecture**
→ Read: `architecture/SERVER_ARCHITECTURE.md`
→ Read: `PROJECT_OVERVIEW.md`

**Task: Understand how tools work**
→ Read: `tools/TOOL_DEVELOPMENT.md`
→ Skim: `architecture/MCP_PROTOCOL.md`

### Testing & Development

**Task: Test MCP server locally**
→ Read: `development/TESTING_GUIDE.md`
→ Read: `development/MCP_INSPECTOR.md`

**Task: Debug tool execution**
→ Read: `development/MCP_INSPECTOR.md`
→ Read: specific tool doc

---

## Documentation Map

### Core Starting Points

| Document | Lines | When to Read |
|----------|-------|--------------|
| **CONTEXT_INDEX.md** | ~100 | **Always read first** |
| **PROJECT_OVERVIEW.md** | ~200 | Understanding the MCP server |
| **SEARCH_GUIDE.md** | ~50 | Learning how to search docs |
| **CHANGELOG.md** | Variable | **Never read linearly** - use grep |

### Architecture (Read when modifying structure)

| Document | Focus | Read When |
|----------|-------|-----------|
| **MCP_PROTOCOL.md** | Model Context Protocol basics | Understanding MCP, adding tools/prompts |
| **SERVER_ARCHITECTURE.md** | Server structure, lifecycle | Modifying server initialization |
| **API_CLIENT.md** | FastEdge API integration | Working with API calls |
| **WORKSPACE_UTILS.md** | File operations, workspace utils | File reading/writing, WASM building |

### Tools (Read specific tool when needed)

| Document | Focus | Read When |
|----------|-------|-----------|
| **TOOL_DEVELOPMENT.md** | Creating/modifying tools | Adding new tools |
| **BUILD_WASM.md** | Build WASM binary tool | WASM compilation issues |
| **UPLOAD_BINARY.md** | Upload binary to API | Binary upload issues |
| **DEPLOY_APP.md** | Deploy/update app tool | Application deployment |
| **DEPLOY_ENV_VARS.md** | Deploy env vars/secrets | Env var management |
| **SCAFFOLDING_SYSTEM.md** | Project scaffolding | Adding templates |
| **MAGIC_COMMENTS.md** | Deployment tracking | Magic Comments feature |
| **FASTEDGE_API.md** | FastEdge API tools | API integration |

### Prompts (Read specific prompt when needed)

| Document | Focus | Read When |
|----------|-------|-----------|
| **PROMPT_SYSTEM.md** | How prompts work | Adding new prompts |
| **CREATE_APP_PROMPT.md** | createFastEdgeApp workflow | App creation prompt |
| **DEPLOY_APP_PROMPT.md** | deployFastEdgeApp workflow | Deployment prompt |
| **ENV_VARS_PROMPT.md** | setEnvironmentVariables | Env vars prompt |

### Resources (Read specific resource when needed)

| Document | Focus | Read When |
|----------|-------|-----------|
| **RESOURCE_SYSTEM.md** | How resources work | Adding resources |
| **FASTEDGE_CONTEXT.md** | fastedge-context resource | Context content |
| **CONTENT_GENERATION.md** | Doc generation scripts | Updating bundled docs |

### Development (Read when implementing/testing)

| Document | Focus | Read When |
|----------|-------|-----------|
| **IMPLEMENTATION_GUIDE.md** | Coding patterns | Starting development |
| **TESTING_GUIDE.md** | Testing MCP server | Testing changes |
| **MCP_INSPECTOR.md** | MCP debugging tool | Debugging tools/prompts |

---

## Search Patterns

**Don't read CHANGELOG.md linearly** - Use these search patterns:

```bash
# Find tool changes
grep -i "build-wasm" context/CHANGELOG.md
grep -i "tool" context/CHANGELOG.md

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

**Find tool documentation:**
```bash
ls context/tools/ | grep -i "build"
ls context/prompts/ | grep -i "deploy"
```

**Search across all context:**
```bash
grep -r "MCP protocol" context/
grep -r "FastEdge API" context/
```

See `SEARCH_GUIDE.md` for more patterns.

---

## Token Efficiency Strategy

**Estimated token costs:**
- This file (CONTEXT_INDEX.md): ~250 tokens
- PROJECT_OVERVIEW.md: ~500 tokens
- Architecture doc: ~500-1,000 tokens each
- Tool doc: ~500-1,500 tokens each
- CHANGELOG.md: **Don't read** - grep only

**Typical task token usage:**
- Simple bug fix: ~750 tokens (this file + 1 tool doc)
- New tool: ~1,500-2,500 tokens (this file + 2-3 docs)
- Major feature: ~2,500-4,000 tokens (this file + multiple docs)

**Compare to reading everything upfront: ~10,000+ tokens**

---

## Key Concepts

### MCP Components

**Model Context Protocol (MCP)**:
- Protocol for connecting AI assistants to external tools/data
- Uses stdio transport (stdin/stdout communication)
- JSON-RPC messages between client (Claude Code) and server (this)

**Three MCP primitives**:

1. **Tools** - Functions Claude can call
   - Example: `build-wasm`, `upload-binary`, `deploy-app`
   - Defined with schemas (input/output)
   - Executed synchronously, return results

2. **Resources** - Static content Claude can read
   - Example: `fastedge-context://docs`
   - URI-based addressing
   - Returns markdown/text content

3. **Prompts** - Interactive workflows
   - Example: `createFastEdgeApp`, `deployFastEdgeApp`
   - Can include arguments and messages
   - Guide users through multi-step processes

### FastEdge Integration

**FastEdge API**:
- Upload binaries
- Create/update applications
- Manage environment variables and secrets
- Requires API key (FASTEDGE_API_KEY)

**Build Process**:
- Rust: `cargo build --target wasm32-wasip1`
- JavaScript: `fastedge-build <input> <output>`
- AssemblyScript: `asc <input> -o <output>`

**Deployment Flow**:
1. Build WASM binary from source code
2. Upload binary to FastEdge API (returns binary ID)
3. Create/update app with binary ID
4. Deploy env vars/secrets (optional)

### Magic Comments

**Purpose**: Track deployment info in source code

**Format**:
```javascript
/* FastEdge Deployment Magic Comments
 * appName: "my-app"
 * appId: "12345"
 * appUrl: "https://my-app.fastedge.app"
 * outputFile: "/wasm/output.wasm"
 */
```

**Used by tools**:
- Automatically extracted during build/deploy
- Maintains consistency across deployments
- Enables incremental updates

---

## Getting Help

**Common questions:**

1. **How do I add a new tool?**
   → Read: `tools/TOOL_DEVELOPMENT.md`

2. **How does MCP work?**
   → Read: `architecture/MCP_PROTOCOL.md`

3. **How do I test my changes?**
   → Read: `development/TESTING_GUIDE.md`

4. **How do prompts work?**
   → Read: `prompts/PROMPT_SYSTEM.md`

5. **How is context generated?**
   → Read: `resources/CONTENT_GENERATION.md`

---

## Next Steps

1. **If you haven't already**: Read `PROJECT_OVERVIEW.md` for a lightweight introduction
2. **Use the decision tree above** to find docs relevant to your task
3. **Read SEARCH_GUIDE.md** to learn effective search patterns
4. **Follow links** in documentation to discover related information

**Remember**: Only read what you need for your current task. The system is designed for just-in-time discovery.

---

**Last Updated**: February 2026
