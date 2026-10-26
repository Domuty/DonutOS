// Vercel serverless function: the Browser's relay. See api/_lib/relay.js.

'use strict';
const { handleRelay } = require('./_lib/relay.js');

module.exports = (req, res) => handleRelay(req, res);
