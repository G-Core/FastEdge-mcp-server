# Best Practices — Agent Quality Guidance

This document is for **agents** building FastEdge applications on a user's behalf. It is not a tutorial or an API reference. It is a set of behavioral rules that distinguish a high-quality FastEdge agent from one that papers over uncertainty.

For SDK signatures, runtime constraints, framework patterns, and example code, defer to the topic-specific reference docs (SDK reference, runtime constraints, Hono patterns, examples). This file is about *how* to work with the user, not *what* APIs to call.

## Confirmation Discipline

Before researching or writing code, confirm:

1. **App type — CDN app or HTTP app.** These are fundamentally different runtimes (proxy-wasm filter vs. standalone serverless function). Use-case descriptions are NOT enough — "auth at the edge", "edge middleware", "API gateway" do not unambiguously imply one or the other. Ask explicitly if the user has not stated `CDN app` or `HTTP app` outright.
2. **Language.** HTTP apps support JavaScript / TypeScript and Rust. CDN apps support Rust and AssemblyScript. The choice constrains everything downstream — SDK imports, build commands, blueprint files. Ask if multiple options remain after the type is fixed.
3. **Project name.** Required before scaffolding. Don't generate a placeholder name and proceed.

Only after all three are confirmed should you research patterns, read example apps, or pick blueprints. Researching ambiguous user input wastes tokens and produces wrong scaffolds — the user has to undo and restart.

## Observation vs. Action Request

Distinguish:

- **Observation** — *"this seems slow"*, *"the response is weird"*, *"I think the routing is off"*. Discuss; do NOT take action. Ask what they want to do about it.
- **Action request** — *"fix the slow response"*, *"change the routing to X"*. Act.

This rule is mandatory and overrides any tendency to be helpful by jumping ahead. Acting on an observation is rude and frequently wrong.

## Scaffold-First Invariant

**Never hand-roll project scaffolding files.** Specifically:

- `package.json`, `tsconfig.json`, `vite.config.*`
- `Cargo.toml`, `.cargo/config.toml`
- `asconfig.json`
- Entry-point boilerplate (`src/index.{js,ts}`, `src/lib.rs`, `assembly/index.ts`)

These are full of FastEdge-specific configuration (build target `wasm32-wasip1` vs `wasm32-wasip2`, the mandatory `abort_proc_exit` directive for AssemblyScript, the proxy-wasm SDK re-export line, etc.) that is easy to get subtly wrong. The blueprint files in `skills/scaffold/reference/` capture the correct shape.

Always use the `/gcore-fastedge:scaffold` skill, which loads the right blueprint based on the confirmed app type + language. After scaffolding, you may write app-specific code on top — but the project structure must come from a blueprint.

Anti-pattern to refuse: looking at a sibling project in the workspace as a "template" for `package.json` structure. The blueprint is the template; the sibling is unverified.

## TDD Loop with Pre-Deploy Gate

The supported lifecycle for non-trivial apps is:

1. **Scaffold** with `/gcore-fastedge:scaffold`.
2. **Write tests first** with `/gcore-fastedge:test` — this generates `tests/*.test.ts` against `@gcoredev/fastedge-test`.
3. **Implement** the feature until tests pass (`npm test`).
4. **Build** the WASM binary.
5. **Deploy** with `/gcore-fastedge:deploy`.

The deploy skill enforces a pre-deploy test gate: if `npm test` fails, deploy is blocked. To override (broken upstream test, urgent rollout, etc.) use `--skip-tests` — but only with explicit user confirmation. Never skip tests silently.

For prototypes / throwaway code the user has marked as exploratory, the loop is acceptable to compress, but do not skip the build and deploy steps for "real" deploys.

## External-Resource Preconditions

These FastEdge resources must exist in the Gcore portal **before** code that consumes them ships:

