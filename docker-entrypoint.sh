#!/bin/sh
# 单容器自洽启动：若配了 XRAY_* 则内置起 Xray（本地 HTTP 代理），并自动把
# NANO_BANANA_PROXY 指向它；然后前台跑 app。图片(Nano Banana/Google)走代理，
# AIGW/文本直连。若不配 XRAY_SERVER，则跳过代理（部署机能直连 Google 时）。
set -e
: "${XRAY_HTTP_PORT:=10809}"
: "${XRAY_SOCKS_PORT:=10808}"
: "${XRAY_TRANSPORT:=tcp}"
: "${XRAY_FLOW:=}"
: "${XRAY_SPX:=/}"

if [ -n "$XRAY_SERVER" ] && [ -n "$XRAY_UUID" ]; then
  CFG=/tmp/xray-config.json
  cat > "$CFG" <<EOF
{
  "log": { "loglevel": "warning" },
  "inbounds": [
    { "tag": "http",  "listen": "127.0.0.1", "port": ${XRAY_HTTP_PORT},  "protocol": "http" },
    { "tag": "socks", "listen": "127.0.0.1", "port": ${XRAY_SOCKS_PORT}, "protocol": "socks", "settings": { "udp": true } }
  ],
  "outbounds": [
    {
      "protocol": "vless",
      "settings": { "vnext": [ {
        "address": "${XRAY_SERVER}", "port": ${XRAY_PORT},
        "users": [ { "id": "${XRAY_UUID}", "encryption": "none", "flow": "${XRAY_FLOW}" } ]
      } ] },
      "streamSettings": {
        "network": "${XRAY_TRANSPORT}", "security": "reality",
        "realitySettings": {
          "serverName": "${XRAY_SNI}", "fingerprint": "${XRAY_FP}",
          "publicKey": "${XRAY_PBK}", "shortId": "${XRAY_SID}", "spiderX": "${XRAY_SPX}"
        }
      }
    }
  ]
}
EOF
  echo "[entrypoint] xray → ${XRAY_SERVER}:${XRAY_PORT} (${XRAY_TRANSPORT}/reality) http-proxy 127.0.0.1:${XRAY_HTTP_PORT}"
  /usr/local/bin/xray run -c "$CFG" &
  sleep 1
  # 未显式指定时，自动把 Nano Banana 的图片调用指向内置代理
  : "${NANO_BANANA_PROXY:=http://127.0.0.1:${XRAY_HTTP_PORT}}"
  export NANO_BANANA_PROXY
  echo "[entrypoint] NANO_BANANA_PROXY=${NANO_BANANA_PROXY}"
else
  echo "[entrypoint] 未配置 XRAY_SERVER → 跳过内置代理（直连 Google）"
fi

exec npx tsx src/server.ts
