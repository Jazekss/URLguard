#!/usr/bin/env node
// Apvieno zīmolus, sarakstus un (pēc izvēles) ārējās plūsmas vienā bundle.json un paraksta ar Ed25519.
//   node scripts/build-bundle.mjs [--feeds] [--sign] [--key <pem>] [--out <dir>]
// Atslēga: env URLGUARD_SIGNING_KEY (PEM teksts) vai --key fails (noklusēti <repo>/.keys/signing-private.pem).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPrivateKey, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  DATA_DIR, ROOT_DIR, SCHEMA_VERSION, hostIn, isDomain, isShared, readBrands, readList, registrable, uniq, urlKey,
} from './lib.mjs';

async function fetchFeeds({ protectedSet, shared }) {
  const cfg = JSON.parse(readFileSync(join(DATA_DIR, 'feeds.json'), 'utf8'));
  const domains = [];
  const urls = [];
  for (const f of cfg.feeds.filter((x) => x.enabled)) {
    try {
      const res = await fetch(f.url, { headers: { 'user-agent': 'urlguard-data-builder' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const lines = (await res.text()).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
      let n = 0;
      for (const line of lines.slice(0, f.max ?? 50000)) {
        let host;
        let key;
        try {
          if (f.format === 'domains') host = line.toLowerCase();
          else {
            const u = new URL(line);
            host = u.hostname.toLowerCase();
            key = urlKey(line);
          }
        } catch {
          continue;
        }
        if (!isDomain(host)) continue;
        // Uz oficiāliem / koplietojamiem hostiem bloķējam tikai konkrēto saiti, nekad visu domēnu.
        if (hostIn(protectedSet, host) || isShared(host, shared)) {
          if (key && key.includes('/')) urls.push(key);
        } else domains.push(host);
        n++;
      }
      console.log(`feed ${f.name}: ${n} ieraksti`);
    } catch (e) {
      console.warn(`feed ${f.name} neizdevās: ${e.message}`);
    }
  }
  return { domains, urls };
}

export async function buildBundle({ feeds = false } = {}) {
  const brands = readBrands();
  const allowlist = uniq(readList('allowlist/domains.txt'));
  const sharedHosting = uniq(readList('lists/shared-hosting.txt'));
  const official = brands.flatMap((b) => b.official.map((d) => d.toLowerCase()));
  const protectedSet = new Set([...official, ...allowlist]);

  let domains = readList('blocklist/domains.txt');
  let urls = readList('blocklist/urls.txt');
  if (feeds) {
    const f = await fetchFeeds({ protectedSet, shared: sharedHosting });
    domains.push(...f.domains);
    urls.push(...f.urls);
  }
  domains = uniq(domains.filter((d) => isDomain(d) && !hostIn(protectedSet, d) && !isShared(d, sharedHosting)));
  urls = uniq(urls.filter((u) => /^[a-z0-9.-]+\/\S+$/.test(u)));

  return {
    version: SCHEMA_VERSION,
    generated: new Date().toISOString(),
    brands: brands.map(({ id, name, category, url, official, keywords, strictKeywords, region }) => ({
      id, name, category, url, official, keywords, ...(strictKeywords ? { strictKeywords } : {}), region,
    })),
    blocklist: { domains, urls },
    allowlist,
    sharedHosting,
  };
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
    }, null, 2),
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
