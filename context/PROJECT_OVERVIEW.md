# FastEdge MCP Server - Project Overview

## What is FastEdge MCP Server?

The **FastEdge MCP Server** is a Model Context Protocol (MCP) server that provides tools, resources, and workflows for building and deploying FastEdge edge computing applications. It enables Claude Code to interact with the FastEdge platform, build WASM binaries, and manage application deployments.

### Key Value Proposition

- **Integrated Development**: Build, test, and deploy FastEdge apps from Claude Code
- **Comprehensive Documentation**: Access FastEdge SDK docs, examples, and patterns
- **Interactive Workflows**: Guided app creation and deployment processes
- **API Integration**: Direct interaction with FastEdge API for deployments
- **Template Scaffolding**: Quick project setup from proven templates

---

## Model Context Protocol (MCP)

### What is MCP?

**Model Context Protocol** is an open protocol that enables AI assistants to:
- **Call tools**: Execute functions with structured input/output
- **Read resources**: Access static content via URIs
- **Use prompts**: Follow interactive multi-step workflows

**Communication**:
- JSON-RPC messages over stdio (stdin/stdout)
- Client: Claude Code (or other MCP clients)
- Server: This FastEdge MCP server

**Why MCP?**
- Standardized protocol for AI tool integration
- Language/platform agnostic
- Secure (runs locally, no network required)
- Extensible

### MCP Primitives

**1. Tools** - Functions Claude can call:
```typescript
{
  name: "build-wasm",
  description: "Build a FastEdge WASM binary",
  inputSchema: { /* JSON Schema */ },
  handler: async (args) => { /* implementation */ }
}
```

**2. Resources** - Static content Claude can read:
```typescript
{
  uri: "fastedge-context://docs",
  name: "FastEdge Context",
  mimeType: "text/markdown",
  content: "# FastEdge Documentation..."
}
```

**3. Prompts** - Interactive workflows:
```typescript
{
  name: "createFastEdgeApp",
  description: "Create a new FastEdge application",
  arguments: [/* optional params */],
  messages: [/* conversation template */]
}
```

---

## Core Capabilities

### MCP Tools

**Scaffolding Tools**:
- `list-fastedge-templates` - List available project templates
- `scaffold-fastedge-project` - Create new project from template (delegates to `create-fastedge-app`)

**Build Tools**:
- `build-wasm` - Compile source code to WASM binary
  - Supports: Rust, JavaScript/TypeScript, AssemblyScript
  - Auto-detects language and build configuration
  - Returns binary path and build output

**API Tools** (direct Gcore API calls via `src/api-client.ts`):
- `upload-binary` - Upload WASM binary to FastEdge API → returns binary ID
- `gcore_api` - Execute any single Gcore API call (GET, POST, PUT, PATCH, DELETE)
- `describe_api` - Get endpoint docs and type definitions for a schema group (FastEdge, CDN, DNS, WAAP, Storage — 55 groups)
- `workflows_list` - Discover multi-step API workflows with `batch_execute`-compatible templates (create-app, update-app-binary, delete-app-and-binary)
- `batch_execute` - Execute sequential API calls with `$name.path` reference resolution. Max 5 calls (configurable via `BATCH_MAX_CALLS`); total runtime capped at 3 min (sum of per-product timeouts)

**Documentation Tools**:
- `deployment-comments` - Generate Magic Comments
  - Tracks deployment info in source code
  - Enables incremental updates
- `fastedge-docs` - Reference documentation search — topics catalog, section-level keyword search, full doc read. Serves pipeline-generated docs from the fastedge-plugin.

### MCP Prompts

**Note**: FastEdge documentation and context is now provided via **skills** in generated projects (`.claude/skills/`) and via the `fastedge-docs` tool, not as MCP resources. This keeps the MCP server focused on build and deployment tools.

**createFastEdgeApp**:
- Interactive app creation workflow
- Template selection
- Language configuration
- Project scaffolding

**deployFastEdgeApp**:
- Complete deployment workflow:
  1. Build WASM binary
  2. Upload to FastEdge API
  3. Create/update application
  4. Generate Magic Comments

