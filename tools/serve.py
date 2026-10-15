from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
import os
os.chdir(Path(__file__).resolve().parents[1]/'public')
class Handler(SimpleHTTPRequestHandler):
 def do_GET(self):
  if self.path.split('?')[0]=='/assets/brain.bin' and 'gzip' in self.headers.get('Accept-Encoding',''):
   b=Path('assets/brain.bin.gz').read_bytes();self.send_response(200);self.send_header('Content-Type','application/octet-stream');self.send_header('Content-Encoding','gzip');self.send_header('Content-Length',str(len(b)));self.send_header('Vary','Accept-Encoding');self.end_headers();self.wfile.write(b)
  else:super().do_GET()
ThreadingHTTPServer(('127.0.0.1',4173),Handler).serve_forever()
