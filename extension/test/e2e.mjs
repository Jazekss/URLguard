// End-to-end tests: ielādē paplašinājumu pārlūkā (headless) un pārbauda galvenos scenārijus.
//   node build.mjs --dev --local-data && node test/e2e.mjs            (Chromium: Brave/Chrome)
//   node build.mjs --dev --local-data && node test/e2e.mjs firefox    (Firefox no F:\Projects\_depsirefox)
// --local-data: iebūvē lokālo bāzi ar datumu 1970, lai pārbaudītu atjaunināšanu no releja.
// Pārlūks: env BROWSER_PATH (citādi Brave vai _deps Firefox).
import puppeteer from 'puppeteer-core';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FF = process.argv[2] === 'firefox';
const EXT = resolve(FF ? 'dist/firefox' : 'dist/chrome');
const FF_DIR = 'F:/Projects/_deps/firefox/firefox';
const BROWSER =
  process.env.BROWSER_PATH ??
  (FF
    ? join(FF_DIR, readdirSync(FF_DIR).sort().pop() ?? '', 'core', 'firefox.exe')
    : join(process.env.LOCALAPPDATA ?? '', 'BraveSoftware/Brave-Browser/Application/brave.exe'));
const PROFILE = resolve('.e2e-profile');
if (!existsSync(BROWSER)) throw new Error(`Pārlūks nav atrasts: ${BROWSER}`);
rmSync(PROFILE, { recursive: true, force: true });

// Firefox: fiksēts paplašinājuma UUID, lai zinām moz-extension:// adresi
const FF_UUID = '6f1b9a52-3c1e-4d8a-9b7e-1a2b3c4d5e6f';
const browser = FF
  ? await puppeteer.launch({
      browser: 'firefox',
      executablePath: BROWSER,
      // Ļauj automatizācijai redzēt paplašinājuma lapas (moz-extension://)
      env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' },
      headless: process.env.HEADFUL ? false : true,
      extraPrefsFirefox: {
        'extensions.webextensions.uuids': JSON.stringify({ 'urlguard@urlguard.app': FF_UUID }),
        'xpinstall.signatures.required': false,
      },
    })
  : await puppeteer.launch({
      executablePath: BROWSER,
      headless: process.env.HEADFUL ? false : true,
      userDataDir: PROFILE,
      enableExtensions: [EXT],
      args: ['--no-first-run', '--no-default-browser-check'],
    });
console.log(`Pārlūks: ${await browser.version()}`);

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
  'https://www.facebook.com/feed-test': `<!doctype html><html><head><title>Facebook</title></head><body>
    <div role="feed"><div role="article"><p>Lidl izloze! Laimē 500 € dāvanu karti – atbildi uz 3 jautājumiem 🎁</p>
      <a id="scam" href="https://l.facebook.com/l.php?u=https%3A%2F%2Flidl-davanas.top%2Fclaim&h=x">lidl-davanas.top</a></div>
    <div role="article"><p>Mūsu jaunais blogs par dārzu</p><a id="ok" href="https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.org%2Fdarzs">example.org</a></div>
    <div role="article"><p>Lidl dāvanu kartes izloze, spied šeit</p><a id="short" href="https://bit.ly/3lidlXyz">bit.ly/3lidlXyz</a></div></div></body></html>`,
  'https://lucky-prize-claim.com/': `<!doctype html><html><head><title>Claim</title></head><body>prize</body></html>`,
};

async function newPage() {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const body = FIXTURES[req.url()];
    if (req.url() === 'https://bit.ly/3lidlXyz' && req.isNavigationRequest()) {
      req.respond({ status: 302, headers: { location: 'https://lucky-prize-claim.com/' }, body: '' });
      return;
    }
    if (body && req.isNavigationRequest()) req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body });
    else req.continue();
  });
  return page;
}

/** Faktiskā adrese: Firefox BiDi pēc paplašinājuma pāradresācijas page.url() var nerādīt – nolasām lapā. */
async function currentUrl(page) {
  const u = await page.evaluate(() => location.href).catch(() => null);
  return u && u !== 'about:blank' ? u : page.url();
}

async function waitForUrl(page, pred, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred(await currentUrl(page))) return true;
    await sleep(150);
  }
  return false;
}

