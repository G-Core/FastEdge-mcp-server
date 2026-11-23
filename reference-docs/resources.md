<!--
  auto-updated: true
  sources:
    - id: fastedge-test
      ref: v0.3.1
      commit: ccc68985ba8dcb688c077c04f2a3762ee34f944d
      updated: 2026-11-23
-->

# Resources

How to model a CDN resource locally: several CDN apps on its hooks, rules, and an origin. Covers running requests through the resource in the debugger and in tests, and how each part maps to a CDN resource on the edge.

## Overview

A resource runs one request through several apps, as a CDN resource does on the edge.

- **Hooks:** each of the four hooks (`onRequestHeaders`, `onRequestBody`, `onResponseHeaders`, `onResponseBody`) can run a different CDN (proxy-wasm) app.
- **Origin:** where the response comes from. It is a URL, the built-in origin (an echo, a folder of files, or a fixed response), or an HTTP app of the resource.
- **Fresh instance per hook:** every hook runs on a new instance of its app, so no wasm memory carries from one hook to the next.
- **What passes between hooks:** request headers and bodies, response headers and bodies, and the request's properties. Headers an app adds in `onRequestHeaders` reach every later hook.
- **Custom properties belong to the request.** A custom property written in `onRequestBody` or a later hook is read by every later hook, whichever app runs it. A custom property written in `onRequestHeaders` is not kept: no later hook sees it. To pass state out of `onRequestHeaders`, add a request header.
- **Shared stores:** all apps of a resource share one cache and one set of Edge KV stores (see the STORES reference).

## The Resource File

A resource is described by one JSON file. The debugger looks for `.fastedge-debug/fastedge-cdn-resource.test.json` in the workspace when no other file is named. Paths in the file are relative to the file itself.

| Field     | Purpose                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------- |
| `apps`    | The apps by name. Each is a built `wasm`, or a `config` pointing at another project's config, or both. |
| `main`    | The default `hooks` (which app runs each hook) and the `origin`.                                        |
| `rules`   | Per-path overrides of `main`'s hooks and origin.                                                        |
| `client`  | Where the client is (preset plus overrides).                                                            |
| `edge`    | Which edge POP runs the apps (preset plus overrides).                                                   |
| `request` | The default request (`url`, `method`, `headers`, `body`) used when a request names none.                |

An app entry takes these fields:

- `wasm`: the built binary, relative to the resource file. It overrides the wasm of a referenced config.
- `config`: another project's `fastedge-config.test.json`. The app takes its wasm and dotenv from it. That config's `wasm.path` is relative to that app's project root (the nearest folder with a `Cargo.toml` or `package.json`, and `<workspace>` means that root). Its `dotenv.path` is relative to the config file. Fields set in the resource file win.
- `dotenv`: `{ enabled, path }`, overriding the referenced config's dotenv. `path` is relative to the resource file and defaults to the resource file's folder.

The full field-by-field schema is in the TEST_CONFIG reference (resource configuration section).

### Example Resource File

```json
{
  "description": "Site with auth, rewrite and header apps; /api/ goes to an HTTP app",
  "apps": {
    "auth": { "wasm": "../auth/wasm/auth.wasm" },
    "rewrite": { "config": "../rewrite/fastedge-config.test.json" },
    "headers": {
      "wasm": "../headers/wasm/headers.wasm",
      "dotenv": { "enabled": true, "path": "../headers" }
    },
    "api": { "wasm": "../api/wasm/api.wasm" }
  },
  "main": {
    "hooks": {
      "onRequestHeaders": "auth",
      "onRequestBody": { "app": "rewrite", "interruptOnError": false },
      "onResponseHeaders": "headers"
    },
    "origin": { "builtIn": { "files": "../site" } }
  },
  "rules": [
    { "name": "api", "match": "^/api/", "origin": { "app": "api" } }
  ],
  "client": { "preset": "de" },
  "edge": { "preset": "nl" },
  "request": { "url": "https://example.com/index.html" }
}
```

## Hooks

Each hook is assigned one of:

- an app name string: `"auth"`
- an object: `{ "app": "auth", "interruptOnError": false }`

A hook with no app is skipped, and the request passes through it unchanged.

`interruptOnError` defaults to `true`. When an app traps in a hook:

- with `interruptOnError: true`, the client gets status 531
- with `interruptOnError: false`, the request goes on as if the hook had not run

Hooks require CDN (proxy-wasm) apps. Assigning an HTTP app to a hook is a load error.

## Rules

Rules override `main` for requests whose path matches.

