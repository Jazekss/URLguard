// Maza ikona (✓ / ! / ✕) blakus saitei – kopīga meklētājam un soc. tīkliem.
// Savs elements + slēgts Shadow DOM: lapas CSS to nevar pagriezt, pārbīdīt vai pārkrāsot.
export type MarkKind = 'danger' | 'warn' | 'ok';

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
export function marker(kind: MarkKind, tip: string): HTMLElement {
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