try {
  let BASE;
  if (FF) {
    await browser.installExtension(EXT);
    BASE = `moz-extension://${FF_UUID}`;
  } else {
    const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'), {
      timeout: 15000,
    });
    BASE = `chrome-extension://${new URL(sw.url()).hostname}`;
  }
  const extId = BASE;
  ok('paplašinājums ielādēts', !!extId, extId);
  await sleep(1500); // DNR noteikumi + dzinējs

  // 0) Statistikas piekrišana: jautā vienreiz; līdz piekrišanai nekas netiek skaitīts
  {
    const page = await browser.newPage();
    await page.goto(`${BASE}/popup.html`, { waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
    await page.waitForSelector('#consent:not([hidden])', { timeout: 4000 }).catch(() => {});
    ok('statistikas jautājums parādās', await page.$eval('#consent', (e) => !e.hidden).catch(() => false));
    // Testi pārbauda latviskus tekstus – valoda lv neatkarīgi no pārlūka valodas
    await page.evaluate(() => chrome.storage.sync.set({ settings: { lang: 'lv' } }));
    await page.click('#consentYes');
    await sleep(300);
    const s = await page.evaluate(() => chrome.storage.sync.get('settings'));
    if (FF) {
      // Firefox parāda savu datu vākšanas apstiprinājuma logu – headless to nevar apstiprināt; iestatām tieši
      console.log('– Firefox: piekrišanu apstiprina pārlūka logs (pārbaudīt ar roku); testā iestata tieši');
      await page.evaluate(() => chrome.storage.sync.set({ settings: { shareStats: true, lang: 'lv' } }));
    } else ok('piekrišana saglabāta', s.settings?.shareStats === true);
    await page.close();
  }

  // 1) Zināms krāpnieku domēns -> DNR pāradresē uz brīdinājumu vēl pirms ielādes
  {
    const page = await newPage();
    page.goto('http://phishing-test.urlguard.invalid/login').catch(() => {});
    const hit = await waitForUrl(page, (u) => u.startsWith(`${BASE}/warning.html`));
    ok('bloķēto saraksts (DNR) -> brīdinājums', hit, (await currentUrl(page)).slice(0, 90));
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
    ok('viltots e-veselības domēns -> brīdinājums', hit, (await currentUrl(page)).slice(0, 90));
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
    await page.waitForSelector('urlguard-mark', { timeout: 6000 }).catch(() => {});
    await sleep(500);
    const marks = await page.$$eval('urlguard-mark', (els) =>
      els.map((e) => {
        const h = e.parentElement;
        const r = e.getBoundingClientRect();
        const hr = h.getBoundingClientRect();
        return { kind: e.dataset.kind, title: e.title, inHeading: !!h.closest('h3,[role="heading"]'), firstChild: h.firstChild === e,
          centered: Math.abs(r.top + r.height / 2 - (hr.top + hr.height / 2)) < hr.height / 2, transform: getComputedStyle(e).transform };
      }),
    );
    const danger = marks.find((m) => m.kind === 'danger');
    ok('reklāma atzīmēta ar sarkanu ikonu', !!danger && /krāpnieku saite/.test(danger.title), danger?.title.split('\n')[0]);
    ok('oficiālā lapa ar zaļu ✓', marks.some((m) => m.kind === 'ok'));
    ok('ziņu portāls netiek atzīmēts', marks.length === 2);
    ok('ikonas ir virsraksta sākumā, tajā pašā rindā', marks.every((m) => m.inHeading && m.firstChild && m.centered), JSON.stringify(marks.map((m) => [m.inHeading, m.firstChild, m.centered])));
    ok('ikonas nav pagrieztas', marks.every((m) => m.transform === 'none'));
    const outline = await page.$eval('[data-text-ad]', (e) => e.style.outline);
    ok('sarkanā reklāma ar rāmi', /solid/.test(outline));
    await page.screenshot({ path: resolve('test/serp.png') });
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
    ok('pieslēgšanās forma uz viltota domēna -> brīdinājums', hit, (await currentUrl(page)).slice(0, 80));
    await page.close();
  }

  // 5b) Soc. tīkls: ieraksts par Lidl izlozi ar svešu saiti -> atzīme; parasts ieraksts -> nekas
  {
    const page = await newPage();
    await page.goto('https://www.facebook.com/feed-test', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#scam urlguard-mark', { timeout: 8000 }).catch(() => {});
    const marks = await page.evaluate(() => ({
      scam: document.querySelector('#scam urlguard-mark')?.dataset.kind,
      ok: !!document.querySelector('#ok urlguard-mark'),
      short: document.querySelector('#short urlguard-mark')?.dataset.kind,
      tip: document.querySelector('#scam urlguard-mark')?.title.split('\n')[0],
    }));
    ok('soc. tīkls: izlozes krāpšana atzīmēta', marks.scam === 'danger', marks.tip);
    ok('soc. tīkls: parasta saite netiek atzīmēta', !marks.ok);
    ok('soc. tīkls: saīsināta saite ar izlozi – brīdinājuma ikona', marks.short === 'warn');
    // Klikšķis uz bit.ly -> 302 uz svešu domēnu -> brīdinājums ar ieraksta kontekstu
    await page.click('#short');
    const hit = await waitForUrl(page, (u) => u.includes('/warning.html?id='), 8000);
    const reasons = hit ? await page.$eval('#reasons', (e) => e.textContent).catch(() => '') : '';
    ok('bit.ly -> galamērķis pārbaudīts ar ieraksta kontekstu', hit && /Lidl/.test(reasons), (await currentUrl(page)).slice(0, 70));
    await page.close();
  }

  // 5c) Vietnes izslēgšana: aizdomīgai lapai vairs nav joslas
  {
    const page = await browser.newPage();
    await page.goto(`${BASE}/popup.html`, { waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
    await page.evaluate(() => chrome.storage.sync.get('settings').then((s) => chrome.storage.sync.set({ settings: { ...s.settings, disabledSites: ['swedbankas.com'] } })));
    await page.close();
    const p2 = await newPage();
    await p2.goto('https://swedbankas.com/', { waitUntil: 'domcontentloaded' });
    await sleep(1500);
    const bar = await p2.evaluate(() => [...document.documentElement.children].some((e) => e.style.zIndex === '2147483647'));
    ok('izslēgtā vietnē nav joslas', !bar);
    await p2.close();
    const p3 = await browser.newPage();
    await p3.goto(`${BASE}/popup.html`, { waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
    await p3.waitForSelector('#disabledList li', { timeout: 4000 }).catch(() => {});
    const listed = await p3.$$eval('#disabledList li span', (els) => els.map((e) => e.textContent));
    ok('izslēgtā vietne redzama iestatījumos', listed.includes('swedbankas.com'), JSON.stringify(listed));
    await p3.evaluate(() => chrome.storage.sync.get('settings').then((s) => chrome.storage.sync.set({ settings: { ...s.settings, disabledSites: [] } })));
    await p3.close();
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
    await page.goto(`${BASE}/popup.html?u=${encodeURIComponent('https://swedbank.top/ib')}`, { waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
    await page.waitForFunction(() => document.getElementById('verdict')?.textContent !== '…', { timeout: 5000 });
    const v = await page.$eval('#verdict', (e) => e.textContent);
    const log = await page.$$eval('#log li', (els) => els.length);
    ok('popup rāda vērtējumu', v === 'Bīstama lapa', v);
    ok('žurnālā ir ieraksti', log >= 3, `${log} ieraksti`);
    const { statsPending } = await page.evaluate(() => chrome.storage.local.get('statsPending'));
    ok('statistika skaita tikai skaitļus', statsPending?.blocked >= 2 && Object.keys(statsPending).length === 6, JSON.stringify(statsPending));
    ok('jautājums vairs neparādās', await page.$eval('#consent', (e) => e.hidden));
    const brands = await page.$$eval('#rBrand option', (o) => o.length);
    ok('ziņošanas formā zīmolu saraksts', brands > 40);

    // Valodas maiņa: krievu un angļu, tad atpakaļ latviešu
    const u = `${BASE}/popup.html?u=${encodeURIComponent('https://swedbank.top/ib')}`;
    for (const [code, expectVerdict, expectReason] of [
      ['ru', 'Опасный сайт', 'окончанием домена'],
      ['en', 'Dangerous site', 'different ending'],
      ['lv', 'Bīstama lapa', 'galotni'],
    ]) {
      await page.evaluate((c) => chrome.storage.sync.get('settings').then((s) => chrome.storage.sync.set({ settings: { ...s.settings, lang: c } })), code);
      await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
      await page.waitForFunction(() => document.getElementById('verdict')?.textContent !== '…', { timeout: 5000 }).catch(() => {});
      const [verdict, reason, lang, title] = await page.evaluate(() => [
        document.getElementById('verdict').textContent,
        document.querySelector('#reasons li')?.textContent ?? '',
        document.documentElement.lang,
        document.querySelector('[data-i18n="settings.title"]').textContent,
      ]);
      ok(`valoda ${code}: popup tulkots`, verdict === expectVerdict && reason.includes(expectReason) && lang === code, `${verdict} | ${title} | ${reason.slice(0, 50)}`);
    }
    await page.screenshot({ path: resolve('test/popup.png'), fullPage: true });
    // Bāzes atjaunināšana no releja (paraksta pārbaude paplašinājumā)
    const before = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'getStatus' }).then((s) => s.data.generated));
    const upd = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'updateNow' }));
    const after = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'getStatus' }).then((s) => s.data));
    ok('bāzes atjaunināšana no releja', (upd === 'updated' || upd === 'up-to-date') && after.domains > 1 && !after.generated.startsWith('1970'), `${upd}: ${before} -> ${after.generated}, bloķēti ${after.domains}`);
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
