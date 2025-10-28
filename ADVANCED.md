# MCP Play - Advanced Local MCP Server

This project demonstrates a Model Context Protocol (MCP) server with filesystem capabilities and Docker support.

## Features

- **FastEdge Application Management**: Create and manage FastEdge applications
- **Workspace Filesystem Access**: Read, write, and list files in the workspace
- **Docker Support**: Run the MCP server in a container for easy distribution

## Local Development

### Prerequisites

- Node.js (v20+)
- npm or yarn
- TypeScript
- Docker and Docker Compose (for containerized deployment)

### Setup

1. Install dependencies:

```bash
npm install
```

2. Build the TypeScript code:

```bash
npm run build
```

3. Run the server in development mode:

```bash
npm run server:dev
```

### Docker Deployment

1. Build the Docker image:

   ```bash
   # Build and push (replace 'yourusername' with your DockerHub username)
   ./build-local.sh [optional-tag]
   ```

2. Run with Docker Compose:

```bash
docker-compose up
```

# FastEdge MCP Server Distribution

## Quick Start (No Repository Clone Required) ⚡

**Manual setup:**

1. Create `.vscode/mcp.json` with the configuration from `STANDALONE-SETUP.md`
2. Set your `FASTEDGE_API_KEY` environment variable
3. Open VS Code - the Docker image will be pulled automatically

See `STANDALONE-SETUP.md` for detailed instructions.

## Full Repository Setup (For Development)

1. **Clone the repository:**

   ```bash
   git clone https://github.com/yourusername/fastedge-mcp-server.git
   cd fastedge-mcp-server

   ```

## For Maintainers (Building and Publishing)

1. **Build and push to DockerHub:**

   ```bash
   # Login to DockerHub first
   docker login

   # Build and push (replace 'yourusername' with your DockerHub username)
   ./build-and-push.sh [optional-tag]
   ```
