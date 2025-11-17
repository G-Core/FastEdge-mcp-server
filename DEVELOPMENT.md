# FastEdge MCP Server - Development settings

## Using a different environment

Edit your `.vscode/mcp.json` in your workspace with the following FASTEDGE_API_URL:

```json
{
  "servers": {
    "fastedge-assistant": {
      "type": "stdio",
      "command": "bash",
      "args": [
        "-c",
        "docker run --rm -i -v ${workspaceFolder}:/workspace -e WORKSPACE_ROOT=/workspace -e \"FASTEDGE_API_KEY=$FASTEDGE_API_KEY\" -e \"FASTEDGE_API_URL=$FASTEDGE_API_URL\" ghcr.io/g-core/fastedge-mcp-server:latest"
      ],
      "env": {
        "FASTEDGE_API_KEY": "your_api_key_here",
        "FASTEDGE_API_URL": "https://api.preprod.world" # Optional environment setting
      }
    }
  }
}
```
