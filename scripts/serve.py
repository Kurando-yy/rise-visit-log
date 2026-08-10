#!/usr/bin/env python3
"""RISE来店記録タブレット 試用配信サーバ（キャッシュ無効）。

素の `python3 -m http.server` は Cache-Control を一切送らないため、
iPad/Android のブラウザが古い版を握り続け「直したのに変わらない」が起きる。
このサーバは毎レスポンスに no-store を付けて、リロード＝必ず最新にする。

使い方: cd <このリポジトリ> && python3 scripts/serve.py [PORT]
既定ポート 8765 / 0.0.0.0 で待受（LAN と Tailscale の両方から到達可）。
"""
import sys
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_head(self):
        # 条件付きGET(If-Modified-Since / If-None-Match)を無効化し、304 を返さない。
        # これをしないと、既に古い版を持っている端末が再検証で 304 を受け取り、
        # キャッシュの中身をそのまま使い続けてしまう。
        for h in ("If-Modified-Since", "If-None-Match"):
            if h in self.headers:
                del self.headers[h]
        return super().send_head()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    handler = partial(NoCacheHandler, directory=ROOT)
    with ThreadingHTTPServer(("0.0.0.0", PORT), handler) as httpd:
        sys.stderr.write("serving %s on 0.0.0.0:%d (no-store)\n" % (ROOT, PORT))
        httpd.serve_forever()
