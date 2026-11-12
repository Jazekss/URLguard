// Meklētāja lapā: atzīmē vai paslēpj krāpnieku saites, oficiālajām pieliek ✓.
import { getQuery, scan, type SerpItem } from './serp-scan';
import type { SerpItemOut } from '../shared';

const DONE = 'urlguardDone';
let hiddenCount = 0;
let notice: HTMLElement | null = null;

type MarkKind = 'danger' | 'warn' | 'ok';

type Shape = [tag: 'path' | 'circle', attrs: Record<string, string>];
const W = { stroke: '#fff', 'stroke-width': '2.3', 'stroke-linecap': 'round' };
const MARK: Record<MarkKind, { color: string; shapes: Shape[] }> = {
  ok: { color: '#16a34a', shapes: [['path', { ...W, d: 'M5.5 10.2l3 3 6-6.4', fill: 'none', 'stroke-width': '2.2', 'stroke-linejoin': 'round' }]] },
  warn: { color: '#ea8a0c', shapes: [['path', { ...W, d: 'M10 5.2v6' }], ['circle', { cx: '10', cy: '14.6', r: '1.35', fill: '#fff' }]] },
  danger: { color: '#dc2626', shapes: [['path', { ...W, d: 'M6.6 6.6l6.8 6.8M13.4 6.6l-6.8 6.8' }]] },
};

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/**
 * Maza ikona virsraksta rindā (paskaidrojums – uzbraucot ar peli).
 * Savs elements + slēgts Shadow DOM: meklētāja CSS to nevar pagriezt, pārbīdīt vai pārkrāsot.
 */
function marker(kind: MarkKind, tip: string): HTMLElement {
  const host = document.createElement('urlguard-mark');
  host.className = 'urlguard-mark';
  host.dataset.kind = kind;
  host.title = tip;
  host.setAttribute('role', 'img');
  host.setAttribute('aria-label', tip);
  host.style.cssText =
    'all:initial;font-size:inherit;display:inline-block;width:0.9em;height:0.9em;min-width:14px;min-height:14px;margin:0 0.35em 0 0;' +
    'vertical-align:-0.1em;transform:none;cursor:help;line-height:0;';
  const root = host.attachShadow({ mode: 'closed' });
  const { color, shapes } = MARK[kind];
  const svg = svgEl('svg', { viewBox: '0 0 20 20', width: '100%', height: '100%', 'aria-hidden': 'true', style: 'display:block' });
  svg.append(svgEl('circle', { cx: '10', cy: '10', r: '10', fill: color }), ...shapes.map(([t, a]) => svgEl(t, a)));
  root.append(svg);
  // Klikšķis uz ikonas neatver saiti
  host.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  }, true);
  return host;
}

function tipText(head: string, r: SerpItemOut['result']): string {
  return ['URLguard: ' + head, ...r.reasons.map((x) => '• ' + x.text)].join('\n');
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
    placeMarker(item, marker('danger', tipText(`krāpnieku saite${brand ? ` – tā nav ${brand} oficiālā lapa` : ''}`, r)));
  } else if (res.verdict === 'suspicious') {
    placeMarker(item, marker('warn', tipText(`aizdomīga saite${brand ? ` – nav ${brand} oficiālā adrese` : ''}`, r)));
  } else if (res.officialMatch && officialBadge && !item.isAd) {
    placeMarker(item, marker('ok', `URLguard: ${brand} oficiālā lapa`));
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
