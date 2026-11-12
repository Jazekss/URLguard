#!/usr/bin/env node
// Kļūdaino brīdinājumu pārbaude: palaiž dzinēju pār populārākajiem domēniem (Tranco top-1M saraksts).
//   node data/scripts/fp-scan.mjs <tranco top-1m.csv> [--top 50000]
// Rezultāts: populāras lapas, kas saņemtu brīdinājumu. Pēc zīmolu izmaiņām tam jābūt ~10 (tikai īsti drukas kļūdu domēni).
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { buildBundle } from './build-bundle.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const csv = process.argv[2];
if (!csv) {
  console.error('Lietošana: node data/scripts/fp-scan.mjs <top-1m.csv>   (https://tranco-list.eu/top-1m.csv.zip)');
  process.exit(1);
}
const ti = process.argv.indexOf('--top');
const TOP = ti > 0 ? Number(process.argv[ti + 1]) : 50000;
const out = join(tmpdir(), 'urlguard-engine.mjs');
const ext = join(here, '..', '..', 'extension');
execFileSync(process.execPath, [join(ext, 'node_modules', 'esbuild', 'bin', 'esbuild'), join(ext, 'src/core/engine.ts'),
  '--bundle', '--platform=node', '--format=esm', `--outfile=${out}`, '--log-level=warning']);
const { Engine } = await import(pathToFileURL(out).href);
const e = new Engine(await buildBundle());
const rows = readFileSync(csv, 'utf8').trim().split('\n').map((l) => l.split(',')).map(([r, d]) => [Number(r), d.trim()]);
const pick = rows.filter(([r, d]) => r <= TOP || /\.(lv|lt|ee)$/.test(d));
let n = 0;
for (const [rank, d] of pick) {
  const r = e.check(`https://www.${d}/`);
  if (r.verdict !== 'suspicious' && r.verdict !== 'danger') continue;
  n++;
  console.log(`${String(rank).padStart(7)} ${r.verdict === 'danger' ? 'BĪSTAMS ' : 'aizdomīgs'} ${String(r.score).padStart(2)} ${d.padEnd(34)} ${r.brand?.id ?? ''} ${r.reasons.map((x) => x.code).join(',')}`);
}
console.log(`\nPārbaudīti ${pick.length} domēni (top ${TOP} + .lv/.lt/.ee); brīdinājumi: ${n}`);
