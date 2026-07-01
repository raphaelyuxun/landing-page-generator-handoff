#!/bin/sh
# 从 .env 的 XRAY_* 变量渲染 Xray 客户端配置（VLESS + Reality），起本地 HTTP/SOCKS 代理。
# app 容器通过 http://xray:${XRAY_HTTP_PORT} 只代理 Nano Banana(Google) 流量。
set -e
: "${XRAY_HTTP_PORT:=10809}"
: "${XRAY_SOCKS_PORT:=10808}"
: "${XRAY_TRANSPORT:=tcp}"
: "${XRAY_FLOW:=}"
: "${XRAY_SPX:=/}"

CFG=/tmp/xray-config.json
cat > "$CFG" <<EOF
{
  "log": { "loglevel": "warning" },
  "inbounds": [
    { "tag": "http",  "listen": "0.0.0.0", "port": ${XRAY_HTTP_PORT},  "protocol": "http" },
    { "tag": "socks", "listen": "0.0.0.0", "port": ${XRAY_SOCKS_PORT}, "protocol": "socks", "settings": { "udp": true } }
  ],
  "outbounds": [
    {
      "protocol": "vless",
      "settings": { "vnext": [ {
        "address": "${XRAY_SERVER}",
        "port": ${XRAY_PORT},
        "users": [ { "id": "${XRAY_UUID}", "encryption": "none", "flow": "${XRAY_FLOW}" } ]
      } ] },
      "streamSettings": {
        "network": "${XRAY_TRANSPORT}",
        "security": "reality",
        "realitySettings": {
          "serverName": "${XRAY_SNI}",
          "fingerprint": "${XRAY_FP}",
          "publicKey": "${XRAY_PBK}",
          "shortId": "${XRAY_SID}",
          "spiderX": "${XRAY_SPX}"
        }
      }
    }
  ]
}
EOF

echo "[xray] config rendered: ${XRAY_SERVER}:${XRAY_PORT} transport=${XRAY_TRANSPORT} sni=${XRAY_SNI} http_proxy=:${XRAY_HTTP_PORT}"
exec xray run -c "$CFG"
