# FastEdge MCP Server - Development settings

End-users should follow [STANDALONE-SETUP.md](./STANDALONE-SETUP.md) — prod image against prod endpoints, only `GCORE_API_KEY` required. This file is for in-house development.

---

## In-house dev: prod schemas against preprod endpoints

The 99% in-house workflow: use the published image (prod schemas baked in) but route API calls at **preprod**. Schemas drift rarely, so prod schemas describing preprod endpoints work most of the time.

`.vscode/mcp.json`:

```json
{
  "servers": {
    "fastedge-assistant": {
      "type": "stdio",
      "command": "bash",
      "args": [
        "-c",
        "docker run --rm -i --pull=always -v ${workspaceFolder}:/workspace -e WORKSPACE_ROOT=/workspace -e \"GCORE_API_KEY=$GCORE_API_KEY\" -e \"GCORE_API_BASE=$GCORE_API_BASE\" -e \"BATCH_MAX_CALLS=$BATCH_MAX_CALLS\" ghcr.io/g-core/fastedge-mcp-server:latest"
      ],
      "env": {
        "GCORE_API_KEY": "your_preprod_api_key_here",
        "GCORE_API_BASE": "https://api.preprod.world",
        "BATCH_MAX_CALLS": "5"
      }
    }
  }
}
```

Drop any `env` entry you don't need — unset vars fall through to the server's defaults (`BATCH_MAX_CALLS` → 5, `GCORE_API_BASE` → baked prod URL). The `-e` flags are harmless when the outer var is empty.

### `--pull=always`

Keeps you on the current image (the fastedge-plugin release cycle drives version bumps here). Adds ~1-3s to MCP server startup for the manifest check against ghcr.io.

Offline or slow network? Drop `--pull=always` and manage upgrades manually:

```sh
docker pull ghcr.io/g-core/fastedge-mcp-server:latest
```

### Environment Variables

| Variable                | Required | Default                                      | Purpose                                                                                                                              |
| ----------------------- | -------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `GCORE_API_KEY`         | Yes      | —                                            | API authentication (legacy `FASTEDGE_API_KEY` also accepted)                                                                         |
| `GCORE_API_BASE`        | No       | Baked at build time (prod: `api.gcore.com`)  | Runtime override for the Gcore API base URL. In-house devs set this to `https://api.preprod.world` to hit preprod with prod schemas. |
| `BATCH_MAX_CALLS`       | No       | `5`                                          | Max calls per `batch_execute` invocation. Bump for batches that exceed 5 steps (total runtime still capped at 3 min).                |
| `WORKSPACE_ROOT`        | No       | `/workspace` (Docker) / cwd (local)          | Where the server looks for user files for build/upload operations. Usually left at the Docker default.                               |

## Building and running locally

```sh
pnpm install
pnpm run build
./build-local.sh
```

## Schemas

API schemas are committed to `src/generated/` and regenerated against prod on each plugin release. To regenerate manually:

```sh
SPEC_BASE_URL=https://api.gcore.com pnpm run generate:schemas
```

### Rebuild with preprod schemas (in-house only — edge case)

Only needed if you're actively testing an endpoint whose preprod/prod schema has diverged. For the 99% case, use `GCORE_API_BASE=https://api.preprod.world` above and keep the published image.

```sh
SPEC_BASE_URL=https://api.preprod.world pnpm run generate:schemas
pnpm run build
./build-local.sh        # builds fastedge-mcp-server:local
# point your .vscode/mcp.json image ref at fastedge-mcp-server:local
```

## Tests

```sh
pnpm run test           # runs test:api + test:reference-index
pnpm run test:api       # node:test suite (API handlers, timeouts, batch budget)
```
