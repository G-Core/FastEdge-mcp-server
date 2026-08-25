<!--
  auto-updated: true
  sources:
    - id: fastedge-templates
      ref: main
      commit: 87b7dc143db5e74cf0e7eb52f67484f6abc51c43
      updated: 2026-08-20
-->

# edge-sso — Origin Integration Reference

Reference for origins integrating with an already-deployed `edge-sso` template pair (auth-app + cdn-filter). Covers the contract the origin relies on: identity delivery, auth routes, login page customization, and redirect validation.

---

## 1. What `SSO_VARIANT` Means for the Origin

`SSO_VARIANT` is set identically on both the auth-app and the cdn-filter. It controls how the edge delivers identity to the origin and what the origin is responsible for verifying.

### `gate-only`

- **What the origin receives**: nothing — the filter enforces allow/deny at the edge; only authenticated requests reach the origin.
- **Origin responsibility**: none. The origin does not receive a token or identity headers; it only sees requests that passed the gate.
- **Signing algorithm**: HS256 (shared `SESSION_SECRET`). The origin never verifies the token; the filter handles all verification.
- **Session cookie**: stripped before forwarding — the origin never sees the raw JWT.

### `cookie`

- **What the origin receives**: the `sso_session` cookie (configurable via `SESSION_COOKIE`) containing a signed JWT. The cookie passes through to the origin unchanged.
- **Origin responsibility**: the origin verifies the cookie itself using the published JWKS endpoint.
  - **JWKS endpoint**: `GET /auth/.well-known/jwks.json` — mounted on the auth-app only when `SSO_VARIANT=cookie` and `SESSION_PUBLIC_JWK` is configured. Use a standard JWKS client (e.g., `createRemoteJWKSet` from the `jose` library) against this URL — do not implement verification manually.
- **Signing algorithm**: ES256 (asymmetric — EC private key `SESSION_SIGNING_KEY` signs; public JWK published via JWKS). The origin holds only the public key and verifies with it; it never holds a forge-capable secret.
- **Cookie attributes**: `HttpOnly; Secure; SameSite=Lax`. Under single-domain routing no `Domain=` is set — same-origin.
- **Token claims**: `sub`, `iat`, `exp`, `aud`, `iss` (optional), `email`, `name`, `picture`, `given_name`, `family_name`.

### `header`

- **What the origin receives**: verified identity injected as request headers. The session cookie is stripped before forwarding — the origin never sees the raw JWT.
- **Origin responsibility**: read and trust `x-sso-*` headers. The origin **must treat an empty `x-sso-*` header as absent** — the platform blanks a cleared header to empty rather than removing it, so an empty value means the claim was not present in the token.
- **Signing algorithm**: HS256 (shared `SESSION_SECRET`). The origin does not verify the token; the filter handles all verification before injecting headers.
- **Anti-spoofing contract**: the filter clears any client-supplied `x-sso-*` header before injecting verified values. A client cannot smuggle a spoofed identity header past the filter. The origin must not trust `x-sso-*` values from any path that bypasses the filter.

**Complete list of injected headers (verbatim from `cdn-filter/src/lib.rs`):**

| Header | Claim source |
|---|---|
| `x-sso-user` | `sub` |
| `x-sso-email` | `email` |
| `x-sso-name` | `name` |
| `x-sso-picture` | `picture` |
| `x-sso-given-name` | `given_name` |
| `x-sso-family-name` | `family_name` |

Headers for claims absent from the token: if the claim was not present, the header is absent (or empty — treat empty as absent per the platform contract above).

---

## 2. Auth-App Routes

All routes are served under `AUTH_PREFIX` (default: `/auth`). Under single-domain routing, the CDN routes `AUTH_PREFIX/**` to the auth-app as an origin on the customer's own domain. The cdn-filter bypasses `AUTH_PREFIX/**` — it does not gate these routes.

