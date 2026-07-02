#!/usr/bin/env bash
# 把旧线上导出的 data.tgz 灌进 compose 命名卷；可选把任务里存的图片URL从旧域名改写成新域名。
#   scripts/load-data.sh <es-data.tgz> [OLD_PUBLIC_BASE] [NEW_PUBLIC_BASE]
# 例:
#   scripts/load-data.sh es-data.tgz \
#       https://easesourcer.omni-marketeer.com  https://lp.yourcorp.com
# 说明:
#   - 资源文件(banner/产品图)随卷一起迁入；但任务 JSON 里存的是【绝对】旧域名 URL。
#     传入 OLD/NEW 两个 base 即可把它们批量改写成新域名，迁移后图片直接可见。
#   - 旧线上导出：cd /opt/easesourcer && tar czf ~/es-data.tgz -C . data
set -euo pipefail
TGZ="${1:-}"; OLD_BASE="${2:-}"; NEW_BASE="${3:-}"
[ -f "$TGZ" ] || { echo "用法: $0 <es-data.tgz> [OLD_PUBLIC_BASE] [NEW_PUBLIC_BASE]"; exit 2; }

PROJECT="$(basename "$(pwd)")"
VOL="${PROJECT}_es-data"           # compose 卷名 = <项目目录名>_es-data
docker volume inspect "$VOL" >/dev/null 2>&1 || docker volume create "$VOL" >/dev/null
ABS_DIR="$(cd "$(dirname "$TGZ")" && pwd)"; BN="$(basename "$TGZ")"

echo "→ 解包 $BN 到卷 $VOL（tgz 内为 data/，铺到卷根）..."
docker run --rm -v "$VOL":/vol -v "$ABS_DIR":/backup alpine \
  sh -c "rm -rf /vol/* 2>/dev/null || true; tar xzf /backup/$BN -C /vol --strip-components=1"

if [ -n "$OLD_BASE" ] && [ -n "$NEW_BASE" ]; then
  echo "→ 改写图片URL域名: $OLD_BASE → $NEW_BASE"
  docker run --rm -e OLD="$OLD_BASE" -e NEW="$NEW_BASE" -v "$VOL":/vol alpine \
    sh -c 'find /vol/projects -name "*.json" -type f -exec sed -i "s#${OLD}#${NEW}#g" {} +'
  echo "  ✓ 已改写(含 content.banner / products[].images / assetsVersion 等绝对URL)"
fi

echo "✓ 完成。重启生效：docker compose restart app"
