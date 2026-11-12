// Uzzīmē vairoga ikonu PNG formātā bez ārējām bibliotēkām (antialiasing ar supersampling).
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function inShield(x, y) {
  const cx = 0.5, half = 0.4, top = 0.07, mid = 0.52, bottom = 0.95;
  if (y < top || y > bottom) return false;
  const dx = Math.abs(x - cx);
  if (y < mid) {
    // augšējie stūri noapaļoti + neliels "iegriezums" augšā
    const r = 0.1;
    if (y < top + r && dx > half - r) return Math.hypot(dx - (half - r), y - (top + r)) <= r;
    return dx <= half;
  }
  const t = (y - mid) / (bottom - mid);
  return dx <= half * Math.cos((t * Math.PI) / 2) ** 0.8;
}
function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}
function inCheck(x, y) {
  const w = 0.065;
  return segDist(x, y, 0.3, 0.5, 0.44, 0.64) < w || segDist(x, y, 0.44, 0.64, 0.71, 0.34) < w;
}

export function shieldPng(size) {
  const S = 4;
  const buf = Buffer.alloc(size * size * 4);
  const top = [0x2b, 0x7b, 0xf0], bot = [0x15, 0x4a, 0xb8];
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let shield = 0, check = 0;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const x = (px + (sx + 0.5) / S) / size, y = (py + (sy + 0.5) / S) / size;
          if (inShield(x, y)) {
            shield++;
            if (inCheck(x, y)) check++;
          }
        }
      const a = shield / (S * S);
      const c = shield ? check / shield : 0;
      const g = py / size;
      const base = top.map((v, i) => Math.round(v * (1 - g) + bot[i] * g));
      const col = base.map((v) => Math.round(v * (1 - c) + 255 * c));
      const o = (py * size + px) * 4;
      buf[o] = col[0];
      buf[o + 1] = col[1];
      buf[o + 2] = col[2];
      buf[o + 3] = Math.round(a * 255);
    }
  }
  return png(size, buf);
}