**setEnvironmentVariables**:
- Environment variable deployment workflow:
  1. Discover dotenv files
  2. Parse variables, secrets, headers
  3. Deploy to FastEdge application

**insertMagicComments**:
- Generate Magic Comments for deployment tracking
- Inserts structured comments in source files

---

## Tech Stack

### Core Technologies
- **Language**: TypeScript
- **MCP SDK**: `@modelcontextprotocol/sdk` (^1.25.2)
- **FastEdge SDK**: `@gcoredev/fastedge-sdk-js` (^2.2.0)
- **Node**: 20+ (defined in .node-version)
- **Package Manager**: pnpm
- **Build Tool**: TypeScript compiler + esbuild (for bundling)

### Key Dependencies
- `zod` - Schema validation for tool inputs
- `toml` - Parsing Cargo.toml files (Rust projects)
- `qs` - Query string parsing
- `dedent` - Template string formatting

### Development Tools
- `tsx` - TypeScript execution for development
- `@modelcontextprotocol/inspector` - MCP debugging tool
- `npm-run-all2` - Script orchestration

---

## Project Structure

```
FastEdge-mcp-server/
├── src/
│   ├── server.ts                  # MCP server entry (stdio transport, env vars)
│   ├── api-client.ts              # Gcore API HTTP client: GCORE_API_BASE override, AbortController timeout, auth
│   │
│   ├── config/
│   │   └── products.ts            # Product registry (specPath, pagination, timeout_ms) — 5 products
│   │
│   ├── generated/                 # Auto-generated by scripts/generate-schemas.ts (do not hand-edit)
│   │   ├── schemas.ts             # 55 schema groups across fastedge/cdn/dns/waap/storage
│   │   └── config.ts              # Baked GCORE_API_BASE constant
│   │
│   ├── workflows/                 # Multi-step batch_execute templates
│   │   ├── types.ts
│   │   ├── registry.ts
│   │   └── fastedge/              # create-app, update-app-binary, delete-app-and-binary
│   │
│   ├── tools/
│   │   ├── index.ts               # registerAllTools (ToolOptions interface)
│   │   ├── api/                   # Direct Gcore API tools
│   │   │   ├── gcore-api.ts       # Execute any API call (testable handler)
│   │   │   ├── describe-api.ts    # Schema docs per group
│   │   │   ├── workflows-list.ts  # Workflow templates
│   │   │   ├── batch-execute.ts   # Sequential batch + $ref resolution + budget cap
│   │   │   └── binaries/          # upload-binary (direct API POST)
│   │   └── local/                 # Workspace/scaffolding/reference tools
│   │       ├── reference/         # fastedge-docs
│   │       ├── scaffolding/       # scaffold-fastedge-project, list-fastedge-templates
│   │       └── workspace/         # build-wasm, deployment-comments
│   │
│   ├── prompts/                   # MCP prompt workflows
│   │   ├── index.ts
│   │   ├── scaffolding.ts         # createFastEdgeApp
│   │   └── deploying.ts           # deployFastEdgeApp, setEnvironmentVariables
│   │
│   ├── resources/                 # MCP resources
│   │   └── scaffolding-guide.ts   # Agent scaffolding guidance
│   │
│   └── utils/
│       └── index.ts               # normalizePath, INVALID_PATH, language helpers
│
├── scripts/
│   ├── generate-schemas.ts        # OpenAPI → generated schemas (needs SPEC_BASE_URL)
│   ├── sync-reference-docs.sh     # Sync docs from fastedge-plugin
│   └── tests/
│       ├── test-api.ts            # node:test — API handlers, timeouts, batch budget
│       └── test-reference-index.sh
│
├── reference-docs/                # Synced from fastedge-plugin (runtime-loaded by fastedge-docs)
├── docs/
│   └── dotenv.md                  # Dotenv patterns for deployments
│
├── package.json
├── tsconfig.json / tsconfig.build.json
├── mcp-standalone.json            # Example MCP client config
├── Dockerfile / Dockerfile-base
├── AGENTS.md                      # Company-wide agent rules
├── CLAUDE.md                      # Discovery hub for agents
├── README.md / DEVELOPMENT.md / STANDALONE-SETUP.md
└── context/                       # Detailed documentation (CHANGELOG, architecture, etc.)
```

