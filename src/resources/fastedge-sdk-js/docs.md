# FastEdge SDK for JavaScript

FastEdge SDK is a JavaScript toolkit for building serverless edge compute applications that run as WebAssembly binaries on Gcore's global CDN network. The SDK provides a Service Workers-compatible API for handling HTTP requests at the edge, with tools for compilation, deployment, and static asset management. FastEdge leverages WebAssembly runtime via StarlingMonkey engine to deliver high-performance, low-latency applications across 160+ data centers worldwide with an average global latency of 30ms.

The SDK includes CLI tools for building WebAssembly binaries from JavaScript source code, managing environment variables and secrets, serving static websites, and local development testing. It follows the Service Workers API standard, making it familiar to web developers while providing edge-specific capabilities like inline static asset bundling, secret rotation with slot-based versioning, and zero-startup-time deployment through pre-snapshot compilation.

## Installation

Installing the FastEdge SDK and its CLI tools

The SDK is installed as a development dependency in your Node.js project (requires Node 18+). It provides both the runtime API and command-line tools for building and deploying edge applications.

```bash
# Install SDK and CLI tools locally
npm install --save-dev @gcoredev/fastedge-sdk-js

# Verify Node version (18+ required)
node --version
```

## Basic Event Handler

Creating a simple HTTP request handler with the Service Workers API

FastEdge applications handle HTTP requests using the addEventListener pattern. The event handler must synchronously call event.respondWith() with a callback that returns a Response object. The callback can be asynchronous for complex operations.

```javascript
async function eventHandler(event) {
  const request = event.request;
  return new Response(`You made a request to ${request.url}`);
}

addEventListener('fetch', (event) => {
  event.respondWith(eventHandler(event));
});
```

## Downstream Fetch

Proxying requests to external APIs or origin servers

FastEdge supports standard fetch() API for making downstream requests to external services. The fetch function works exactly like browser fetch, supporting all HTTP methods, headers, and body types.

```javascript
async function app(event) {
  // Fetch from external API
  return await fetch('http://jsonplaceholder.typicode.com/users');
}

addEventListener('fetch', (event) => {
  event.respondWith(app(event));
});
```

## Modifying Downstream Responses

Transforming API responses before returning to the client

You can intercept downstream responses, parse the data, transform it, and return a modified response. This is useful for aggregation, filtering, or enrichment of third-party API data.

```javascript
async function app(event) {
  // Fetch from downstream API
  const downstreamResponse = await fetch('http://jsonplaceholder.typicode.com/users');
  const users = await downstreamResponse.json();

  // Transform and return modified data
  return new Response(
    JSON.stringify({
      users: users.slice(0, 5),
      total: 5,
      skip: 0,
      limit: 30,
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    },
  );
}

addEventListener('fetch', (event) => {
  event.respondWith(app(event));
});
```

## Request Constructor

Creating new Request objects for fetch operations

The Request constructor creates HTTP request objects that can be used with fetch() or modified from incoming requests. Supports all standard HTTP methods, headers, and body types.

```javascript
// Create a GET request
const getRequest = new Request('https://api.example.com/data');

// Create a POST request with headers and body
const postRequest = new Request('https://api.example.com/users', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer token123'
  },
  body: JSON.stringify({ name: 'John Doe', email: 'john@example.com' })
});

// Clone an existing request
async function eventHandler(event) {
  const originalRequest = event.request;
  const clonedRequest = new Request(originalRequest);
  return await fetch(clonedRequest);
}

addEventListener('fetch', (event) => {
  event.respondWith(eventHandler(event));
});
```

## Response Constructor

Creating custom HTTP responses with status codes and headers

The Response constructor creates HTTP response objects with customizable body, status, statusText, and headers. Supports various body types including strings, ArrayBuffers, TypedArrays, and ReadableStreams.

```javascript
async function eventHandler(event) {
  // Simple text response
  const textResponse = new Response('Hello World');

  // JSON response with status and headers
  const jsonResponse = new Response(
    JSON.stringify({ message: 'Success', data: { id: 123 } }),
    {
      status: 200,
      statusText: 'OK',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600'
      }
    }
  );

  // Error response
  const errorResponse = new Response(
    JSON.stringify({ error: 'Not Found' }),
    {
      status: 404,
      statusText: 'Not Found',
      headers: { 'Content-Type': 'application/json' }
    }
  );

  return jsonResponse;
}

addEventListener('fetch', (event) => {
  event.respondWith(eventHandler(event));
});
```

