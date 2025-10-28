#!/bin/bash

# Build and push script for maintainers
# Usage: ./build-and-push-base.sh [tag]

# Set default tag if not provided
TAG=${1:-latest}
IMAGE_NAME="viridiscomms/fastedge-base"

echo "Building Docker image: $IMAGE_NAME:$TAG"

# Build the image
docker build -f Dockerfile-base -t "$IMAGE_NAME:$TAG" .

if [ $? -eq 0 ]; then
    echo "Build successful! Pushing to DockerHub..."

    # Push to DockerHub
    docker push "$IMAGE_NAME:$TAG"

    if [ $? -eq 0 ]; then
        echo "Successfully pushed $IMAGE_NAME:$TAG to DockerHub"
        echo "Users can now pull this image with: docker pull $IMAGE_NAME:$TAG"
    else
        echo "Failed to push to DockerHub"
        exit 1
    fi
else
    echo "Build failed"
    exit 1
fi
