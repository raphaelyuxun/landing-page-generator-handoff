#!/usr/bin/env bash
# 上线脚本：先快照"回滚到上一版所需的一切"，再上线；成功后才替换旧回滚包。
# 永远保留恰好一份回滚能力（上一份回滚材料留到下次上线时清理）。
#
#   用法:  scripts/deploy.sh <prod|test>
#   回滚:  scripts/rollback.sh <prod|test> [--with-data] [--with-env]
#
# 安全保证：
#  - data/ 被 .gitignore 忽略且 git 不跟踪 → git pull 物理上碰不到它。
#  - rsync --delete 的范围严格限定 web/dist/，够不到 data/。
#  - 重启时若有在途任务会被开机逻辑标记“已中断（可重新生成）”，不损坏文案/图片/输入。
#  - 上线前完整快照 code+dist+data+.env，任何意外可完全无损回滚。
set -euo pipefail

TARGET="${1:-}"
case "$TARGET" in
  prod) DIR=/opt/easesourcer;      SVC=easesourcer;      PORT=4100 ;;
  test) DIR=/opt/easesourcer-test; SVC=easesourcer-test; PORT=4101 ;;
  *) echo "用法: $0 <prod|test>"; exit 2 ;;
esac
SSH=seo
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "▶ [1/6] 本地构建前端 (web/dist)…"
( cd "$ROOT/web" && npm run build >/dev/null )
echo "  ✓ 构建完成"

echo "▶ [2/6] 远端快照上一版（commit/前端/数据/.env → .rollback-staging）…"
ssh "$SSH" "bash -s" <<REMOTE
set -euo pipefail
cd "$DIR"
STAGE="$DIR/.rollback-staging"
rm -rf "\$STAGE"; mkdir -p "\$STAGE"
git rev-parse HEAD > "\$STAGE/commit.txt"
git log -1 --format='%h %cd %s' --date=short > "\$STAGE/commit.desc" || true
[ -d web/dist ] && tar czf "\$STAGE/web-dist.tgz" web/dist || echo "  (web/dist 不存在，跳过)"
tar czf "\$STAGE/data.tgz" data
[ -f .env ] && cp -p .env "\$STAGE/env.bak" || true
date '+%Y-%m-%d %H:%M:%S %z' > "\$STAGE/at.txt"
echo "  ✓ 快照: \$(cat \$STAGE/commit.desc) | data \$(du -h \$STAGE/data.tgz | cut -f1)"
REMOTE

echo "▶ [3/6] 远端 git pull --ff-only…"
ssh "$SSH" "cd '$DIR' && git pull --ff-only"

echo "▶ [4/6] 同步前端 dist（--delete 仅作用于 web/dist/）…"
rsync -az --delete "$ROOT/web/dist/" "$SSH:$DIR/web/dist/"
echo "  ✓ rsync 完成"

echo "▶ [5/6] 重启 + 健康检查（失败则自动回滚，且不替换旧回滚包）…"
ssh "$SSH" "bash -s" <<REMOTE
set -euo pipefail
cd "$DIR"
STAGE="$DIR/.rollback-staging"
sudo systemctl restart "$SVC"
ok=0; code=000
for i in \$(seq 1 15); do
  code=\$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/health" || echo 000)
  # 200=正常 401=已起但需鉴权（都代表服务存活）
  if [ "\$code" = "200" ] || [ "\$code" = "401" ]; then ok=1; break; fi
  sleep 2
done
if [ "\$ok" != "1" ]; then
  echo "  ✗ 健康检查失败（最后状态码 \$code）→ 自动回滚到上一版"
  git reset --hard "\$(cat \$STAGE/commit.txt)"
  if [ -f "\$STAGE/web-dist.tgz" ]; then rm -rf web/dist && tar xzf "\$STAGE/web-dist.tgz"; fi
  sudo systemctl restart "$SVC"
  echo "  ↩ 已回滚到 \$(cat \$STAGE/commit.desc)（旧回滚包保持不变）"
  exit 1
fi
echo "  ✓ 服务存活（状态码 \$code）"
REMOTE

echo "▶ [6/6] 上线成功 → 用本次快照替换旧回滚包（永远保留一份回滚能力）…"
ssh "$SSH" "cd '$DIR' && rm -rf .rollback && mv .rollback-staging .rollback && echo '  ✓ .rollback 已更新（可回滚到本次上线前的上一版）'"

echo "✅ [$TARGET] 上线完成。如需回滚： scripts/rollback.sh $TARGET"
