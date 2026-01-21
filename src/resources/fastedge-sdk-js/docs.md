### Fastedge Build Configuration

Source: https://g-core.github.io/FastEdge-sdk-js/guides/fastedge-init

JavaScript configuration file defining build parameters for Fastedge WASM compilation. Specifies entry point, output path, and server configuration for HTTP type builds.

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

--------------------------------

### Initialize Fastedge Configuration

Source: https://g-core.github.io/FastEdge-sdk-js/guides/fastedge-init

Command to initialize Fastedge configuration files using the fastedge-init CLI tool. This creates a .fastedge folder with build-config.js containing default configuration settings.

```bash
npx fastedge-init
```

--------------------------------

### Build WASM with Configuration

Source: https://g-core.github.io/FastEdge-sdk-js/guides/fastedge-init

Command to build WASM modules using the previously created Fastedge configuration file. Requires a valid build-config.js in the .fastedge directory.

```bash
npx fastedge-build --config
```

--------------------------------

### KV Store Open

Source: https://g-core.github.io/FastEdge-sdk-js/reference/fastedge/kv/open

Opens a named KV store and returns an instance that exposes methods such as get, scan, and others.

```APIDOC
## KV Store Open

### Description
Opens a named Key‑Value store and returns an instance to interact with it.

### Method
Function Call

### Endpoint
KvStore.open(kvStoreName)

### Parameters
#### Path Parameters
- **kvStoreName** (string) - Required - Name of the KV store to open.

### Request Example
```
const myStore = KvStore.open('my-kv-store');
```

### Response
#### Success Response (200)
- **kvStoreInstance** (object) - Instance providing methods like get, scan, zrangeByScore, zscan, bfExists.

### Response Example
```
{
  "kvStoreInstance": {
    "methods": ["get", "scan", "zrangeByScore", "zscan", "bfExists"]
  }
}
```
```

--------------------------------

### Secret Slots Configuration Example in JSON

Source: https://g-core.github.io/FastEdge-sdk-js/reference/fastedge/secret/get-secret-effective-at

Shows an example JSON configuration for secret slots, illustrating how to define multiple slots with different values for secret rollover management.

```JSON
{
  "secret": {
    "comment": "The password to validate the token has been signed with",
    "id": 168,
    "name": "token-secret",
    "secret_slots": [
      {
        "slot": 0,
        "value": "original_password"
      },
      {
        "slot": 5,
        "value": "updated_password"
      }
    ]
  }
}
```

```JSON
{
  "secret": {
    "comment": "The password to validate the token has been signed with",
    "id": 168,
    "name": "token-secret",
    "secret_slots": [
      {
        "slot": 0,
        "value": "original_password"
      },
      {
        "slot": 1741790697,
        "value": "new_password"
      }
    ]
  }
}
```

--------------------------------

### Create static asset server

Source: https://g-core.github.io/FastEdge-sdk-js/migrating/v1-v2

Implementation of static asset server creation in FastEdge SDK. Version 2.x.x introduces a simplified API with createStaticServer function that combines manifest and configuration in a single call. This replaces the two-step process of creating assets cache and server separately in version 1.x.x.

```javascript
import { getStaticServer, createStaticAssetsCache } from '@gcoredev/fastedge-sdk-js';
import { staticAssetManifest } from './build/static-server-manifest.js';
import { serverConfig } from './build-config.js';


const staticAssets = createStaticAssetsCache(staticAssetManifest);


const staticServer = getStaticServer(serverConfig, staticAssets);


async function handleRequest(event) {
  const response = await staticServer.serveRequest(event.request);
  if (response != null) {
    return response;
  }


  return new Response('Not found', { status: 404 });
}


addEventListener('fetch', (event) => event.respondWith(handleRequest(event)));
```

```javascript
import { createStaticServer } from '@gcoredev/fastedge-sdk-js';
import { staticAssetManifest } from './build/static-asset-manifest.js';
import { serverConfig } from './build-config.js';


const staticServer = createStaticServer(staticAssetManifest, serverConfig);


async function handleRequest(event) {
  const response = await staticServer.serveRequest(event.request);
  if (response != null) {
    return response;
  }


  return new Response('Not found', { status: 404 });
}


addEventListener('fetch', (event) => event.respondWith(handleRequest(event)));
```

