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

This shows the direct-Docker `args` shape. The VS Code extension generates the same `args`, but differs in how it stores the key (it prompts for it and writes the value into `env`; `${env:GCORE_API_KEY}` is only used for its Codespaces-secret flow) and it pins a versioned image tag instead of `latest`:

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

- **Claude Desktop, Cursor and most others** use `"mcpServers"` instead of `"servers"`. Cursor keeps `"type": "stdio"`; most others have no `"type"` field.
- **The workspace path** uses the client's own variable syntax (Cursor: `${workspaceFolder}`; elsewhere an absolute path).
- **The key**: drop the `env` block. Cursor passes its host environment through, so Docker's `-e GCORE_API_KEY` forwards it by name, as it does for any client that inherits the environment. A Cursor launched from the Dock/Finder doesn't see shell exports; on macOS set it at the GUI-session level with `launchctl setenv GCORE_API_KEY "your_api_key"` and restart Cursor. Add `-e GCORE_API_BASE` to `args` only if you override the API base.

Claude Code and Codex users should install the [`gcore-fastedge` plugin](https://github.com/G-Core/fastedge-plugin) instead, which configures this server for you.

## Sign In Without an API Key (Portal Session)

Instead of a long-lived `GCORE_API_KEY`, you can approve a **time-limited session** in the Gcore portal. Leave the key out and mount the session volume read-only:

```json
"args": [
    "run", "--rm", "-i", "--pull=always",
    "-v", "${workspaceFolder}:/workspace",
    "-e", "WORKSPACE_ROOT=/workspace",
    "-v", "fastedge-session:/run/fastedge:ro",
    "ghcr.io/g-core/fastedge-mcp-server:latest"
]
```

**Signing in:**

1. The first time an API tool runs, it answers "not connected" with a login command.
2. Your agent asks permission, runs that command and shows you a portal link.
3. Open the link, sign in to the account you want, choose how long the token lasts (4 hours, 8 hours by default, 2 days, or 7 days at most), and click **Approve**.
4. The agent retries. No restart is needed.

The login command looks like this. Run it yourself if you prefer:

```bash
docker run --rm -i -p 127.0.0.1:47215:47215 -v fastedge-session:/run/fastedge \
  -e GCORE_API_BASE=https://api.gcore.com ghcr.io/g-core/fastedge-mcp-server:latest login
```

**Other commands:**

| Command | What it does |
|---|---|
| `… login --use <client_id>` (no `-p` needed) | Switch to another account that's already signed in, without the browser. |
| `… login --logout` | Forget the active account on this computer. The token itself stays valid until it expires; delete it on the portal's **API tokens** page to revoke it now. |
| `docker run -it … login --code` | For Codespaces, SSH or anything else where your browser can't reach this machine's `127.0.0.1`. Choose the manual option on the Approve page, then paste the code into this prompt **in your own terminal**. Never paste it into the agent chat: it contains the token. |

**Good to know:**

- **Switching accounts.** A running MCP server stays on the account it started with. After switching, restart it (Claude Code: `/mcp`, then reconnect).
- **Checking your account.** The `fastedge-auth-status` tool shows which account you're on and when the session expires. It never shows the token.
- **An explicit key always wins.** If `GCORE_API_KEY` is set, the session is not used.
- **Root required.** Session mode needs the container's default root start, so don't add `--user`. It drops to an unprivileged user itself.
- **Reserved id.** uid/gid `10002` is reserved for the token broker, so don't use it as `HOST_UID`/`HOST_GID`.

### What's protected, and what isn't

The session token sits in the `fastedge-session` Docker volume. Inside the container, only a small **token broker** process can read it: it runs under its own user with every privilege dropped. The MCP server, and everything `build-wasm` runs (Cargo `build.rs` scripts, procedural macros, npm scripts), run as a different user and reach the API only through the broker.

The broker:
- sends only the API operations this server allows;
- never returns the token;
- accepts one connection, from the MCP server at startup, so build code started later has nothing to connect to.

**Protected:**
- A malicious build dependency can't read the token from the cache, the broker's memory or its environment.
- It can't connect to the broker either.

**Not protected:**
- **Anything that can run Docker on your machine, or root.** This includes malware running as your user on Docker Desktop or rootless Docker, and members of the `docker` group on Linux. Such code can mount the volume and read the token, just as it could read an API key from your shell profile or another CLI's config file. Short lifetimes limit the damage; prefer 4 or 8 hours.
- **Hosts where any process can trace any other** (Linux `kernel.yama.ptrace_scope=0`). There, build code could take over the MCP server's own connection and make the API calls the server is allowed to make, but it still can't read the token. The default on most distributions is `1`.
- **MCP configurations you didn't write.** A config can add mounts, environment variables or a different image. Only use MCP configurations you control: be wary of a `.vscode/mcp.json` or similar that arrives inside a cloned repository.
- **Your disk.** Without disk encryption, the volume is readable from a stolen disk or a backup until the token expires.

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
- A FastEdge API key, or a Gcore portal sign-in (see above)

That's it! No need to clone the repository or manage dependencies locally.
