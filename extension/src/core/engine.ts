import { parse } from 'tldts';
import type { Brand, BrandRef, Bundle, CheckContext, CheckResult, PageSignals, Reason, Verdict } from './types';
import { hasMixedScript, levenshtein, norm, skeleton, stripDiacritics, tokens } from './text';
import { hostToUnicode } from './punycode';

const DANGER = 70;
const SUSPICIOUS = 40;

const SUSPICIOUS_TLDS = new Set([
  'top', 'xyz', 'icu', 'buzz', 'cfd', 'sbs', 'click', 'link', 'live', 'shop', 'online', 'site', 'website',
  'space', 'fun', 'rest', 'bond', 'cyou', 'monster', 'quest', 'lol', 'work', 'support', 'help', 'digital',
  'store', 'tk', 'ml', 'ga', 'cf', 'gq', 'pw', 'cc', 'su', 'ru', 'info', 'app', 'today', 'vip', 'pro',
]);

const PHISH_WORDS = [
  'login', 'signin', 'logon', 'verify', 'verif', 'secure', 'security', 'auth', 'update', 'account', 'wallet',
  'konts', 'pieslegt', 'apstiprin', 'atjaun', 'parole', 'smartid', 'eparaksts', 'internetbank', 'atmaksa',
  'refund', 'bonus', 'payment', 'maksajum', 'invoice', 'rekins', 'piegade', 'sutijum', 'paka', 'delivery',
  'customs', 'muita', 'unlock', 'bloket', 'confirm',
];

/** Galotnes, kurās domēnus var reģistrēt tikai valsts iestādes – uzskatām par drošām. */
const TRUSTED_SUFFIXES = new Set(['gov.lv', 'mil.lv', 'gov.lt', 'gov.ee', 'gov.uk', 'europa.eu']);

const COUNTRY_TOKENS = new Set(['lv', 'latvija', 'latvia', 'lat', 'riga', 'gov', 'eu']);
const TLD_LIKE = '(lv|com|gov|ee|lt|eu|net|org)';
const AUTH_MARKERS = /smart-?id|e-?paraksts|mobile-?id|internetbank|internetbanka|personas\s?kod/i;

interface KwEntry {
  brand: Brand;
  kw: string;
  skel: string;
  strict: boolean;
}

interface BrandHit {
  brand: Brand;
  score: number;
  code: string;
}

function ref(b: Brand): BrandRef {
  return { id: b.id, name: b.name, url: b.url };
}

/** Meklē hostu vai tā vecākdomēnu kopā, bet ne augstāk par reģistrējamo domēnu. */
function matchUpTo(set: Set<string>, host: string, domain: string): string | null {
  let h = host;
  for (;;) {
    if (set.has(h)) return h;
    if (h === domain) return null;
    const i = h.indexOf('.');
    if (i < 0) return null;
    h = h.slice(i + 1);
  }
}

/** Vai `host` satur `d` kā atsevišķu daļu (pirms/pēc: sākums, beigas, '.' vai '-'). */
function embeds(host: string, d: string, brandWords: Set<string>): boolean {
  const label = d.split('.')[0];
  for (let i = host.indexOf(d); i >= 0; i = host.indexOf(d, i + 1)) {
    const before = i === 0 ? '' : host[i - 1];
    const after = host[i + d.length] ?? '';
    // "my-swedbank.lv" – atdarinājums; "intercom-messenger.com", "ks-live.com" – parasts vārds, nejaušība
    const beforeOk = before === '' || before === '.' || (before === '-' && brandWords.has(norm(label)));
    if (beforeOk && (after === '' || after === '.' || after === '-')) return true;
  }
  return false;
}

export class Engine {
  readonly bundle: Bundle;
  private official = new Map<string, Brand>();
  private officialSet = new Set<string>();
  /** Zīmola oficiālo domēnu publiskās galotnes (lv, gov.lv, com …). */
  private officialSuffixes = new Map<string, Set<string>>();
  private anyTld = new Map<string, Brand>();
  private brandWords = new Map<string, Set<string>>();
  private allow: Set<string>;
  private block: Set<string>;
  private blockUrls: string[];
  private shared: string[];
  private kws: KwEntry[] = [];
  private brandIds = new Map<string, Brand>();

