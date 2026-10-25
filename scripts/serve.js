// Tiny static server for trying the web version locally: `npm run serve` → http://localhost:5173
// (A server is needed because ES modules and service workers don't run from file://.)

'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { check } = require('../api/_lib/frame-check.js');

const ROOT = path.join(__dirname, '..', 'src');
const PORT = Number(process.env.PORT) || 5173;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // Same answer as the Vercel function (api/frame-check.js). Requests from this computer may
  // also check local addresses, so pages from your own dev servers work in the Browser.
  if (url.pathname === '/api/frame-check') {
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    const result = await check(url.searchParams.get('url') || '', url.searchParams.get('origin') || `http://${req.headers.host}`, { allowPrivate: local });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(result));
    return;
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`DonutOS web version: http://localhost:${PORT}`));
