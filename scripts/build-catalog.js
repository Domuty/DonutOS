#!/usr/bin/env node
// Builds the Store catalog: every folder in src/store/apps/<name>/ (manifest.json, main.js,
// icon.svg) becomes src/store/catalog/<id>.dapp, and src/store/catalog/index.json lists them.
// Run after changing a Store app:  node scripts/build-catalog.js

'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'src', 'store');
const APPS = path.join(ROOT, 'apps');
const OUT = path.join(ROOT, 'catalog');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const index = [];
for (const dir of fs.readdirSync(APPS).sort()) {
  const base = path.join(APPS, dir);
  if (!fs.statSync(base).isDirectory()) continue;
  const manifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'));
  const source = fs.readFileSync(path.join(base, 'main.js'), 'utf8');
  const icon = fs.readFileSync(path.join(base, 'icon.svg'), 'utf8').trim();
  for (const k of ['id', 'name', 'version', 'description', 'category']) if (!manifest[k]) throw new Error(`${dir}/manifest.json is missing "${k}"`);
  const pkg = `${JSON.stringify({ format: 'donutos-app', formatVersion: 1, manifest, icon, source }, null, 1)}\n`;
  const file = `${manifest.id}.dapp`;
  fs.writeFileSync(path.join(OUT, file), pkg);
  index.push({
    id: manifest.id, name: manifest.name, version: manifest.version, author: manifest.author || 'DonutOS',
    description: manifest.description, summary: manifest.summary || manifest.description.split('. ')[0],
    category: manifest.category, permissions: manifest.permissions || [], features: manifest.features || [],
    size: Buffer.byteLength(pkg), package: file,
    icon: `data:image/svg+xml;base64,${Buffer.from(icon).toString('base64')}`,
    updated: manifest.updated || null,
  });
  console.log(`  ${file}  (${(Buffer.byteLength(pkg) / 1024).toFixed(1)} KB)`);
}
fs.writeFileSync(path.join(OUT, 'index.json'), `${JSON.stringify({ name: 'DonutOS Store', apps: index }, null, 1)}\n`);
console.log(`catalog: ${index.length} apps`);
