#!/usr/bin/env bash
# 备份运行中的数据（SQLite 数据库 + 截图），在服务器上、compose 文件所在目录执行。
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE_FILE="${COMPOSE_FILE:-compose.ghcr.yaml}"
mkdir -p backups
name="runclub-$(date +%Y%m%d-%H%M%S).tar.gz"
docker compose -f "$COMPOSE_FILE" exec -T app tar czf - -C /data . > "backups/$name"
echo "已备份：backups/$name ($(du -h "backups/$name" | cut -f1))"
echo "恢复命令：cat backups/$name | docker compose -f $COMPOSE_FILE exec -T app tar xzf - -C /data"
