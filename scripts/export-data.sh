#!/usr/bin/env bash
# 在【旧线上主机】导出全量数据用于交接迁移（只导线上 data，不含测试环境）。
#   用法: scripts/export-data.sh [data目录] [输出tgz]
#   典型: 在 /opt/easesourcer 下执行 → 得到 es-data.tgz，交付给研发。
set -euo pipefail
DATA="${1:-./data}"; OUT="${2:-es-data.tgz}"
[ -d "$DATA" ] || { echo "找不到数据目录: $DATA（请在项目根执行，或传入 data 路径）"; exit 2; }
tar czf "$OUT" -C "$(dirname "$DATA")" "$(basename "$DATA")"
N=$(ls "$DATA/projects" 2>/dev/null | grep -c '\.json$' || echo 0)
echo "✓ 导出 $OUT ($(du -h "$OUT" | cut -f1))，含 $N 个任务。"
echo "  交付给研发后：scripts/load-data.sh $OUT <旧域名base> <新域名base>"
