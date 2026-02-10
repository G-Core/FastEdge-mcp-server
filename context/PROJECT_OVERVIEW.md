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

**Deployment Tools**:
- `upload-binary` - Upload WASM binary to FastEdge API
  - Returns binary ID for deployment
- `update-or-create-app` - Deploy or update application
  - Creates new app or updates existing
  - Uses binary ID from upload
- `update-env-vars-app` - Deploy environment variables and secrets
  - Reads from dotenv files
  - Supports env vars, secrets, response headers
- `get-secret-id` - Retrieve secret ID by name

**Documentation Tools**:
- `deployment-comments` - Generate Magic Comments
  - Tracks deployment info in source code
  - Enables incremental updates

### MCP Prompts

**Note**: FastEdge documentation and context is now provided via **skills** in generated projects (`.claude/skills/`), not as MCP resources. This keeps the MCP server focused on build and deployment tools.

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
│   ├── server.ts               # MCP server entry point
│   │
│   ├── tools/                  # MCP tool implementations
│   │   ├── index.ts            # Tool registration
│   │   ├── fastedge/           # FastEdge API tools
│   │   │   ├── binaries/       # upload-binary tool
│   │   │   ├── apps/           # deploy-app, deploy-env-vars
│   │   │   └── secrets/        # get-secret-id
│   │   ├── scaffolding/        # scaffold-fastedge-project
│   │   └── workspace/          # build-wasm, file operations
│   │
│   ├── prompts/                # MCP prompt workflows
│   │   ├── index.ts            # Prompt registration
│   │   ├── scaffolding.ts      # createFastEdgeApp
│   │   └── deploying.ts        # deployFastEdgeApp, setEnvVars
│   │
│   └── utils/                  # Shared utilities
│       ├── api.ts              # FastEdge API client
│       ├── workspace.ts        # File/workspace operations
│       └── build.ts            # WASM build logic
│
├── docs/                       # MCP-specific documentation
│   └── dotenv.md               # Dotenv patterns for deployments
│
├── package.json                # Dependencies and scripts
├── tsconfig.json               # TypeScript configuration
├── tsconfig.build.json         # Build-specific TS config
├── mcp-standalone.json         # MCP server config
├── README.md                   # User documentation
├── STANDALONE-SETUP.md         # Setup instructions
└── DEVELOPMENT.md              # Development guide
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
- Requires `FASTEDGE_API_KEY` environment variable
- API key obtained from FastEdge dashboard

**Endpoints used**:
- `POST /binaries` - Upload WASM binary
- `POST /apps` - Create application
- `PATCH /apps/{id}` - Update application
- `GET /secrets` - List secrets
- `POST /secrets` - Create secret
- `PATCH /secrets/{id}` - Update secret

**API Client**: `src/utils/api.ts`

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
2. **Upload**: `upload-binary` tool uploads to API → returns binary ID
3. **Deploy**: `update-or-create-app` tool creates/updates app with binary ID
4. **Env Vars** (optional): `update-env-vars-app` deploys configuration
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
- `FASTEDGE_API_KEY` - API authentication (required)
- `FASTEDGE_API_URL` - API endpoint (default: https://api.gcore.com)

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

**Last Updated**: February 2026
