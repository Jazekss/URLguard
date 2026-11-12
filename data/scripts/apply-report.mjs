#!/usr/bin/env node
// Apstiprināts ziņojums -> ieraksts sarakstā. Ievade: env ISSUE_BODY, ISSUE_NUMBER.
// phishing:        domēns -> blocklist/domains.txt (koplietojamam/oficiālam hostam – konkrēta saite -> blocklist/urls.txt)
// false_positive:  domēns -> allowlist/domains.txt (un izņem no blocklist)
import { writeFileSync } from 'node:fs';
import {
  appendToList, hostIn, isDomain, isShared, parseIssue, readBrands, readList, registrable, removeFromList, urlKey,
} from './lib.mjs';

const num = process.env.ISSUE_NUMBER ?? '?';
const r = parseIssue(process.env.ISSUE_BODY ?? '');
const fail = (m) => {
  writeFileSync('apply-result.md', `❌ ${m}`);
  console.error(m);
  process.exit(1);
};

if (!r.url || !r.kind) fail('Ziņojumā nav derīgas saites vai veida.');
const host = new URL(r.url).hostname.toLowerCase();
if (!isDomain(host)) fail(`Nederīgs hosts: ${host}`);
const domain = registrable(host);
const official = new Set(readBrands().flatMap((b) => b.official));
const shared = readList('lists/shared-hosting.txt');
const tag = `#${num}`;
let msg;

if (r.kind === 'phishing') {
  if (hostIn(official, host) || isShared(host, shared)) {
    const key = urlKey(r.url);
    if (!key.includes('/') || key === host) fail('Oficiālam/koplietojamam hostam vajag konkrētu ceļu (ne tikai domēnu).');
    msg = appendToList('blocklist/urls.txt', key, tag) ? `✅ Pievienota bloķēto saišu sarakstam: \`${key}\`` : `ℹ️ \`${key}\` jau bija sarakstā.`;
  } else {
    msg = appendToList('blocklist/domains.txt', domain, tag)
      ? `✅ Domēns \`${domain}\` pievienots bloķēto sarakstam.`
      : `ℹ️ \`${domain}\` jau bija sarakstā.`;
  }
} else {
  if (hostIn(official, host)) fail('Domēns jau ir oficiāls – nav ko pievienot.');
  removeFromList('blocklist/domains.txt', domain);
  msg = appendToList('allowlist/domains.txt', domain, tag)
    ? `✅ Domēns \`${domain}\` pievienots baltajam sarakstam (brīdinājumi vairs netiks rādīti).`
    : `ℹ️ \`${domain}\` jau bija baltajā sarakstā.`;
}
msg += '\n\nIzmaiņas nonāks lietotājiem ar nākamo bāzes atjauninājumu (parasti dažu stundu laikā).';
writeFileSync('apply-result.md', msg);
console.log(msg);
