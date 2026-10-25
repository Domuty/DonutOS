#!/usr/bin/env node
// Packs a Store app folder (manifest.json, main.js, icon.svg) into a .dapp file.
//   node scripts/pack-dapp.js path/to/my-app [out.dapp]
// Install the result from the Store (Sources › From a .dapp file), or host it and add it to a
// catalog (see docs/SDK.md › Publishing).

'use strict';
const fs = require('node:fs');
const path = require('node:path');

const dir = path.resolve(process.argv[2] || '.');
const manifestFile = path.join(dir, 'manifest.json');
if (!fs.existsSync(manifestFile)) { console.error(`No manifest.json in ${dir}`); process.exit(1); }
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const problems = [];
if (!/^[a-z0-9][a-z0-9.-]{0,62}[a-z0-9]$/.test(manifest.id || '')) problems.push('id must be 2-64 lowercase letters, digits, dots or dashes (e.g. "yourname.myapp")');
if (!manifest.name) problems.push('name is required');
if (!/^\d+\.\d+\.\d+/.test(manifest.version || '')) problems.push('version must look like 1.0.0');
const allowed = ['files.read', 'files.write', 'system.fs', 'network', 'notifications', 'clipboard', 'location'];
for (const p of manifest.permissions || []) if (!allowed.includes(p)) problems.push(`Store apps can't use the "${p}" permission (allowed: ${allowed.join(', ')})`);
const main = path.join(dir, manifest.main || 'main.js');
if (!fs.existsSync(main)) problems.push(`${path.basename(main)} is missing`);
if (problems.length) { console.error(`Can't pack ${manifest.name || dir}:\n  - ${problems.join('\n  - ')}`); process.exit(1); }
const source = fs.readFileSync(main, 'utf8');
if (!/export\s+default/.test(source)) console.warn('warning: main.js has no "export default function main(app)"');
const iconFile = path.join(dir, 'icon.svg');
const icon = fs.existsSync(iconFile) ? fs.readFileSync(iconFile, 'utf8').trim() : undefined;
const out = path.resolve(process.argv[3] || path.join(path.dirname(dir), `${manifest.id}.dapp`));
fs.writeFileSync(out, `${JSON.stringify({ format: 'donutos-app', formatVersion: 1, manifest, icon, source }, null, 1)}\n`);
console.log(`Packed ${manifest.name} ${manifest.version} → ${out} (${(fs.statSync(out).size / 1024).toFixed(1)} KB)`);
