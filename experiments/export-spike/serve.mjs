// Serves this folder so the page can be opened in a browser for a look.
// ES modules and WebCodecs both refuse to work from file://, so a real origin is needed.
//
//   node serve.mjs [port]
//
// Then open the printed URL. Ctrl-C to stop.
import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';

const HERE = import.meta.dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.map': 'application/json; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    const rel = new URL(req.url, 'http://127.0.0.1').pathname;
    const file = path.resolve(HERE, '.' + (rel === '/' ? '/index.html' : rel));
    if (!file.startsWith(HERE)) {
      res.writeHead(403).end('no');
      return;
    }
    const data = await fsp.readFile(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 500).end(String(e.message));
  }
});

const port = Number(process.argv[2] ?? 8123);
server.listen(port, '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${port}/index.html`);
  console.log('Ctrl-C で停止');
});