- **KV stores.** `KvStore.open(name)` errors if the named store doesn't exist. KV stores are account-level resources created independently and assigned to apps — the same store can be shared across multiple apps in the same account. Confirm the store is provisioned and assigned to this app before adding `KvStore.open(...)` calls. If unsure, ask the user. Do not design KV key schemas with organisation or client namespace prefixes (e.g. `tenant:acme:...`) — the account is already the client boundary. Per-user or per-session prefixes within the app's own data model (e.g. `session:abc123`) are fine.
- **Secrets.** `getSecret(name)` returns `null` (JS / AS) or a `None`-equivalent (Rust) if the secret is not provisioned or not assigned to the app. Secrets are account-level resources — the same secret (e.g. a shared signing key) can be assigned to multiple apps. Bare `getSecret(...)` calls without null-checks produce silent misconfiguration. Always check, and confirm the secret name is provisioned and assigned before relying on it.
- **Env vars.** Set on the app via `PUT /apps/{id}` `env_vars` field, or in the portal. Apps that read env vars at module-init time will fail to start (530) if the var is missing. Confirm provisioning before assuming a value is set.

When in doubt, list what the app will need and ask the user to confirm provisioning before writing the consuming code.

## CDN Routing Preconditions

For CDN apps, before deploying, confirm:

1. **Which CDN resource** the app attaches to (the resource has a `cname` and an `originGroup`).
2. **Which lifecycle hooks** the app should fire on (`on_request_headers`, `on_request_body`, `on_response_headers`, `on_response_body`). Pick only the hooks the filter actually needs — don't attach to all four by default.
3. **Which paths must skip FastEdge entirely** (health checks, status endpoints, third-party callbacks). These need a CDN rule with `options.fastedge.enabled: false` for the path. Don't assume "all traffic" means literally all traffic.
4. **Which paths use a different app**, if any. Per-path overrides via CDN rules **fully replace** the resource-level config — they don't merge. This is easy to get wrong. See the CDN integration reference.

Don't deploy a CDN app to a resource without confirming these — accidentally running a filter on health checks or callback URLs has caused outages.

## Live-Debug Logging Precondition

Before tailing logs from a deployed app:

1. Check the app's `debug_until` field. If unset, in the past, or close to expiring, debug capture is off or about to expire.
2. Enable debug — `PATCH /fastedge/v1/apps/{id}` with `{"debug": true}`. The platform sets `debug_until` to ~30 minutes in the future and auto-disables.
3. Trigger the request(s) you want to capture **after** debug is on.
4. Read `/apps/{id}/logs` to see the captured entries.

The order matters: logs only populate for traffic that hits the app while debug is active. Reading `/logs` before enabling debug returns nothing. See the operations reference for full details.

When the user asks to debug an issue, surface the debug-flag state explicitly before pasting any `/logs` curl command.

## Binary-Size Delta Watch

After every build, compare the new `.wasm` size to the previous build (if available). If the new binary is **materially larger** than the previous one (e.g. 2× or more), surface the delta to the user. Common causes:

- A development build with source maps was shipped instead of a release build.
- A new dependency was added without checking its bundle weight.
- A static asset was bundled into the binary unintentionally.

There is no fixed numeric threshold. The platform rejects uploads beyond ~50MB but typical apps land well under that. The point is *unexpected growth*, not a hard limit. If the user is intentionally bundling more (assets, larger deps), they'll say so.

## When in Doubt, Ask

The pattern that ties all of this together: when an answer requires asserting an API signature, runtime behavior, fetch option support, or framework feature — and you don't have a verified source — **ask the user instead of guessing**. Sources that count: `.d.ts` declarations in the SDK, the framework's published types, an existing example in the workspace that uses the exact pattern, or explicit confirmation from the user. Sources that don't count: training data, plausibility, or "this is how it usually works in similar runtimes."

A fabricated confident assertion is worse than admitting uncertainty. The user can correct uncertainty quickly; bad code shipped on a guess can take hours to unwind.
