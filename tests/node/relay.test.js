// The Browser's relay (api/_lib/relay.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { handleRelay, rewriteHtml } = require('../../api/_lib/relay.js');

test('rewriteHtml adds <base> and the relay script after <head>, keeping bytes and charset', () => {
  const src = Buffer.from('<html><head><meta charset="windows-1252"><meta http-equiv="Content-Security-Policy" content="script-src \'none\'"><meta http-equiv="refresh" content="0; url=/next"></head><body>caf\xe9</body></html>', 'latin1');
  const out = rewriteHtml(src, 'https://site.example/a/', 'https://donut.example/api/relay?url=').toString('latin1');
  assert.match(out, /^<html><head><base href="https:\/\/site.example\/a\/"><script>/);
  assert.ok(!/Content-Security-Policy/i.test(out), 'page CSP meta removed');
  assert.ok(out.includes('url=https://donut.example/api/relay?url=https%3A%2F%2Fsite.example%2Fnext'), 'meta refresh goes through the relay');
  assert.ok(out.includes('caf\xe9'), 'non-UTF-8 bytes untouched');
});

function serve(handler) {
  return new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => resolve(s)); });
}

test('relay: only frames, no framing headers or cookies, redirects followed, private networks refused', async (t) => {
  const site = await serve((req, res) => {
    if (req.url === '/hop') { res.writeHead(302, { Location: '/page' }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'", 'Set-Cookie': 'id=1' });
    res.end('<html><head><title>T</title></head><body>hi</body></html>');
  });
  const relayLocal = await serve((req, res) => handleRelay(req, res, { allowPrivate: true }));
  const relayPublic = await serve((req, res) => handleRelay(req, res));
  t.after(() => { site.close(); relayLocal.close(); relayPublic.close(); });
  const target = encodeURIComponent(`http://127.0.0.1:${site.address().port}/hop`);
  const at = (srv, headers = {}) => fetch(`http://127.0.0.1:${srv.address().port}/api/relay?url=${target}`, { headers });

  assert.equal((await at(relayLocal)).status, 403, 'no Sec-Fetch-Dest: refused');
  assert.equal((await at(relayLocal, { 'sec-fetch-dest': 'document' })).status, 403, 'top-level browsing: refused');
  const r = await at(relayLocal, { 'sec-fetch-dest': 'iframe' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-frame-options'), null);
  assert.equal(r.headers.get('set-cookie'), null);
  assert.match(r.headers.get('content-security-policy'), /^sandbox /);
  assert.ok(!/allow-same-origin/.test(r.headers.get('content-security-policy')), 'relayed pages get an opaque origin');
  assert.equal(r.headers.get('x-donut-relay-url'), `http://127.0.0.1:${site.address().port}/page`, 'redirect followed');
  assert.match(await r.text(), /<base href="http:\/\/127\.0\.0\.1:\d+\/page">/);
  const priv = await at(relayPublic, { 'sec-fetch-dest': 'iframe' });
  assert.equal(priv.status, 403, 'private addresses refused on the public relay');
  const probe = await fetch(`http://127.0.0.1:${relayPublic.address().port}/api/relay?probe=1`);
  assert.deepEqual(await probe.json(), { relay: true, version: 1 });
});
