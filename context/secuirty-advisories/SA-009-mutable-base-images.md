# SA-009 — Docker base images use mutable tags (not digest-pinned)

**Severity:** Low
**Category:** Reliance on untrusted/mutable resolution (CWE-494 / supply chain)
**Status:** Open
**Affected files:** `Dockerfile-base:1`, `Dockerfile:2`

## Summary

The image supply chain pins the *artifacts fetched inside* the build (Node and
WASI SDK are checksum-verified; pnpm/Rust toolchain versions are fixed), but the
**base images themselves are mutable tags**:

- `Dockerfile-base:1` — `FROM rust:1.95-slim`
- `Dockerfile:2` — `ARG BASE_IMAGE=ghcr.io/g-core/fastedge-mcp-server-base:latest`

Both `rust:1.95-slim` and especially `:latest` are floating tags: the same
`docker build` on two different days can pull different underlying image
contents (base OS packages, libc, CA bundle, etc.). Checksumming Node/WASI does
**not** make the resulting image reproducible or protect against a moved/
republished base tag. `:latest` is the weakest form — it can jump across major
versions entirely.

This corrects an earlier incorrect statement in SA-003 that "the base-image
supply chain is in good shape."

## Impact

- **Reproducibility / supply chain:** a rebuild can silently change the base OS
  layer; a compromised or moved upstream tag is pulled without detection. No
  live exploit against a running instance — hence Low — but it undermines
  build integrity and incident forensics ("what exactly shipped?").

## Remediation

Pin both `FROM`/base references by **digest**, and bump deliberately:

1. Resolve current digests:
   ```bash
   docker pull rust:1.95-slim && docker inspect --format='{{index .RepoDigests 0}}' rust:1.95-slim
   docker pull ghcr.io/g-core/fastedge-mcp-server-base:latest && \
     docker inspect --format='{{index .RepoDigests 0}}' ghcr.io/g-core/fastedge-mcp-server-base:latest
   ```
2. Pin them:
   ```dockerfile
   # Dockerfile-base
   FROM rust:1.95-slim@sha256:<digest>
   ```
   ```dockerfile
   # Dockerfile
   ARG BASE_IMAGE=ghcr.io/g-core/fastedge-mcp-server-base@sha256:<digest>
   ```
   Keep the human-readable version in a comment so bumps stay reviewable.
3. Update the digests intentionally (ideally via a bot/PR) when upgrading the
   base, rather than floating.

## Test / verification

- `grep -n 'FROM .*@sha256:' Dockerfile-base` and the `BASE_IMAGE` default in
  `Dockerfile` both show a digest.
- Image still builds: `docker build` succeeds against the pinned digests.
- Optionally add a CI lint (hadolint `DL3006`, or a grep) that fails on a
  `FROM`/`BASE_IMAGE` without `@sha256:`.

## Related

- SA-003 (npm-tree CVEs — separate concern; this is the OS/base layer).
