import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'tldts';

export const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT_DIR = join(DATA_DIR, '..');
export const SCHEMA_VERSION = 1;

export const KIND_PHISH = 'Krāpnieciska saite (phishing)';
export const KIND_FP = 'Kļūdains brīdinājums (lapa ir droša)';

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

export const isDomain = (s) => DOMAIN_RE.test(s);
export const uniq = (a) => [...new Set(a)].sort();

export function readList(rel) {
  const f = join(DATA_DIR, rel);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*/, '').trim().toLowerCase())
    .filter(Boolean);
}

/** Pievieno rindu saraksta failam (ar komentāru), ja tādas vēl nav. */
export function appendToList(rel, value, comment = '') {
  const f = join(DATA_DIR, rel);
  if (readList(rel).includes(value)) return false;
  const cur = existsSync(f) ? readFileSync(f, 'utf8') : '';
  const line = comment ? `${value}  # ${comment}` : value;
  writeFileSync(f, cur.replace(/\s*$/, '\n') + line + '\n');
  return true;
}

export function removeFromList(rel, value) {
  const f = join(DATA_DIR, rel);
  if (!existsSync(f)) return false;
  const lines = readFileSync(f, 'utf8').split(/\r?\n/);
  const kept = lines.filter((l) => l.replace(/#.*/, '').trim().toLowerCase() !== value);
  if (kept.length === lines.length) return false;
  writeFileSync(f, kept.join('\n'));
  return true;
}

export function readBrands() {
  const dir = join(DATA_DIR, 'brands');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => {
      const j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      return j.brands.map((b) => ({ ...b, region: j.region }));
    });
}

export function registrable(host) {
  const p = parse(host, { allowPrivateDomains: true });
  return p.domain ?? host;
}

export function isShared(host, shared) {
  return shared.some((s) => host === s || host.endsWith('.' + s));
}

/** "https://Host/Path?x" -> "host/path" (URL saraksta atslēga). */
export function urlKey(u) {
  const x = new URL(u);
  return (x.hostname.toLowerCase() + x.pathname.toLowerCase()).replace(/\/+$/, '');
}

/** Vai hosts (vai tā vecākdomēns līdz reģistrējamam) ir kopā. */
export function hostIn(set, host) {
  const dom = registrable(host);
  let h = host;
  for (;;) {
    if (set.has(h)) return true;
    if (h === dom) return false;
    const i = h.indexOf('.');
    if (i < 0) return false;
    h = h.slice(i + 1);
  }
}

/** Izvelk laukus no GitHub issue formas ("### Virsraksts\n\nvērtība"). */
export function parseIssue(body = '') {
  const sections = {};
  const parts = body.split(/^###\s+/m).slice(1);
  for (const p of parts) {
    const nl = p.indexOf('\n');
    const head = (nl < 0 ? p : p.slice(0, nl)).trim();
    const val = (nl < 0 ? '' : p.slice(nl + 1)).trim();
    sections[head] = val === '_No response_' ? '' : val;
  }
  const urlField = sections['Saite'] ?? '';
  const m = urlField.match(/https?:\/\/[^\s<>"'`)]+/i);
  const kindRaw = sections['Veids'] ?? '';
  const kind = /phishing|krāpniec/i.test(kindRaw) ? 'phishing' : /kļūdain|droša|false/i.test(kindRaw) ? 'false_positive' : null;
  return {
    url: m ? m[0] : null,
    kind,
    brand: (sections['Zīmols (ja zināms)'] ?? '').slice(0, 100),
    note: (sections['Piezīme'] ?? '').slice(0, 1000),
  };
}