- The first rule whose `match` regular expression matches the request **path** wins. The query string is not part of the match. Matching a path is limited to 100 ms: a pattern that backtracks for longer fails the request.
- A rule's `hooks`, when set, **replace** `main`'s hooks completely. A hook the rule leaves out does not fall back to `main`'s app.
- A rule that leaves out `hooks` uses `main`'s hooks. A rule that leaves out `origin` uses `main`'s origin.
- A request that matches no rule uses `main`.

The result of a request names the rule that matched (index, `name`, `match`), or `null` for `main`.

## Origins

The origin is declared in `main.origin` and can be overridden per rule.

| Origin   | Declared as                                      | What answers                                                     |
| -------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| URL      | `{ "url": "https://backend.example.com" }`       | a real fetch to that host, with the request's path and query     |
| Echo     | `{ "url": "built-in" }`                          | the echo responder                                               |
| Folder   | `{ "builtIn": { "files": "../site" } }`          | the file under the folder named by the request path (200 or 404) |
| Fixed    | `{ "builtIn": { "status": 200, "body": "ok" } }` | the declared response                                            |
| HTTP app | `{ "app": "api" }`                               | the HTTP app of the resource                                     |

### URL Origin

The request's path and query are forwarded to the origin's host, as a CDN forwards them. The URL the client asked for (the request's `url`) is not fetched. Redirects are not followed: a 3xx reaches the response hooks unchanged. An unreachable origin gives status 0 with `Fetch Failed` and the error text as the body, and the response hooks do not run.

### Echo Origin (`"built-in"`)

The echo answers 200 with a JSON body describing the request: `{ method, reqHeaders, reqBody, requestUrl }`. The request headers `x-debugger-status` and `x-debugger-content` still change its status and body, but they are deprecated. Declare a `builtIn` origin instead.

### Declared Built-in Origin

`builtIn` takes `status`, `headers`, and at most one of `body`, `bodyFile`, and `files`.

- **Fixed response:** `status` (default 200), `headers`, and `body` (text) or `bodyFile` (the file's bytes, with the content type taken from the extension).
- **Folder:** `files` serves `<folder>/<request path>`. The status is 200 or 404, so `status` cannot be set with `files`. Only GET and HEAD are served (other methods give 405). Dotfiles and paths that leave the folder are never served. Files larger than 32 MiB give 404.
- Paths are relative to the resource file and must lie inside the workspace (or inside `root` for `createResource`).
- Declared `headers` apply over the generated ones. HEAD gets the headers without the body.

### HTTP App Origin

An HTTP app of the resource answers as the origin. It receives:

- the request's path and query
- the method
- the headers, with pseudo-headers removed and multi-value headers comma-joined
- the body

A binary request body that a hook produced reaches the HTTP app as base64 text, not as raw bytes. An origin app must be an HTTP app, not a CDN app.

## Request Context

A resource has one `client` and one `edge` for the whole request, because one edge POP runs every app of a request. Both are a preset (`de`, `nl`, `us`) plus field overrides, and they are set in the resource file.

- CDN apps see the client as `request.*` geo properties and `geoip-*` headers, and the edge as dictionary entries and the `x-id` header.
- An HTTP-app origin sees the same client and edge as request headers.
- Explicit properties and request headers win over the values the context adds.
- The context is applied once, at the start of the request. A `client` or `edge` in a request body is not applied to a resource.
- A loaded resource keeps the context it loaded with. On the Resource page, a change to `client` or `edge` marks the file edited, so the next send saves it and loads it again.

The field list and the headers each field produces are in the TEST_CONFIG reference (client and edge context section) and the RUNNER reference (request context section).

## Errors and Rebuilds

### Load Errors

Loading a resource fails, and names the app or the rule, when:

- the file does not match the schema (for example an unknown field)
- a hook or origin names an app that is not in `apps`
- a rule's `match` is not a valid regular expression
- an app has neither `wasm` nor `config`
- an app's `config` is itself a resource (resources cannot be nested)
- an app's wasm file is missing (the app is not built)
- an HTTP app is assigned to a hook
- a CDN app is used as an origin
- a file is outside the workspace (debugger) or outside `root` (`createResource`)
- a `builtIn` origin names a dotfile as `bodyFile`, a folder that does not exist, or a file-system root

A request with no `url` (none passed and no `request.url` in the file) throws.

### Rebuilds

An app whose wasm changed since it was loaded is reloaded before the next request. A failed reload (a broken build) fails that request, and the next request tries again.

## In the Debugger

The Resource page edits the resource file and runs requests through it.

1. **Open** a file (the default path is filled in). A file that does not exist yet starts a new resource.
2. Edit the **Apps** table (name, config, wasm, dotenv), **main** and each **rule** (name, match regex, hook assignment with an "interrupt on error" option per hook, and the origin), and the request context. Rules can be reordered and removed. Ticking "FastEdge hooks for this rule" gives the rule its own hooks, which replace main's completely.
3. **Save** (or Ctrl/Cmd+S). If the file changed on disk since it was opened, or the target path is another existing file, the page asks before overwriting.
4. **Load** the resource, then **Send** a request (method, URL, headers, body). When there are unsaved edits, the button saves, loads and sends.

The result shows the rule that matched, then the five steps in order: the four hooks (with the app that ran each and its status) and the origin (with its kind and response status). Selecting a step shows that hook's logs, store calls, input and output, or the origin's response. The final response is shown below.

- Loading a resource replaces the single app of the Debugger page.
- The file's origin fields must be filled in before it can be saved.
- Every file the resource reads (the resource file, wasm, referenced configs, dotenv folders, origin files) must be inside the workspace.

The routes the page uses are listed in the API reference.

## In Tests

### `createResource(fileOrObject, options?)`

Loads a resource from a file (paths relative to it) or an object (paths relative to the current directory). Returns a `Resource`.

```typescript
import { createResource } from '@gcoredev/fastedge-test';

async function main(): Promise<void> {
  const resource = await createResource('.fastedge-debug/fastedge-cdn-resource.test.json');
  try {
    const result = await resource.request({ url: 'https://example.com/api/users' });
    console.log(result.rule?.name);           // "api"
    console.log(result.origin?.kind);         // "app"
    console.log(result.finalResponse.status);
  } finally {
    await resource.cleanup();
  }
}

main();
```

**Options:**

- `options.root`: confines every file the resource reads to one folder, as the debugger confines loads to its workspace.
- `options.stores`: selects the stores (`false` turns them off, or pass an isolated `TestStores`).

### Resource Test Suite Type

The test framework accepts a resource in place of a wasm file:

```typescript
type ResourceTestSuite = {
  resource: string | ResourceConfigInput;
  stores?: false | TestStores;
  tests: {
    name: string;
    run: (resource: Resource, context: { stores: TestStores | null }) => Promise<void>;
  }[];
};
```

Each test gets a fresh resource on its own stores. See the RUNNER reference for `createResource` and the TEST_FRAMEWORK reference for suites.

## On the Edge

A resource file models the FastEdge part of a CDN resource. This table maps each part to the Gcore API on the edge.

| Resource file                 | On the edge                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps.<name>` (CDN app)       | a FastEdge app with `api_type` `proxy-wasm`: upload the binary (`POST /fastedge/v1/binaries/raw`), then `POST /fastedge/v1/apps`                                                            |
| `apps.<name>` (HTTP app)      | a FastEdge app with `api_type` `wasi-http`                                                                                                                                                  |
| an app's dotenv               | the app's `env` and `secrets`                                                                                                                                                               |
| `main.hooks.<hook>`           | the CDN resource's `options.fastedge.on_<hook>`: `{ "enabled": true, "app_id": "<id as a string>", "interrupt_on_error": <bool> }` (`onRequestHeaders` → `on_request_headers`, and so on)  |
| `rules[i]`                    | a CDN rule (`POST /cdn/resources/{id}/rules`) with `rule` = the regex and `ruleType: 0`                                                                                                     |
| rule order (first match wins) | rule `weight` (the lowest matching weight applies)                                                                                                                                          |
| `rules[i].hooks`              | the rule's `options.fastedge`, which replaces the resource's                                                                                                                                |
| `origin: { "url": … }`        | an origin group with that source                                                                                                                                                            |
| `origin: { "app": … }`        | an origin group whose source has `origin_type: "fastedge"` and `config.app_id`, set as `originGroup` on the resource or the rule                                                            |
| `origin: { "builtIn": … }`    | no equivalent: a real origin, or an HTTP app that serves the same files or response                                                                                                         |
| `client`, `edge`, `dc`        | none: where a request lands is decided by the edge                                                                                                                                          |
| KV fixtures                   | real KV stores attached to the apps that open them (see the STORES reference)                                                                                                               |

The edge runs hooks on the edge by default. `execute_on_edge` and `execute_on_shield` have no local equivalent. A resource file models only the FastEdge part of a CDN resource: it has no caching or other CDN options.

Locally, every app opens every KV store that has a fixture. On the edge, an app opens only the stores attached to it.

## See Also

- TEST_CONFIG — resource configuration schema, origins, client and edge context
- RUNNER — `createResource`, `matchRule`, and the `Resource*` types
- API — REST routes behind the Resource page
- TEST_FRAMEWORK — test suites, including the `resource` option
- STORES — the cache and Edge KV shared by a resource's apps
