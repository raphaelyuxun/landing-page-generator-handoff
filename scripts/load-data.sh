#!/usr/bin/env bash
# 把线上导出的 data.tgz 灌进 compose 的命名卷 es-data（迁移历史任务/素材）。
#   用法: scripts/load-data.sh <path/to/es-data.tgz>
# 线上导出：ssh seo "tar czf ~/es-data.tgz -C /opt/easesourcer data" 然后下载该文件。
set -euo pipefail
TGZ="${1:-}"
[ -f "$TGZ" ] || { echo "用法: $0 <es-data.tgz>"; exit 2; }

# compose 项目名决定卷全名（默认取当前目录名）；卷名 = <project>_es-data
PROJECT="$(basename "$(pwd)")"
VOL="${PROJECT}_es-data"

# 确保卷存在（compose 起过一次即有；否则先建）
docker volume inspect "$VOL" >/dev/null 2>&1 || docker volume create "$VOL" >/dev/null

echo "→ 解包 $TGZ 到卷 $VOL ..."
# tgz 内是 data/ 目录；解到卷根后卷内为 data/…，与容器挂载点 /app/data 对应：
#   这里把 data/ 的内容直接铺到卷根（--strip-components=1）
docker run --rm -v "$VOL":/vol -v "$(cd "$(dirname "$TGZ")" && pwd)":/backup alpine \
  sh -c "rm -rf /vol/* 2>/dev/null; tar xzf /backup/$(basename "$TGZ") -C /vol --strip-components=1"

echo "✓ 数据已灌入卷 $VOL。重启 app 生效：docker compose restart app"
