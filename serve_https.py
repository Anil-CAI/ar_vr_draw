import http.server
import ssl
import socketserver
import mimetypes

PORT = 8443

# Force correct MIME types for Quest Browser
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()

httpd = socketserver.TCPServer(("", PORT), Handler)

httpd.socket = ssl.wrap_socket(
    httpd.socket,
    certfile="cert.pem",
    keyfile="key.pem",
    server_side=True
)

print(f"HTTPS server running on port {PORT}")
httpd.serve_forever()
