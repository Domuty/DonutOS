// Can a web page be shown inside DonutOS's Browser on the web version?
//
// The web version shows pages in an <iframe>, and most big sites forbid that with
// X-Frame-Options or a CSP frame-ancestors rule. The browser then shows an empty frame and
// tells the page that contains it nothing. A web page can't read another site's headers, so this
// small server-side check does: it requests the page, reads only the response headers (never
// the body, which isn't passed on), and answers yes, no or unknown.
//
// Used by api/frame-check.js (Vercel) and scripts/serve.js (local). Files under api/_lib
// aren't routes on Vercel.

'use strict';
const dns = require('node:dns').promises;
const net = require('node:net');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 6000;

/** true for loopback, private, link-local, carrier-grade NAT, multicast and other non-public addresses. */
function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9')
    || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
}

async function assertPublic(url) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw Object.assign(new Error('private address'), { code: 'EPRIVATE' });
}

/** Origin matching for one CSP source expression (frame-ancestors). */
function sourceMatches(src, embedder, target) {
  const s = src.toLowerCase();
  if (s === '*') return /^https?:$/.test(embedder.protocol);
  if (s === "'none'") return false;
  if (s === "'self'") return embedder.origin === target.origin;
  if (/^[a-z][a-z0-9+.-]*:$/.test(s)) return embedder.protocol === s || (s === 'http:' && embedder.protocol === 'https:');
  const m = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^/:]+|\*)(?::(\d+|\*))?(?:\/.*)?$/.exec(s);
  if (!m) return false;
  const [, scheme, wildcard, host, port] = m;
  if (scheme && scheme !== embedder.protocol.slice(0, -1) && !(scheme === 'http' && embedder.protocol === 'https:')) return false;
  if (!scheme && embedder.protocol !== target.protocol && !(target.protocol === 'http:' && embedder.protocol === 'https:')) return false;
  const eh = embedder.hostname.toLowerCase();
  if (host !== '*' && (wildcard ? !(eh.endsWith(`.${host}`)) : eh !== host)) return false;
  // No port in the source means the scheme's default port (URL.port is '' for that).
  return port === '*' || (port ? embedder.port === port : !embedder.port);
}

/**
 * Decides from response headers whether `embedder` may frame the page.
 * headers: a Headers object (or anything with get()). Returns { embeddable, reason }.
 */
function decide(headers, target, embedder) {
  // A CSP frame-ancestors rule replaces X-Frame-Options when both are present.
  const csp = headers.get('content-security-policy');
  if (csp) {
    // Several policies arrive joined with ", "; every one of them must allow the embedder.
    for (const policy of csp.split(',')) {
      const d = policy.split(';').map((x) => x.trim()).find((x) => /^frame-ancestors(\s|$)/i.test(x));
      if (!d) continue;
      const sources = d.split(/\s+/).slice(1);
      if (!sources.some((src) => sourceMatches(src, embedder, target))) return { embeddable: false, reason: 'frame-ancestors' };
    }
    if (/frame-ancestors/i.test(csp)) return { embeddable: true, reason: 'frame-ancestors' };
  }
  const xfo = (headers.get('x-frame-options') || '').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
  if (xfo.includes('deny')) return { embeddable: false, reason: 'x-frame-options' };
  if (xfo.includes('sameorigin')) return { embeddable: embedder.origin === target.origin, reason: 'x-frame-options' };
  return { embeddable: true, reason: 'none' };
}

/**
 * check('https://github.com', 'https://my-donutos.vercel.app') → { embeddable: false, reason, url }.
 * embeddable is null when the page couldn't be checked (the Browser then just tries).
 */
async function check(rawUrl, rawEmbedder, { allowPrivate = false } = {}) {
  let url, embedder;
  try { url = new URL(rawUrl); embedder = new URL(rawEmbedder); } catch { return { embeddable: null, reason: 'bad-url' }; }
  if (!/^https?:$/.test(url.protocol) || !/^https?:$/.test(embedder.protocol)) return { embeddable: null, reason: 'bad-url' };
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!allowPrivate) await assertPublic(url);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      let res;
      try {
        res = await fetch(url, { method: 'GET', redirect: 'manual', signal: ctl.signal, headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'accept-language': 'en' } });
      } finally { clearTimeout(timer); }
      res.body?.cancel().catch(() => {}); // headers are all we need
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, url); continue; }
      return { ...decide(res.headers, url, embedder), url: url.href };
    }
    return { embeddable: null, reason: 'too-many-redirects' };
  } catch (err) {
    return { embeddable: null, reason: err.code === 'EPRIVATE' ? 'private-address' : 'unreachable' };
  }
}

module.exports = { check, decide, isPrivateAddress, sourceMatches };
