#!/usr/bin/env bash
# 服务器上一键更新到最新镜像。
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE_FILE="${COMPOSE_FILE:-compose.ghcr.yaml}"
docker compose -f "$COMPOSE_FILE" pull app
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
docker image prune -f
docker compose -f "$COMPOSE_FILE" ps
curl -fsS http://127.0.0.1:3000/api/health && echo
