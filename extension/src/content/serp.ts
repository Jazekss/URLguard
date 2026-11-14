// Meklētāja lapā: atzīmē vai paslēpj krāpnieku saites, oficiālajām pieliek ✓.
import { getQuery, scan, type SerpItem } from './serp-scan';
import type { SerpItemOut } from '../shared';
import { initLang, reasonText, t } from '../i18n';
import { marker } from './marker';

const DONE = 'urlguardDone';
let hiddenCount = 0;
let notice: HTMLElement | null = null;

function tipText(head: string, r: SerpItemOut['result']): string {
  return ['URLguard: ' + head, ...r.reasons.map((x) => '• ' + reasonText(x))].join('\n');
}

/** Kur ielikt ikonu: virsraksta sākumā (h3 / role=heading), citādi saites sākumā. */
function placeMarker(item: SerpItem, el: HTMLElement) {
  const target = item.anchor.matches('h1,h2,h3,[role="heading"]') ? item.anchor : item.anchor.querySelector('h2,h3') ?? item.anchor;
  target.prepend(el);
}

function ensureNotice(container: Element) {
  if (!notice) {
    notice = document.createElement('div');
    notice.style.cssText = `margin:8px 0 14px;padding:10px 14px;border-radius:10px;background:#fef2f2;color:#7f1d1d;
      border:1px solid #fecaca;font:14px/1.45 system-ui,sans-serif;max-width:650px;`;
    container.prepend(notice);
  }
  notice.innerHTML = '';
  const label = document.createElement('span');
  label.textContent = t('serp.hidden', { n: hiddenCount }) + ' ';
  const btn = document.createElement('button');
  btn.textContent = t('serp.show');
  btn.style.cssText = 'border:0;background:none;color:#b91c1c;text-decoration:underline;cursor:pointer;font:inherit;padding:0';
  btn.onclick = () => {
    document.querySelectorAll<HTMLElement>('[data-urlguard-hidden]').forEach((e) => {
      e.style.display = '';
      e.removeAttribute('data-urlguard-hidden');
    });
    notice?.remove();
    notice = null;
    hiddenCount = 0;
  };
  notice.append(label, btn);
}

function apply(item: SerpItem, res: SerpItemOut, mode: 'mark' | 'hide', officialBadge: boolean) {
  const { block } = item;
  const r = res.result;
  const brand = r.brand?.name;
  if (res.verdict === 'danger') {
    if (mode === 'hide') {
      block.style.display = 'none';
      block.setAttribute('data-urlguard-hidden', '1');
      hiddenCount++;
      const container = document.querySelector('#search, #b_results, #rso, [data-testid="mainline"]') ?? document.body;
      ensureNotice(container);
      return;
    }
    // Rāmis ar outline – nemaina izkārtojumu
    block.style.outline = '2px solid #dc2626';
    block.style.outlineOffset = '6px';
    block.style.borderRadius = '10px';
    placeMarker(item, marker('danger', tipText(brand ? t('serp.dangerBrand', { brand }) : t('serp.danger'), r)));
  } else if (res.verdict === 'suspicious') {
    placeMarker(item, marker('warn', tipText(brand ? t('serp.warnBrand', { brand }) : t('serp.warn'), r)));
  } else if (res.officialMatch && officialBadge && !item.isAd) {
    placeMarker(item, marker('ok', `URLguard: ${t('serp.ok', { brand })}`));
  }
}

let running = false;
async function run() {
  if (running) return;
  running = true;
  try {
    const query = getQuery(location.href);
    if (!query) return;
    const items = scan(document, location.href).filter((i) => !i.block.dataset[DONE]);
    if (!items.length) return;
    items.forEach((i) => (i.block.dataset[DONE] = '1'));
    const [res, settings] = await Promise.all([
      chrome.runtime.sendMessage({
        type: 'serpCheck',
        query,
        items: items.map(({ key, url, displayUrl, title, isAd }) => ({ key, url, displayUrl, title, isAd })),
      }) as Promise<SerpItemOut[]>,
      chrome.storage.sync.get('settings'),
    ]);
    if (!Array.isArray(res)) return;
    const s = (settings.settings ?? {}) as { serpMode?: 'mark' | 'hide'; serpOfficialBadge?: boolean };
    const byKey = new Map(res.map((r) => [r.key, r]));
    for (const it of items) {
      const r = byKey.get(it.key);
      if (r) apply(it, r, s.serpMode ?? 'mark', s.serpOfficialBadge ?? true);
    }
  } catch (e) {
    console.debug('URLguard serp', e);
  } finally {
    running = false;
  }
}

let timer: number | undefined;
const schedule = () => {
  clearTimeout(timer);
  timer = window.setTimeout(run, 300);
};
initLang().then(schedule);
new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
// SPA navigācija (DuckDuckGo, Bing)
let lastHref = location.href;
setInterval(() => {
  if (location.href !== lastHref) {
    lastHref = location.href;
    schedule();
  }
}, 1000);
