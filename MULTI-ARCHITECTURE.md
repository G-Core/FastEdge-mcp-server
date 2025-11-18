# Multi-Architecture Docker Support

## Overview

This project now supports multi-architecture Docker images that can run on:

- **Linux** (amd64, arm64)
- **macOS** (via Docker Desktop)
- **Windows** (via Docker Desktop with WSL2)

## Architecture Support

### Supported Platforms

- `linux/amd64` - Standard x86_64 Linux systems
- `linux/arm64` - ARM64 Linux systems (Apple Silicon, ARM servers)

### Running on Different Platforms

#### Linux

```bash
# Native support - will automatically use the correct architecture
docker run ghcr.io/g-core/fastedge-mcp-server:latest
```

#### macOS (Intel & Apple Silicon)

```bash
# Docker Desktop automatically pulls the correct architecture
# Intel Macs: linux/amd64
# Apple Silicon Macs: linux/arm64
docker run ghcr.io/g-core/fastedge-mcp-server:latest
```

#### Windows

```bash
# Docker Desktop with WSL2 backend
docker run ghcr.io/g-core/fastedge-mcp-server:latest
```

## Building Multi-Architecture Images

### Base Image

The base image is built using the existing workflow:

```bash
# Use the build-docker-base-image.yaml workflow
# Manually triggered via GitHub Actions UI or API
```

### Main Image

The main application image is built using the multi-architecture base:

```bash
# Use the build-push-docker action with platforms: linux/amd64,linux/arm64
```

## Development Notes

### Local Multi-Architecture Building

#### Full Multi-Architecture Build (Requires Network Connectivity)

For environments with proper network connectivity and ARM64 emulation:

```bash
# Set up buildx with docker-container driver (one-time setup)
docker buildx create --name multiarch --driver docker-container --use
docker buildx inspect --bootstrap

# Build base image for multiple architectures
docker buildx build --platform linux/amd64,linux/arm64 -f Dockerfile-base -t fastedge-mcp-server-base:latest --load .

# Build main image for multiple architectures
docker buildx build --platform linux/amd64,linux/arm64 --build-arg BASE_IMAGE=fastedge-mcp-server-base:latest -t fastedge-mcp-server:latest --load .
```

#### Single Architecture Build (Recommended for Local Development)

If you encounter network issues or want faster builds:

```bash
# Use default driver (no special setup required)
docker buildx use default

# Build base image for current platform only
docker build -f Dockerfile-base -t fastedge-mcp-server-base:latest .

# Build main image for current platform
docker build --build-arg BASE_IMAGE=fastedge-mcp-server-base:latest -t fastedge-mcp-server:latest .
```

### Architecture-Specific Considerations

1. **Node.js Binaries**: The Dockerfile-base now automatically detects the target architecture and downloads the appropriate Node.js binary
2. **Rust Compilation**: Rust toolchain supports cross-compilation for both amd64 and arm64
3. **npm Dependencies**: Native dependencies are compiled for the target architecture during the build process

### Limitations

- **Windows Containers**: Not supported due to complexity and requirement for Windows hosts
- **Performance**: ARM64 images may have slightly different performance characteristics
- **Build Time**: Multi-architecture builds take longer due to building for multiple platforms

## Troubleshooting

### Platform-Specific Issues

If you encounter platform-specific issues, you can force a specific architecture:

```bash
# Force amd64 on any platform
docker run --platform linux/amd64 ghcr.io/g-core/fastedge-mcp-server:latest

# Force arm64 on any platform (if available)
docker run --platform linux/arm64 ghcr.io/g-core/fastedge-mcp-server:latest
```

### Build Issues

Common issues and solutions when building multi-architecture images:

#### 1. "Multi-platform build is not supported for the docker driver"

**Problem**: Using the default Docker driver which doesn't support multi-platform builds.

**Solution**:

```bash
# Create and use a docker-container builder
docker buildx create --name multiarch --driver docker-container --use
docker buildx inspect --bootstrap
```

**Alternative**: Use single-platform builds with the default driver:

```bash
docker buildx use default
docker build -f Dockerfile-base -t fastedge-mcp-server-base:latest .
```

#### 2. Network connectivity issues (IPv6)

**Problem**: `dial tcp [IPv6]:443: connect: network is unreachable`

**Solutions**:

```bash
# Option 1: Use default driver (often has better network compatibility)
docker buildx use default
docker build -f Dockerfile-base -t fastedge-mcp-server-base:latest .

# Option 2: Configure Docker daemon to prefer IPv4
# Edit /etc/docker/daemon.json:
# {
#   "ipv6": false,
#   "dns": ["8.8.8.8", "8.8.4.4"]
# }
# Then: sudo systemctl restart docker

# Option 3: Use Docker registry mirrors
# Add --registry-mirror flag or configure in daemon.json
```

#### 3. "No output specified with docker-container driver"

**Problem**: Warning about build results only staying in cache.

**Solution**: Always specify output with `--load` or `--push`:

```bash
# Load into local Docker images
docker buildx build --platform linux/amd64,linux/arm64 -f Dockerfile-base -t fastedge-mcp-server-base:latest --load .

# Push to registry (for CI/CD)
docker buildx build --platform linux/amd64,linux/arm64 -f Dockerfile-base -t fastedge-mcp-server-base:latest --push .
```

#### 4. General troubleshooting

- Check buildx status: `docker buildx ls`
- Verify builder capabilities: `docker buildx inspect`
- Ensure base images support target architectures
- Test single-platform builds first
- Use `--progress=plain` for detailed build output
