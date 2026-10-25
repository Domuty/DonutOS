// Vercel serverless function: GET /api/frame-check?url=<page>&origin=<DonutOS origin>
// → { embeddable: true | false | null, reason, url }. See api/_lib/frame-check.js.

'use strict';
const { check } = require('./_lib/frame-check.js');

module.exports = async (req, res) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const origin = q.get('origin') || `https://${req.headers.host}`;
  const result = q.get('url') ? await check(q.get('url'), origin) : { embeddable: null, reason: 'bad-url' };
  res.setHeader('Content-Type', 'application/json');
  // Sites rarely change this; let the CDN answer repeat questions.
  res.setHeader('Cache-Control', result.embeddable === null ? 'no-store' : 'public, max-age=600, s-maxage=3600');
  res.end(JSON.stringify(result));
};
