<!--
  auto-updated: true
  sources:
    - id: fastedge-templates
      ref: main
      commit: 87b7dc143db5e74cf0e7eb52f67484f6abc51c43
      updated: 2026-08-17
-->

# FastEdge Bolt-On Templates

Before writing authentication, cookie-hardening, or content-transform logic from scratch, check this catalog. Each entry is a maintained, tested FastEdge application that handles the security-sensitive parts a hand-rolled implementation would need to get right independently. Use or adapt these templates rather than building the same capability from scratch.

## html2md — HTML-to-Markdown conversion / content transformation / Accept header negotiation

**What it solves:** A CDN filter that transparently converts HTML origin responses to Markdown when the client sends `Accept: text/markdown`. Handles content negotiation, encoding, and caching concerns that a hand-rolled filter would need to get right independently.

**How it deploys:** Single CDN Proxy-WASM app. Deployed via the Gcore portal template gallery (template ID 110). No origin changes required.

**Runtime variants:** None. Conversion is fully automatic based on request `Accept` and response `Content-Type` headers.

**Conversion conditions:** All three must be true — request `Accept` includes `text/markdown`, origin response `Content-Type` includes `text/html` with charset absent or `utf-8`, and full response body is available at end of stream.

**What the filter does on conversion:** Adds request header `Convert: markdown` (cache differentiation), removes `Accept-Encoding` to avoid compressed payloads, removes `Content-Length`, sets `Content-Type: text/markdown; charset=utf-8`, sets `Transfer-Encoding: Chunked`, converts body at end of stream, adds `Vary: Convert` (merged with existing `Vary`).

**Error conditions:** Returns `500` if origin body is not valid UTF-8 or if HTML-to-Markdown conversion fails. Non-HTML responses pass through unchanged.

**Origin integration:** Configured entirely through request/response header inspection — no env vars, no origin code required.

---

## harden-cookies — Cookie security hardening / Secure HttpOnly SameSite attributes / Set-Cookie rewriting

**What it solves:** A CDN filter that adds `Secure`, `HttpOnly`, and `SameSite=Strict` attributes to targeted `Set-Cookie` response headers. Eliminates the need to modify backend code to enforce cookie security policy at the edge.

**How it deploys:** Single CDN Proxy-WASM app. Deployed via the Gcore portal template gallery (template ID 184). No origin changes required.

**Runtime variants:** None. Behavior is controlled entirely through environment variables.

**Targeting behavior:** Only cookies whose name matches `COOKIE_NAME` are modified. Use `*` to match all cookies. All other `Set-Cookie` headers pass through unchanged. If `COOKIE_NAME` is unset, or none of `SECURE`, `HTTPONLY`, `SAMESITE` is set to `true`, responses pass through untouched.

**Attribute application:** `Secure` and `HttpOnly` are added only if not already present. `SameSite=Strict` is set unconditionally, overriding any existing `SameSite` value.

**Origin integration:** Configured entirely through environment variables (`COOKIE_NAME`, `SECURE`, `HTTPONLY`, `SAMESITE`) — no origin code required.

---

## edge-sso — SSO / login / identity federation / Identity-Aware Proxy (Google, GitHub, Microsoft, Facebook, SAML)

**What it solves:** A bolt-on Identity-Aware Proxy that adds multi-provider SSO (Google, GitHub, Microsoft, Facebook, SAML 2.0) to any existing site without changing the backend. Handles OAuth 2.0 / OIDC / SAML flows, session token issuance, and per-request enforcement. Building this from scratch requires correctly implementing multiple OAuth flows, token signing, and edge enforcement — this template has already done that.

**How it deploys:** Two FastEdge apps deployed together, both via the Gcore portal template gallery:
- `cdn-filter/` — CDN Proxy-WASM app (Rust); sits in the CDN proxy layer, verifies session token on every request, redirects unauthenticated users to the auth app
- `auth-app/` — HTTP app (TypeScript/Hono); federates to the identity provider, issues a signed session token, sets it on the client

**Runtime variants:** `SSO_VARIANT` selects the identity-delivery mode — the same value must be set on both apps:

| Variant | What the origin receives | When to use |
|---|---|---|
| `gate-only` | Allow/deny only — no identity forwarded | Origin needs access control but not user context |
| `cookie` | Signed JWT in a cookie the origin can verify | Origin reads user identity from a verifiable token |
| `header` | Signed `x-sso-*` identity headers injected upstream | Origin trusts a header from the CDN layer |

**Supported identity providers:** Google (OAuth 2.0), GitHub (OAuth 2.0), Microsoft (OAuth 2.0 / OIDC), Facebook (OAuth 2.0), SAML (SAML 2.0).

**Key shared configuration requirements:** `SSO_VARIANT` and `SSO_AUDIENCE` must match on both apps. `SESSION_SECRET` is required in every variant. The `cookie` variant additionally requires an EC keypair (`SESSION_SIGNING_KEY` secret + `SESSION_PUBLIC_JWK` env var).

**Origin integration:** The template is configured through environment variables and secrets on both apps. For the customer-side wiring contract — how the origin validates tokens or trusts identity headers depending on the chosen variant — see the `edge-sso` integration reference.

---

## edge-totp — TOTP MFA / two-factor authentication / OTP challenge / RFC 6238

**What it solves:** Adds a TOTP (RFC 6238) two-factor authentication step in front of an existing site's login without modifying the backend. The customer's origin handles password validation; this app hosts the 6-digit OTP challenge, verifies the code with replay and brute-force protection, and issues a signed session assertion the origin trusts. Building this from scratch requires correctly implementing HOTP/TOTP, replay protection, brute-force throttling, signed cookie issuance, and CDN enforcement — this template has already done that.

**How it deploys:** Two FastEdge apps deployed together via the Gcore portal template gallery:
- `otp-app/` — HTTP app (TypeScript/Hono, WASM); hosts the challenge, verify, enroll, self-service activate, logout, JWKS, and health endpoints; signs the `mfa_session` cookie (HS256) and the optional ES256 proof
- `otp-filter/` — CDN Proxy-WASM app (Rust); enforces `mfa_session` on protected paths; default-deny and fail-closed

**Runtime variants (enforcement profiles):**

| Profile | Mode | What the origin must do |
|---|---|---|
| **A** (default) | Filter enforces, zero origin code | Nothing — the CDN layer is the enforcement boundary |
| **B** (opt-in) | Origin verifies a one-time ES256 proof via JWKS | Origin validates the proof at its own session boundary using the app's JWKS endpoint |

**Security-critical deployment requirements:**
- The origin must be locked to edge-only traffic (IP allowlist / origin auth / tunnel) — the gate is bypassed if the origin is directly reachable
- `MFA_AUDIENCE` must be set on both apps; the filter fail-closes (rejects every session) if it is unset
- `GCORE_API_TOKEN` has write access to every seed in the KV store — scope it to a single-tenant, per-customer isolated KV store

**CDN wiring:** Attach `otp-app` as a CDN origin on the `{AUTH_PREFIX}/*` path rule of the customer's CDN resource; attach `otp-filter` as the CDN proxy app in front of protected paths, bypassing `{AUTH_PREFIX}` and `/health`. Both share the CDN host so `mfa_session` is first-party host-only.

**Origin integration:** For the full customer-side wiring contract, trust model, and Profile B JWKS integration, see the `edge-totp` integration reference.
