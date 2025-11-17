# FastEdge MCP Tools

This project provides MCP (Model Context Protocol) tools for building, deploying, and scaffolding FastEdge applications. It includes comprehensive context, documentation, and automated workflows to help developers create FastEdge applications more effectively.

## Getting Started

#### Step 1

[Setting up your own MCP Server](./STANDALONE-SETUP.md)

#### Step 2

Setup a basic repo and project with:

```prompt
/createFastEdgeApp
```

Follow the prompts and get started coding with AI Agent support.

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
3. Create or update the application using `update-or-create-app`
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

For more information on how Environment Variables work in `dotenv` files read [here](./assets/context/dotenv.md)

# Available Tools

### FastEdge Application Development

- **get-fastedge-context** - Get comprehensive FastEdge development context and patterns for coding assistance
- **scaffold-fastedge-project** - Create a new FastEdge project from templates.
- **list-fastedge-templates** - List all available FastEdge templates with descriptions, languages, and application types

### FastEdge Binary Management

- **build-wasm** - Build a FastEdge WASM binary from source code within the workspace.
- **upload-binary** - Upload a WASM binary to the FastEdge API for deployment

### FastEdge Application Deployment

- **update-or-create-app** - Update an existing FastEdge application or create a new one using a binary ID

### FastEdge Environment Variable Deployment

- **update-env-vars-app** - Update an existing FastEdge application with "Environment Variables", "Secrets" and "Response Headers"
- **get-secret-id** - Get a secrets id from its name

### Documentation & Magic Comments

- **deployment-comments** - Generate "Magic Comments" for tracking deployment information within code files

# Available Resources

- **fastedge-context** - Comprehensive FastEdge development documentation including:
  - FastEdge Core concepts and patterns
  - JavaScript SDK documentation and examples
  - Real-world examples from the FastEdge examples repository
  - Environment variables and secrets management patterns

# Available Prompts

- **createFastEdgeApp** - Interactive guided creation of new FastEdge applications with template selection
- **deployFastEdgeApp** - Automated workflow to build, upload, and deploy a FastEdge application
- **setEnvironmentVariables** - Automated workflow to collect "Environment Variables", "Secrets" or "Response Headers" and deploy to a FastEdge application.
- **insertMagicComments** - Generate Magic Comments for deployment tracking

## Environment Setup

Make sure to set the following environment variables:

- `FASTEDGE_API_KEY` - Your FastEdge API key for authentication

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

This MCP server integrates seamlessly with:

- **FastEdge API** for binary uploads and application management
- **FastEdge SDK** for JavaScript/TypeScript development
- **FastEdge Examples Repository** for proven code patterns
- **VS Code FastEdge Launcher Extension** for enhanced development experience

## Resources

- FastEdge Documentation: https://g-core.github.io/FastEdge-sdk-js/
- FastEdge Examples: https://github.com/G-Core/FastEdge-examples
- Model Context Protocol: https://modelcontextprotocol.io/
