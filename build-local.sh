#!/bin/bash

# Build and push script for maintainers
# Usage: ./build-and-push.sh [tag]

# Set default tag if not provided
TAG=${1:-latest}
# IMAGE_NAME="ghcr.io/g-core/fastedge-mcp-server"  # Replace with your DockerHub username
IMAGE_NAME="viridiscomms/fastedge-mcp-server"  # Replace with your DockerHub username

echo "Building Docker image: $IMAGE_NAME:$TAG"

# Build the image
docker build -t "$IMAGE_NAME:$TAG" .

if [ $? -eq 0 ]; then
    echo "Build successful!"
else
    echo "Build failed"
    exit 1
fi
