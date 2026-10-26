<!--
  auto-updated: true
  sources:
    - id: fastedge-sdk-js
      ref: v2.7.0
      commit: 65909abd5e0da8720eee5166dca4fc559e098eac
      updated: 2026-10-26
-->

---
type: example
app_type: http
languages: [typescript]
capabilities: [component-imports, image-processing, static-assets, wasm-components]
---

# Component Imports — Image Thumbnails (JavaScript/TypeScript)

FastEdge JS example: import a Wasm component by its WIT interface and call it like a JS module. The component (`thumbnail.wasm`) is a Rust binary using the `image` crate. The app serves embedded images and, with `?w=<width>`, a resized thumbnail produced by the component.

SDK requirement: `@gcoredev/fastedge-sdk-js` ^2.7.0

---

## WIT Interface

File: `component/wit/thumbnail.wit`

```wit
package example:image;

interface thumbnail {
  enum format { jpeg, png }

  record size { width: u32, height: u32 }

  record options {
    max-width: u32,
    format: format,
  }

  dimensions: func(image: list<u8>) -> result<size, string>;
  resize: func(image: list<u8>, options: options) -> result<list<u8>, string>;
}

world thumbnail-component {
  export thumbnail;
}
```

---

## Component Registration

File: `.fastedge/build-config.js`

```js
export const config = {
  type: 'http',
  tsConfigPath: './tsconfig.json',
  entryPoint: './src/index.ts',
  wasmOutput: './dist/component-imports.wasm',
  components: {
    'example:image/thumbnail': './thumbnail.wasm',
  },
};
```

The `components` map declares which `.wasm` file exports each WIT interface. `fastedge-build` reads the interface from the component, generates JS/Wasm bindings, writes TypeScript declarations to `fastedge-components.d.ts`, and composes the component into the output binary. The result is a single `.wasm` file.

Equivalent CLI invocation:

```sh
fastedge-build -i src/index.ts -o dist/component-imports.wasm -t tsconfig.json \
  --component example:image/thumbnail=./thumbnail.wasm
```

---

## Import

```ts
import { dimensions, resize } from 'example:image/thumbnail';
```

The import specifier is the WIT package and interface name. TypeScript types are generated automatically by `fastedge-build` before type-checking.

---

## API

### WIT → TypeScript type mapping

| WIT type                          | TypeScript type                                                        |
| --------------------------------- | ---------------------------------------------------------------------- |
| `list<u8>`                        | `Uint8Array`                                                           |
| `u32`                             | `number`                                                               |
| `record options { max-width, … }` | `{ maxWidth: number, format: 'jpeg' \| 'png' }` (kebab-case → camelCase) |
| `enum format { jpeg, png }`       | `'jpeg' \| 'png'`                                                      |
| `result<size, string>`            | returns `size` on success; throws on error, message in `error.payload` |

### `dimensions(image: Uint8Array): { width: number, height: number }`

Reads only the image header. Does not decode the image. Cheap relative to `resize`. Call before `resize` to reject images that would exceed time or memory limits.

- **Parameter**: `image` — raw image bytes as `Uint8Array`
- **Returns**: `{ width: number, height: number }` in pixels
- **Throws**: object with `payload: string` containing the component's error message

### `resize(image: Uint8Array, options: { maxWidth: number, format: 'jpeg' | 'png' }): Uint8Array`

Decodes a JPEG or PNG, scales it down keeping aspect ratio, and encodes it. Images smaller than `maxWidth` are not enlarged.

- **Parameter**: `image` — raw image bytes as `Uint8Array`
- **Parameter**: `options.maxWidth` — maximum output width in pixels (image is never enlarged)
- **Parameter**: `options.format` — output format: `'jpeg'` or `'png'`
- **Returns**: encoded image bytes as `Uint8Array`
- **Throws**: object with `payload: string` containing the component's error message

---

## Request Routing

| Request                              | Response                                      |
| ------------------------------------ | --------------------------------------------- |
| `GET /<image>`                       | `200` original image                          |
| `GET /<image>?w=<width>`             | `200` JPEG thumbnail up to `width` px wide    |
| `GET /<image>?w=<width>&format=png`  | `200` PNG thumbnail                           |
| `?w=` not a whole number             | `400 w must be a whole number`                |
| Image over `MAX_PIXELS` (500 000)    | `413` pixel count message, no decode          |
| Component cannot read the image      | `415 Cannot read image: <component message>`  |
| Not in `images/`                     | `404 Not found`                               |
| Non-200 original (e.g. 304)          | Original response passed through unchanged    |

`w` is clamped to 16–800 px.

---

## Implementation Patterns

### Pattern 1 — Check size before decode

```ts
const { width, height } = dimensions(bytes);
if (width * height > MAX_PIXELS) {
  return new Response(`${width}x${height} is over the ${MAX_PIXELS}-pixel limit`, {
    status: 413,
  });
}
const thumbnail = resize(bytes, { maxWidth: ..., format });
```

`dimensions()` reads only the header. Reject oversized images before calling `resize()` to avoid decoding within the request time and memory budget.

### Pattern 2 — Error handling

```ts
try {
  const { width, height } = dimensions(bytes);
  // pixel guard ...
  const thumbnail = resize(bytes, { maxWidth, format });
  return new Response(thumbnail, { headers: { 'content-type': `image/${format}` } });
} catch (error) {
  return new Response(`Cannot read image: ${(error as { payload: string }).payload}`, {
    status: 415,
  });
}
```

