import puppeteer from 'puppeteer-core';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const BROWSER = join(process.env.LOCALAPPDATA, 'BraveSoftware/Brave-Browser/Application/brave.exe');
const b = await puppeteer.launch({ executablePath: BROWSER, headless: true, userDataDir: resolve('.e2e-profile') });
const p = await b.newPage();
const js = readFileSync('dist/chrome/serp.js', 'utf8');
const src = readFileSync('src/content/serp.ts', 'utf8');
const css = [...src.matchAll(/'([^']*(?:all:initial|vertical-align)[^']*)'/g)].map((m) => m[1]).join('');
const va = process.argv[2]; const CSS = va ? css.replace(/vertical-align:[^;]+;/, `vertical-align:${va};`) : css;
await p.evaluateOnNewDocument((c) => { window.__css = c; }, CSS);
const out = [];
for (const [font, size] of [['Arial', 20], ['Arial', 22], ['"Google Sans", Arial', 22], ['Arial', 14]]) {
  await p.evaluate((c) => { window.__css = c; }, CSS);
  await p.setContent(`<h3 style="font-family:${font};font-size:${size}px;line-height:1.3;margin:20px;font-weight:400"><span id="t">VID EDS - Elektroniskā</span></h3>`);
  const r = await p.evaluate((CSS) => { window.__css = CSS;
    const h = document.querySelector('h3');
    const host = document.createElement('urlguard-mark');
    // tie paši stili kā serp.ts marker()
    host.style.cssText = window.__css;
    h.prepend(host);
    const ir = host.getBoundingClientRect();
    const t = document.getElementById('t');
    const cs = getComputedStyle(t);
    const c = document.createElement('canvas').getContext('2d');
    c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = c.measureText('VIDEH'); const x = c.measureText('x');
    // bāzes līnija: inline-block apakšējā mala + vertical-align nobīde
    const probe = document.createElement('span'); probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    t.prepend(probe);
    const baseline = probe.getBoundingClientRect().top;
    const capCenter = baseline - m.actualBoundingBoxAscent / 2;
    const mixCenter = baseline - (m.actualBoundingBoxAscent + x.actualBoundingBoxAscent) / 4;
    return { icon: +(ir.top + ir.height / 2).toFixed(1), capCenter: +capCenter.toFixed(1), mixCenter: +mixCenter.toFixed(1), h: ir.height };
  }, CSS).catch((e) => String(e));
  out.push({ font, size, ...r });
}
console.log(out.map((o) => `${o.font} ${o.size}px: ikona ${o.icon}, lielo burtu centrs ${o.capCenter} (nobīde ${(o.icon - o.capCenter).toFixed(1)} px), jaukta teksta centrs ${o.mixCenter} (${(o.icon - o.mixCenter).toFixed(1)} px)`).join('\n'));
await b.close();
