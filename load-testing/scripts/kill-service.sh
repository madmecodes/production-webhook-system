#!/bin/bash

# ==============================================================================
# Utility Script: Kill and restart a Docker service after a delay
# ==============================================================================
# Usage: ./kill-service.sh <service-name> <delay-seconds>
# Example: ./kill-service.sh old-api 5

SERVICE_NAME=$1
DELAY_SECONDS=$2

if [ -z "$SERVICE_NAME" ] || [ -z "$DELAY_SECONDS" ]; then
    echo "Usage: $0 <service-name> <delay-seconds>"
    echo "Example: $0 old-api 5"
    exit 1
fi

echo "[CHAOS] Killing service: $SERVICE_NAME"
docker kill "$SERVICE_NAME" 2>/dev/null || true

echo "[CHAOS] Service killed. Waiting ${DELAY_SECONDS}s before restart..."
sleep "$DELAY_SECONDS"

echo "[CHAOS] Restarting service: $SERVICE_NAME"
docker start "$SERVICE_NAME"

echo "[CHAOS] Service restarted."
