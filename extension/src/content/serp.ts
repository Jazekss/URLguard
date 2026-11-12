// Meklētāja lapā: atzīmē vai paslēpj krāpnieku saites, oficiālajām pieliek ✓.
import { getQuery, scan, type SerpItem } from './serp-scan';
import type { SerpItemOut } from '../shared';

const DONE = 'urlguardDone';
let hiddenCount = 0;
let notice: HTMLElement | null = null;

function badge(text: string, kind: 'danger' | 'warn' | 'ok'): HTMLElement {
  const el = document.createElement('div');
  el.className = 'urlguard-badge';
  const colors = {
    danger: ['#fef2f2', '#b91c1c', '#fecaca'],
    warn: ['#fffbeb', '#92400e', '#fde68a'],
    ok: ['#f0fdf4', '#15803d', '#bbf7d0'],
  }[kind];
  el.style.cssText = `display:inline-flex;align-items:center;gap:6px;margin:0 0 6px;padding:3px 10px;border-radius:999px;
    font:600 12px/1.4 system-ui,sans-serif;background:${colors[0]};color:${colors[1]};border:1px solid ${colors[2]};`;
  el.textContent = text;
  return el;
}

function ensureNotice(container: Element) {
  if (!notice) {
    notice = document.createElement('div');
    notice.style.cssText = `margin:8px 0 14px;padding:10px 14px;border-radius:10px;background:#fef2f2;color:#7f1d1d;
      border:1px solid #fecaca;font:14px/1.45 system-ui,sans-serif;max-width:650px;`;
    container.prepend(notice);
  }
  notice.innerHTML = '';
  const t = document.createElement('span');
  t.textContent = `🛡 URLguard paslēpa ${hiddenCount} krāpniecisku saiti${hiddenCount === 1 ? '' : 'es'}. `;
  const btn = document.createElement('button');
  btn.textContent = 'Parādīt';
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
  notice.append(t, btn);
}

function apply(item: SerpItem, res: SerpItemOut, mode: 'mark' | 'hide', officialBadge: boolean) {
  const { block, anchor } = item;
  const r = res.result;
  const where = anchor.closest('a') ?? anchor;
  if (res.verdict === 'danger') {
    if (mode === 'hide') {
      block.style.display = 'none';
      block.setAttribute('data-urlguard-hidden', '1');
      hiddenCount++;
      const container = document.querySelector('#search, #b_results, #rso, [data-testid="mainline"]') ?? document.body;
      ensureNotice(container);
      return;
    }
    block.style.outline = '2px solid #dc2626';
    block.style.outlineOffset = '4px';
    block.style.borderRadius = '8px';
    block.style.opacity = '0.75';
    const brand = r.brand ? ` – tā nav ${r.brand.name} oficiālā lapa` : '';
    const b = badge(`⚠ URLguard: krāpnieku saite${brand}`, 'danger');
    b.title = r.reasons.map((x) => x.text).join('\n');
    where.parentElement?.insertBefore(b, where);
  } else if (res.verdict === 'suspicious') {
    const brand = r.brand ? `: nav ${r.brand.name} oficiālā adrese` : '';
    const b = badge(`⚠ Aizdomīga saite${brand}`, 'warn');
    b.title = r.reasons.map((x) => x.text).join('\n');
    where.parentElement?.insertBefore(b, where);
  } else if (res.officialMatch && officialBadge && !item.isAd) {
    const b = badge(`✓ ${r.brand?.name}: oficiālā lapa`, 'ok');
    where.parentElement?.insertBefore(b, where);
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
schedule();
new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
// SPA navigācija (DuckDuckGo, Bing)
let lastHref = location.href;
setInterval(() => {
  if (location.href !== lastHref) {
    lastHref = location.href;
    schedule();
  }
}, 1000);
