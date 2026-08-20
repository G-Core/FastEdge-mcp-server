<!--
  auto-updated: true
  sources:
    - id: fastedge-templates
      ref: main
      commit: 87b7dc143db5e74cf0e7eb52f67484f6abc51c43
      updated: 2026-08-20
-->

# edge-totp — Origin Integration

Reference for wiring the TOTP second-factor step into an origin's existing password login. The `edge-totp` template (otp-app + otp-filter) is already deployed on the Gcore portal; this document covers the three origin-side code changes required to connect it.

---

## The Three Origin-Side Changes

Only the origin's auth module changes. The rest of the site is untouched.

### 1. Split login into password-then-OTP

After the password check succeeds, instead of immediately minting the full origin session:

1. Sign a **handoff ticket** = `HMAC(HANDOFF_KEY)` over `{ sub: userId, next, exp: now + TICKET_TTL }`.
2. Set a short-lived **`pre_mfa`** cookie or marker so the origin remembers the password step passed (bind it to `sub`).
3. Issue a `303` redirect to `{AUTH_PREFIX}/challenge?t=<ticket>` (totp-app, same host via the CDN path rule).

**Ticket constraints:**
- `sub` — the user identifier
- `next` — the URL to return to after MFA
- `exp` — absolute expiry (`now + TICKET_TTL`); totp-app independently requires this field and caps absolute age
- Signed with `HANDOFF_KEY` (HS256, shared between origin and edge)

### 2. Finish login on return — choose a profile

When the user returns to `next` after the TOTP step, the origin finishes minting its session. Pick one profile:

**Profile A (default — zero origin crypto):**
- The Rust filter has already enforced `mfa_session` on protected paths before the request reaches the origin.
- The origin re-identifies its `pre_mfa` user and mints its own session — no proof verification, no crypto on the origin side.
- `HANDOFF_KEY` is the only key the origin holds.

**Profile B (opt-in — longer sessions, signed proof):**
- The edge delivers a one-time **ES256** proof as a short-lived cookie (`MFA_PROOF_COOKIE`). The proof is never in a URL.
- The origin verifies the proof via totp-app's JWKS endpoint (`{AUTH_PREFIX}/.well-known/jwks.json`) using `createRemoteJWKSet` (public key only — the origin cannot forge proofs).
- The origin checks that the proof's `sub` matches `pre_mfa`.
- **Required:** the origin must also verify the proof's `aud` claim against `MFA_AUDIENCE`. Verifying the signature alone without checking `aud` accepts a proof that was never meant for this deployment — this is a required check, not optional.
- After verification, the origin mints its own revocable session with whatever lifetime it needs (safely longer than the 8h edge session).

### 3. Enroll users

No new origin endpoint is required. Two paths:

- **Admin provisioning:** `POST {AUTH_PREFIX}/enroll` (gated by `ENROLL_API_KEY`). totp-app writes the seed to KV using `GCORE_API_TOKEN`. Call with `force: true` to re-provision a lost authenticator behind your own identity check.
- **Self-service:** Users can self-enroll on first login via `{AUTH_PREFIX}/activate`. Enabled by default (`ALLOW_SELF_ENROLLMENT=true`). Set `ALLOW_SELF_ENROLLMENT=false` to require admin provisioning; `/activate` returns 403 and `/challenge` refuses unenrolled users.

---

## Profile A vs Profile B — Decision Guide

This is a security-posture decision. A wrong choice here is a real vulnerability, not a style issue.

| Criterion | Profile A | Profile B |
| --- | --- | --- |
| Origin crypto required | None — `HANDOFF_KEY` only | ES256 proof verification via JWKS |
| Origin knows *which* user passed MFA | No — the filter only verifies that *a* valid `mfa_session` exists | Yes — the ES256 proof carries `sub`; origin verifies and binds it to `pre_mfa` |
| Session lifetime | Edge-bounded (8h, non-sliding) | Origin mints its own session at whatever lifetime it needs |
| Origin-lockdown dependency | Hard requirement — Profile A collapses entirely if the origin is directly reachable | More robust — origin independently verifies the signed proof rather than trusting the request came through the gate |

**Do not add an unsigned forwarded-identity header for the origin to trust under Profile A.** Forwarded-identity headers (`x-mfa-user` or similar) are a recurring source of auth-bypass CVEs (e.g. oauth2-proxy header smuggling). The Rust filter deliberately does not forward the user id to the origin because the origin already authenticated the password and re-identifies its `pre_mfa` user when minting its session. If you need the edge to assert *which* user passed MFA, use Profile B: the ES256 proof carries `sub`, the origin verifies it via JWKS, and the proof is signed rather than a bare header. This is the same signed-assertion pattern Cloudflare Access uses (`Cf-Access-Jwt-Assertion`).

