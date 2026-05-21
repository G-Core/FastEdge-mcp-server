# FastEdge MCP Server

The FastEdge MCP server is the **executor layer** for AI-assisted FastEdge development. It exposes Model Context Protocol tools that any MCP-compatible client can call directly — Cursor, VSCode, Claude Desktop, Codex, and Claude Code (via the [gcore-fastedge plugin](https://github.com/G-Core/fastedge-plugin)).

What it does:

- **Containerised build toolchains** for JS/TS, Rust, and AssemblyScript (no local toolchain needed) — `build-wasm`, `upload-binary`
- **Schema-aware Gcore API access** — `gcore_api`, `describe_api`, `workflows_list`, `batch_execute`
- **Bundled FastEdge reference docs** kept current via the plugin's docs pipeline — `fastedge-docs`
- **Project scaffolding** from FastEdge SDK templates — `scaffold-fastedge-project`, `list-fastedge-templates`

Higher-level workflow orchestration — deciding *when* to build, *what* to deploy, *how* to wire CDN rules — lives in the [`gcore-fastedge` plugin](https://github.com/G-Core/fastedge-plugin) skills. This server runs the steps.

## Getting Started

**If you're on Claude Code or Codex, use the plugin instead.** It wraps this server with the intelligence layer (blueprint-driven scaffolding, deploy/manage/live-test/debug skills) and is the recommended path:

- Claude Code → [`gcore-fastedge` plugin](https://github.com/G-Core/fastedge-plugin)
- Codex → `gcore-fastedge-codex` plugin (same repo)

The rest of this README covers running the MCP server **standalone** for clients without plugin support (Cursor, Claude Desktop, VSCode MCP, etc.).

### Standalone setup

1. Wire the Docker image into your client's MCP config — see [STANDALONE-SETUP.md](./STANDALONE-SETUP.md).
2. Invoke the `createFastEdgeApp` prompt to scaffold your first project. (The exact form depends on your client — `/createFastEdgeApp`, `/mcp__fastedge-assistant__createFastEdgeApp`, or a UI prompt picker.)

# Usage Examples

### Get FastEdge Documentation and Context

To get comprehensive information about FastEdge development:

```
Show me FastEdge development patterns and best practices
```

```
Get FastEdge context for building edge applications
```

### Create a New FastEdge Application

To scaffold a new FastEdge project using the interactive prompt:

```prompt
/createFastEdgeApp
```

### Build and Deploy a FastEdge Application

For a complete deployment workflow using the prompt:

```prompt
/deployFastEdgeApp
```

This automated workflow will:

1. Build the current code into a WASM binary using `build-wasm`
2. Upload the binary to FastEdge using `upload-binary`
3. Use `describe_api` to inspect the `fastedge-apps` endpoints, then call `gcore_api` to create or update the application (POST `/fastedge/v1/apps` or PUT `/fastedge/v1/apps/{id}`) with the new binary ID
4. Optionally generate Magic Comments for tracking deployment info

### Individual Build and Deployment Steps

If you prefer to execute steps individually:

**Build WASM binary:**

```prompt
Build my current file into a WASM binary
```

**Upload binary:**

```prompt
Upload the generated WASM binary to FastEdge
```

**Deploy application:**

```prompt
Create a FastEdge application using binary ID 12345 with name "my-app"
```

### Generate Magic Comments

To manually add "Magic Comments" use:

```prompt
/insertMagicComments
```

### Deploy Environment Variables

To manually deploy environment variables from `dotenv` files use:

```prompt
/setEnvironmentVariables
```

For more information on how Environment Variables work in `dotenv` files read [here](./docs/dotenv.md)

# Available Tools

### Local Tools (workspace operations)

- **scaffold-fastedge-project** - Create a new FastEdge project from templates.
- **list-fastedge-templates** - List all available FastEdge templates with descriptions, languages, and application types.
- **build-wasm** - Build a FastEdge WASM binary from source code within the workspace.
- **deployment-comments** - Generate "Magic Comments" for tracking deployment information within code files.
- **fastedge-docs** - Search and read FastEdge SDK reference docs, platform guides, error codes, and testing documentation. Three modes: topics (list all), search (keyword match), read (full document).

### API Tools (direct Gcore API calls)

- **upload-binary** - Upload a WASM binary to the FastEdge API for deployment.
- **gcore_api** - Execute any Gcore API call. Use `describe_api` first to understand available endpoints.
- **describe_api** - Get endpoint documentation and TypeScript type definitions for a Gcore API resource group (e.g. `fastedge-apps`, `cdn-resources`). Covers FastEdge, CDN, DNS, WAAP, and Storage.
- **workflows_list** - Discover pre-built multi-step API workflows (e.g. `create-app`, `update-app-binary`). Returns templates for `batch_execute`.
- **batch_execute** - Execute multiple sequential API calls in one invocation with `$name.path` reference resolution between steps. Max 5 calls per batch (configurable via `BATCH_MAX_CALLS`); total runtime capped at 3 minutes.

# Available Resources

MCP resources are read-only guidance documents that agents can read on demand.

- **fastedge-scaffolding-guide** (`fastedge://guides/scaffolding`) — Decision tree and recipes for scaffolding FastEdge apps across new repos, mixed-language monorepos, and existing projects.
- **fastedge-template-guide** (`fastedge://guides/templates`) — Template selection guide covering `http-base`, `http-react`, `http-react-hono`, and `cdn-base`.

Up-to-date SDK, platform, and example documentation is served through the `fastedge-docs` tool (above) rather than as a static resource.

# Available Prompts

- **createFastEdgeApp** — Intelligent project creation that detects new vs existing repos, mixed-language scenarios, and routes to the right scaffold action
- **deployFastEdgeApp** — Build, upload, and deploy via `build-wasm` + `upload-binary` + `describe_api`/`gcore_api`
- **setEnvironmentVariables** — Collect environment variables, secrets, and response headers from `.env` files and apply them to a deployed app via `gcore_api`
- **insertMagicComments** — Generate Magic Comments for deployment tracking
- **explainFastEdgeTemplate** — Walk through the available templates and recommend one for the user's use case

## Environment Setup

Make sure to set the following environment variables:

- `GCORE_API_KEY` (required) - Your Gcore API key for authentication (legacy `FASTEDGE_API_KEY` also accepted).
- `GCORE_API_BASE` (optional) - Runtime override for the Gcore API base URL. Defaults to `https://api.gcore.com` (baked at build time). In-house devs can set this to `https://api.preprod.world` to test against preprod endpoints using prod schemas.
- `BATCH_MAX_CALLS` (optional) - Override the default max calls per `batch_execute` (default: 5).

See [DEVELOPMENT.md](./DEVELOPMENT.md) for the full env var table and the preprod build recipe.

## Supported FastEdge Templates

The MCP server includes the following templates:

1. **http-base** - Basic HTTP request/response handling for JavaScript/TypeScript
2. **http-react** - React application template for static site hosting
3. **http-react-hono** - React application with Hono framework for enhanced routing
4. **cdn-base** - CDN application template for proxy/traffic modification (AssemblyScript)

Each template supports multiple programming languages including JavaScript, TypeScript, and AssemblyScript.

## Magic Comments

The system supports "Magic Comments" that track deployment information directly in your source code:

```javascript
/* FastEdge Deployment Magic Comments
 * appName: "my-application"
 * appId: "12345"
 * appUrl: "https://my-app.fastedge.app"
 * outputFile: "/wasm/output.wasm"
 * buildDirectory: "./dist"
 */
```

These comments are automatically used by the build and deployment tools to maintain consistency across deployments.

## Development Best Practices

When developing FastEdge applications:

1. **Use the Service Workers API pattern** for HTTP event handling
2. **Keep code lightweight** and minimize dependencies for optimal edge performance
3. **Use async/await** for asynchronous operations
4. **Implement proper error handling** with appropriate HTTP status codes
5. **Test locally** before deploying to the edge
6. **Use environment variables and secrets** for configuration management
7. **Follow FastEdge examples** for proven patterns and best practices

## Language Support

- **JavaScript/TypeScript**: Full support with FastEdge SDK and modern framework integration
- **AssemblyScript**: WebAssembly-first development for CDN applications
- **Rust**: High-performance edge applications (examples and documentation provided)

## Integration with FastEdge Ecosystem

This MCP server is consumed by, and integrates with:

- **[`gcore-fastedge` plugin for Claude Code](https://github.com/G-Core/fastedge-plugin)** — primary consumer; ships a bundled `.mcp.json` that launches this server and delegates build/deploy/manage execution to it
- **`gcore-fastedge-codex` plugin** — Codex variant of the same plugin, also launches this server
- **Gcore API** — direct REST access via `gcore_api` (FastEdge, CDN, DNS, WAAP, Storage)
- **FastEdge SDKs** (`@gcoredev/fastedge-sdk-js`, `fastedge` Rust crate, `@gcoredev/proxy-wasm-sdk-as`) — bundled in the container's build toolchain
- **FastEdge Examples Repository** — source of truth for the bundled reference docs and scaffold blueprints
- **VS Code FastEdge Launcher Extension** — generates the `.vscode/mcp.json` config that points at this server

## Resources

- FastEdge Documentation: https://g-core.github.io/FastEdge-sdk-js/
- FastEdge Examples: https://github.com/G-Core/FastEdge-examples
- Model Context Protocol: https://modelcontextprotocol.io/
