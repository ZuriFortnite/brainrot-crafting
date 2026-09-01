/* Tiny static server for local testing. node serve.js [port] */
const http = require('http'), fs = require('fs'), path = require('path');
const root = __dirname, port = Number(process.argv[2]) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.ico': 'image/x-icon',
  '.ogg': 'audio/ogg', '.txt': 'text/plain; charset=utf-8'
};

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(root, path.normalize(p).replace(/^([/\\])+/, ''));
  if (!f.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(f, (e, buf) => {
    if (e) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404 ' + p); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(buf);
  });
}).listen(port, () => console.log('http://localhost:' + port));