  constructor(bundle: Bundle) {
    this.bundle = bundle;
    for (const b of bundle.brands) {
      this.brandIds.set(b.id, b);
      for (const d of b.official) this.official.set(d.toLowerCase(), b);
      for (const l of b.anyTld ?? []) this.anyTld.set(l.toLowerCase(), b);
      this.brandWords.set(b.id, new Set([...b.keywords, ...(b.strictKeywords ?? [])].map(norm)));
      this.officialSuffixes.set(b.id, new Set(b.official.map((d) => parse(d).publicSuffix ?? '')));
      for (const k of b.keywords) {
        const n = norm(k);
        if (n.length >= 4) this.kws.push({ brand: b, kw: n, skel: skeleton(n), strict: false });
        else if (n) this.kws.push({ brand: b, kw: n, skel: skeleton(n), strict: true });
      }
      for (const k of b.strictKeywords ?? []) {
        const n = norm(k);
        if (n) this.kws.push({ brand: b, kw: n, skel: skeleton(n), strict: true });
      }
    }
    this.officialSet = new Set(this.official.keys());
    this.allow = new Set(bundle.allowlist.map((d) => d.toLowerCase()));
    this.block = new Set(bundle.blocklist.domains.map((d) => d.toLowerCase()));
    this.blockUrls = bundle.blocklist.urls.map((u) => u.toLowerCase());
    this.shared = bundle.sharedHosting.map((d) => d.toLowerCase());
  }

  /**
   * Drukas kļūda: 1 atšķirība (>=11 burti – 2); 6–7 burti – tikai ar oficiālo vai aizdomīgu galotni;
   * īsāki vārdi – nekad (mail≈gmail, telex≈tele2, pcloud≈icloud dod pārāk daudz kļūdainu brīdinājumu).
   */
  private isTypo(e: KwEntry, dNorm: string, dTokens: string[], suffix: string, tld: string): boolean {
    const n = e.kw.length;
    if (e.strict || n < 6) return false;
    if (n <= 7 && !(this.officialSuffixes.get(e.brand.id)?.has(suffix) || SUSPICIOUS_TLDS.has(tld))) return false;
    const max = n >= 11 ? 2 : 1;
    if (dNorm !== e.kw && levenshtein(dNorm, e.kw, max) <= max) return true;
    return dTokens.some((t) => t !== e.kw && t.length >= n - 1 && levenshtein(t, e.kw, 1) <= 1);
  }

  get brands(): Brand[] {
    return this.bundle.brands;
  }

  brand(id: string): Brand | undefined {
    return this.brandIds.get(id);
  }

  /** Kuri zīmoli minēti tekstā (meklēšanas frāzē, virsrakstā). */
  brandsInText(text: string): Brand[] {
    const toks = tokens(text);
    const joined = toks.join('');
    const found: Brand[] = [];
    for (const e of this.kws) {
      if (found.includes(e.brand)) continue;
      const hit = e.strict
        ? toks.includes(e.kw)
        : joined.includes(e.kw) || (e.kw.length >= 5 && toks.some((t) => t.length >= 5 && levenshtein(t, e.kw, 1) <= 1));
      if (hit) found.push(e.brand);
    }
    return found;
  }