---

## How It Works (High-Level Flow)

### Server Initialization

1. **Server Starts** (`src/server.ts`):
   - Creates MCP server instance
   - Registers all tools from `src/tools/index.ts`
   - Registers all prompts from `src/prompts/index.ts`
   - Connects to stdio transport (reads from stdin, writes to stdout)

2. **Claude Code Connects**:
   - Discovers server via workspace `.claude/mcp.json` configuration
   - Initializes MCP connection
   - Receives tool/resource/prompt listings

### Tool Execution Flow

1. **User Requests Action**:
   - Example: "Build my FastEdge app into WASM"

2. **Claude Code Invokes Tool**:
   - Sends JSON-RPC tool call: `tools/call { name: "build-wasm", arguments: {...} }`

3. **Server Receives Request**:
   - Validates arguments against Zod schema
   - Routes to tool handler

4. **Tool Executes**:
   - `build-wasm` handler:
     - Detects language (Rust/JS/AssemblyScript)
     - Locates build files (Cargo.toml/package.json)
     - Runs appropriate build command
     - Returns binary path + output

5. **Server Returns Result**:
   - JSON-RPC response with tool result
   - Includes success status, content, metadata

6. **Claude Code Receives Result**:
   - Displays output to user
   - Can chain with additional tool calls

### Prompt Execution Flow

1. **User Invokes Prompt**:
   - Example: `/createFastEdgeApp` in Claude Code

2. **Claude Code Runs Prompt**:
   - Sends: `prompts/get { name: "createFastEdgeApp" }`

3. **Server Returns Prompt Template**:
   - Includes conversation messages
   - Guides interactive workflow

4. **Claude Follows Workflow**:
   - Asks user questions (template type, language, etc.)
   - Calls tools based on responses (scaffold-fastedge-project)
   - Completes multi-step process

---

## FastEdge Integration

### FastEdge API

**Authentication**:
- Requires `GCORE_API_KEY` environment variable (legacy `FASTEDGE_API_KEY` also accepted)
- API key obtained from FastEdge dashboard

**Endpoints used**:
- `POST /binaries` - Upload WASM binary
- `POST /apps` - Create application
- `PATCH /apps/{id}` - Update application
- `GET /secrets` - List secrets
- `POST /secrets` - Create secret
- `PATCH /secrets/{id}` - Update secret

**API Client**: `src/api-client.ts` (timeout layer, `GCORE_API_BASE` runtime override, auth forwarding)

### Build Process

**Language Detection**:
- Rust: Presence of `Cargo.toml`
- JavaScript: Presence of `package.json` with FastEdge SDK
- AssemblyScript: `.ts` files with AssemblyScript patterns

**Build Commands**:

**Rust**:
```bash
cargo build --target wasm32-wasip1 --release
# Output: target/wasm32-wasip1/release/{package-name}.wasm
```

**JavaScript/TypeScript**:
```bash
npx fastedge-build <input> <output>
# Output: specified output path
```

**AssemblyScript**:
```bash
npx asc <input> -o <output> --optimize
# Output: specified output path
```

### Deployment Workflow

**Complete flow** (deployFastEdgeApp prompt):

1. **Build**: `build-wasm` tool compiles source to WASM
2. **Upload**: `upload-binary` tool uploads to API → returns binary ID (direct API call via `src/api-client.ts`)
3. **Deploy**: `gcore_api` tool creates/updates app via POST/PUT /fastedge/v1/apps with binary ID
4. **Env Vars** (optional): `gcore_api` tool sets env vars via PUT /fastedge/v1/apps/{id}
5. **Track**: `deployment-comments` generates Magic Comments

---

## Templates

**Available templates**:

1. **http-base** - Basic HTTP request/response (JS/TS)
2. **http-react** - Static React site hosting (JS/TS)
3. **http-react-hono** - React with Hono routing (JS/TS)
4. **cdn-base** - CDN proxy/traffic modification (AssemblyScript)