## Headers Manipulation

Working with HTTP headers in requests and responses

Headers objects are immutable in Request and Response objects. To modify headers, create a new Headers object, make changes, and use it in a new Request or Response.

```javascript
async function eventHandler(event) {
  const request = event.request;

  // Create new mutable Headers object from request
  const responseHeaders = new Headers(request.headers);

  // Add or modify headers
  responseHeaders.set('X-Custom-Header', 'custom-value');
  responseHeaders.set('Cache-Control', 'no-cache');
  responseHeaders.append('Set-Cookie', 'session=abc123; HttpOnly');

  // Create response with modified headers
  return new Response('Headers modified', {
    headers: responseHeaders,
  });
}

addEventListener('fetch', (event) => {
  event.respondWith(eventHandler(event));
});
```

## Environment Variables

Accessing deployment-time environment variables

Use getEnv() to retrieve environment variables set during deployment on the FastEdge network. Returns null if the variable doesn't exist.

```javascript
import { getEnv } from 'fastedge::env';

async function eventHandler(event) {
  const request = event.request;

  // Get environment variable
  const customEnvVariable = getEnv('MY_CUSTOM_ENV_VAR');
  const apiEndpoint = getEnv('API_ENDPOINT');

  // Use in headers
  const responseHeaders = new Headers(request.headers);
  responseHeaders.set('X-Environment', customEnvVariable);

  return new Response('Returned all headers with a custom header added', {
    headers: responseHeaders,
  });
}

addEventListener('fetch', (event) => {
  event.respondWith(eventHandler(event));
});
```

## Secret Management

Accessing secure secret variables with versioning support

FastEdge provides getSecret() for accessing the latest secret value and getSecretEffectiveAt() for slot-based secret rotation. Secrets are set during deployment and support multiple slots for gradual rollover.

```javascript
import { getEnv } from 'fastedge::env';
import { getSecret } from 'fastedge::secret';

async function eventHandler(event) {
  // Get latest secret (max slot value)
  const username = getEnv('USERNAME');
  const password = getSecret('PASSWORD');

  // Use for authentication
  const authHeader = btoa(`${username}:${password}`);
  const response = await fetch('https://api.example.com/secure', {
    headers: { 'Authorization': `Basic ${authHeader}` }
  });

  return response;
}

addEventListener('fetch', (event) => {
  event.respondWith(eventHandler(event));
});
```

## Secret Rotation with Slots

Managing secret versioning for gradual rollover

getSecretEffectiveAt() retrieves secrets by slot number, enabling version-specific access. The function returns the value where effectiveAt >= secret_slot, allowing timestamp-based or index-based secret rotation.

```javascript
import { getSecretEffectiveAt } from 'fastedge::secret';

async function validateToken(token, claims) {
  // Example 1: Using slots as indices
  // Secret has slots: 0="original_password", 5="updated_password"
  const secretSlot = claims.version || 0;
  const secret = getSecretEffectiveAt('token-secret', secretSlot);
  // getSecretEffectiveAt('token-secret', 0) -> 'original_password'
  // getSecretEffectiveAt('token-secret', 3) -> 'original_password'
  // getSecretEffectiveAt('token-secret', 5) -> 'updated_password'
  // getSecretEffectiveAt('token-secret', 7) -> 'updated_password'

  // Example 2: Using slots as timestamps
  // Secret has slots: 0="original_password", 1741790697="new_password"
  const issuedAt = claims.iat; // JWT issued-at timestamp
  const secretAtTime = getSecretEffectiveAt('token-secret', issuedAt);
  // Tokens before Wed Mar 12 2025 use original_password
  // Tokens after use new_password

  return verifyJWT(token, secretAtTime);
}

async function eventHandler(event) {
  const token = event.request.headers.get('Authorization')?.replace('Bearer ', '');
  const claims = parseJWT(token);

  const isValid = await validateToken(token, claims);

  return new Response(
    JSON.stringify({ valid: isValid }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}

addEventListener('fetch', (event) => {
  event.respondWith(eventHandler(event));
});
```

