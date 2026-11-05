import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);
const port = Number(process.env.DEMO_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DEMO_PORT tidak valid');
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  const file = files.get(path);
  if (req.method !== 'GET' || !file) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const content = await readFile(fileURLToPath(new URL(file[0], import.meta.url)));
    res.writeHead(200, { 'Content-Type': file[1], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    res.end(content);
  } catch { res.writeHead(500); res.end('Cannot load demo'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Demo: http://127.0.0.1:${port}`));
