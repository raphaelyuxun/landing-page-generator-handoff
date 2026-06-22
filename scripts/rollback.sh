#!/usr/bin/env bash
# 回滚脚本：恢复到“上一次上线前”的版本。回滚不消耗回滚包（仍保留，直到下次上线才清理）。
#
#   用法:  scripts/rollback.sh <prod|test> [--with-data] [--with-env]
#
# 默认只回滚【代码 + 前端】并重启——这是对线上业务数据无损的回滚（保留上线后新产生的任务）。
#   --with-env   额外恢复 .env（用于上线时改过 .env 的情况）
#   --with-data  额外恢复 data/  ⚠ 会丢弃“上线快照之后”产生/变更的任务，仅在确认数据被损坏时使用
set -euo pipefail

TARGET="${1:-}"; shift || true
WITH_DATA=0; WITH_ENV=0
for a in "$@"; do
  case "$a" in
    --with-data) WITH_DATA=1 ;;
    --with-env)  WITH_ENV=1 ;;
    *) echo "未知参数: $a"; exit 2 ;;
  esac
done
case "$TARGET" in
  prod) DIR=/opt/easesourcer;      SVC=easesourcer;      PORT=4100 ;;
  test) DIR=/opt/easesourcer-test; SVC=easesourcer-test; PORT=4101 ;;
  *) echo "用法: $0 <prod|test> [--with-data] [--with-env]"; exit 2 ;;
esac
SSH=seo

ssh "$SSH" "bash -s" <<REMOTE
set -euo pipefail
cd "$DIR"
RB="$DIR/.rollback"
[ -d "\$RB" ] || { echo "✗ 没有可用回滚包（\$RB 不存在）。可能从未用 deploy.sh 上过线。"; exit 1; }
echo "↩ 回滚到: \$(cat \$RB/commit.desc 2>/dev/null)  （快照于 \$(cat \$RB/at.txt 2>/dev/null)）"
git reset --hard "\$(cat \$RB/commit.txt)"
if [ -f "\$RB/web-dist.tgz" ]; then rm -rf web/dist && tar xzf "\$RB/web-dist.tgz"; echo "  ✓ 已恢复 web/dist"; fi
if [ "$WITH_ENV" = "1" ]; then cp -p "\$RB/env.bak" .env && echo "  ✓ 已恢复 .env"; fi
if [ "$WITH_DATA" = "1" ]; then
  echo "  ⚠ 恢复 data/（丢弃快照之后的任务变更）…"
  rm -rf data && tar xzf "\$RB/data.tgz" && echo "  ✓ 已恢复 data/"
fi
sudo systemctl restart "$SVC"
ok=0; code=000
for i in \$(seq 1 15); do
  code=\$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/health" || echo 000)
  if [ "\$code" = "200" ] || [ "\$code" = "401" ]; then ok=1; break; fi
  sleep 2
done
if [ "\$ok" = "1" ]; then echo "✅ [$TARGET] 回滚完成，服务存活（\$code）。回滚包保留，下次上线时再清理。";
else echo "✗ 回滚后健康检查失败（\$code），请人工介入"; exit 1; fi
REMOTE
