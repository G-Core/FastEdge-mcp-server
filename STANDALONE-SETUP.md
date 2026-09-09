# FastEdge MCP Server - Standalone Setup

## Quick Start (No Repository Clone Required)

You can run the FastEdge MCP Server with just Docker and a single configuration file.

If you have the FastEdge VSCode Extension installed, use: `Ctrl + Shift + P` & `FastEdge (Generate mcp.json)`

Otherwise follow on:

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
        "docker run --rm -i --pull=always -v ${workspaceFolder}:/workspace -e WORKSPACE_ROOT=/workspace -e HOST_UID=$(id -u) -e HOST_GID=$(id -g) -e \"GCORE_API_KEY=$GCORE_API_KEY\" ghcr.io/g-core/fastedge-mcp-server:latest"
      ],
      "env": {
        "GCORE_API_KEY": "your_api_key_here"
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
docker run --rm -i --pull=always \
  -v "$(pwd):/workspace" \
  -e "WORKSPACE_ROOT=/workspace" \
  -e HOST_UID=$(id -u) -e HOST_GID=$(id -g) \
  -e "GCORE_API_KEY=your_api_key" \
  ghcr.io/g-core/fastedge-mcp-server:latest
```

## Permissions

The container entrypoint automatically detects the owner of the `/workspace` mount and drops privileges to that UID/GID so generated files are not root-owned. If builds fail with "Permission denied", pass `-e HOST_UID=$(id -u) -e HOST_GID=$(id -g)` to `docker run` (both `docker run` examples above already include these flags).

## Requirements

- Docker installed and running
- VS Code with MCP extension
- FastEdge API key

That's it! No need to clone the repository or manage dependencies locally.
