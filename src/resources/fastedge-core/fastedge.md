# FastEdge Development Context

FastEdge is a WebAssembly-based edge computing platform that enables developers to run applications at the edge of G-Core's CDN network. This comprehensive context provides real-world examples and patterns for building edge applications using JavaScript, Rust, and AssemblyScript.

## JavaScript/TypeScript Core Concepts

FastEdge applications use an event-driven architecture with the fetch event listener pattern:

```javascript
addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event));
});

async function handleRequest(event) {
  // Your FastEdge application logic here
  return new Response("Hello from FastEdge!");
}
```

Key capabilities:

- Request and response manipulation
- Key-Value storage at the edge
- Environment variables and secrets management
- WebAssembly-based runtime for multi-language support
- Low-latency global deployment
- Geo-IP headers for location-based routing

### Environment Variables & Secrets

FastEdge supports configuration through environment variables and secure secrets:

```javascript
import { getEnv } from "fastedge::env";
import { getSecret } from "fastedge::secret";

// Environment variables
const baseUrl = getEnv("BASE_URL");
const debugMode = getEnv("DEBUG") === "true";

// Secrets (for sensitive data)
const apiKey = await getSecret("api_key");
const password = await getSecret("password");
```

### Error Handling Patterns

Robust error handling with proper HTTP status codes:

```javascript
async function handleRequest(event) {
  try {
    const response = await processRequest(event.request);
    return response;
  } catch (error) {
    console.error("Request processing failed:", error);

    if (error instanceof ValidationError) {
      return new Response("Bad Request", { status: 400 });
    }

    if (error instanceof AuthenticationError) {
      return new Response("Unauthorized", { status: 401 });
    }

    return new Response("Internal Server Error", { status: 500 });
  }
}
```

### Request/Response Manipulation

Common patterns for modifying requests and responses:

```javascript
// Request modification
async function modifyRequest(request) {
  const modifiedRequest = new Request(request, {
    headers: {
      ...Object.fromEntries(request.headers.entries()),
      "X-Edge-Modified": "true",
      "X-Timestamp": Date.now().toString(),
    },
  });
  return fetch(modifiedRequest);
}

// Response modification
async function modifyResponse(response) {
  const body = await response.text();
  const modifiedBody = body.replace(/old-content/g, "new-content");

  return new Response(modifiedBody, {
    status: response.status,
    headers: {
      ...Object.fromEntries(response.headers.entries()),
      "X-Modified-By": "FastEdge",
    },
  });
}
```

> **⚠️ NOTE**
>
> For CDN Applications (proxy-wasm):
> If manipulating the `onRequestBody` or `onResponseBody` data, it is vital to update the `content-length` header in the previous step (e.g., `onRequestHeader` or `onResponseHeader`).
> Applications will fail if you change the body content without updating the content-length header.

## Build and Deployment

FastEdge applications are built to WebAssembly:

### JavaScript/TypeScript Build

```bash

# Install FastEdge SDK
npm install @gcoredev/fastedge-sdk-js

# Build to WASM
npx fastedge-build --input src/index.js --output dist/app.wasm
```

### Static Assets Generation

```bash

# Generate static asset manifests
npx fastedge-assets ./assets ./src/assets-manifest.ts
```

### Build Configuration

Using a configuration file for building. e.g.

```bash
npx fastedge-build --config .fastedge/build-config.js
```

Allows you to configure more complex build criteria.

- type:
  - "static": This will invoke createStaticAssetsManifest() for embedding static assets/files during the build
  - "http": Standard build
- entryPoint: <string> path to the builds entry point.
- ignoreDotFiles: <boolean> - should it include dotenv files in the static assets.
- ignoreDirs: <string[]> - paths to exclude from static assets.
- ignoreWellKnown: <boolean> - should it ignore the `.well-known` folder from the static assets.
- tsConfigPath: <string> - path to the tsconfig.json to use during build. ( default: ./tsconfig.json )
- wasmOutput: <string> - path to wasm binary output
- publicDir: <string> - path to the folder containing all the assets / files you wish to include in the binary
- assetManifestPath: <string> - path to the file containing the staticAssetManifest - used for tracking static assets.
- contentType: <contentType[]> - custom content-types for handling unknown static asset types.

Examples of a custom contentType:

```js
[
  { test: /.mpeg$/u, contentType: "video/mpeg", isText: false },
  { test: /.json$/u, contentType: "application/json", isText: true },
];
```

## Multi-Language Support

FastEdge supports Rust and AssemblyScript for high-performance applications:

## Best Practices

1. **Performance Optimization**

   - Keep code lightweight and minimize dependencies
   - Use async/await for non-blocking operations
   - Implement proper caching strategies

2. **Security**

   - Validate and sanitize all inputs
   - Use secrets for sensitive configuration
   - Implement proper authentication and authorization

3. **Error Handling**

   - Always handle errors gracefully
   - Provide meaningful error responses
   - Use appropriate HTTP status codes

4. **Development Workflow**
   - Test locally using FastEdge-run
   - Use version control for deployments
   - Implement CI/CD with GitHub Actions

## Resources

- Full documentation: https://g-core.github.io/FastEdge-sdk-js/
- Examples repository: https://github.com/G-Core/FastEdge-examples
- FastEdge Launcher VSCode extension for simplified development
- Local testing with FastEdge-run

```

```
