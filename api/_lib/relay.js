// The Browser's relay (web version): fetches a web page for DonutOS so sites that refuse to be
// shown inside another page can still appear in the Browser window.
//
//   GET|POST /api/relay?url=https://example.com/page
//
// The relay:
// - fetches the page server-side (no cookies are sent or kept) and passes it back without
//   the headers that forbid framing (X-Frame-Options, Content-Security-Policy);
// - for HTML, adds <base href> (so pictures, styles and scripts load from the site itself)
//   and a small script that keeps link clicks and form submissions going through the relay
//   and tells DonutOS the real address and title;
// - turns redirects into redirects to the relay.
//
// Safety:
// - Every response carries `Content-Security-Policy: sandbox` without allow-same-origin:
//   relayed pages run with an opaque origin and can never reach DonutOS's storage, even
//   though they're served from DonutOS's own address.
// - Only frames may use it (Sec-Fetch-Dest: iframe), so it can't be browsed as an open proxy
//   from a browser tab. Private and local network addresses are refused.
//
// Used by api/relay.js (Vercel) and scripts/serve.js (local).

'use strict';
const { assertPublic } = require('./frame-check.js');

const MAX_HTML = 8 * 1024 * 1024;
const MAX_BODY = 4 * 1024 * 1024;
const TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 8;
const SANDBOX = 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-pointer-lock allow-presentation';
// Response headers never passed on.
const DROP = new Set(['x-frame-options', 'content-security-policy', 'content-security-policy-report-only', 'set-cookie', 'set-cookie2',
  'strict-transport-security', 'cross-origin-opener-policy', 'cross-origin-embedder-policy', 'cross-origin-resource-policy', 'permissions-policy',
  'content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'alt-svc', 'report-to', 'nel', 'clear-site-data', 'refresh', 'link']);

const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Form data is too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** The script added to relayed pages (runs before the page's own scripts). */
function clientScript(relayBase, pageUrl) {
  return `<script>(function(){
var RELAY=${JSON.stringify(relayBase)},PAGE=${JSON.stringify(pageUrl)};
function abs(u){try{return new URL(u,document.baseURI)}catch(e){return null}}
function via(u){var a=abs(u);return a&&/^https?:$/.test(a.protocol)?RELAY+encodeURIComponent(a.href):null}
function tell(m){m.donutRelay=m.donutRelay||'info';try{parent.postMessage(m,'*')}catch(e){}}
document.addEventListener('click',function(e){
 if(e.defaultPrevented||e.button>1)return;
 var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a)return;
 var raw=a.getAttribute('href')||'';
 if(raw.charAt(0)==='#'){e.preventDefault();var id=decodeURIComponent(raw.slice(1));var t=id&&(document.getElementById(id)||document.getElementsByName(id)[0]);if(t)t.scrollIntoView();else if(!id)scrollTo(0,0);try{history.replaceState(null,'',raw)}catch(x){}return}
 if(/^(javascript|mailto|tel|sms|data|blob):/i.test(raw.trim()))return;
 var r=via(a.href);if(!r)return;
 e.preventDefault();
 if(a.target==='_blank'||e.ctrlKey||e.metaKey||e.shiftKey||e.button===1)tell({donutRelay:'open',url:abs(a.href).href});
 else location.href=r;
},true);
document.addEventListener('auxclick',function(e){if(e.button!==1)return;var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(a&&via(a.href)){e.preventDefault();tell({donutRelay:'open',url:abs(a.href).href})}},true);
document.addEventListener('submit',function(e){
 if(e.defaultPrevented)return;var f=e.target;
 var act=abs(f.getAttribute('action')||PAGE);if(!act||!/^https?:$/.test(act.protocol))return;
 e.preventDefault();
 var fd;try{fd=new FormData(f,e.submitter)}catch(x){fd=new FormData(f)}
 var method=(e.submitter&&e.submitter.getAttribute('formmethod')||f.getAttribute('method')||'get').toLowerCase();
 if(method==='get'){var q=new URLSearchParams();fd.forEach(function(v,k){if(typeof v==='string')q.append(k,v)});act.search=q.toString();location.href=via(act.href);return}
 var nf=document.createElement('form');nf.method='post';nf.action=via(act.href);nf.style.display='none';
 fd.forEach(function(v,k){if(typeof v!=='string')return;var i=document.createElement('input');i.type='hidden';i.name=k;i.value=v;nf.appendChild(i)});
 document.documentElement.appendChild(nf);HTMLFormElement.prototype.submit.call(nf);
},true);
function info(){var icon=document.querySelector('link[rel~="icon"]');tell({donutRelay:'loaded',url:PAGE.split('#')[0]+(location.hash||''),title:document.title||'',favicon:icon?abs(icon.getAttribute('href')).href:''})}
document.addEventListener('DOMContentLoaded',function(){info();var t=document.querySelector('title');if(t)new MutationObserver(info).observe(t,{childList:true,characterData:true,subtree:true})});
addEventListener('hashchange',info);
})();</script>`;
}

/** Adds <base> and the client script to an HTML page, keeping its bytes (and charset) as they are. */
function rewriteHtml(buf, pageUrl, relayBase) {
  let html = buf.toString('latin1');
  const inject = `<base href="${escAttr(pageUrl)}">${clientScript(relayBase, pageUrl)}`;
  // The page's own CSP <meta> tags would block the relay script; refresh tags would leave the relay.
  html = html.replace(/<meta[^>]+http-equiv\s*=\s*["']?content-security-policy[^>]*>/gi, '');
  html = html.replace(/(<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["']\s*\d+\s*;\s*url\s*=\s*)([^"'>]+)/gi,
    (m, pre, target) => { try { return pre + relayBase + encodeURIComponent(new URL(target.trim(), pageUrl).href); } catch { return m; } });
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) html = html.slice(0, head.index + head[0].length) + inject + html.slice(head.index + head[0].length);
  else {
    const tag = /<html(\s[^>]*)?>/i.exec(html);
    html = tag ? html.slice(0, tag.index + tag[0].length) + inject + html.slice(tag.index + tag[0].length) : inject + html;
  }
  return Buffer.from(html, 'latin1');
}

function page(res, status, title, text) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `${SANDBOX}; default-src 'none'; style-src 'unsafe-inline'`, 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><title>${escAttr(title)}</title><style>body{font:15px/1.5 system-ui,sans-serif;display:grid;place-content:center;min-height:90vh;text-align:center;color:#555;padding:20px}h1{font-size:20px;color:#222}</style><h1>${escAttr(title)}</h1><p>${escAttr(text)}</p>`);
}

/**
 * Handles one relay request (Node request/response).
 * opts: { allowPrivate } — the local dev server allows this computer's own addresses.
 */
async function handleRelay(req, res, { allowPrivate = false } = {}) {
  const here = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  // Vercel says https in x-forwarded-proto; the local server is plain http.
  const proto = req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http');
  const origin = `${String(proto).split(',')[0]}://${req.headers.host}`;
  // DonutOS asks whether the relay exists before using it.
  if (here.searchParams.has('probe')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ relay: true, version: 1 }));
    return;
  }
  const dest = req.headers['sec-fetch-dest'];
  if (dest && dest !== 'iframe' && dest !== 'frame') { page(res, 403, 'Only for DonutOS', 'This relay only shows pages inside the DonutOS Browser.'); return; }
  if (!dest) { res.writeHead(403, { 'Content-Type': 'text/plain' }).end('The relay is only available to the DonutOS Browser.'); return; }

  let target;
  try { target = new URL(here.searchParams.get('url') || ''); } catch { page(res, 400, 'That address doesn’t look right', 'Check the web address and try again.'); return; }
  if (!/^https?:$/.test(target.protocol)) { page(res, 400, 'Only web pages', 'The relay can only open http and https addresses.'); return; }
  const relayBase = `${origin}/api/relay?url=`;

  let body;
  const method = req.method === 'POST' ? 'POST' : req.method === 'HEAD' ? 'HEAD' : 'GET';
  try { if (method === 'POST') body = await readBody(req); } catch (err) { page(res, err.status || 400, 'Couldn’t send the form', err.message); return; }

  let upstream;
  try {
    for (let hop = 0; ; hop++) {
      if (!allowPrivate) await assertPublic(target);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      try {
        upstream = await fetch(target, {
          method, body, redirect: 'manual', signal: ctl.signal,
          headers: {
            'user-agent': req.headers['user-agent'] || 'Mozilla/5.0',
            accept: req.headers.accept || 'text/html,application/xhtml+xml,*/*;q=0.8',
            'accept-language': req.headers['accept-language'] || 'en',
            ...(body ? { 'content-type': req.headers['content-type'] || 'application/x-www-form-urlencoded', origin: target.origin, referer: target.href } : {}),
          },
        });
      } finally { clearTimeout(timer); }
      const loc = upstream.headers.get('location');
      if (upstream.status >= 300 && upstream.status < 400 && loc) {
        // POST → GET on 301/302/303, as browsers do; follow here so the frame only sees the end.
        if (hop >= MAX_REDIRECTS) { page(res, 508, 'Too many redirects', 'The site kept sending the relay somewhere else.'); return; }
        upstream.body?.cancel().catch(() => {});
        target = new URL(loc, target);
        if (upstream.status !== 307 && upstream.status !== 308) { body = undefined; }
        continue;
      }
      break;
    }
  } catch (err) {
    if (err.code === 'EPRIVATE') page(res, 403, 'This address is on a private network', 'The relay only opens public websites.');
    else if (err.name === 'AbortError') page(res, 504, 'The site took too long', `${target.hostname} didn’t answer in time. Try again.`);
    else page(res, 502, 'Can’t reach this page', `${target.hostname} couldn’t be reached.`);
    return;
  }

  const headers = { 'Content-Security-Policy': SANDBOX, 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'X-Donut-Relay-Url': target.href };
  for (const [k, v] of upstream.headers) if (!DROP.has(k.toLowerCase())) headers[k] = v;
  headers['Content-Security-Policy'] = SANDBOX;
  const type = upstream.headers.get('content-type') || '';
  if (/text\/html|application\/xhtml/i.test(type) && method !== 'HEAD') {
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > MAX_HTML) { page(res, 413, 'This page is too big for the relay', 'Open it in a browser tab instead.'); return; }
    const out = rewriteHtml(buf, target.href, relayBase);
    res.writeHead(upstream.status, { ...headers, 'Content-Length': out.length });
    res.end(out);
    return;
  }
  // Anything else (a picture, a PDF, a download) streams through unchanged.
  res.writeHead(upstream.status, headers);
  if (!upstream.body || method === 'HEAD') { res.end(); return; }
  for await (const chunk of upstream.body) res.write(chunk);
  res.end();
}

module.exports = { handleRelay, rewriteHtml };
