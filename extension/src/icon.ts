// Rīkjoslas ikona pēc stāvokļa: zaļa ✓ (darbojas), pelēka – (izslēgts), oranža ! (aizdomīgs), sarkana ✕ (bīstams).
// Zīmē dinamiski (OffscreenCanvas), lai krāsu var pielāgot arī pārlūka akcenta krāsai (Firefox tēmas).
export type IconState = 'ok' | 'off' | 'warn' | 'danger';

export const ICON_COLORS: Record<IconState, string> = {
  ok: '#16a34a',
  off: '#9ca3af',
  warn: '#ea8a0c',
  danger: '#dc2626',
};

function shield(ctx: OffscreenCanvasRenderingContext2D, s: number) {
  // Vairogs: taisnas malas augšā, noapaļota apakša (tā pati forma kā paplašinājuma logo)
  const l = 0.1 * s, r = 0.9 * s, t = 0.07 * s, mid = 0.52 * s, b = 0.95 * s, rad = 0.1 * s;
  ctx.beginPath();
  ctx.moveTo(l + rad, t);
  ctx.lineTo(r - rad, t);
  ctx.quadraticCurveTo(r, t, r, t + rad);
  ctx.lineTo(r, mid);
  ctx.bezierCurveTo(r, 0.78 * s, 0.68 * s, 0.9 * s, 0.5 * s, b);
  ctx.bezierCurveTo(0.32 * s, 0.9 * s, l, 0.78 * s, l, mid);
  ctx.lineTo(l, t + rad);
  ctx.quadraticCurveTo(l, t, l + rad, t);
  ctx.closePath();
}

function glyph(ctx: OffscreenCanvasRenderingContext2D, state: IconState, s: number) {
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.6, 0.13 * s);
  ctx.beginPath();
  if (state === 'ok') {
    ctx.moveTo(0.3 * s, 0.5 * s);
    ctx.lineTo(0.44 * s, 0.64 * s);
    ctx.lineTo(0.71 * s, 0.34 * s);
    ctx.stroke();
  } else if (state === 'off') {
    ctx.moveTo(0.32 * s, 0.48 * s);
    ctx.lineTo(0.68 * s, 0.48 * s);
    ctx.stroke();
  } else if (state === 'warn') {
    ctx.moveTo(0.5 * s, 0.24 * s);
    ctx.lineTo(0.5 * s, 0.54 * s);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0.5 * s, 0.71 * s, Math.max(1, 0.075 * s), 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(0.34 * s, 0.31 * s);
    ctx.lineTo(0.66 * s, 0.63 * s);
    ctx.moveTo(0.66 * s, 0.31 * s);
    ctx.lineTo(0.34 * s, 0.63 * s);
    ctx.stroke();
  }
}

const cache = new Map<string, Record<number, ImageData>>();

export function iconImages(state: IconState, color = ICON_COLORS[state]): Record<number, ImageData> | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const key = `${state}|${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out: Record<number, ImageData> = {};
  for (const s of [16, 32]) {
    const c = new OffscreenCanvas(s, s);
    const ctx = c.getContext('2d')!;
    shield(ctx, s);
    ctx.fillStyle = color;
    ctx.fill();
    glyph(ctx, state, s);
    out[s] = ctx.getImageData(0, 0, s, s);
  }
  cache.set(key, out);
  return out;
}
