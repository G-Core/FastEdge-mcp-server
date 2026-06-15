# Build argument for base image
ARG BASE_IMAGE=ghcr.io/g-core/fastedge-mcp-server-base:latest

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

# Default to workspace in volumey
ENV WORKSPACE_ROOT=/workspace

# Set up a volume mount point for workspace data
VOLUME [ "/workspace" ]

# Entrypoint drops privileges to the host user (owner of the /workspace mount,
# or HOST_UID/HOST_GID if set) so generated files are not root-owned. Falls
# back to running as root when the resolved UID is 0 (e.g. no mount or root-owned mount).
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# Start MCP server
CMD ["node", "build/server.js"]

