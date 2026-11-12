#!/usr/bin/env node
// Automātiska ziņojuma pārbaude (GitHub Action uz jaunu issue).
// Ievade: env ISSUE_BODY. Izvade: triage-comment.md + triage-labels.txt (komatiem atdalītas etiķetes).
import { promises as dns } from 'node:dns';
import { writeFileSync } from 'node:fs';
import { hostIn, isShared, parseIssue, readBrands, readList, registrable } from './lib.mjs';

const r = parseIssue(process.env.ISSUE_BODY ?? '', process.env.ISSUE_TITLE ?? '');
const labels = new Set();
const rows = [];
const notes = [];

async function domainAge(domain) {
  try {
    const res = await fetch(`https://rdap.org/domain/${domain}`, { headers: { accept: 'application/rdap+json' } });
    if (!res.ok) return null;
    const j = await res.json();
    const ev = (j.events ?? []).find((e) => e.eventAction === 'registration');
    return ev ? Math.floor((Date.now() - Date.parse(ev.eventDate)) / 86400000) : null;
  } catch {
    return null;
  }
}

if (!r.url) {
  labels.add('invalid');
  notes.push('❌ Neizdevās atrast derīgu saiti (http/https) laukā "Saite".');
} else {
  const u = new URL(r.url);
  const host = u.hostname.toLowerCase();
  const domain = registrable(host);
  const brands = readBrands();
  const official = new Set(brands.flatMap((b) => b.official));
  const allow = new Set(readList('allowlist/domains.txt'));
  const block = new Set(readList('blocklist/domains.txt'));
  const shared = readList('lists/shared-hosting.txt');
  const ownerBrand = brands.find((b) => hostIn(new Set(b.official), host));

  rows.push(['Hosts', `\`${host}\``], ['Domēns', `\`${domain}\``], ['Veids', r.kind ?? '—']);
  if (r.kind) labels.add(r.kind === 'phishing' ? 'phishing' : 'false-positive');

  if (hostIn(official, host)) {
    labels.add('auto:official');
    notes.push(`⚠️ Šis ir **${ownerBrand?.name}** oficiālais domēns. Ja ziņots kā krāpniecisks – visticamāk kļūda (vai konkrēta lapa uz koplietojama servisa).`);
  }
  if (hostIn(block, host)) {
    labels.add('auto:already-listed');
    notes.push('ℹ️ Domēns jau ir bloķēto sarakstā.');
  }
  if (hostIn(allow, host)) {
    labels.add('auto:allowlisted');
    notes.push('ℹ️ Domēns ir baltajā sarakstā.');
  }
  if (isShared(host, shared)) {
    labels.add('auto:shared-hosting');
    notes.push('ℹ️ Koplietojams hostings – tiks bloķēta tikai konkrētā saite, ne viss domēns.');
  }
  try {
    const addrs = await dns.resolve(host);
    rows.push(['DNS', `✅ ${addrs.slice(0, 3).join(', ')}`]);
  } catch {
    rows.push(['DNS', '❌ neatrisinās (lapa, iespējams, jau slēgta)']);
    labels.add('auto:dns-fail');
  }
  const age = await domainAge(domain);
  rows.push(['Domēna vecums', age == null ? 'nezināms' : `${age} d.`]);
  if (age != null && age < 30) {
    labels.add('auto:new-domain');
    notes.push(`🚩 Domēns reģistrēts tikai pirms ${age} dienām – raksturīgi krāpniekiem.`);
  }
  const lower = host.replace(/[^a-z0-9]/g, '');
  const looks = brands.filter((b) => b.keywords.some((k) => k.length >= 4 && lower.includes(k.replace(/[^a-z0-9]/g, ''))));
  if (looks.length && !ownerBrand) {
    labels.add('auto:brand-lookalike');
    notes.push(`🚩 Adresē ir zīmola nosaukums: ${looks.map((b) => b.name).join(', ')}.`);
  }
}

const comment = [
  '### 🤖 Automātiskā pārbaude',
  '',
  '| | |',
  '|---|---|',
  ...rows.map(([a, b]) => `| ${a} | ${b} |`),
  '',
  ...notes.map((n) => `- ${n}`),
  '',
  'Uzturētājs: pievieno etiķeti **`approved`**, lai saite automātiski nonāktu bāzē (vai aizver issue, ja nepiekrīti).',
  '',
  '> ⚠️ Neatveriet ziņoto saiti savā ikdienas pārlūkā.',
].join('\n');

writeFileSync('triage-comment.md', comment);
writeFileSync('triage-labels.txt', [...labels].join(','));
console.log(comment);
