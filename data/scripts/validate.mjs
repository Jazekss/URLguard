#!/usr/bin/env node
// Pārbauda datu failus (CI uz katru pull request).
import { hostIn, isDomain, readBrands, readList, registrable } from './lib.mjs';

const errors = [];
const brands = readBrands();
const ids = new Set();
const officialOwner = new Map();

for (const b of brands) {
  const where = `zīmols "${b.id ?? '?'}"`;
  if (!/^[a-z0-9-]+$/.test(b.id ?? '')) errors.push(`${where}: nederīgs id`);
  if (ids.has(b.id)) errors.push(`${where}: dublēts id`);
  ids.add(b.id);
  if (!b.name) errors.push(`${where}: nav name`);
  if (!/^https:\/\//.test(b.url ?? '')) errors.push(`${where}: url jābūt https://`);
  if (!Array.isArray(b.official) || !b.official.length) errors.push(`${where}: nav official domēnu`);
  if (!Array.isArray(b.keywords)) errors.push(`${where}: keywords jābūt masīvam`);
  if (!b.keywords?.length && !b.strictKeywords?.length && !(b.official ?? []).length)
    errors.push(`${where}: nav neviena atslēgvārda`);
  for (const d of b.official ?? []) {
    if (!isDomain(d)) errors.push(`${where}: nederīgs domēns "${d}"`);
    if (officialOwner.has(d)) errors.push(`${where}: "${d}" jau pieder ${officialOwner.get(d)}`);
    officialOwner.set(d, b.id);
  }
  try {
    const host = new URL(b.url).hostname;
    if (!hostIn(new Set(b.official), host)) errors.push(`${where}: url hosts nav official sarakstā`);
  } catch {
    errors.push(`${where}: nederīgs url`);
  }
}

const official = new Set(officialOwner.keys());
const allow = readList('allowlist/domains.txt');
const allowSet = new Set(allow);
const block = readList('blocklist/domains.txt');
for (const d of allow) if (!isDomain(d)) errors.push(`allowlist: nederīgs domēns "${d}"`);
for (const d of block) {
  if (!isDomain(d)) errors.push(`blocklist: nederīgs domēns "${d}"`);
  if (hostIn(official, d)) errors.push(`blocklist: "${d}" ir oficiāls zīmola domēns`);
  if (hostIn(allowSet, d)) errors.push(`blocklist: "${d}" ir baltajā sarakstā`);
  if (registrable(d) !== d && hostIn(official, registrable(d))) errors.push(`blocklist: "${d}" ir zem oficiāla domēna`);
}
for (const u of readList('blocklist/urls.txt')) if (!/^[a-z0-9.-]+\/\S+$/.test(u)) errors.push(`urls: nederīgs "${u}"`);

if (errors.length) {
  console.error(errors.map((e) => '✗ ' + e).join('\n'));
  process.exit(1);
}
console.log(`✓ ${brands.length} zīmoli, ${block.length} bloķēti domēni, ${allow.length} baltajā sarakstā – viss kārtībā.`);
