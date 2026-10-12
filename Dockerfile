# Base image built from Dockerfile-base and published to GHCR.
# Update both the tag and the digest together when publishing a new base image.
# apt/rustup runs inside the pinned base build — accepted.
ARG BASE_IMAGE=ghcr.io/g-core/fastedge-mcp-server-base:0.2.9@sha256:18c20628f204f70785fa7bd709d9181676400692d38e1e337bd70cf8ab58a58a

# Build stage
FROM ${BASE_IMAGE} AS builder

WORKDIR /app

# Install dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build MCP server
RUN npm run build:server

# Production stage
FROM ${BASE_IMAGE}

WORKDIR /app

# Install dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Copy build output and reference docs
COPY --from=builder /app/build ./build
COPY --from=builder /app/reference-docs ./reference-docs

# Session-login cache mount point. A new named volume copies this directory's owner and mode.
# Broker-only (uid/gid 10002, 0700): build code running as the MCP server's uid must not be able
# to read cached tokens. The login container runs as 10002; the token broker reads it.
RUN mkdir -p /run/fastedge && chown 10002:10002 /run/fastedge && chmod 0700 /run/fastedge

# Default to workspace in volumey
ENV WORKSPACE_ROOT=/workspace

# Set up a volume mount point for workspace data
VOLUME [ "/workspace" ]

# Entrypoint resolves the target UID/GID from the /workspace mount owner, then
# drops privileges via setpriv so generated files are owned by that user. When
# the mount is missing, root-owned, or Docker Desktop-virtualized (uid 0 inside
# the container), it falls back to uid/gid 10001 instead of running as root.
# Override with -e HOST_UID=$(id -u) -e HOST_GID=$(id -g) on docker run when
# automatic detection does not produce the right owner.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# Start MCP server
CMD ["node", "build/server.js"]

