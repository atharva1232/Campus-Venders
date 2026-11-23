"""Local dev server for Campus Vendors: like `python -m http.server 8000`,
but tells the browser to always re-check files, so changes (and the
sign-in link from the email) never load an old cached copy of the site."""
import http.server
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    print(f"Serving Campus Vendors on http://localhost:{PORT}")
    http.server.ThreadingHTTPServer(("", PORT), NoCacheHandler).serve_forever()