| Route | Method | Caller | Purpose |
|---|---|---|---|
| `/auth/` and `/auth` | GET | Browser | Hosted login page — server-rendered, branded, provider buttons. Honours `?redirect=`. |
| `/auth/providers` | GET | Browser / custom login UI | Provider data (JSON) — the enabled provider set with login URLs. Honours `?redirect=`. |
| `/auth/branding` | GET | Custom login page | Branding config (JSON) — current `LOGIN_PAGE_*` values for custom pages. |
| `/auth/login/google` | GET | Browser | Start Google OIDC. Honours `?redirect=`. |
| `/auth/login/github` | GET | Browser | Start GitHub OAuth. Honours `?redirect=`. |
| `/auth/login/microsoft` | GET | Browser | Start Microsoft OIDC. Honours `?redirect=`. |
| `/auth/login/facebook` | GET | Browser | Start Facebook OAuth. Honours `?redirect=`. |
| `/auth/login` | GET | Browser | Start SAML SSO. Honours `?redirect=`. |
| `/auth/logout` | GET | Browser | Sign out — clears `sso_session` (`Max-Age=0`), redirects to the validated `?redirect=` (defaults to `/`). Not gated by the filter. |
| `/auth/callback/<provider>` | GET | IdP only | OAuth/OIDC callback — used by the identity provider, not called directly. |
| `/auth/callback` | POST | IdP only | SAML ACS endpoint — used by the identity provider, not called directly. |
| `/auth/.well-known/jwks.json` | GET | Origin / JWKS client | Public JWK set — mounted only when `SSO_VARIANT=cookie` and `SESSION_PUBLIC_JWK` is set. |

`?redirect=<url>` is the post-login destination. After successful federation the auth-app sets the `sso_session` cookie and 302s to that URL.

---

## 3. Login Page Customization Tiers

### Tier 1 — Env Var Branding (recommended default)

The built-in hosted login page reads these env vars per-request. No code changes required.

| Env var | Default | Effect |
|---|---|---|
| `LOGIN_PAGE_TITLE` | `"Sign in"` | `<title>` and `<h1>` |
| `LOGIN_PAGE_SUBTITLE` | `"Choose a sign-in method"` | Subheading below the title |
| `LOGIN_PAGE_LOGO_URL` | — | Logo image above the title |
| `LOGIN_PAGE_FAVICON_URL` | — | Tab favicon |
| `LOGIN_PAGE_ACCENT_COLOR` | `#0066cc` | Button/focus-ring color (CSS `--lp-accent`) |
| `LOGIN_PAGE_BACKGROUND_COLOR` | `#f0f2f5` | Page background (CSS `--lp-bg`) |
| `LOGIN_PAGE_CSS_URL` | — | Customer stylesheet linked last — overrides any built-in style |
| `IDP_LABEL` | `"SSO"` | Display name for the SAML provider button |
| `IDP_ICON_URL` | — | Icon URL for the SAML provider button |

`LOGIN_PAGE_CSS_URL` is the deep-customization escape hatch — a `<link rel="stylesheet">` injected after built-in styles. The CSS variables `--lp-accent` and `--lp-bg` are intentional override points.

### Tier 2 — Fully Custom Login Page (`LOGIN_PAGE_URL`)

Set `LOGIN_PAGE_URL` on the **CDN filter** to redirect unauthenticated users to a page you own instead of the built-in one. That page calls `GET /auth/providers` for login URLs and, optionally, `GET /auth/branding` for consistent branding tokens.

```
LOGIN_PAGE_URL=https://shop.example.com/my-login
```

Your custom page handles the full UI; clicking a provider's button navigates to its `loginUrl` (relative, same-origin) which kicks off the standard federation flow. The default value of `LOGIN_PAGE_URL` is `/auth/` — set it only to opt out.

### Tier 3 — Embed Sign-In Buttons on an Existing Page

**Static links (simplest):** hard-code the provider routes.
```html
<a href="/auth/login/google?redirect=/account">Sign in with Google</a>
<a href="/auth/login/github?redirect=/account">Sign in with GitHub</a>
<a href="/auth/login?redirect=/account">Single Sign-On</a>
```

**Dynamic widget:** fetch `/auth/providers` and render whatever is enabled.
```js
const { providers } = await fetch("/auth/providers?redirect=/account").then(r => r.json());
for (const p of providers) {
  const a = document.createElement("a");
  a.href = p.loginUrl;                  // relative, same-origin, redirect already encoded
  a.textContent = `Sign in with ${p.label}`;
  loginContainer.append(a);
}
```

Adding or removing a provider (a secret or `SSO_PROVIDERS` change in the portal) updates the widget with no code change on the customer's side.

---

## 4. JSON Contracts

### `GET /auth/providers`

```jsonc
// GET /auth/providers?redirect=/cart
{
  "providers": [
    { "id": "google", "label": "Google", "loginUrl": "/auth/login/google?redirect=%2Fcart" },
    { "id": "github", "label": "GitHub", "loginUrl": "/auth/login/github?redirect=%2Fcart" },
    { "id": "saml",   "label": "SSO",    "loginUrl": "/auth/login?redirect=%2Fcart" }
  ]
}
```

