#!/usr/bin/env node
// Apvieno zīmolus, sarakstus un (pēc izvēles) ārējās plūsmas vienā bundle.json un paraksta ar Ed25519.
//   node scripts/build-bundle.mjs [--feeds] [--sign] [--key <pem>] [--out <dir>]
// Atslēga: env URLGUARD_SIGNING_KEY (PEM teksts) vai --key fails (noklusēti <repo>/.keys/signing-private.pem).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPrivateKey, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse } from 'tldts';
import {
  DATA_DIR, ROOT_DIR, SCHEMA_VERSION, hostIn, isDomain, isShared, readBrands, readList, registrable, uniq, urlKey,
} from './lib.mjs';

// Galotnes, kurās domēnus reģistrē tikai valsts iestādes – ārēji saraksti tās nekad nebloķē.
const TRUSTED_SUFFIXES = ['gov.lv', 'mil.lv', 'gov.lt', 'gov.ee', 'gov.uk', 'europa.eu'];
const BALTIC = /\.(lv|lt|ee)$/;

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'urlguard-data-builder (+https://github.com/Jazekss/URLguard)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Populārākie domēni (Tranco). Ja nav pieejami – null, un lielie saraksti neko nebloķē (tikai "aizdomīgs"). */
async function fetchPopular(top) {
  try {
    const meta = JSON.parse(await fetchText('https://tranco-list.eu/api/lists/date/latest'));
    const csv = await fetchText(`https://tranco-list.eu/download/${meta.list_id}/${top}`);
    const set = new Set(csv.split(/\r?\n/).map((l) => l.split(',')[1]?.trim().toLowerCase()).filter(Boolean));
    console.log(`populārie domēni (Tranco ${meta.list_id}): ${set.size}`);
    return set.size > top / 2 ? set : null;
  } catch (e) {
    console.warn(`Tranco nav pieejams (${e.message}) – lielie saraksti tikai kā "aizdomīgi"`);
    return null;
  }
}

/**
 * Ārējās plūsmas ar apstiprināšanas likumiem:
 *  - trust "high" (OpenPhish – aktuāls, precīzs): bloķē
 *  - domēns >=2 neatkarīgos sarakstos: bloķē (tikai, ja zināms populāro saraksts)
 *  - tikai 1 lielajā sarakstā + (Baltijas domēns vai zīmola vārds adresē): "aizdomīgs"
 *  - oficiāli, baltais saraksts, populāri (top N), gov.lv u.c.: nekad
 * Lielie saraksti satur arī uzlauztas likumīgas lapas, tāpēc viens saraksts vien nekad nebloķē.
 */
