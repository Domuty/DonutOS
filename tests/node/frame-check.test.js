// The Browser's "can this site be shown in a frame?" check (api/_lib/frame-check.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { check, decide, isPrivateAddress } = require('../../api/_lib/frame-check.js');

const H = (obj) => new Headers(obj);
const me = new URL('https://donut.example');
const site = new URL('https://site.example/page');
const verdict = (headers, embedder = me) => decide(H(headers), site, embedder).embeddable;

test('X-Frame-Options DENY and SAMEORIGIN refuse other sites', () => {
  assert.equal(verdict({ 'x-frame-options': 'DENY' }), false);
  assert.equal(verdict({ 'x-frame-options': 'sameorigin' }), false);
  assert.equal(verdict({ 'x-frame-options': 'SAMEORIGIN' }, new URL('https://site.example')), true);
  assert.equal(verdict({}), true);
  assert.equal(verdict({ 'x-frame-options': 'ALLOW-FROM https://donut.example' }), true); // ignored by browsers
});

test('CSP frame-ancestors decides, and overrides X-Frame-Options', () => {
  assert.equal(verdict({ 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" }), false);
  assert.equal(verdict({ 'content-security-policy': "frame-ancestors 'self'" }), false);
  assert.equal(verdict({ 'content-security-policy': 'frame-ancestors *' }), true);
  assert.equal(verdict({ 'content-security-policy': 'frame-ancestors https:' }), true);
  assert.equal(verdict({ 'content-security-policy': 'frame-ancestors https://donut.example' }), true);
  assert.equal(verdict({ 'content-security-policy': 'frame-ancestors *.example' }), true);
  assert.equal(verdict({ 'content-security-policy': 'frame-ancestors https://other.example' }), false);
  assert.equal(verdict({ 'content-security-policy': 'frame-ancestors *', 'x-frame-options': 'DENY' }), true);
  assert.equal(verdict({ 'content-security-policy': "script-src 'self'", 'x-frame-options': 'DENY' }), false);
  // Two policies: both must allow.
  assert.equal(verdict({ 'content-security-policy': "frame-ancestors *, frame-ancestors 'self'" }), false);
  // Ports: none means the default port.
  assert.equal(verdict({ 'content-security-policy': 'frame-ancestors http://localhost' }, new URL('http://localhost:5173')), false);
  assert.equal(verdict({ 'content-security-policy': 'frame-ancestors http://localhost:5173' }, new URL('http://localhost:5173')), true);
});

test('private and loopback addresses are recognised', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.4', '172.20.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('check() reads real response headers, follows redirects, refuses private hosts', async (t) => {
  const srv = http.createServer((req, res) => {
    if (req.url === '/deny') res.writeHead(200, { 'X-Frame-Options': 'DENY' });
    else if (req.url === '/hop') res.writeHead(302, { Location: '/deny' });
    else res.writeHead(200);
    res.end('<p>hi</p>');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  assert.equal((await check(`${base}/deny`, 'https://donut.example', { allowPrivate: true })).embeddable, false);
  assert.equal((await check(`${base}/ok`, 'https://donut.example', { allowPrivate: true })).embeddable, true);
  const hop = await check(`${base}/hop`, 'https://donut.example', { allowPrivate: true });
  assert.equal(hop.embeddable, false);
  assert.equal(hop.url, `${base}/deny`);
  assert.deepEqual(await check(`${base}/ok`, 'https://donut.example'), { embeddable: null, reason: 'private-address' });
  assert.equal((await check('ftp://x.example', 'https://donut.example')).embeddable, null);
});