**Profile B `aud` check is mandatory.** After verifying the ES256 signature via JWKS, also assert that the proof's `aud` claim equals `MFA_AUDIENCE`. The edge embeds `MFA_AUDIENCE` as `aud` in both `mfa_session` and the Profile-B proof. `MFA_AUDIENCE` should be the CDN hostname (e.g. `https://app.example.com`). A proof signed by this deployment's private key but addressed to a different audience must be rejected.

**Prefer Profile B when the origin cannot be fully locked to edge-only traffic.** Profile B independently verifies a signed assertion at the origin; Profile A relies entirely on the filter gate having run.

---

## Shared Configuration

Keys and endpoints shared between the origin and the edge. Both components must agree on these values.

| Key / Endpoint | Origin | Edge |
| --- | --- | --- |
| `HANDOFF_KEY` (HS256) | Signs the handoff ticket on password success | Verifies the ticket on `{AUTH_PREFIX}/challenge` and `{AUTH_PREFIX}/verify` |
| **JWKS** endpoint (Profile B only) | Fetches `{AUTH_PREFIX}/.well-known/jwks.json` via `createRemoteJWKSet` (public key only — cannot forge proofs) | Signs the one-time ES256 proof with `MFA_PROOF_SIGNING_KEY` (private key, edge-internal); serves the JWKS endpoint |
| `MFA_AUDIENCE` | **Must** enforce as the `aud` claim on the Profile-B proof (required check after signature verification) | Embedded as `aud` in both `mfa_session` and the Profile-B proof; the Rust filter enforces it on `mfa_session` (Profile A); fail-closes without it |

**Profile A shares only `HANDOFF_KEY`.** The origin holds no verification key for `mfa_session`; that is edge-internal (signed with `MFA_SESSION_KEY`, verified by the Rust filter). No symmetric secret crosses to the origin on the proof path under Profile B — only the JWKS public-key fetch.

Both components must live on the **same CDN host** (CDN path rule `{AUTH_PREFIX}/*` → totp-app). The `mfa_session` cookie is first-party and host-only. Same-host is required: the proof and session are consumed at the edge into a host-only cookie, so there is no cross-host URL-token path.

---

## Required Deployment Precondition

**Lock the origin to edge-only traffic.** This is a hard requirement for both profiles, not a suggestion.

Any edge gate — Profile A or B — is meaningless if the origin is directly reachable. If the origin's IP or hostname is accessible without going through the Gcore CDN, an attacker simply skips the CDN entirely; `mfa_session`, the Rust filter, and the signed proof never run. Restrict the origin to Gcore CDN ingress using an IP allowlist, origin authentication, or a tunnel.

Profile B is more robust in environments where the origin cannot be fully locked down (the origin independently verifies the signed proof rather than trusting that the request arrived through the gate), but it does not eliminate this requirement — locking the origin is still necessary.

---

## Recovery and Self-Service Enrollment Caveat

Self-service enrollment (`{AUTH_PREFIX}/activate`) inherits the trust level of the password step — a user who can pass the password check can self-enroll a new authenticator. This is the correct default for most deployments, but for sensitive accounts this means a compromised password also compromises the TOTP second factor.

**Decision point for sensitive accounts:** If your threat model requires that the second factor remain independent of the password (e.g. privileged users, admin accounts), disable self-service enrollment (`ALLOW_SELF_ENROLLMENT=false`) and require admin provisioning via `POST {AUTH_PREFIX}/enroll` (gated by `ENROLL_API_KEY`, behind your own identity check). Recovery for a lost authenticator also goes through `POST {AUTH_PREFIX}/enroll` with `force: true`.

See the edge-totp threat model reference (threat-model.md, risk R5) before relying on self-service enrollment for sensitive accounts.

---

## See Also

- edge-totp storage and secrets reference (storage-and-secrets.md) — full env var and secret list for both otp-app and otp-filter
- edge-totp threat model reference (threat-model.md) — trust boundaries, residual risks, and risk register including R4 (KV token scope) and R5 (self-enrollment trust level)
- edge-totp architecture flow reference (flow.md) — why the seed is fetched at verify time and PoP replication behavior
- FastEdge KV store reference — `fastedge::kv` SDK binding and `storeRefs`/`kvStoreVars` deploy-time linking
- FastEdge secrets reference — `getSecret` API and dotenv sync workflow