--------------------------------

### Static Asset Manifest Object Structure

Source: https://g-core.github.io/FastEdge-sdk-js/guides/creating-a-static-manifest

A simplified example of the generated Static Assets Manifest object. This object details each asset with its key, content type, file size, and its path for inclusion in the wasm binary.

```typescript
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

--------------------------------

### Access Environment Variable with FastEdge::env SDK (JavaScript)

Source: https://g-core.github.io/FastEdge-sdk-js/reference/fastedge/env

Demonstrates how to access custom environment variables set during FastEdge network deployment using the 'getEnv' function. It shows an example event handler that retrieves 'MY_CUSTOM_ENV_VAR' and returns it.

```javascript
import { getEnv } from 'fastedge::env';


async function eventHandler(event) {
  const customEnvVariable = getEnv('MY_CUSTOM_ENV_VAR');
  return new Response({ customEnvVariable });
}


addEventListener('fetch', (event) => {
  event.respondWith(eventHandler(event));
});

```

--------------------------------

### Open KV Store and Retrieve Value with FastEdge JavaScript SDK

Source: https://g-core.github.io/FastEdge-sdk-js/reference/fastedge/kv/open

Demonstrates opening a KV store using KvStore.open, reading a key, and returning the result in a Response object. The example includes error handling and integration with the fetch event listener. Requires the FastEdge SDK and a defined KV store name.

```javascript
import { KvStore } from 'fastedge::kv';