async function fetchFeeds({ protectedSet, shared, brandWords }) {
  const cfg = JSON.parse(readFileSync(join(DATA_DIR, 'feeds.json'), 'utf8'));
  const seen = new Map(); // domēns -> Set(plūsmu nosaukumi)
  const high = new Set();
  const urls = [];
  const privateHosts = new Set();
  for (const f of cfg.feeds.filter((x) => x.enabled)) {
    try {
      const lines = (await fetchText(f.url)).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^[#!]/.test(l));
      let n = 0;
      for (const line of lines.slice(0, f.max ?? 1_000_000)) {
        let host;
        let key;
        try {
          if (f.format === 'domains') host = line.split(/\s+/).pop().toLowerCase().replace(/^\*\./, '');
          else {
            const u = new URL(line);
            host = u.hostname.toLowerCase();
            key = urlKey(line);
          }
        } catch {
          continue;
        }
        if (!isDomain(host)) continue;
        n++;
        // Uz oficiāliem / koplietojamiem hostiem (arī "privātās galotnes": *.digitaloceanspaces.com u.c.)
        // – tikai konkrētā saite un tikai no precīza avota; zīmola atdarinājumi – kā "aizdomīgi"
        const priv = parse(host, { allowPrivateDomains: true }).isPrivate;
        if (hostIn(protectedSet, host) || isShared(host, shared) || priv) {
          if (priv && !hostIn(protectedSet, host)) privateHosts.add(host);
          if (f.trust === 'high' && key && key.includes('/')) urls.push(key);
          continue;
        }
        const d = registrable(host);
        if (!seen.has(d)) seen.set(d, new Set());
        seen.get(d).add(f.name);
        if (f.trust === 'high') high.add(d);
      }
      console.log(`plūsma ${f.name}: ${n} ieraksti`);
    } catch (e) {
      console.warn(`plūsma ${f.name} neizdevās: ${e.message}`);
    }
  }
  const popular = await fetchPopular(cfg.popularTop ?? 100000);
  const isTrusted = (d) => TRUSTED_SUFFIXES.some((s) => d === s || d.endsWith('.' + s));
  const isPopular = (d) => !!popular && (popular.has(d) || popular.has('www.' + d));
  const brandish = (d) => {
    const plain = d.replace(/[^a-z0-9]/g, '');
    const toks = d.split(/[^a-z0-9]+/);
    return brandWords.loose.some((k) => plain.includes(k)) || brandWords.strict.some((k) => toks.includes(k));
  };
  const domains = [];
  const suspect = [];
  const review = []; // Baltijas domēni tikai vienā sarakstā – bieži sen uzlauztas likumīgas lapas -> pārbauda cilvēks
  for (const [d, feeds] of seen) {
    if (isTrusted(d) || isPopular(d)) continue;
    if (high.has(d)) domains.push(d);
    else if (feeds.size >= 2 && popular) domains.push(d);
    else if (brandish(d)) suspect.push(d);
    else if (BALTIC.test(d)) review.push(d);
  }
  for (const h of privateHosts) if (brandish(h)) suspect.push(h);
  console.log(
    `no plūsmām: bloķēt ${domains.length}, aizdomīgi ${suspect.length}, pārskatīt ${review.length}, saites ${urls.length} (no ${seen.size} domēniem)`,
  );
  return { domains, urls, suspect, review };
}

// Saderība ar vecākām paplašinājuma versijām: tās nepazīst "anyTld", tāpēc tiem pašiem zīmoliem
// pievienojam arī izplatītākās valstu galotnes kā parastus oficiālos domēnus (google.lv, dpd.de …).
// Likums: bāzei VIENMĒR jāstrādā arī ar vecākiem dzinējiem – jaunu mehānismu dēļ neizņemam vecos ierakstus.
const COMPAT_SUFFIXES = [
  'com', 'net', 'org', 'eu', 'lv', 'lt', 'ee', 'fi', 'se', 'no', 'dk', 'de', 'at', 'ch', 'nl', 'be', 'fr', 'es', 'pt', 'it',
  'ie', 'pl', 'cz', 'sk', 'hu', 'ro', 'bg', 'gr', 'hr', 'si', 'ru', 'by', 'ua', 'us', 'ca', 'co.uk', 'com.au', 'co.in',
  'com.tr', 'com.br', 'com.mx', 'com.ua', 'com.hk', 'com.sg', 'co.jp', 'co.kr', 'co.il', 'co.za', 'cn', 'is', 'lu',
];
function withCompat(b) {
  if (!b.anyTld?.length) return b.official;
  const extra = b.anyTld.flatMap((label) => COMPAT_SUFFIXES.map((s) => `${label}.${s}`));
  return [...new Set([...b.official, ...extra])];
}

export async function buildBundle({ feeds = false } = {}) {
  const brands = readBrands();
  const allowlist = uniq(readList('allowlist/domains.txt'));
  const sharedHosting = uniq(readList('lists/shared-hosting.txt'));
  const official = brands.flatMap((b) => withCompat(b).map((d) => d.toLowerCase()));
  const protectedSet = new Set([...official, ...allowlist]);
  const norm = (w) => w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  const brandWords = {
    loose: brands.flatMap((b) => b.keywords.map(norm).filter((k) => k.length >= 5)),
    strict: brands.flatMap((b) => [...(b.strictKeywords ?? []), ...b.keywords.filter((k) => norm(k).length < 5)].map(norm)),
  };

  let domains = readList('blocklist/domains.txt');
  let urls = readList('blocklist/urls.txt');
  let suspect = [];
  let review = [];
  if (feeds) {
    const f = await fetchFeeds({ protectedSet, shared: sharedHosting, brandWords });
    domains.push(...f.domains);
    urls.push(...f.urls);
    suspect = f.suspect;
    review = f.review;
  }
  domains = uniq(domains.filter((d) => isDomain(d) && !hostIn(protectedSet, d) && !isShared(d, sharedHosting)));
  const blocked = new Set(domains);
  suspect = uniq(suspect.filter((d) => isDomain(d) && !blocked.has(d) && !hostIn(protectedSet, d)));
  urls = uniq(urls.filter((u) => /^[a-z0-9.-]+\/\S+$/.test(u)));

  buildBundle.review = uniq(review);
  return {
    version: SCHEMA_VERSION,
    generated: new Date().toISOString(),
    brands: brands.map(({ id, name, category, url, official, keywords, strictKeywords, anyTld, weak, noTypo, region }) => ({
      id, name, category, url, official: withCompat({ official, anyTld }), keywords,
      ...(strictKeywords ? { strictKeywords } : {}), ...(anyTld ? { anyTld } : {}), ...(weak ? { weak } : {}), ...(noTypo ? { noTypo } : {}), region,
    })),
    // suspect – jauns lauks (1.2.0+); vecākas versijas to vienkārši ignorē
    blocklist: { domains, urls, suspect },
    allowlist,
    sharedHosting,
    // shorteners – jauns lauks (1.3.0+); vecākas versijas to ignorē
    shorteners: uniq(readList('lists/shorteners.txt')),
  };
}

/**
 * Publiskie saraksti citiem rīkiem (AdGuard, uBlock Origin, Pi-hole, hosts). Tikai MŪSU pašu apstiprinātie
 * domēni (data/blocklist/domains.txt) – bez ārējo plūsmu datiem (licences + katru ierakstu pārbaudījis cilvēks).
 */
export function writePublicLists(out) {
  const domains = uniq(readList('blocklist/domains.txt').filter((d) => isDomain(d) && !d.endsWith('.invalid')));
  const now = new Date().toISOString();
  const head = (c) =>
    [
      `${c} Title: URLguard – Baltic phishing blocklist`,
      `${c} Description: Phishing domains impersonating Baltic banks, government portals and other brands. Reviewed by people.`,
      `${c} Homepage: https://github.com/Jazekss/URLguard`,
      `${c} Report: https://github.com/Jazekss/URLguard/issues/new?template=report.yml`,
      `${c} Last modified: ${now}`,
      `${c} Entries: ${domains.length}`,
      `${c} License: CC0-1.0 (public domain) – https://creativecommons.org/publicdomain/zero/1.0/`,
      `${c} Expires: 1 day`,
    ].join('\n');
  mkdirSync(join(out, 'lists'), { recursive: true });
  writeFileSync(join(out, 'lists', 'domains.txt'), `${head('#')}\n${domains.join('\n')}\n`);
  writeFileSync(join(out, 'lists', 'hosts.txt'), `${head('#')}\n${domains.map((d) => `0.0.0.0 ${d}`).join('\n')}\n`);
  writeFileSync(join(out, 'lists', 'adguard.txt'), `[Adblock Plus]\n${head('!')}\n${domains.map((d) => `||${d}^`).join('\n')}\n`);
  return domains.length;
}

export function signBytes(bytes, pem) {
  return sign(null, bytes, createPrivateKey(pem)).toString('base64');
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (n) => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const out = resolve(arg('--out') ?? join(DATA_DIR, 'dist'));
  const bundle = await buildBundle({ feeds: args.includes('--feeds') });
  mkdirSync(out, { recursive: true });
  const bytes = Buffer.from(JSON.stringify(bundle));
  writeFileSync(join(out, 'bundle.json'), bytes);
  writeFileSync(
    join(out, 'meta.json'),
    JSON.stringify({
      generated: bundle.generated,
      brands: bundle.brands.length,
      blockedDomains: bundle.blocklist.domains.length,
      blockedUrls: bundle.blocklist.urls.length,
      suspect: bundle.blocklist.suspect.length,
      review: (buildBundle.review ?? []).length,
    }, null, 2),
  );
  const listed = writePublicLists(out);
  console.log(`publiskie saraksti (lists/): ${listed} domēni`);
  writeFileSync(
    join(out, 'review.txt'),
    '# Baltijas domēni, kas ir tikai vienā publiskā krāpnieku sarakstā (bieži – sen uzlauztas likumīgas lapas).\n' +
      '# Pārbaudiet ar roku; ja tiešām krāpnieki – ziņojiet (URLguard "Ziņot"), lai tie nonāk bloķēto sarakstā.\n' +
      (buildBundle.review ?? []).join('\n') + '\n',
  );
  if (args.includes('--sign')) {
    const keyPath = arg('--key') ?? join(ROOT_DIR, '.keys', 'signing-private.pem');
    const pem = process.env.URLGUARD_SIGNING_KEY || (existsSync(keyPath) ? readFileSync(keyPath, 'utf8') : null);
    if (!pem) {
      console.error('Nav parakstīšanas atslēgas (URLGUARD_SIGNING_KEY vai --key).');
      process.exit(1);
    }
    writeFileSync(join(out, 'bundle.json.sig'), signBytes(bytes, pem));
    console.log('Parakstīts.');
  }
  console.log(
    `bundle.json: ${bundle.brands.length} zīmoli, ${bundle.blocklist.domains.length} domēni, ${bundle.blocklist.urls.length} saites -> ${out}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
