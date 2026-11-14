// Saites konteksts: kad lietotājs uzklikšķina uz saites, atceramies, NO KĀ tā tika atvērta
// (ieraksta teksts, saites teksts). Fona dzinējs salīdzina to ar galamērķi – arī pēc bit.ly u.c. pāradresācijām.
// Soc. tīklos papildus atzīmējam aizdomīgas saites jau ierakstā (tā pati ikona kā meklētājā).
import { unwrap } from './serp-scan';
import { marker } from './marker';
import { reasonText, t } from '../i18n';
import type { CheckResult } from '../core/types';

const SOCIAL = /(^|\.)(facebook\.com|instagram\.com|x\.com|twitter\.com|tiktok\.com|linkedin\.com|reddit\.com|threads\.net|youtube\.com|draugiem\.lv|vk\.com)$/;
const POST = 'article, [role="article"], [data-testid="tweet"], [data-pagelet^="FeedUnit"], shreddit-post, [data-e2e="browse-video-desc"], li';
const MAX_CONTEXT = 600;

function externalUrl(a: HTMLAnchorElement): string | null {
  const href = a.getAttribute('href');
  if (!href || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href)) return null;
  const url = unwrap(href, location.href);
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    if (u.hostname === location.hostname) return null;
    return u.href;
  } catch {
    return null;
  }
}

function contextOf(a: HTMLAnchorElement): { context: string; anchor: string } {
  const post = (a.closest(POST) as HTMLElement | null) ?? a.parentElement?.parentElement ?? a.parentElement;
  const anchor = (a.innerText || a.getAttribute('aria-label') || a.title || '').trim().slice(0, 200);
  const context = (post?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CONTEXT);
  return { context, anchor };
}

/** Klikšķis uz saites -> konteksts fona dzinējam (pirms sākas navigācija). */
export function watchClicks() {
  const send = (ev: Event) => {
    const a = (ev.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    const url = externalUrl(a);
    if (!url) return;
    const { context, anchor } = contextOf(a);
    chrome.runtime
      .sendMessage({ type: 'linkContext', url, raw: a.href, context, anchor, from: location.hostname })
      .catch(() => {});
  };
  // pointerdown nāk ~100 ms pirms click – konteksts paspēj nonākt fonā pirms navigācijas
  document.addEventListener('pointerdown', send, true);
  document.addEventListener('keydown', (ev) => {
    if ((ev as KeyboardEvent).key === 'Enter') send(ev);
  }, true);
}

interface ContextOut {
  key: string;
  result: CheckResult;
  shortenerBrand?: string;
}

/** Soc. tīklos: atzīmē saites, kuru ieraksts runā par zīmolu, bet saite ved citur. */
export function watchSocial() {
  if (!SOCIAL.test(location.hostname)) return;
  let n = 0;
  const pending = new Map<string, HTMLAnchorElement>();
  const scan = async () => {
    const batch: { key: string; url: string; context: string; anchor: string }[] = [];
    document.querySelectorAll<HTMLAnchorElement>('a[href]:not([data-urlguard-seen])').forEach((a) => {
      a.dataset.urlguardSeen = '1';
      const url = externalUrl(a);
      if (!url || batch.length >= 60) return;
      const key = `s${++n}`;
      pending.set(key, a);
      batch.push({ key, url, ...contextOf(a) });
    });
    if (!batch.length) return;
    const res = (await chrome.runtime.sendMessage({ type: 'contextCheck', items: batch }).catch(() => [])) as ContextOut[];
    for (const r of res ?? []) {
      const a = pending.get(r.key);
      pending.delete(r.key);
      if (!a || !a.isConnected) continue;
      const v = r.result.verdict;
      const brand = r.result.brand?.name;
      if (v === 'danger' || v === 'suspicious') {
        const head = brand ? t('social.mismatch', { brand }) : t(v === 'danger' ? 'serp.danger' : 'serp.warn');
        const tip = ['URLguard: ' + head, ...r.result.reasons.map((x) => '• ' + reasonText(x))].join('\n');
        a.prepend(marker(v === 'danger' ? 'danger' : 'warn', tip));
        if (v === 'danger') {
          a.style.outline = '2px solid #dc2626';
          a.style.outlineOffset = '2px';
          a.style.borderRadius = '6px';
        }
      } else if (r.shortenerBrand) {
        a.prepend(marker('warn', `URLguard: ${t('social.shortener')}`));
      }
    }
    for (const k of [...pending.keys()]) if (!pending.get(k)?.isConnected) pending.delete(k);
  };
  let timer: number | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = window.setTimeout(scan, 700);
  };
  schedule();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
}
