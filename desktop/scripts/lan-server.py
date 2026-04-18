#!/usr/bin/env python3
"""LAN dev server: directory listing for downloads + upload form for receiving
files (screenshots, logs) from the Windows test machine. Replaces
`python3 -m http.server` when you also need to push files BACK to the Mac.

Usage:
    cd desktop/dist && python3 ../scripts/lan-server.py 8080

Serves the current directory; uploads land in ./uploads/.
Hand-rolled multipart parsing — no third-party deps, works on Python 3.13+
where the `cgi` module has been removed.
"""
import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn

UPLOAD_DIR = "uploads"

UPLOAD_FORM = b"""<!doctype html>
<html><head><meta charset="utf-8"><title>Upload</title>
<style>
  body { font-family: -apple-system, Segoe UI, sans-serif; max-width: 520px;
         margin: 60px auto; padding: 20px; background: #0e0e10; color: #f5f5f7; }
  h1 { font-size: 18px; margin: 0 0 14px; }
  form { padding: 20px; border: 1px dashed #444; border-radius: 12px; }
  input[type=file] { width: 100%; margin-bottom: 14px; color: #ccc; }
  button { padding: 10px 18px; border-radius: 8px; border: 0;
           background: #ececf0; color: #0e0e10; font-weight: 600;
           cursor: pointer; }
  a { color: #7ec89a; }
</style></head><body>
<h1>Drop a file (lands in ./uploads/)</h1>
<form method="post" enctype="multipart/form-data" action="/upload">
  <input type="file" name="file" multiple required />
  <button type="submit">Upload</button>
</form>
<p><a href="/">&larr; back to download list</a></p>
</body></html>
"""


def parse_multipart(body: bytes, boundary: bytes):
    """Yield (filename, content_bytes) for each file part in a multipart body.
    Skips form fields that aren't file uploads. Filenames are trusted to the
    extent we basename() them in the caller.
    """
    sep = b"--" + boundary
    # Drop preamble before first boundary, drop epilogue after closing boundary.
    parts = body.split(sep)
    for raw in parts[1:-1]:
        # Each part starts with \r\n and ends with \r\n; strip those.
        if raw.startswith(b"\r\n"):
            raw = raw[2:]
        if raw.endswith(b"\r\n"):
            raw = raw[:-2]
        header_end = raw.find(b"\r\n\r\n")
        if header_end < 0:
            continue
        header = raw[:header_end].decode("utf-8", errors="replace")
        content = raw[header_end + 4:]
        m = re.search(r'filename="([^"]*)"', header)
        if not m:
            continue
        filename = m.group(1)
        if not filename:
            continue
        yield filename, content


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/upload", "/upload/"):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(UPLOAD_FORM)))
            self.end_headers()
            self.wfile.write(UPLOAD_FORM)
            return
        return super().do_GET()

    def do_POST(self):
        if self.path not in ("/upload", "/upload/"):
            self.send_error(404, "POST only on /upload")
            return

        ctype = self.headers.get("Content-Type", "")
        m = re.search(r'boundary=([^;]+)', ctype)
        if not m:
            self.send_error(400, "missing multipart boundary")
            return
        boundary = m.group(1).strip('"').encode()

        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            self.send_error(400, "empty body")
            return
        body = self.rfile.read(length)

        os.makedirs(UPLOAD_DIR, exist_ok=True)
        saved = []
        for filename, content in parse_multipart(body, boundary):
            name = os.path.basename(filename)
            dest = os.path.join(UPLOAD_DIR, name)
            with open(dest, "wb") as f:
                f.write(content)
            saved.append(name)
            print(f"[upload] saved {dest} ({len(content)} bytes)", flush=True)

        body = (
            f"<pre>saved: {saved}\n\n<a href='/upload'>another</a> | "
            f"<a href='/'>list</a></pre>"
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    addr = ("", port)
    httpd = ThreadingHTTPServer(addr, Handler)
    print(f"Serving HTTP on :: port {port} (http://[::]:{port}/)", flush=True)
    print(f"Upload form at  http://localhost:{port}/upload", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