**Template structure**:
- Located in scaffolding tool
- Includes source files, build config, README
- Language-specific variations

**Scaffolding process**:
1. User selects template via `createFastEdgeApp` prompt
2. `scaffold-fastedge-project` tool creates project
3. Files written to workspace
4. Ready to build and deploy

---

## Magic Comments

**Purpose**: Track deployment metadata in source code

**Format**:
```javascript
/* FastEdge Deployment Magic Comments
 * appName: "my-application"
 * appId: "12345"
 * appUrl: "https://my-app.fastedge.app"
 * binaryId: "67890"
 * outputFile: "/dist/output.wasm"
 * buildDirectory: "./dist"
 * deployedAt: "2026-02-09T12:00:00Z"
 */
```

**Usage**:
- Extracted during build/deploy workflows
- Enables incremental updates (use existing app ID)
- Maintains consistency across deployments
- Tracks deployment history

**Generated by**: `deployment-comments` tool

---

## Environment Variables

**Server configuration**:
- `GCORE_API_KEY` - API authentication (required; legacy `FASTEDGE_API_KEY` also accepted)
- `GCORE_API_BASE` - Runtime override for baked-in Gcore API base URL (optional; useful for in-house devs running prod schemas against preprod endpoints)
- `BATCH_MAX_CALLS` - Max calls per `batch_execute` (optional, default: 5)
- `WORKSPACE_ROOT` - Workspace root path (optional, default: `/workspace` in Docker)

**Application configuration** (dotenv files):
- `.env.variables` - Environment variables
- `.env.secrets` - Secrets (sensitive data)
- `.env.rsp_headers` - Response headers

**See**: `assets/context/dotenv.md` for detailed patterns

---

## Development Workflow

### Building the Server
```bash
pnpm install
pnpm run build          # Generate docs + compile TypeScript
```

### Running Locally
```bash
pnpm run server:dev     # Run server with tsx (dev mode)
```

### Debugging with Inspector
```bash
pnpm run server:inspect # Run with MCP inspector UI
```

**Inspector provides**:
- Tool invocation testing
- Resource browsing
- Prompt testing
- Request/response inspection

### Adding New Tools

1. Create tool file in `src/tools/{category}/`
2. Define schema with Zod
3. Implement handler function
4. Register in `src/tools/index.ts`
5. Update documentation

---

## Key Design Decisions

### Why MCP?
- Standard protocol for AI tool integration
- Works with Claude Code and other MCP clients
- Secure local execution (no cloud dependencies)
- Extensible for future capabilities

### Why Bundled Resources?
- Offline access to documentation
- Consistent across environments
- Fast retrieval (no API calls)
- Build-time generation ensures freshness

### Why Magic Comments?
- Deployment tracking without external state
- Source code as single source of truth
- Enables incremental updates
- No database or config files needed

### Why Templates?
- Quick project setup
- Proven patterns
- Language-specific configurations
- Reduces boilerplate

---

## Related Projects

- **[FastEdge API](https://api.gcore.com)** - FastEdge platform API
- **[FastEdge SDK JS](https://github.com/G-Core/FastEdge-sdk-js)** - JavaScript SDK
- **[FastEdge Examples](https://github.com/G-Core/FastEdge-examples)** - Example applications
- **[FastEdge VSCode Extension](https://github.com/G-Core/FastEdge-vscode)** - VS Code debugger
- **[create-fastedge-app](https://github.com/G-Core/create-fastedge-app)** - CLI scaffolding tool
- **[Model Context Protocol](https://modelcontextprotocol.io/)** - MCP specification

---

## Status: Current Features

**Fully Implemented**:
- ✅ MCP server with stdio transport
- ✅ Build WASM (Rust, JS, AssemblyScript)
- ✅ Upload binaries to FastEdge API
- ✅ Deploy/update applications
- ✅ Deploy environment variables and secrets
- ✅ Project scaffolding with templates
- ✅ FastEdge context resources
- ✅ Interactive prompts (create, deploy, env vars)
- ✅ Magic Comments generation

**Planned/Future**:
- See GitHub issues for roadmap items

---

**Last Updated**: April 2026
