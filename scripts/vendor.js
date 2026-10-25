// Copies third-party browser libraries from node_modules into src/vendor so the web build
// needs no install step and works offline. Run after upgrading a dependency.

'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const copies = [['node_modules/jszip/dist/jszip.min.js', 'src/vendor/jszip.min.js']];
for (const [from, to] of copies) {
  fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
  fs.copyFileSync(path.join(root, from), path.join(root, to));
  console.log(`vendor: ${to}`);
}
