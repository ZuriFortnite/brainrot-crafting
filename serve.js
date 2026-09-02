/* Tiny static server for local testing. node serve.js [port] */
const http = require('http'), fs = require('fs'), path = require('path');
const root = __dirname, port = Number(process.argv[2]) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.ico': 'image/x-icon',
  '.ogg': 'audio/ogg', '.txt': 'text/plain; charset=utf-8'
};

/* Verbatim from https://developers.google.com/youtube/gaming/playables/reference/test_suite_guide
   Note what is NOT in the sandbox list: allow-modals, allow-popups,
   allow-downloads. alert(), confirm(), window.open() and <a download> are all
   dead inside a Playable. */
const CSP = "default-src 'none'; script-src 'report-sample' 'self' 'unsafe-eval' "
  + "'unsafe-inline' blob: https://www.youtube.com/game_api/v0 "
  + "https://www.youtube.com/game_api/v0/ https://www.youtube.com/game_api/v1 "
  + "https://www.youtube.com/game_api/v1/; object-src 'none'; style-src 'self' "
  + "'unsafe-inline' https://fonts.googleapis.com; img-src 'self' blob: data:; "
  + "media-src 'self' blob:; font-src 'self' data: https://fonts.googleapis.com "
  + "https://fonts.gstatic.com; connect-src 'self' blob: data:; sandbox "
  + "allow-pointer-lock allow-same-origin allow-scripts; base-uri 'self'; "
  + "manifest-src 'self'; worker-src 'self' blob:";

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(root, path.normalize(p).replace(/^([/\\])+/, ''));
  if (!f.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(f, (e, buf) => {
    if (e) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404 ' + p); return; }
    /* YouTube's real Content-Security-Policy, verbatim from the Playables SDK
       Test Suite guide. Serving under it locally is the whole point of that
       guide: a CSP violation is invisible until certification otherwise, and
       by then it is someone else finding it. */
    const head = {
      'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    };
    if (f.endsWith('.html')) head['Content-Security-Policy'] = CSP;
    res.writeHead(200, head);
    res.end(buf);
  });
}).listen(port, () => console.log('http://localhost:' + port));
