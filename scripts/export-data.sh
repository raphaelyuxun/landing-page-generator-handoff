#!/usr/bin/env bash
# 在【旧线上主机】导出数据用于交接迁移（只导线上 data，不含测试环境）。
#   scripts/export-data.sh [--only-campaign] [data目录] [输出tgz]
#     --only-campaign  只导带 campaignId 的【真实云工厂任务】，排除无 campaignId 的手建/测试早期任务
#   典型（切换时在 /opt/easesourcer 下执行）：
#     scripts/export-data.sh --only-campaign        # → es-data.tgz，只含真实生产数据
# 交付研发后：scripts/load-data.sh es-data.tgz <旧域名base> <新域名base>
set -euo pipefail
ONLY_CAMPAIGN=0; args=()
for a in "$@"; do case "$a" in --only-campaign) ONLY_CAMPAIGN=1 ;; *) args+=("$a") ;; esac; done
DATA="${args[0]:-./data}"; OUT="${args[1]:-es-data.tgz}"
[ -d "$DATA" ] || { echo "找不到数据目录: $DATA（请在项目根执行，或传入 data 路径）"; exit 2; }

if [ "$ONLY_CAMPAIGN" = "1" ]; then
  TMP="$(mktemp -d)"; STAGE="$TMP/data"; mkdir -p "$STAGE/projects" "$STAGE/assets"
  n=0
  for f in "$DATA"/projects/*.json; do
    [ -e "$f" ] || continue
    code=$(node -e "const p=require(require('path').resolve(process.argv[1]));if(p.campaignId)console.log(p.code||'')" "$f" 2>/dev/null)
    [ -n "$code" ] || continue
    cp "$f" "$STAGE/projects/"
    [ -d "$DATA/assets/$code" ] && cp -r "$DATA/assets/$code" "$STAGE/assets/"
    n=$((n+1))
  done
  tar czf "$OUT" -C "$TMP" data
  rm -rf "$TMP"
  echo "✓ 导出 $OUT ($(du -h "$OUT" | cut -f1))，只含带 campaignId 的真实任务 $n 个（已排除手建/测试）。"
else
  tar czf "$OUT" -C "$(dirname "$DATA")" "$(basename "$DATA")"
  N=$(ls "$DATA/projects" 2>/dev/null | grep -c '\.json$' || echo 0)
  echo "✓ 导出 $OUT ($(du -h "$OUT" | cut -f1))，全量 $N 个任务。"
fi
echo "  交付研发后：scripts/load-data.sh $OUT <旧域名base> <新域名base>"
