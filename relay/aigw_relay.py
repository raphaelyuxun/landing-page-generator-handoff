#!/usr/bin/env python3
"""EaseSourcer AIGW relay.

Thin authenticated passthrough to NetEase AIGW. Runs on the Mac Mini
(corp-internal network), listens on 127.0.0.1:4500, and is reached from the
seo server via the persistent reverse SSH tunnel (seo:127.0.0.1:4500 ->
macmini:127.0.0.1:4500). Holds the AIGW AppKey (read from a config file, never
hardcoded), injects the Authorization header, and forwards POST bodies verbatim
to https://aigw.nie.netease.com/v1/chat/completions for BOTH text
(claude-*) and image (gemini-3-pro-image, with vertexai.response_modalities set
by the caller).

Pure Python 3.9 stdlib, zero dependencies.
"""
import json
import os
import ssl
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CONFIG_PATH = os.environ.get(
    "RELAY_CONFIG",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "relay.config.json"),
)


def load_config():
    with open(CONFIG_PATH, "r") as f:
        return json.load(f)


CFG = load_config()
AIGW_BASE = CFG.get("aigw_base", "https://aigw.nie.netease.com/v1").rstrip("/")
APP_KEY = CFG["app_key"]
RELAY_TOKEN = CFG.get("relay_token") or None
LISTEN_HOST = CFG.get("listen_host", "127.0.0.1")
LISTEN_PORT = int(CFG.get("listen_port", 4500))
UPSTREAM_TIMEOUT = int(CFG.get("upstream_timeout", 180))
MAX_BODY = int(CFG.get("max_body_bytes", 64 * 1024 * 1024))  # 64 MB (i2i base64)

ALLOWED_PATHS = ("/v1/chat/completions", "/v1/chat")


class Handler(BaseHTTPRequestHandler):
    server_version = "EaseSourcerRelay/1.0"
    protocol_version = "HTTP/1.1"

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        if self.path == "/healthz":
            self._send(200, json.dumps({"ok": True, "service": "aigw-relay"}))
        else:
            self._send(404, json.dumps({"error": "not found"}))

    def do_POST(self):
        if RELAY_TOKEN and self.headers.get("X-Relay-Token") != RELAY_TOKEN:
            self._send(401, json.dumps({"error": "relay auth failed"}))
            return
        if self.path not in ALLOWED_PATHS:
            self._send(404, json.dumps({"error": "not found"}))
            return

        length = int(self.headers.get("Content-Length", 0) or 0)
        if length > MAX_BODY:
            self._send(413, json.dumps({"error": "payload too large"}))
            return
        raw = self.rfile.read(length) if length else b""

        url = AIGW_BASE + "/chat/completions"
        req = urllib.request.Request(url, data=raw, method="POST")
        req.add_header("Authorization", "Bearer " + APP_KEY)
        req.add_header("Content-Type", "application/json")
        ctx = ssl.create_default_context()
        try:
            with urllib.request.urlopen(req, timeout=UPSTREAM_TIMEOUT, context=ctx) as resp:
                self._send(resp.status, resp.read())
        except urllib.error.HTTPError as e:
            self._send(e.code, e.read())
        except Exception as e:  # noqa: BLE001
            self._send(502, json.dumps({"error": "relay upstream error", "detail": str(e)}))

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    httpd = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    sys.stderr.write(
        "EaseSourcer AIGW relay listening on %s:%d -> %s (token=%s)\n"
        % (LISTEN_HOST, LISTEN_PORT, AIGW_BASE, "on" if RELAY_TOKEN else "off")
    )
    sys.stderr.flush()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.shutdown()


if __name__ == "__main__":
    main()
