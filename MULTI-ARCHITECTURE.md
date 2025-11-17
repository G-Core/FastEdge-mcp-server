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

To build multi-architecture images locally:

```bash
# Set up buildx (one-time setup)
docker buildx create --name multiarch --use

# Build base image for multiple architectures
docker buildx build --platform linux/amd64,linux/arm64 -f Dockerfile-base -t fastedge-mcp-server-base:latest .

# Build main image for multiple architectures
docker buildx build --platform linux/amd64,linux/arm64 --build-arg BASE_IMAGE=fastedge-mcp-server-base:latest -t fastedge-mcp-server:latest .
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

If multi-architecture builds fail:

1. Ensure Docker Buildx is properly set up
2. Check that the base image supports the target architectures
3. Verify all dependencies have cross-platform support