One `try/catch` wraps both component calls. The thrown object has a `payload` property containing the component's error string.

### Pattern 3 — Input validation before component calls

```ts
const w = url.searchParams.get('w');
if (w === null || original.status !== 200) {
  return original; // no resize requested, or not a full response
}
if (!/^\d+$/u.test(w)) {
  return new Response('w must be a whole number', { status: 400 });
}
const maxWidth = Math.min(Math.max(Number(w), MIN_WIDTH), MAX_WIDTH);
```

Validate and clamp before passing to the component.

### Full handler

```ts
import { createStaticServer } from '@gcoredev/fastedge-sdk-js';
import { dimensions, resize } from 'example:image/thumbnail';
import { staticAssetManifest } from './images-static-assets';

const MAX_PIXELS = 500_000;
const MIN_WIDTH = 16;
const MAX_WIDTH = 800;

const images = createStaticServer(staticAssetManifest, {});

async function handle(request: Request): Promise<Response> {
  const original = await images.serveRequest(request);
  if (!original) {
    return new Response('Not found', { status: 404 });
  }
  const url = new URL(request.url);
  const w = url.searchParams.get('w');
  if (w === null || original.status !== 200) {
    return original;
  }
  if (!/^\d+$/u.test(w)) {
    return new Response('w must be a whole number', { status: 400 });
  }
  const maxWidth = Number(w);
  const format = url.searchParams.get('format') === 'png' ? 'png' : 'jpeg';

  const bytes = new Uint8Array(await original.arrayBuffer());
  try {
    const { width, height } = dimensions(bytes);
    if (width * height > MAX_PIXELS) {
      return new Response(`${width}x${height} is over the ${MAX_PIXELS}-pixel limit`, {
        status: 413,
      });
    }
    const thumbnail = resize(bytes, {
      maxWidth: Math.min(Math.max(maxWidth, MIN_WIDTH), MAX_WIDTH),
      format,
    });
    return new Response(thumbnail, { headers: { 'content-type': `image/${format}` } });
  } catch (error) {
    return new Response(`Cannot read image: ${(error as { payload: string }).payload}`, {
      status: 415,
    });
  }
}

addEventListener('fetch', (event: FetchEvent) => event.respondWith(handle(event.request)));
```

---

## Time and Memory Budget

Component work counts against each request's time and memory limits. Free plan: 100 ms, 52 MB.

Decoding is the costly step; cost grows with pixel count. Measured on the edge:

| Image                     | Decode time   | Full component call | Memory |
| ------------------------- | ------------- | ------------------- | ------ |
| 612×640 JPEG (~0.4 MP)    | ~10 ms        | ~20–30 ms           | 3 MB   |
| 1200×900 JPEG (~1 MP)     | ~45–60 ms     | over 60 ms          | 9 MB   |
| 4000×3000 JPEG (12 MP)    | ~530–690 ms   | over 700 ms         | 71 MB  |

`MAX_PIXELS = 500_000` (~0.5 MP) is the safe limit for the free plan. Raise it only on a plan with a larger budget.

---

## Constraints and Gotchas

- **Progressive JPEGs decode ~3× slower** than baseline JPEGs. Save images as baseline.
- **Data is copied into the component on each call.** While the component runs, bytes are held twice (input buffer + component's internal copy). This is small relative to the decoded pixels (3 bytes/pixel for JPEG).
- **Image source**: The example embeds images as static assets (via `fastedge-assets`) to stay self-contained. A real image service would `fetch()` the original from an origin or storage and pass those bytes to the same component calls — the component works on bytes regardless of source.
- **`thumbnail.wasm` is committed** to the repository. Building the app (`npm run build`) requires no Rust toolchain. Rebuilding the component after changes to `component/` requires Rust with target `wasm32-wasip2`:
  ```sh
  rustup target add wasm32-wasip2
  npm run build:component
  npm run build
  ```
- **Component may only import what FastEdge provides**: WASI 0.2 and `gcore:` interfaces. Builds fail if the component imports anything else.
- **Any language that builds Wasm components** can implement the WIT interface (Go/TinyGo, C/C++, Python/componentize-py, etc.).

---

## Project Structure

```
component/wit/thumbnail.wit      WIT interface definition
component/src/lib.rs             Rust implementation of the interface
component/build.sh               Builds thumbnail.wasm
.fastedge/build-config.js        Maps WIT interface name → .wasm file
src/index.ts                     App entry point; imports and calls the component
src/images-static-assets.ts      Generated static asset manifest
images/                          Embedded image files
dist/component-imports.wasm      Final composed output binary
```

---

## Build Scripts

```json
{
  "build": "npm run create-images-manifest && fastedge-build -c",
  "create-images-manifest": "fastedge-assets ./images src/images-static-assets.ts",
  "build:component": "./component/build.sh"
}
```

`fastedge-build -c` uses `.fastedge/build-config.js`. The `-i`, `-o`, `-t`, `--component` flags are the equivalent CLI form.

---

## See Also

- Component imports reference (types, errors, what components may import, WIT binding rules)
- Build CLI reference (`fastedge-build` flags including `--component`)
- Static assets reference (`createStaticServer`, `fastedge-assets`)