async function eventHandler(event) {
  try {
    const myStore = KvStore.open('kv-store-name-as-defined-on-app');
    const value = myStore.get('key');
    return new Response(`The KV Store responded with: ${value}`);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

addEventListener('fetch', (event) => {
  event.respondWith(eventHandler(event));
});
```

```javascript
KvStore.open(kvStoreName);
```

--------------------------------

### getEnv Function Signature for FastEdge Environment Variables (JavaScript)

Source: https://g-core.github.io/FastEdge-sdk-js/reference/fastedge/env

Provides the signature for the 'getEnv' function used in the FastEdge SDK. This function takes a required 'keyName' string and returns the corresponding environment variable's value as a string, or null if the key is not found.

```javascript
getEnv(keyName);

```

--------------------------------

### Retrieve Value from KV Store using get()

Source: https://g-core.github.io/FastEdge-sdk-js/reference/fastedge/kv/key-value

This snippet demonstrates how to retrieve a value associated with a specific key from a KV Store. It requires a KV Store instance opened with `KvStore.open()` and takes a key string as input. It returns an ArrayBuffer of the value or null if the key does not exist.

```javascript
import { KvStore } from 'fastedge::kv';


async function eventHandler(event) {
  try {
    const myStore = KvStore.open('kv-store-name-as-defined-on-app');
    const value = myStore.get('key');
    return new Response(`The KV Store responded with: ${value}`);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}


addEventListener('fetch', (event) => {
  event.respondWith(eventHandler(event));
});
```

```javascript
storeInstance.get(key);
```

--------------------------------

### Get Secret Variables - FastEdge JavaScript

Source: https://g-core.github.io/FastEdge-sdk-js/reference/fastedge/secret/get-secret

Retrieves secret variables deployed on the FastEdge network using the getSecret function. Supports both simple function calls and integration with fetch event handlers. The function requires a secret name parameter and returns the corresponding string value.

```javascript
import { getSecret } from 'fastedge::secret';

async function eventHandler(event) {
  const secretToken = getSecret('MY_SECRET_TOKEN');
  return new Response({ secretToken });
}

addEventListener('fetch', (event) => {
  event.respondWith(eventHandler(event));
});
```

```javascript
getSecret(secretName);
```

--------------------------------

### Create Static Server with Manifest

Source: https://g-core.github.io/FastEdge-sdk-js/guides/creating-a-static-manifest

This JavaScript code snippet demonstrates how to create a static server using the `createStaticServer` function from the `@gcoredev/fastedge-sdk-js` library, utilizing the previously generated `staticAssetManifest`.

```javascript
import { createStaticServer } from '@gcoredev/fastedge-sdk-js';


createStaticServer(staticAssetManifest, serverConfig);

```

--------------------------------

### Headers Constructor

Source: https://g-core.github.io/FastEdge-sdk-js/reference/headers

The Headers() constructor creates a new Headers object, which can be initialized with an existing object or array of header key-value pairs.

```APIDOC
## Headers Constructor

### Description
Creates a new Headers object. This object can be pre-populated with existing headers.

### Method
`new Headers()`

### Endpoint
N/A (Constructor)

### Parameters
#### Path Parameters
None

#### Query Parameters
None

#### Request Body
None

### Request Example
```javascript
// Create an empty Headers object
const myHeaders = new Headers();

// Create a Headers object with initial values
const myHeadersWithInit = new Headers({
  'Content-Type': 'application/json',
  'X-Custom-Header': 'value'
});

// Create a Headers object from an array of pairs
const myHeadersFromArray = new Headers([
  ['Accept', 'application/xml'],
  ['Cache-Control', 'no-cache']
]);

// Create a Headers object by copying an existing one
const existingHeaders = new Headers({
  'Authorization': 'Bearer token'
});
const copiedHeaders = new Headers(existingHeaders);
```

### Response
#### Success Response (200)
Returns a new Headers object.

#### Response Example
```json
{
  "Content-Type": "application/json",
  "X-Custom-Header": "value"
}
```

### Info
Request and Response Headers are immutable. If you need to modify headers for downstream fetch requests or before returning a Response, you must create a `new Headers()` object and populate it with the desired headers.
```

--------------------------------

### Generate Static Assets Manifest with fastedge-assets

Source: https://g-core.github.io/FastEdge-sdk-js/guides/creating-a-static-manifest

This command-line interface tool takes an input directory and an output TypeScript file name. It generates a 'Static Assets Manifest' object mapping files to their properties, which is then embedded into the wasm binary.

```bash
npx fastedge-assets ./public ./src/public-static-assets.ts

```

--------------------------------

### Create new Headers object in JavaScript

Source: https://g-core.github.io/FastEdge-sdk-js/reference/headers

Demonstrates how to create a new Headers object using the Headers() constructor. The constructor accepts an optional init parameter that can prepopulate headers from various data structures. Note that Request and Response headers are immutable and require creating new Headers objects for modification.

```javascript
new Headers();
new Headers(init);
```

--------------------------------

### Create Response Object - JavaScript

Source: https://g-core.github.io/FastEdge-sdk-js/reference/response

The Response() constructor creates a new Response object. It accepts an optional body and an optional options object to configure status, statusText, and headers.

```javascript
new Response();
new Response(body);
new Response(body, options);
```

--------------------------------

### Create Request Object in JavaScript

Source: https://g-core.github.io/FastEdge-sdk-js/reference/request

Initializes a new Request object with a specified input (URL or another Request) and optional configuration options like method, headers, and body. Used for fetching resources in web applications.

```javascript
new Request(input);
new Request(input, options);
```

--------------------------------

### Handle Fetch Event in FastEdge Javascript SDK

Source: https://g-core.github.io/FastEdge-sdk-js/guides/fastedge-sdk-js

This snippet demonstrates the basic usage of the FastEdge Javascript SDK for handling incoming HTTP requests. It defines an asynchronous event handler for the 'fetch' event and uses `addEventListener` to register it. The handler must synchronously call `event.respondWith()` with a function that returns a `Response` object.

```javascript
async function eventHandler(event) {
  const request = event.request;
  return new Response(`You made a request to ${request.url}`);
}


addEventListener('fetch', (event) => {
  event.respondWith(eventHandler(event));
});
```

--------------------------------

### Scan KV Store for Keys using scan()

Source: https://g-core.github.io/FastEdge-sdk-js/reference/fastedge/kv/key-value

This snippet shows how to scan the KV Store for keys matching a given pattern. It uses the `scan` method on a KV Store instance, which requires a pattern string (must include '*'). It returns an array of matching keys, or an empty array if no matches are found.

```javascript
import { KvStore } from 'fastedge::kv';


async function eventHandler(event) {
  try {
    const myStore = KvStore.open('kv-store-name-as-defined-on-app');
    const results = myStore.scan('pre*');
    return new Response(`The KV Store responded with: ${results.join(', ')}`);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}


addEventListener('fetch', (event) => {
  event.respondWith(eventHandler(event));
});
```

```javascript
storeInstance.scan(pattern);
```

--------------------------------

### Scan Sorted Set Values by Prefix in JavaScript

Source: https://g-core.github.io/FastEdge-sdk-js/reference/fastedge/kv/zset

Creates a KvStore instance to access the KV Store and uses zscan with a prefix pattern to retrieve matching values. Inputs are a string key and a pattern string with '*' wildcard; performs prefix matching only. Returns an array of [ArrayBuffer, number] tuples; dependencies include FastEdge KV module, with error handling.

```javascript
import { KvStore } from 'fastedge::kv';

async function eventHandler(event) {
  try {
    const myStore = KvStore.open('kv-store-name-as-defined-on-app');
    const results = myStore.zscan('pre*');
    return new Response(`The KV Store responded with: ${JSON.stringify(results)}`);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

addEventListener('fetch', (event) => {
  event.respondWith(eventHandler(event));
});
```

--------------------------------

### KV Store zscan

Source: https://g-core.github.io/FastEdge-sdk-js/reference/fastedge/kv/zset

Scans keys in a Sorted Set that match a given pattern. You first need to open a KV Store instance.

```APIDOC
## GET /kvstore/zscan

### Description
Scans keys in a Sorted Set that match a given pattern. You first need to open a KV Store instance.

### Method
GET

### Endpoint
`/kvstore/zscan`

### Parameters
#### Query Parameters
- **key** (string) - Required - The key of the Sorted Set to scan.
- **pattern** (string) - Required - The prefix pattern to match (must include '*').

### Request Example
```javascript
import { KvStore } from 'fastedge::kv';

async function eventHandler(event) {
  try {
    const myStore = KvStore.open('kv-store-name-as-defined-on-app');
    const results = myStore.zscan('pre*');
    return new Response(`The KV Store responded with: ${JSON.stringify(results)}`);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

addEventListener('fetch', (event) => {
  event.respondWith(eventHandler(event));
});
```

### Response
#### Success Response (200)
- **results** (Array<[ArrayBuffer, number]>) - A list of tuples, containing the value in an ArrayBuffer and the score as a number.

#### Response Example
```json
[
  [ArrayBuffer('prefix_value1'), 5],
  [ArrayBuffer('prefix_value2'), 8]
]
```

**Note**: The `pattern` parameter is a prefix match and must contain the wildcard `*`. For example, `pre*` matches all keys starting with `pre`.
```

--------------------------------

### Add custom header from environment variable

Source: https://g-core.github.io/FastEdge-sdk-js/examples/headers

Adds a custom HTTP header to the response using an environment variable value. Depends on the fastedge::env module for accessing environment variables. Takes an incoming request event and returns a response with modified headers.

```JavaScript
import { getEnv } from 'fastedge::env';


async function eventHandler(event) {
  const request = event.request;


  const customEnvVariable = getEnv('MY_CUSTOM_ENV_VAR');


  const responseHeaders = new Headers(request.headers);
  responseHeaders.set('my-custom-header', customEnvVariable);


  return new Response('Returned all headers with a custom header added', {
    headers: responseHeaders,
  });
}


addEventListener('fetch', (event) => {
  event.respondWith(eventHandler(event));
});
```

--------------------------------

### Retrieve Sorted Set Values by Score in JavaScript

Source: https://g-core.github.io/FastEdge-sdk-js/reference/fastedge/kv/zset

Uses KvStore.open to access the KV Store and zrangeByScore to fetch values within a score range. Requires a string key and numeric min/max scores as inputs. Returns an array of [ArrayBuffer, number] tuples or throws an error; dependencies include FastEdge KV module.

```javascript
import { KvStore } from 'fastedge::kv';

async function eventHandler(event) {
  try {
    const myStore = KvStore.open('kv-store-name-as-defined-on-app');
    const results = myStore.zrangeByScore('key', 0, 10);
    return new Response(`The KV Store responded with: ${JSON.stringify(results)}`);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

addEventListener('fetch', (event) => {
  event.respondWith(eventHandler(event));
});
```

--------------------------------

### Check Bloom Filter Existence with bfExists - JavaScript

Source: https://g-core.github.io/FastEdge-sdk-js/reference/fastedge/kv/bloom-filter

This snippet demonstrates how to check if a value exists in a Bloom Filter stored in a KV Store. It requires the `fastedge::kv` module and an active KV Store instance. The `bfExists` method takes a key and a value as input and returns a boolean indicating existence.

```javascript
import { KvStore } from 'fastedge::kv';


async function eventHandler(event) {
  try {
    const myStore = KvStore.open('kv-store-name-as-defined-on-app');
    const hasItem = myStore.bfExists('key', 'value');
    return new Response(`The KV Store responded with: ${hasItem}`);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}


addEventListener('fetch', (event) => {
  event.respondWith(eventHandler(event));
});

```

```javascript
storeInstance.bfExists(key, value);
```

--------------------------------

### Access Secret Variables with getSecretEffectiveAt in JavaScript

Source: https://g-core.github.io/FastEdge-sdk-js/reference/fastedge/secret/get-secret-effective-at

Demonstrates how to use the `getSecretEffectiveAt` function to retrieve secret variables from specific slots. The function requires the secret name and the slot number as inputs and returns the secret value or null if not found.

```JavaScript
import { getSecretEffectiveAt } from 'fastedge::secret';

async function eventHandler(event) {
  const secretToken = getSecretEffectiveAt('MY_SECRET_TOKEN', 1);
  return new Response({ secretToken });
}

addEventListener('fetch', (event) => {
  event.respondWith(eventHandler(event));
});
```

```JavaScript
getSecretEffectiveAt(secretName, 0);
```

--------------------------------

### KV Store zrangeByScore

Source: https://g-core.github.io/FastEdge-sdk-js/reference/fastedge/kv/zset

Retrieves values from a Sorted Set within a specified score range. You first need to open a KV Store instance.

```APIDOC
## GET /kvstore/zrangeByScore

### Description
Retrieves values from a Sorted Set within a specified score range. You first need to open a KV Store instance.

### Method
GET

### Endpoint
`/kvstore/zrangeByScore`

### Parameters
#### Query Parameters
- **key** (string) - Required - The key of the Sorted Set to retrieve values from.
- **min** (number) - Required - The minimum score for the range.
- **max** (number) - Required - The maximum score for the range.

### Request Example
```javascript
import { KvStore } from 'fastedge::kv';

async function eventHandler(event) {
  try {
    const myStore = KvStore.open('kv-store-name-as-defined-on-app');
    const results = myStore.zrangeByScore('key', 0, 10);
    return new Response(`The KV Store responded with: ${JSON.stringify(results)}`);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

addEventListener('fetch', (event) => {
  event.respondWith(eventHandler(event));
});
```

### Response
#### Success Response (200)
- **results** (Array<[ArrayBuffer, number]>) - A list of tuples, containing the value in an ArrayBuffer and the score as a number.

#### Response Example
```json
[
  [ArrayBuffer('value1'), 5],
  [ArrayBuffer('value2'), 8]
]
```
```

--------------------------------

### Modify Downstream Response in JavaScript

Source: https://g-core.github.io/FastEdge-sdk-js/examples/downstream-modify-response

This function fetches user data from an API, modifies the response to include only the first 5 users, and returns a new JSON response with metadata. It uses the Fetch API and is designed to work with Cloudflare Workers.

```JavaScript
async function app(event) {
  const downstreamResponse = await fetch('http://jsonplaceholder.typicode.com/users');
  const users = await downstreamResponse.json();
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

=== COMPLETE CONTENT === This response contains all available snippets from this library. No additional content exists. Do not make further requests.