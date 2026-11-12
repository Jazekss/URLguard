// End-to-end tests: ielādē dist/chrome paplašinājumu Brave/Chrome (headless) un pārbauda galvenos scenārijus.
//   node build.mjs --dev && node test/e2e.mjs
// Pārlūks: env BROWSER_PATH vai Brave lokālajā instalācijā.
import puppeteer from 'puppeteer-core';
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const EXT = resolve('dist/chrome');
const BROWSER =
  process.env.BROWSER_PATH ?? join(process.env.LOCALAPPDATA ?? '', 'BraveSoftware/Brave-Browser/Application/brave.exe');
const PROFILE = resolve('.e2e-profile');
if (!existsSync(BROWSER)) throw new Error(`Pārlūks nav atrasts: ${BROWSER}`);
rmSync(PROFILE, { recursive: true, force: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER,
  headless: process.env.HEADFUL ? false : true,
  userDataDir: PROFILE,
  enableExtensions: [EXT],
  args: ['--no-first-run', '--no-default-browser-check'],
});

let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` – ${extra}` : ''}`);
  if (!cond) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FIXTURES = {
  'https://www.google.com/search?q=eveseliba': `<!doctype html><html><head><title>eveseliba - Google</title></head><body>
    <div id="search"><div id="tads">
      <div data-text-ad="1" data-hveid="A1"><a data-pcu="https://eveseliba-portals.top/login" href="https://www.googleadservices.com/pagead/aclk?adurl=https://eveseliba-portals.top/login">
        <div role="heading">E-veselība – pieslēgties portālam</div></a><span data-dtld="eveseliba-portals.top">eveseliba-portals.top</span></div>
    </div>
    <div id="rso">
      <div data-hveid="B1"><a href="https://www.eveseliba.gov.lv/"><h3>E-veselība | Vienotās veselības nozares elektroniskās informācijas sistēmas portāls</h3></a></div>
      <div data-hveid="B2"><a href="https://lsm.lv/raksts/eveseliba"><h3>Ziņas par e-veselību</h3></a></div>
    </div></div></body></html>`,
  'https://swedbankas.com/': `<!doctype html><html><head><title>Swedbankas</title></head><body><h1>Sveiki</h1></body></html>`,
  'https://lmt-bonuss.com/': `<!doctype html><html><head><title>LMT bonuss</title></head><body>
    <h1>Saņem LMT bonusu</h1><p>Pieslēdzieties ar Smart-ID</p><input name="personas_kods" placeholder="Personas kods"></body></html>`,
  'https://example.com/': `<!doctype html><html><head><title>Example</title></head><body>ok</body></html>`,
};

async function newPage() {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const body = FIXTURES[req.url()];
    if (body && req.isNavigationRequest()) req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body });
    else req.continue();
  });
  return page;
}

async function waitForUrl(page, pred, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred(page.url())) return true;
    await sleep(150);
  }
  return false;
}

try {
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'), {
    timeout: 15000,
  });
  const extId = new URL(sw.url()).hostname;
  ok('paplašinājums ielādēts', !!extId, extId);
  await sleep(1500); // DNR noteikumi + dzinējs

  // 1) Zināms krāpnieku domēns -> DNR pāradresē uz brīdinājumu vēl pirms ielādes
  {
    const page = await newPage();
    page.goto('http://phishing-test.urlguard.invalid/login').catch(() => {});
    const hit = await waitForUrl(page, (u) => u.startsWith(`chrome-extension://${extId}/warning.html`));
    ok('bloķēto saraksts (DNR) -> brīdinājums', hit, page.url().slice(0, 90));
    if (hit) {
      await page.waitForSelector('#reasons li', { timeout: 4000 }).catch(() => {});
      const txt = await page.$eval('#reasons', (e) => e.textContent).catch(() => '');
      ok('brīdinājumā ir iemesls', /sarakstā/.test(txt), txt.trim().slice(0, 60));
    }
    await page.close();
  }

  // 2) Heuristika: "eveseliba.lv.<cits>.com" -> brīdinājums ar oficiālo saiti
  {
    const page = await newPage();
    page.goto('https://eveseliba.lv.pieteikums-portal.com/login').catch(() => {});
    const hit = await waitForUrl(page, (u) => u.includes('/warning.html?id='));
    ok('viltots e-veselības domēns -> brīdinājums', hit, page.url().slice(0, 90));
    if (hit) {
      await page.waitForSelector('#officialLink', { visible: true, timeout: 4000 }).catch(() => {});
      const href = await page.$eval('#officialLink', (a) => a.href).catch(() => '');
      ok('piedāvā oficiālo adresi', href.startsWith('https://www.eveseliba.gov.lv'), href);
    }
    await page.close();
  }

  // 3) Google: krāpnieku reklāma atzīmēta, oficiālā lapa ar ✓
  {
    const page = await newPage();
    await page.goto('https://www.google.com/search?q=eveseliba', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.urlguard-badge', { timeout: 6000 }).catch(() => {});
    await sleep(500);
    const badges = await page.$$eval('.urlguard-badge', (els) => els.map((e) => e.textContent));
    ok('reklāma atzīmēta kā krāpnieciska', badges.some((b) => /krāpnieku saite/.test(b)), JSON.stringify(badges));
    ok('oficiālā lapa ar ✓', badges.some((b) => /oficiālā lapa/.test(b)));
    ok('ziņu portāls netiek atzīmēts', badges.length === 2);
    await page.close();
  }

  // 4) Aizdomīga (ne bīstama) lapa -> neuzbāzīga josla, lapa atveras
  {
    const page = await newPage();
    await page.goto('https://swedbankas.com/', { waitUntil: 'domcontentloaded' });
    await sleep(1500);
    const bar = await page.evaluate(() => [...document.documentElement.children].some((e) => e.style.zIndex === '2147483647'));
    ok('aizdomīgai lapai rāda joslu', bar && page.url() === 'https://swedbankas.com/');
    await page.close();
  }

  // 5) Lapas saturs: "LMT" + Smart-ID + personas kods uz līdzīga domēna -> bīstams
  {
    const page = await newPage();
    await page.goto('https://lmt-bonuss.com/', { waitUntil: 'domcontentloaded' });
    const hit = await waitForUrl(page, (u) => u.includes('/warning.html?id='), 8000);
    ok('pieslēgšanās forma uz viltota domēna -> brīdinājums', hit, page.url().slice(0, 80));
    await page.close();
  }

  // 6) Parasta lapa -> nekas nenotiek
  {
    const page = await newPage();
    await page.goto('https://example.com/', { waitUntil: 'domcontentloaded' });
    await sleep(1200);
    const bar = await page.evaluate(() => [...document.documentElement.children].some((e) => e.style.zIndex === '2147483647'));
    ok('parasta lapa bez brīdinājuma', !bar && page.url() === 'https://example.com/');
    await page.close();
  }

  // 7) Popup ar konkrētu saiti
  {
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${extId}/popup.html?u=${encodeURIComponent('https://swedbank.top/ib')}`);
    await page.waitForFunction(() => document.getElementById('verdict')?.textContent !== '…', { timeout: 5000 });
    const v = await page.$eval('#verdict', (e) => e.textContent);
    const log = await page.$$eval('#log li', (els) => els.length);
    ok('popup rāda vērtējumu', v === 'Bīstama lapa', v);
    ok('žurnālā ir ieraksti', log >= 3, `${log} ieraksti`);
    const brands = await page.$$eval('#rBrand option', (o) => o.length);
    ok('ziņošanas formā zīmolu saraksts', brands > 40);
    await page.screenshot({ path: resolve('test/popup.png'), fullPage: true });
    await page.close();
  }
} catch (e) {
  console.error(e);
  failed++;
} finally {
  await browser.close();
  rmSync(PROFILE, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} pārbaude(s) neizdevās` : '\nVisas e2e pārbaudes izdevās ✓');
process.exit(failed ? 1 : 0);