## Building WebAssembly Binaries

Compiling JavaScript to WebAssembly for edge deployment

The fastedge-build CLI tool compiles JavaScript applications into WebAssembly binaries. It uses esbuild for bundling ES modules and wizer for creating pre-snapshot binaries with zero startup time.

```bash
# Basic build with explicit paths
npx fastedge-build src/index.js dist/main.wasm

# Build using config file (see fastedge-init)
npx fastedge-build --config

# Build output: dist/main.wasm ready for FastEdge deployment
```

## Project Initialization

Creating FastEdge configuration files for repeatable builds

The fastedge-init CLI tool creates .fastedge/build-config.js configuration files. It provides interactive prompts for HTTP event handlers or static website configurations.

```bash
# Interactive configuration wizard
npx fastedge-init

# Creates .fastedge/build-config.js with:
```

```javascript
const config = {
  type: 'http',
  entryPoint: 'src/index.js',
  wasmOutput: '.fastedge/dist/main.wasm',
};

const serverConfig = {
  type: 'http',
};

export { config, serverConfig };
```

```bash
# Build using generated config
npx fastedge-build --config
```

## Static Asset Manifest

Embedding static files in WebAssembly for zero-latency serving

Since WebAssembly has no filesystem, fastedge-assets creates a manifest that embeds files as UintArrayBuffers at compile time. Files are read during compilation and included in the wasm binary memory snapshot.

```bash
# Generate manifest from public directory
npx fastedge-assets ./public ./src/public-static-assets.ts
```

```javascript
// Generated manifest file: src/public-static-assets.ts
const staticAssetManifest = {
  '/gcore.png': {
    assetKey: '/gcore.png',
    contentType: 'image/png',
    fileInfo: { size: 40261, assetPath: './images/gcore.png' },
    type: 'wasm-inline',
  },
  '/home.png': {
    assetKey: '/home.png',
    contentType: 'image/png',
    fileInfo: { size: 1502064, assetPath: './images/home.png' },
    type: 'wasm-inline',
  },
};

export { staticAssetManifest };
```

## Static Website Hosting

Serving static sites as WebAssembly applications

Use createStaticServer() to serve static websites from the embedded asset manifest. The function must be called at top level during compilation so wizer can snapshot all files into memory before creating the final binary.

```javascript
import { createStaticServer } from '@gcoredev/fastedge-sdk-js';
import { staticAssetManifest } from './src/public-static-assets.js';

// Must be called at top level (not in functions/async code)
// This runs during compile-time so wizer can snapshot files
const serverConfig = {
  type: 'http',
  spa: true, // Enable SPA mode for client-side routing
  fallback: '/index.html', // Fallback for unknown routes
};

createStaticServer(staticAssetManifest, serverConfig);
```

```bash
# Interactive static site setup
npx fastedge-init
# Select: Static Website
# Provide: output file (e.g., .fastedge/dist/main.wasm)
# Provide: public directory (e.g., ./build for CRA, ./dist for Astro)
# Provide: SPA fallback (e.g., /index.html for React apps)

# Build static site to wasm
npx fastedge-build --config
```

## Use Cases and Integration

FastEdge SDK is designed for building edge compute applications that require low latency and global distribution. Primary use cases include API gateways with request/response transformation, authentication middleware, A/B testing and feature flags, static website hosting with zero cold starts, and serverless function execution at the edge. The SDK's Service Workers-compatible API makes it easy to migrate existing edge worker code or adapt web service workers for edge deployment.

Integration with Gcore's ecosystem provides seamless connectivity to CDN, Virtual Machines, and S3 Storage services. The WebAssembly-based architecture ensures consistent performance across all 160+ edge locations with no environment configuration or infrastructure maintenance required. The slot-based secret management system enables sophisticated deployment patterns like blue-green deployments, gradual secret rotation, and backward-compatible API versioning. Static asset inlining eliminates filesystem overhead and cold start delays, making FastEdge ideal for serving SPAs, marketing sites, and documentation portals with sub-30ms response times globally.
