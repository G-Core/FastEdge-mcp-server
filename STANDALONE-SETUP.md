# FastEdge MCP Server - Standalone Setup

## Quick Start (No Repository Clone Required)

You can run the FastEdge MCP Server with just Docker and a single configuration file.

### Step 1: Create MCP Configuration

Create a file called `.vscode/mcp.json` in your workspace with the following content:

```json
{
  "servers": {
    "fastedge-assistant": {
      "type": "stdio",
      "command": "bash",
      "args": [
        "-c",
        "docker run --user $(id -u):$(id -g) --rm -i -v \"$WORKSPACE_ROOT:/workspace\" -e \"WORKSPACE_ROOT=/workspace\" -e \"FASTEDGE_API_KEY=$FASTEDGE_API_KEY\" -e \"FASTEDGE_API_URL=$FASTEDGE_API_URL\" ghcr.io/g-core/fastedge-mcp-server:latest"
      ],
      "env": {
        "WORKSPACE_ROOT": "${workspaceFolder}",
        "FASTEDGE_API_KEY": "your_api_key_here",
        "FASTEDGE_API_URL": "https://api.preprod.world" # Optional
      }
    }
  }
}
```

### Step 2: Start VS Code

1. Open VS Code in your workspace
2. The MCP server will automatically pull the Docker image and start
3. No repository cloning required!

## What This Does

- Pulls `ghcr.io/g-core/fastedge-mcp-server:latest` from GitHub Container Registry
- Mounts your current workspace as `/workspace` in the container
- Runs the MCP server with stdio transport
- Automatically handles file permissions with your user ID

## Manual Testing

You can test the Docker image manually:

```bash
docker run --rm -i \
  -v "$(pwd):/workspace" \
  -e "WORKSPACE_ROOT=/workspace" \
  -e "FASTEDGE_API_KEY=your_api_key" \
  ghcr.io/g-core/fastedge-mcp-server:latest
```

## Requirements

- Docker installed and running
- VS Code with MCP extension
- FastEdge API key

That's it! No need to clone the repository or manage dependencies locally.
