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
            "command": "docker",
            "args": [
                "run",
                "--rm",
                "-i",
                "--pull=always",
                "-v",
                "${workspaceFolder}:/workspace",
                "-e",
                "WORKSPACE_ROOT=/workspace",
                "-e",
                "GCORE_API_KEY",
                "ghcr.io/g-core/fastedge-mcp-server:latest"
            ],
            "env": {
                "GCORE_API_KEY": "${env:GCORE_API_KEY}"
            }
        }
    }
}
```

This is the same configuration the VS Code extension generates:

- `docker` is called directly (no `bash -c` wrapper), so it works unchanged on Linux, macOS and Windows.
- `-e GCORE_API_KEY` with no value makes Docker forward the variable from the environment the client starts it with. The `env` block reads it from your own environment, so the key is never written into a file you might commit.

### Step 2: Provide your API key

Set `GCORE_API_KEY` in the environment you start VS Code from, then start VS Code from that shell:

```bash
export GCORE_API_KEY="your_api_key"
code .
```

Create a key in the Gcore Customer Portal under **API tokens**.

### Step 3: Start VS Code

1. Open VS Code in your workspace
2. The MCP server will automatically pull the Docker image and start
3. No repository cloning required!

## Other MCP Clients

The `args` array is the same for every client. What differs is the surrounding shape and how variables are written:

- **Claude Desktop, Cursor and most others** use `"mcpServers"` instead of `"servers"`, and have no `"type"` field.
- **The workspace path** uses the client's own variable syntax (Cursor: `${workspaceFolder}`; elsewhere an absolute path).
- **The key** comes from the client's own variable syntax (Cursor: `${env:GCORE_API_KEY}`). For a client that has none, drop the `env` block: Docker then forwards `GCORE_API_KEY` from the environment the client was started in.

Claude Code and Codex users should install the [`gcore-fastedge` plugin](https://github.com/G-Core/fastedge-plugin) instead, which configures this server for you.

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
  -e WORKSPACE_ROOT=/workspace \
  -e GCORE_API_KEY \
  ghcr.io/g-core/fastedge-mcp-server:latest
```

## Permissions

The container entrypoint automatically detects the owner of the `/workspace` mount and drops privileges to that UID/GID, so generated files are not root-owned. When the mount appears as root-owned (for example on Docker Desktop, where mounts are virtualized), it falls back to UID/GID 10001 rather than running as root.

If builds fail with "Permission denied", or generated files end up with the wrong owner, add `"-e", "HOST_UID=<uid>", "-e", "HOST_GID=<gid>"` to `args` (on Linux/macOS, `id -u` and `id -g` print them). In a shell, that is `-e HOST_UID=$(id -u) -e HOST_GID=$(id -g)`.

## Requirements

- Docker installed and running
- VS Code with MCP extension
- FastEdge API key

That's it! No need to clone the repository or manage dependencies locally.
