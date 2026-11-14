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

/** Izlozes / balvas vārdi ierakstā – tipiska soc. tīklu krāpšana ("Lidl izloze"). */
const GIVEAWAY = /izloz|laim[eē]|balv|d[aā]van|d[aā]vin|konkurs|giveaway|\bwin\b|prize|розыгрыш|приз|подар|выигр|loterij|dovan|laimėk|auhind|loos/i;
/** Darbības vārdi, ar kuriem izvilina datus. */
const ACTION = /pieslēd|pieteik|apstiprin|atjaunin|verific|verify|login|log in|sign in|bloķ|aptur|atmaks|kompens|refund|paka|sūtījum|parcel|delivery|войти|подтверд|посылк/i;

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
function embeds(host: string, d: string, brandWords: Set<string>, globalBrand = false): boolean {
  const label = d.split('.')[0];
  for (let i = host.indexOf(d); i >= 0; i = host.indexOf(d, i + 1)) {
    const before = i === 0 ? '' : host[i - 1];
    const after = host[i + d.length] ?? '';
    // "my-swedbank.lv" – atdarinājums; "intercom-messenger.com", "ks-live.com" – parasts vārds, nejaušība
    // Īss globāla zīmola vārds (Apple me.com -> me.com.br) – nejaušība; vietējiem (ss.lv, lg.lv) – atdarinājums
    if (label.length < 4 && globalBrand && !brandWords.has(norm(label))) return false;
    // globāls zīmols ar savu nosaukumu domēna daļā (images-amazon.com, stores-apple.com) – parasti pats zīmols
    const beforeOk = before === '' || before === '.' || (before === '-' && brandWords.has(norm(label)) && !globalBrand);
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
  private suspect: Set<string>;
  private shorteners: Set<string>;
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
    this.suspect = new Set((bundle.blocklist.suspect ?? []).map((d) => d.toLowerCase()));
    this.shorteners = new Set((bundle.shorteners ?? []).map((d) => d.toLowerCase()));
    this.blockUrls = bundle.blocklist.urls.map((u) => u.toLowerCase());
    this.shared = bundle.sharedHosting.map((d) => d.toLowerCase());
  }

  /**
   * Drukas kļūda: 1 atšķirība (>=11 burti – 2); 6–7 burti – tikai ar oficiālo vai aizdomīgu galotni;
   * īsāki vārdi – nekad (mail≈gmail, telex≈tele2, pcloud≈icloud dod pārāk daudz kļūdainu brīdinājumu).
   */
  private isTypo(e: KwEntry, dNorm: string, dTokens: string[], suffix: string, tld: string): boolean {
    const n = e.kw.length;
    if (e.strict || n < 6 || e.brand.noTypo) return false;
    if (n <= 7 && !(this.officialSuffixes.get(e.brand.id)?.has(suffix) || SUSPICIOUS_TLDS.has(tld))) return false;
    const max = n >= 11 ? 2 : 1;
    if (dNorm !== e.kw && levenshtein(dNorm, e.kw, max) <= max) return true;
    return dTokens.some((t) => t !== e.kw && t.length >= n - 1 && levenshtein(t, e.kw, 1) <= 1);
  }

  isShortener(raw: string): boolean {
    try {
      return this.shorteners.has(new URL(raw).hostname.toLowerCase().replace(/^www\./, ''));
    } catch {
      return false;
    }
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
    if (matchUpTo(this.allow, host, icannDomain) || TRUSTED_SUFFIXES.has(icann.publicSuffix ?? '') || /^((gov|gouv|gob|go|govt|mil)\.[a-z]{2}|gov|mil)$/.test(icann.publicSuffix ?? '') || host === 'europa.eu' || host.endsWith('.europa.eu')) {
      return { ...base, domain, verdict: 'safe', score: 0, reasons: [] };
    }
    // 4) Bloķētie domēni
    if (matchUpTo(this.block, host, domain)) {
      return { ...base, domain, verdict: 'danger', score: 100, listed: 'domain', reasons: [this.reason('blocklist', {})] };
    }
    if (this.shorteners.has(host.replace(/^www\./, ''))) {
      return { ...base, domain, verdict: 'unknown', score: 0, reasons: [], shortener: true };
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
        if (e.kw.length >= 4 && dSkel === e.skel && dNorm !== e.kw) [s, code] = [70, 'homoglyph'];
        else if (dTokens.includes(e.kw)) [s, code] = [45, 'brand-in-domain'];
        else if (subTokens.includes(e.kw)) [s, code] = [35, 'brand-in-subdomain'];
      } else if (dNorm === e.kw) [s, code] = [60, 'brand-other-tld'];
      else if (dSkel === e.skel) [s, code] = [70, 'homoglyph'];
      else if (dTokens.includes(e.kw)) [s, code] = [50, 'brand-in-domain'];
      else if (dNorm.includes(e.kw)) [s, code] = [45, 'brand-in-domain'];
      else if (e.kw.length >= 6 && dSkel.includes(e.skel)) [s, code] = [65, 'homoglyph'];
      else if (this.isTypo(e, dNorm, dTokens, p.publicSuffix ?? '', tld)) {
        // drukas kļūda + tā pati galotne kā oficiālajam (swedbamk.lv, steamcommunlty.com) = ļoti aizdomīgi
        const sameTld = this.officialSuffixes.get(e.brand.id)?.has(p.publicSuffix ?? '-') ?? false;
        [s, code] = [sameTld && e.kw.length >= 8 ? 70 : 55, 'typosquat'];
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
      if (offDomain.length >= 6 && embeds(hostPlain, offDomain, this.brandWords.get(b.id)!, !!b.weak)) consider({ brand: b, score: 75, code: 'official-embedded' });
    }

    let score = 0;
    const reasons: Reason[] = [];
    let brand: Brand | undefined;
    const hit = best as BrandHit | null;
    const qBrands = ctx.query ? this.brandsInText(ctx.query) : [];

    // Konteksts, no kura saite atvērta (soc. tīkla ieraksts, e-pasts)
    const ctxText = ctx.context || ctx.anchor ? `${ctx.anchor ?? ''}\n${ctx.context ?? ''}` : '';
    const ctxGiveaway = !!ctxText && GIVEAWAY.test(ctxText);
    const ctxStrong = !!ctxText && (ctxGiveaway || ACTION.test(ctxText));

    if (hit) {
      brand = hit.brand;
      score = hit.score;
      reasons.push(this.reason(hit.code, { brand, domain, tld }));
      // Domēns atdarina zīmolu UN ieraksts par to pašu zīmolu aicina rīkoties / sola balvu -> stiprāks signāls
      if (ctxStrong && this.brandsInText(ctxText).includes(hit.brand)) {
        score += 20;
        reasons.push(this.reason('context-mismatch', { brand, domain }));
        if (ctxGiveaway) {
          score += 25;
          reasons.push(this.reason('giveaway', {}));
        }
      }
    } else if (ctx.isAd && ctx.title) {
      const tBrands = this.brandsInText(ctx.title);
      const b = tBrands.find((x) => qBrands.includes(x)) ?? tBrands[0];
      if (b) {
        brand = b;
        score = 45;
        reasons.push(this.reason('ad-impersonation', { brand, domain }));
      }
    } else if (ctx.context || ctx.anchor) {
      // Saite atvērta no ieraksta par zīmolu, bet ved citur ("Lidl izloze" -> lidl-davanas.top)
      const text = `${ctx.anchor ?? ''}\n${ctx.context ?? ''}`;
      const aBrands = ctx.anchor ? this.brandsInText(ctx.anchor) : [];
      const cBrands = this.brandsInText(text);
      const giveaway = GIVEAWAY.test(text);
      const strong = aBrands.length > 0 || giveaway || ACTION.test(text);
      const b = aBrands[0] ?? cBrands[0];
      if (b && strong) {
        brand = b;
        score = 45;
        reasons.push(this.reason('context-mismatch', { brand, domain }));
        if (giveaway) {
          score += 25;
          reasons.push(this.reason('giveaway', {}));
        }
      }
    }

    // Publiskā krāpnieku sarakstā (tikai vienā avotā) – pats par sevi "aizdomīgs"; kopā ar atdarinājumu – "bīstams"
    if (this.suspect.size && matchUpTo(this.suspect, host, host.split('.').slice(-2).join('.'))) {
      score += 45;
      reasons.push(this.reason('feed-listed', {}));
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
    const params: Reason['params'] = {};
    if (o.brand) params.brand = o.brand.name;
    if (o.domain) params.domain = o.domain;
    if (o.tld) params.tld = o.tld;
    return { code, params };
  }
}
