// Veikalu attēli: 5 ekrānuzņēmumi 1280x800 ar parakstiem, reklāmas attēls 440x280, logo 300x300.
//   cd extension && node build.mjs --dev && node scripts/store-screens.mjs
// Rezultāts: store/images/*.png
import puppeteer from 'puppeteer-core';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shieldPng } from './icons.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../../store/images');
const EXT = resolve(here, '../dist/chrome');
const PROFILE = resolve(here, '../.e2e-profile');
const BROWSER = process.env.BROWSER_PATH ?? join(process.env.LOCALAPPDATA ?? '', 'BraveSoftware/Brave-Browser/Application/brave.exe');
mkdirSync(OUT, { recursive: true });
rmSync(PROFILE, { recursive: true, force: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FONT = `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;

// ---------------------------------------------------------------- demo lapas (neitrālas, bez citu zīmolu izskata)
const SERP = `<!doctype html><html lang="lv"><head><meta charset="utf-8"><title>eveselība – meklēšana</title><style>
  body{margin:0;font-family:Arial,sans-serif;background:#fff;color:#202124}
  header{display:flex;align-items:center;gap:22px;padding:22px 40px;border-bottom:1px solid #e5e7eb}
  .logo{font:700 22px ${FONT};color:#475569}
  .q{flex:0 0 560px;border:1px solid #d1d5db;border-radius:24px;padding:11px 20px;font-size:16px}
  #search{padding:18px 40px 0 190px;max-width:720px}
  .r{margin:0 0 26px}
  .site{font-size:13px;color:#4d5156;margin-bottom:3px}
  .site b{display:block;color:#202124;font-weight:400;font-size:14px}
  .ad{font-weight:700;font-size:12px;color:#202124;margin-right:4px}
  h3{margin:0 0 4px;font-size:20px;font-weight:400;line-height:1.3}
  a{text-decoration:none}h3{color:#1a0dab}
  .r.ad-r{margin-bottom:96px}
  p{margin:0;font-size:14px;color:#4d5156;line-height:1.55}
</style></head><body>
<header><span class="logo">Meklētājs</span><div class="q">eveselība</div></header>
<div id="search"><div id="tads">
  <div class="r ad-r" data-text-ad="1" data-hveid="A1">
    <div class="site"><span class="ad">Sponsorēts</span><b>E-veselība portāls</b>eveseliba-pieteikums.top</div>
    <a data-pcu="https://eveseliba-pieteikums.top/login" href="https://eveseliba-pieteikums.top/login"><h3 role="heading">E-veselība – pieslēgties ar Smart-ID</h3></a>
    <span data-dtld="eveseliba-pieteikums.top"></span>
    <p>Pieslēdzieties e-veselības portālam ar Smart-ID vai eParaksts mobile. Ātri un droši.</p>
  </div></div>
  <div id="rso">
  <div class="r" data-hveid="B1"><div class="site"><b>Nacionālais veselības dienests</b>https://www.eveseliba.gov.lv</div>
    <a href="https://www.eveseliba.gov.lv/"><h3>E-veselība | Vienotās veselības nozares elektroniskās informācijas sistēmas portāls</h3></a>
    <p>E-veselība – e-receptes, darbnespējas lapas, nosūtījumi, izmeklējumu rezultāti vienuviet.</p></div>
  <div class="r" data-hveid="B2"><div class="site"><b>LSM</b>https://lsm.lv › raksts</div>
    <a href="https://lsm.lv/raksts/eveseliba"><h3>E-veselībā pieejami jauni pakalpojumi</h3></a>
    <p>Iedzīvotāji tagad var e-veselībā apskatīt arī laboratorisko izmeklējumu rezultātus…</p></div>
</div></div></body></html>`;

const FAKE_BANK = `<!doctype html><html lang="lv"><head><meta charset="utf-8"><title>Swedbankas – aizdevumi</title><style>
  body{margin:0;font-family:${FONT};background:#f8fafc;color:#111}
  .top{background:#334155;color:#fff;padding:16px 40px;font-weight:700;font-size:18px;margin-top:46px}
  .hero{max-width:720px;margin:60px auto;padding:0 20px}
  h1{font-size:34px;margin:0 0 12px}p{font-size:17px;line-height:1.6;color:#475569}
  .cta{display:inline-block;margin-top:14px;padding:12px 22px;border-radius:10px;background:#334155;color:#fff}
</style></head><body><div class="top">Swedbankas</div><div class="hero"><h1>Ātrais kredīts 5 minūtēs</h1>
<p>Saņemiet līdz 5000 € bez ķīlas. Pieteikums tiešsaistē, lēmums uzreiz.</p><span class="cta">Pieteikties</span></div></body></html>`;

const FIXTURES = {
  'https://www.google.com/search?q=eveseliba': SERP,
  'https://swedbankas.com/': FAKE_BANK,
};

// ---------------------------------------------------------------- kompozīcija
const ICON = readFileSync(join(EXT, 'icons/icon128.png')).toString('base64');
function frame({ title, sub, shot, url, w = 1080, popup = false }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;width:1280px;height:800px;overflow:hidden;font-family:${FONT};
    background:radial-gradient(1200px 600px at 10% -10%,#dbeafe 0,transparent 60%),linear-gradient(160deg,#eff6ff,#e0e7ff);color:#0f172a}
  .cap{position:absolute;left:64px;top:44px;right:64px;display:flex;align-items:center;gap:18px}
  .cap img{width:52px;height:52px}
  h1{margin:0;font-size:34px;line-height:1.15;letter-spacing:-.01em}
  .sub{margin-top:6px;font-size:18px;color:#334155}
  .win{position:absolute;left:50%;transform:translateX(-50%);top:${popup ? 150 : 160}px;width:${w}px;border-radius:14px;overflow:hidden;
    box-shadow:0 30px 60px -20px rgba(15,23,42,.35),0 0 0 1px rgba(15,23,42,.08);background:#fff}
  .bar{height:42px;background:#f1f5f9;display:flex;align-items:center;gap:8px;padding:0 14px;border-bottom:1px solid #e2e8f0}
  .dot{width:11px;height:11px;border-radius:50%;background:#cbd5e1}
  .url{margin-left:12px;flex:1;background:#fff;border-radius:8px;padding:6px 12px;font-size:13px;color:#475569;font-family:ui-monospace,Consolas,monospace}
  .win > img{display:block;width:100%}
</style></head><body>
  <div class="cap"><img src="data:image/png;base64,${ICON}"><div><h1>${title}</h1><div class="sub">${sub}</div></div></div>
  <div class="win">${popup ? '' : `<div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><div class="url">${url}</div></div>`}
  <img src="data:image/png;base64,${shot}"></div>
</body></html>`;
}

const browser = await puppeteer.launch({
  executablePath: BROWSER,
  headless: true,
  userDataDir: PROFILE,
  enableExtensions: [EXT],
  args: ['--no-first-run', '--no-default-browser-check', '--force-color-profile=srgb'],
});
const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'));
const BASE = `chrome-extension://${new URL(sw.url()).hostname}`;
await sleep(1500);

async function page(w, h) {
  const p = await browser.newPage();
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await p.setRequestInterception(true);
  p.on('request', (r) => (FIXTURES[r.url()] && r.isNavigationRequest() ? r.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURES[r.url()] }) : r.continue()));
  return p;
}
async function shot(p, clip) {
  return (await p.screenshot({ encoding: 'base64', clip })).toString();
}
async function compose(name, opts) {
  const p = await browser.newPage();
  await p.setViewport({ width: 1280, height: 800 });
  await p.setContent(frame(opts), { waitUntil: 'load' });
  await p.screenshot({ path: join(OUT, name) });
  await p.close();
  console.log('✓', name);
}

// Popup: piekrišana jau dota (lai attēlos nav jautājuma)
{
  const p = await page(400, 600);
  await p.goto(`${BASE}/popup.html`);
  await p.evaluate(() => chrome.storage.sync.set({ settings: { shareStats: true } }));
  await p.close();
}

// 1) Brīdinājuma lapa
let warnShot;
{
  const p = await page(1080, 600);
  p.goto('https://eveseliba.lv.pieteikums-portal.com/login').catch(() => {});
  await p.waitForFunction(() => location.href.includes('warning.html') && document.querySelector('#reasons li'), { timeout: 10000 }).catch(() => {});
  await sleep(600);
  warnShot = await shot(p);
  await p.close();
}
await compose('1-bridinajums.png', {
  title: 'Aptur viltotas lapas, pirms ievadāt datus',
  sub: 'Adrese izliekas par E-veselību – URLguard parāda, kur ir īstā lapa',
  shot: warnShot,
  url: 'eveseliba.lv.pieteikums-portal.com/login',
});

// 2) Meklētājs
{
  const p = await page(1080, 600);
  await p.goto('https://www.google.com/search?q=eveseliba', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('urlguard-mark', { timeout: 8000 }).catch(() => {});
  await sleep(800);
  // parāda paskaidrojumu (kā uzbraucot ar peli) – vizuāls atveidojums attēlam
  await p.evaluate(() => {
    const m = document.querySelector('urlguard-mark[data-kind="danger"]');
    if (!m) return;
    const r = m.getBoundingClientRect();
    const tip = document.createElement('div');
    tip.textContent = m.title.split('\n').slice(0, 3).join('\n');
    tip.style.cssText = `position:fixed;left:${r.left + 4}px;top:${r.bottom + 26}px;white-space:pre;background:#1f2937;color:#fff;font:13px/1.5 system-ui;padding:8px 12px;border-radius:8px;box-shadow:0 8px 20px rgba(0,0,0,.25);z-index:9`;
    document.body.append(tip);
  });
  const s = await shot(p);
  await p.close();
  await compose('2-mekletajs.png', {
    title: 'Krāpnieku reklāmas meklētājā – uzreiz redzamas',
    sub: '✕ – krāpnieku saite,  ✓ – oficiālā lapa.  Pēc izvēles krāpnieku saites var arī paslēpt.',
    shot: s,
    url: 'meklētājs › eveselība',
  });
}

// 3) Aizdomīga lapa – josla
{
  const p = await page(1080, 600);
  await p.goto('https://swedbankas.com/', { waitUntil: 'domcontentloaded' });
  await sleep(1800);
  const s = await shot(p);
  await p.close();
  await compose('3-josla.png', {
    title: 'Neuzbāzīgs: aizdomīgām lapām – tikai josla',
    sub: 'Pilnekrāna brīdinājums tikai tad, ja lapa tiešām bīstama',
    shot: s,
    url: 'swedbankas.com',
  });
}

// 4) Popup – statuss un žurnāls; 5) Ziņošana
for (const [name, title, sub, path, scroll] of [
  ['4-popup.png', 'Viss vienuviet', 'Lapas vērtējums, bloķēto lapu žurnāls un iestatījumi', `popup.html?u=${encodeURIComponent('https://swedbank.top/ib')}`, 0],
  ['5-zinot.png', 'Redzēji krāpnieku lapu? Ziņo ar vienu klikšķi', 'Pēc pārbaudes tā tiek bloķēta visiem URLguard lietotājiem', `popup.html?u=${encodeURIComponent('https://omniva-paka.top/track')}&report=1`, 1],
]) {
  const p = await page(380, 590);
  await p.goto(`${BASE}/${path}`);
  await p.waitForFunction(() => document.getElementById('verdict')?.textContent !== '…', { timeout: 6000 }).catch(() => {});
  await sleep(500);
  if (scroll) await p.evaluate(() => document.getElementById('reportForm').closest('section').scrollIntoView({ block: 'start' }));
  else await p.evaluate(() => scrollTo(0, 0));
  await sleep(300);
  const s = await shot(p);
  await p.close();
  await compose(name, { title, sub, shot: s, w: 380, popup: true });
}

// Reklāmas attēls 440x280 un logo 300x300
{
  const p = await browser.newPage();
  await p.setViewport({ width: 440, height: 280 });
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;width:440px;height:280px;font-family:${FONT};
    background:linear-gradient(150deg,#1d4ed8,#1e3a8a);color:#fff;display:flex;align-items:center;gap:22px;padding:0 34px;box-sizing:border-box">
    <img src="data:image/png;base64,${ICON}" style="width:104px;height:104px;filter:drop-shadow(0 8px 16px rgba(0,0,0,.25))">
    <div><div style="font:800 34px/1 ${FONT};letter-spacing:-.01em">URLguard</div>
    <div style="margin-top:10px;font-size:17px;line-height:1.35;color:#dbeafe">Aizsardzība pret<br>krāpnieku saitēm</div></div></body></html>`);
  await p.screenshot({ path: join(OUT, 'promo-440x280.png') });
  writeFileSync(join(OUT, 'logo-300x300.png'), shieldPng(300));
  await p.close();
  console.log('✓ promo-440x280.png, logo-300x300.png');
}

await browser.close();
rmSync(PROFILE, { recursive: true, force: true });