- `id` — stable identifier; matches the value used in `SSO_PROVIDERS`.
- `label` — human label; the SAML label is overridden by `IDP_LABEL`.
- `loginUrl` — relative path including the encoded `redirect`.
- Order is stable (registry order), not allowlist order.
- The enabled provider set is resolved at runtime from `SSO_PROVIDERS` ∩ providers-whose-credentials-are-present.

### `GET /auth/branding`

```jsonc
{
  "title": "Sign in",
  "subtitle": "Choose a sign-in method",
  "logoUrl": "https://cdn.example.com/logo.png",
  "faviconUrl": null,
  "accentColor": "#e00",
  "backgroundColor": "#f0f2f5",
  "cssUrl": null
}
```

Returns the current `LOGIN_PAGE_*` env var values as a JSON object. Custom login pages (Tier 2) can `fetch("/auth/branding")` to auto-style themselves consistently without duplicating the env var set.

---

## 5. Redirect Validation

The `?redirect=` parameter is validated against `SSO_ALLOWED_ORIGINS` on every route that honours it and on every read of the `saml_relay` cookie.

**Rules:**
- Relative URLs (starting with `/`) are always permitted.
- Off-origin absolute URLs are silently dropped — the post-login redirect falls back to `/`.
- Protocol-relative and backslash bypasses (e.g., `/\evil.com`) are rejected.
- To permit absolute redirects to specific origins, set `SSO_ALLOWED_ORIGINS` to a comma-separated list of allowed origins (e.g., `https://shop.example.com`).

This is a security-load-bearing constraint, not cosmetic. An incorrect or missing `SSO_ALLOWED_ORIGINS` will silently drop redirect parameters that include absolute URLs, changing post-login destination behavior without error.

---

## 6. Shared Config the Origin Needs to Know About

These env vars affect the contract the origin operates under. They are set on the FastEdge apps (auth-app and/or cdn-filter), but the origin integration depends on their values.

| Env var | Set on | Origin concern |
|---|---|---|
| `SSO_VARIANT` | Both apps (must match) | Determines what the origin receives: nothing (gate-only), a JWT cookie to verify (cookie), or identity headers (header). |
| `SSO_AUDIENCE` | Both apps (must match) | The `aud` claim in every minted token. The cookie variant origin must validate `aud` matches this value when verifying the JWT. |
| `AUTH_PREFIX` | Both apps | The path prefix reserved for auth routes (default: `/auth`). The origin must not serve conflicting routes under this prefix; the CDN routes it to the auth-app. |
| `SESSION_COOKIE` | Both apps | Cookie name (default: `sso_session`). The cookie variant origin reads the session token from this cookie name. |
| `SESSION_SECRET` | Auth-app + cdn-filter (gate-only/header) | HS256 signing secret. The origin does not use this directly; only the filter verifies with it. |
| `SESSION_SIGNING_KEY` / `SESSION_PUBLIC_JWK` | Auth-app (cookie variant) | EC keypair. The origin uses the JWKS endpoint (`GET /auth/.well-known/jwks.json`) — never `SESSION_SIGNING_KEY` directly. |
| `SSO_ALLOWED_ORIGINS` | Auth-app | Governs which absolute redirect URLs are permitted. Affects post-login destination. |
| `LOGIN_PAGE_URL` | CDN filter | Where unauthenticated users are redirected. Default `/auth/`. Set to opt out of the built-in hosted page. |
| `CANONICAL_HOST` | Auth-app | The auth-app 301-redirects requests arriving on non-canonical hosts. The origin and IdP callback URLs must use this domain. |

**Provider credentials** (`GOOGLE_CLIENT_ID`, `GITHUB_CLIENT_ID`, `MICROSOFT_CLIENT_ID`, `FACEBOOK_CLIENT_ID`, SAML `IDP_*`/`SP_*`) are internal to the auth-app and not visible to the origin. Provider availability at runtime is reflected in `GET /auth/providers`.

---

## See Also

- edge-sso template README (deployment and configuration of the auth-app and cdn-filter)
- auth-app `.env.example` and cdn-filter `.env.example` (authoritative, exhaustive env var lists with inline guidance)
- edge-sso architecture: auth-modes (SSO_VARIANT axis detail)
- edge-sso architecture: security (token trust model, known limitations including no revocation and no IdP Single Logout)
- edge-sso architecture: overview (two-app deployment model, signing strategy, CANONICAL_HOST)
