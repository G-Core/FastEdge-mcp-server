# FastEdge Error Codes

## Overview

FastEdge returns specific HTTP status codes (530-533) when the Wasm runtime encounters issues. These replace the standard 5xx codes to distinguish edge runtime errors from origin server errors.

---

## 530 — App Initialization Failed

**Meaning:** The Wasm module failed to start up before processing the request.

**Common Causes:**
- Missing required environment variables that the app reads during initialization
- Corrupted or invalid Wasm binary
- Binary was compiled for the wrong target (not `wasm32-wasip1`)
- Binary exceeds the 10MB size limit

**Debugging Steps:**
1. Verify the binary was built correctly:
   - JS: `fastedge-build ./src/index.js ./<name>.wasm` completed without errors
   - Rust: `cargo build --release --target wasm32-wasip1` succeeded
2. Check binary size: `ls -la *.wasm` or `ls -la target/wasm32-wasip1/release/*.wasm`
3. Test locally: `fastedge-run http -w ./app.wasm --port 8080`
4. Verify all required env vars are set via API or portal
5. Re-upload the binary and update the app

---

## 531 — Runtime Error

**Meaning:** The app started successfully but threw an unhandled exception during request processing.

**Common Causes:**
- Uncaught JavaScript exception (TypeError, ReferenceError, etc.)
- Rust panic (`unwrap()` on `None` or `Err`)
- Failed `fetch()` call without error handling
- JSON parse error on malformed request body
- Accessing undefined properties

**Debugging Steps:**
1. Test locally with the same request that triggers the error
2. Add error handling around likely failure points:
   ```typescript
   // JS: Wrap in try/catch
   try {
     const data = await req.json();
   } catch (e) {
     return new Response("Invalid JSON", { status: 400 });
   }
   ```
   ```rust
   // Rust: Use ? operator with proper error types
   let body = serde_json::from_slice::<MyType>(req.body())
       .map_err(|e| Error::from(format!("Invalid JSON: {}", e)))?;
   ```
3. Add `console.log()` statements to narrow down the failure point
4. Check that all external API calls have timeout and error handling

---

## 532 — Timeout Exceeded

**Meaning:** The app did not return a response within the allowed execution time.

**Limits:**
- Basic plan: 50ms
- Pro plan: 200ms

**Common Causes:**
- Slow external API calls via `fetch()`
- CPU-intensive computation (complex regex, large data processing)
- Multiple sequential external requests
- Infinite loops or recursive calls

**Debugging Steps:**
1. Profile external API calls — are they responding within limits?
2. Parallelize independent `fetch()` calls:
   ```typescript
   // Bad: Sequential
   const a = await fetch(url1);
   const b = await fetch(url2);

   // Good: Parallel
   const [a, b] = await Promise.all([fetch(url1), fetch(url2)]);
   ```
3. Cache results in KV store to avoid repeated API calls
4. Reduce computation — pre-compute where possible
5. Consider upgrading to Pro plan for 200ms limit
6. Move heavy processing to a backend service, use edge for routing/caching

---

## 533 — Memory Limit Exceeded

**Meaning:** The app allocated more memory than allowed.

**Limits:**
- Basic plan: 128MB
- Pro plan: 256MB

**Common Causes:**
- Loading large files or responses into memory
- String concatenation in loops (creates many intermediate strings)
- Unbounded data structures (arrays/maps that grow with input)
- Memory leaks in request handling logic
- Large dependency bundles

**Debugging Steps:**
1. Check binary size — large binaries consume base memory
2. Stream large responses instead of buffering:
   ```typescript
   // Instead of loading entire response into memory,
   // process chunks or return early
   ```
3. Avoid storing entire request/response bodies when only headers are needed
4. Use `TextEncoder`/`TextDecoder` for efficient string handling
5. Minimize dependencies — each imported module adds to memory usage
6. For Rust: avoid unnecessary `.clone()` calls, use references

---

## General Debugging Strategy

1. **Reproduce locally** using `fastedge-run http -w ./app.wasm --port 8080`
2. **Use fastedge-test** for a visual debugging UI — load your `.wasm`, craft test requests, inspect logs and responses in real time via the REST API or browser at `http://localhost:3000`
3. **Check app logs** in the Gcore portal for console output
4. **Verify configuration** — env vars, secrets, KV store names
5. **Test the specific request** that triggers the error (method, headers, body)
6. **Check app stats** via `GET /apps/{id}/stats` for error rate patterns
