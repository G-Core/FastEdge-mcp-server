# Build argument for base image
ARG BASE_IMAGE=ghcr.io/g-core/fastedge-mcp-server-base:latest

# Build stage
FROM ${BASE_IMAGE} AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source code
COPY . .

# Build MCP server
RUN npm run build:server

# Production stage
FROM ${BASE_IMAGE}

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy only the build output
COPY --from=builder /app/build ./build

# Create required directories
# RUN mkdir -p /workspace/apps

# Default to workspace in volumey
ENV WORKSPACE_ROOT=/workspace

# Set up a volume mount point for workspace data
VOLUME [ "/workspace" ]

# Start MCP server - use node directly for standalone execution
CMD ["node", "build/server.js"]
