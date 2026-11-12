// Meklētāju rezultātu nolasīšana (Google, Bing, DuckDuckGo). Tīras funkcijas – testējamas ar happy-dom.

export interface SerpItem {
  key: string;
  block: HTMLElement;
  anchor: HTMLElement;
  url: string;
  displayUrl?: string;
  title: string;
  isAd: boolean;
}

export type Engine = 'google' | 'bing' | 'ddg' | null;

export function detectEngine(host: string): Engine {
  if (/(^|\.)google\.[a-z.]+$/.test(host)) return 'google';
  if (/(^|\.)bing\.com$/.test(host)) return 'bing';
  if (/(^|\.)duckduckgo\.com$/.test(host)) return 'ddg';
  return null;
}

export function getQuery(href: string): string {
  try {
    return new URL(href).searchParams.get('q')?.trim() ?? '';
  } catch {
    return '';
  }
}

/** Atritina meklētāju pāradresācijas saites līdz galamērķim. */
export function unwrap(href: string, base: string): string {
  let u: URL;
  try {
    u = new URL(href, base);
  } catch {
    return href;
  }
  const h = u.hostname;
  if (/(^|\.)google\.[a-z.]+$/.test(h) && u.pathname === '/url') return u.searchParams.get('q') || u.searchParams.get('url') || u.href;
  if (h.endsWith('googleadservices.com') || (/(^|\.)google\.[a-z.]+$/.test(h) && u.pathname.startsWith('/aclk'))) {
    const a = u.searchParams.get('adurl');
    if (a) return a;
  }
  if (h.endsWith('bing.com') && u.pathname.startsWith('/ck/a')) {
    const p = u.searchParams.get('u');
    if (p?.startsWith('a1')) {
      try {
        return atob(p.slice(2).replace(/-/g, '+').replace(/_/g, '/'));
      } catch {
        /* ignore */
      }
    }
  }
  if (h.endsWith('duckduckgo.com') && u.pathname === '/l/') return u.searchParams.get('uddg') || u.href;
  return u.href;
}

/** "https://www.swedbank.lv › private" -> "https://www.swedbank.lv/" */
export function displayToUrl(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  let t = text.trim().split(/[\s›»]/)[0];
  if (!t) return undefined;
  if (!/^https?:\/\//i.test(t)) t = 'https://' + t;
  try {
    const u = new URL(t);
    return u.hostname.includes('.') ? `${u.protocol}//${u.hostname}/` : undefined;
  } catch {
    return undefined;
  }
}

let counter = 0;
function keyOf(el: HTMLElement): string {
  if (!el.dataset.urlguardKey) el.dataset.urlguardKey = `ug${++counter}`;
  return el.dataset.urlguardKey;
}

const isSearchHost = (url: string) => {
  try {
    return detectEngine(new URL(url).hostname) !== null;
  } catch {
    return true;
  }
};

function topmost(blocks: Set<HTMLElement>): HTMLElement[] {
  const arr = [...blocks];
  return arr.filter((b) => !arr.some((o) => o !== b && o.contains(b)));
}

function scanGoogle(doc: Document, base: string): SerpItem[] {
  const items: SerpItem[] = [];
  // Reklāmas
  const adBlocks = new Set<HTMLElement>();
  doc.querySelectorAll<HTMLElement>('[data-text-ad]').forEach((e) => adBlocks.add(e));
  doc.querySelectorAll<HTMLElement>('#tads, #tadsb, #bottomads').forEach((c) => {
    c.querySelectorAll<HTMLElement>('a [role="heading"], a h3').forEach((h) => {
      const blk = (h.closest('[data-hveid]') as HTMLElement) ?? (h.closest('a')?.parentElement as HTMLElement);
      if (blk && c.contains(blk) && blk !== c) adBlocks.add(blk);
    });
  });
  const ads = topmost(adBlocks);
  for (const blk of ads) {
    const heading = blk.querySelector<HTMLElement>('[role="heading"], h3');
    const a =
      blk.querySelector<HTMLAnchorElement>('a[data-pcu]') ??
      (heading?.closest('a') as HTMLAnchorElement | null) ??
      blk.querySelector<HTMLAnchorElement>('a[href]');
    if (!a) continue;
    const pcu = a.getAttribute('data-pcu')?.split(',')[0];
    const url = pcu || unwrap(a.getAttribute('href') ?? '', base);
    const dtld = blk.querySelector('[data-dtld]')?.getAttribute('data-dtld');
    items.push({
      key: keyOf(blk),
      block: blk,
      anchor: heading ?? a,
      url,
      displayUrl: dtld ? `https://${dtld}/` : undefined,
      title: (heading?.textContent ?? a.textContent ?? '').trim(),
      isAd: true,
    });
  }
  // Organiskie rezultāti
  doc.querySelectorAll<HTMLElement>('#rso a h3, #search a h3, #botstuff a h3').forEach((h3) => {
    const a = h3.closest('a') as HTMLAnchorElement | null;
    if (!a || ads.some((b) => b.contains(a))) return;
    const url = unwrap(a.getAttribute('href') ?? '', base);
    if (isSearchHost(url)) return;
    const blk = (a.closest('[data-hveid]') as HTMLElement) ?? (a.parentElement as HTMLElement);
    items.push({ key: keyOf(blk), block: blk, anchor: h3, url, title: h3.textContent?.trim() ?? '', isAd: false });
  });
  return items;
}

function scanBing(doc: Document, base: string): SerpItem[] {
  const items: SerpItem[] = [];
  doc.querySelectorAll<HTMLAnchorElement>('#b_results h2 a, #b_results .b_adTop h2 a, #b_results .b_ad a.b_title').forEach((a) => {
    const blk = (a.closest('li') as HTMLElement) ?? (a.parentElement as HTMLElement);
    const url = unwrap(a.getAttribute('href') ?? '', base);
    const isAd = !!a.closest('.b_ad, .b_adTop, .b_adBottom, .sb_add');
    items.push({
      key: keyOf(blk),
      block: blk,
      anchor: a,
      url: isSearchHost(url) ? displayToUrl(blk.querySelector('cite')?.textContent) ?? url : url,
      displayUrl: displayToUrl(blk.querySelector('cite')?.textContent),
      title: a.textContent?.trim() ?? '',
      isAd,
    });
  });
  return items;
}

function scanDdg(doc: Document, base: string): SerpItem[] {
  const items: SerpItem[] = [];
  doc.querySelectorAll<HTMLAnchorElement>('a[data-testid="result-title-a"]').forEach((a) => {
    const blk = (a.closest('article, li') as HTMLElement) ?? (a.parentElement as HTMLElement);
    const isAd = !!a.closest('[data-testid="ad"], [data-layout="ad"], .result--ad');
    items.push({
      key: keyOf(blk),
      block: blk,
      anchor: a,
      url: unwrap(a.getAttribute('href') ?? '', base),
      title: a.textContent?.trim() ?? '',
      isAd,
    });
  });
  return items;
}

export function scan(doc: Document, href: string): SerpItem[] {
  const eng = detectEngine(new URL(href).hostname);
  const items = eng === 'google' ? scanGoogle(doc, href) : eng === 'bing' ? scanBing(doc, href) : eng === 'ddg' ? scanDdg(doc, href) : [];
  return items.filter((i) => /^https?:\/\//.test(i.url));
}