  check(raw: string, ctx: CheckContext = {}): CheckResult {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return { url: raw, host: '', domain: '', verdict: 'unknown', score: 0, reasons: [] };
    }
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    const base = { url: u.href, host };
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { ...base, domain: host, verdict: 'unknown', score: 0, reasons: [] };
    }
    const p = parse(host, { allowPrivateDomains: true });
    const domain = p.domain ?? host;

    // 1) Konkrētas bloķētas saites (arī uz "oficiāliem" hostiem, piem. docs.google.com/forms/...)
    const key = host + u.pathname.toLowerCase();
    if (this.blockUrls.some((b) => key.startsWith(b))) {
      return { ...base, domain, verdict: 'danger', score: 100, listed: 'url', reasons: [this.reason('blocklist', {})] };
    }
    // 2) Oficiālie zīmolu domēni (līdz ICANN domēnam: googleapis.com, withgoogle.com ir "privātas galotnes")
    const icann = parse(host);
    const icannDomain = icann.domain ?? domain;
    const off = matchUpTo(this.officialSet, host, icannDomain);
    const anyTldBrand = icann.domainWithoutSuffix ? this.anyTld.get(icann.domainWithoutSuffix) : undefined;
    if (off || anyTldBrand) {
      const b = off ? this.official.get(off)! : anyTldBrand!;
      return { ...base, domain, verdict: 'official', score: 0, reasons: [], brand: ref(b) };
    }
    // 3) Baltais saraksts un valsts galotnes (gov.lv u.c.)
    if (matchUpTo(this.allow, host, icannDomain) || TRUSTED_SUFFIXES.has(icann.publicSuffix ?? '') || host === 'europa.eu' || host.endsWith('.europa.eu')) {
      return { ...base, domain, verdict: 'safe', score: 0, reasons: [] };
    }
    // 4) Bloķētie domēni
    if (matchUpTo(this.block, host, domain)) {
      return { ...base, domain, verdict: 'danger', score: 100, listed: 'domain', reasons: [this.reason('blocklist', {})] };
    }
    if (p.isIp || !p.domain || (!p.isIcann && !p.isPrivate)) {
      return { ...base, domain, verdict: 'unknown', score: 0, reasons: [] };
    }

    // 5) Heuristika
    const uniHost = hostToUnicode(host);
    const dwl = hostToUnicode(p.domainWithoutSuffix ?? domain);
    const sub = hostToUnicode(p.subdomain ?? '');
    const dNorm = norm(dwl);
    const dTokens = tokens(dwl);
    const dSkel = skeleton(dwl);
    const subNorm = norm(sub);
    const subTokens = tokens(sub);
    const hostPlain = stripDiacritics(uniHost.toLowerCase());
    const tld = (p.publicSuffix ?? '').split('.').pop() ?? '';

    let best: BrandHit | null = null;
    const consider = (h: BrandHit) => {
      if (!best || h.score > best.score) best = h;
    };

    for (const e of this.kws) {
      let s = 0;
      let code = '';
      if (e.strict) {
        if (dSkel === e.skel && dNorm !== e.kw) [s, code] = [70, 'homoglyph'];
        else if (dTokens.includes(e.kw)) [s, code] = [45, 'brand-in-domain'];
        else if (subTokens.includes(e.kw)) [s, code] = [35, 'brand-in-subdomain'];
      } else if (dNorm === e.kw) [s, code] = [60, 'brand-other-tld'];
      else if (dSkel === e.skel) [s, code] = [70, 'homoglyph'];
      else if (dTokens.includes(e.kw)) [s, code] = [50, 'brand-in-domain'];
      else if (dNorm.includes(e.kw)) [s, code] = [45, 'brand-in-domain'];
      else if (dSkel.includes(e.skel)) [s, code] = [65, 'homoglyph'];
      else if (this.isTypo(e, dNorm, dTokens, p.publicSuffix ?? '', tld)) {
        // drukas kļūda + tā pati galotne kā oficiālajam (swedbamk.lv, steamcommunlty.com) = ļoti aizdomīgi
        const sameTld = this.officialSuffixes.get(e.brand.id)?.has(p.publicSuffix ?? '-') ?? false;
        [s, code] = [sameTld ? 70 : 55, 'typosquat'];
      }
      else if (subTokens.includes(e.kw) || subNorm.includes(e.kw)) [s, code] = [40, 'brand-in-subdomain'];

      // "eveseliba.lv.kautkas.com", "swedbank-lv-login.com"
      if (s > 0 && new RegExp(`(^|[.-])${e.kw}[.-]${TLD_LIKE}[.-]`).test(hostPlain) && s < 70) {
        [s, code] = [70, 'fake-domain-prefix'];
      }
      // Globālie zīmoli paši lieto daudz domēnu ar savu nosaukumu – nosaukums vien = vājš signāls
      if (e.brand.weak && (code === 'brand-in-domain' || code === 'brand-in-subdomain')) s = Math.min(s, 30);
      if (s > 0) consider({ brand: e.brand, score: s, code });
    }
    // Iestrādāts oficiālais domēns: "swedbank.lv-secure.com", "eveseliba.gov.lv.abc.xyz"
    for (const [offDomain, b] of this.official) {
      if (offDomain.length >= 6 && embeds(hostPlain, offDomain, this.brandWords.get(b.id)!)) consider({ brand: b, score: 75, code: 'official-embedded' });
    }

    let score = 0;
    const reasons: Reason[] = [];
    let brand: Brand | undefined;
    const hit = best as BrandHit | null;
    const qBrands = ctx.query ? this.brandsInText(ctx.query) : [];

    if (hit) {
      brand = hit.brand;
      score = hit.score;
      reasons.push(this.reason(hit.code, { brand, domain, tld }));
    } else if (ctx.isAd && ctx.title) {
      const tBrands = this.brandsInText(ctx.title);
      const b = tBrands.find((x) => qBrands.includes(x)) ?? tBrands[0];
      if (b) {
        brand = b;
        score = 45;
        reasons.push(this.reason('ad-impersonation', { brand, domain }));
      }
    }

    const mixed = uniHost.split('.').some(hasMixedScript);
    if (mixed) {
      score += 40;
      reasons.push(this.reason('mixed-script', {}));
    }

    if (brand) {
      if (SUSPICIOUS_TLDS.has(tld)) {
        score += 15;
        reasons.push(this.reason('suspicious-tld', { tld }));
      }
      const hay = norm(uniHost + u.pathname);
      const words = PHISH_WORDS.filter((w) => hay.includes(w) && !norm(brand!.name).includes(w)).length;
      if (words) {
        score += Math.min(20, words * 10);
        reasons.push(this.reason('phishing-words', {}));
      }
      if (p.isPrivate || this.shared.some((s) => host === s || host.endsWith('.' + s))) {
        score += 15;
        reasons.push(this.reason('free-hosting', {}));
      }
      if (dTokens.some((t) => COUNTRY_TOKENS.has(t))) {
        score += 10;
        reasons.push(this.reason('country-hint', {}));
      }
      if (host.includes('xn--') && !mixed) {
        score += 10;
        reasons.push(this.reason('punycode', {}));
      }
      // Meklēšanas sakritība pastiprina tikai jau stipru atdarinājumu (ne tikai līdzīgu vārdu)
      if (qBrands.includes(brand) && (hit?.score ?? 0) >= 65) {
        score += 15;
        reasons.push(this.reason('search-mismatch', { brand }));
      }
    }

    score = Math.min(score, 99);
    const verdict: Verdict = score >= DANGER ? 'danger' : score >= SUSPICIOUS ? 'suspicious' : 'unknown';
    return {
      ...base,
      domain,
      verdict,
      score,
      reasons: verdict === 'unknown' ? [] : reasons,
      brand: brand && verdict !== 'unknown' ? ref(brand) : undefined,
    };
  }

  /** Papildu pārbaude pēc lapas satura (pieslēgšanās forma, Smart-ID, zīmols virsrakstā). */
  checkPage(url: string, sig: PageSignals): CheckResult {
    const r = this.check(url);
    if (r.verdict === 'official' || r.verdict === 'safe' || r.listed) return r;
    const text = `${sig.title}\n${sig.text}`;
    const auth = AUTH_MARKERS.test(text);
    const login = sig.hasPassword || sig.hasIdField || auth;
    if (!login) return r;

    if (r.score >= SUSPICIOUS) {
      const score = Math.min(99, r.score + 30);
      return {
        ...r,
        score,
        verdict: score >= DANGER ? 'danger' : 'suspicious',
        reasons: [...r.reasons, this.reason('login-on-lookalike', {})],
      };
    }
    // Zīmols virsrakstā + pieslēgšanās elementi uz neoficiāla domēna
    const tBrands = this.brandsInText(sig.title);
    if (tBrands.length && (sig.hasPassword || sig.hasIdField || auth)) {
      const b = tBrands[0];
      return {
        ...r,
        score: 50,
        verdict: 'suspicious',
        brand: ref(b),
        reasons: [this.reason('brand-login-unofficial', { brand: b, domain: r.domain })],
      };
    }
    return r;
  }

  private reason(code: string, o: { brand?: Brand; domain?: string; tld?: string }): Reason {
    const b = o.brand?.name ?? '';
    const d = o.domain ?? '';
    const texts: Record<string, string> = {
      blocklist: 'Adrese ir zināmo krāpniecisko vietņu sarakstā.',
      'official-embedded': `Adresē iestrādāts ${b} oficiālais domēns, bet lapa patiesībā atrodas citur (${d}).`,
      'fake-domain-prefix': `Adrese sākas kā ${b} lapa, bet īstais domēns ir ${d}.`,
      homoglyph: `Adresē izmantoti līdzīga izskata simboli, lai atdarinātu ${b}.`,
      'brand-other-tld': `${b} nosaukums ar citu domēna galotni (.${o.tld}) – tā nav oficiālā adrese.`,
      typosquat: `Adrese ir ļoti līdzīga ${b}, bet atšķiras par dažiem burtiem.`,
      'brand-in-domain': `Adresē ir ${b} nosaukums, bet tas nav ${b} oficiālais domēns.`,
      'brand-in-subdomain': `${b} nosaukums ir tikai apakšdomēnā – īstais domēns ir ${d}.`,
      'ad-impersonation': `Reklāma izliekas par ${b}, bet ved uz ${d}.`,
      'mixed-script': 'Adresē sajaukti dažādu alfabētu burti (piem., kirilica ar latīņu).',
      'suspicious-tld': `Domēna galotne .${o.tld} bieži tiek izmantota krāpniecībā.`,
      'phishing-words': 'Adresē ir pikšķerēšanai raksturīgi vārdi (login, verify, atmaksa u.c.).',
      'free-hosting': 'Lapa izvietota bezmaksas hostingā, ko bieži izmanto krāpnieki.',
      'country-hint': 'Adresē pievienots "lv"/"gov" u.tml., lai izskatītos oficiālāk.',
      punycode: 'Adresē ir nelatīņu (punycode) simboli.',
      'search-mismatch': `Jūs meklējāt ${b}, bet šī saite neved uz ${b} oficiālo lapu.`,
      'login-on-lookalike': 'Lapa prasa pieslēgšanās datus (parole / Smart-ID / personas kods).',
      'brand-login-unofficial': `Lapa izskatās pēc ${b} pieslēgšanās, bet atrodas adresē ${d}.`,
    };
    return { code, text: texts[code] ?? code };
  }
}
