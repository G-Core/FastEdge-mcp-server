# Build stage
FROM viridiscomms/fastedge-base:latest AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM viridiscomms/fastedge-base:latest

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
