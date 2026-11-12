#!/usr/bin/env node
// Augšupielādē parakstīto bāzi relejam (GitHub Action pēc build-bundle --sign).
//   node data/scripts/upload-bundle.mjs <dist-mape> [releja-adrese]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'data/dist';
const relay = process.argv[3] ?? process.env.RELAY_URL ?? 'https://urlguard-relay.urlguard-relay.workers.dev';
const body = readFileSync(join(dir, 'bundle.json'), 'utf8');
const sig = readFileSync(join(dir, 'bundle.json.sig'), 'utf8').trim();
const res = await fetch(`${relay}/bundle`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ body, sig }),
});
const text = await res.text();
console.log(`relejs: HTTP ${res.status} ${text}`);
if (!res.ok) process.exit(1);
