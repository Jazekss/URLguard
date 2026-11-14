import { describe, expect, it } from 'vitest';
import { Engine } from '../src/core/engine';
import { decodeLabel } from '../src/core/punycode';
import { skeleton } from '../src/core/text';
// @ts-expect-error – .mjs bez tipiem
import { buildBundle } from '../../data/scripts/build-bundle.mjs';

const bundle = await buildBundle();
const engine = new Engine(bundle);
const v = (url: string, ctx = {}) => engine.check(url, ctx).verdict;

describe('punycode / skelets', () => {
  it('dekodē kirilicas "apple"', () => {
    expect(decodeLabel('80ak6aa92e')).toBe('аррӏе');
    expect(skeleton('аррӏе')).toBe('apple');
  });
});

describe('oficiālās un drošās lapas', () => {
  it.each([
    'https://www.swedbank.lv/private',
    'https://ib.swedbank.lv/',
    'https://www.eveseliba.gov.lv/',
    'https://e.csdd.lv/',
    'https://www.seb.lv/',
    'https://www.google.com/search?q=seb',
    'https://lsm.lv/raksts/zinas/swedbank-ieviesis-jaunu.a1234/',
  ])('%s', (url) => {
    expect(['official', 'safe']).toContain(v(url));
  });

  it('nepazīstamas parastas lapas nebrīdina', () => {
    for (const u of [
      'https://vid.me/', 'https://www.bolt.com/', 'https://me.com.br/', 'https://1mt.ru/',
      'https://www.example.com/', 'https://cooking-recipes.lv/',
      'https://videoclips.com/', 'https://sebastians.lv/', 'https://industrial-parts.com/', 'https://pineapple.com/',
      'https://hotel-booking.lv/', 'https://localhost:3000/', 'http://192.168.1.1/',
    ]) expect(v(u), u).toBe('unknown');
  });
});

describe('krāpnieku paraugi', () => {
  it.each([
    ['https://eveseliba.lv.pieteikums.com/login', 'danger'],
    ['https://eveseliba-gov-lv.com/', 'danger'],
    ['https://www.swedbank.lv-secure-login.com/', 'danger'],
    ['https://swedbank.top/', 'danger'],
    ['https://swedbamk.lv/ib/login', 'danger'],
    ['https://xn--80ak6aa92e.com/', 'danger'],
    ['https://seb-lv.com/login', 'danger'],
    ['https://citadele-verify.xyz/', 'danger'],
    ['https://g00gle.com/', 'danger'],
    ['https://steamcommunlty.com/tradeoffer', 'danger'],
    ['https://swedbank-lv.pages.dev/', 'danger'],
    ['http://phishing-test.urlguard.invalid/', 'danger'],
    ['https://latvija.gov.lv.e-pakalpojumi.net/', 'danger'],
    ['https://www.ss.com.example.org/', 'danger'],
    ['https://lmt-bonuss.com/', 'suspicious'],
    ['https://omniva-piegade.com/paka', 'danger'],
    ['https://dpd-lv.info/track', 'danger'],
    ['https://swedbankas.com/', 'suspicious'],
  ])('%s -> %s', (url, expected) => {
    const r = engine.check(url);
    expect(r.verdict, JSON.stringify(r.reasons)).toBe(expected);
    if (expected !== 'unknown') expect(r.reasons.length).toBeGreaterThan(0);
  });

  it('norāda oficiālo lapu', () => {
    const r = engine.check('https://eveseliba.lv.pieteikums.com/');
    expect(r.brand?.id).toBe('eveseliba');
    expect(r.brand?.url).toBe('https://www.eveseliba.gov.lv');
  });
});

describe('saites konteksts (soc. tīkli, e-pasts)', () => {
  it('Lidl izloze -> svešs domēns = bīstams', () => {
    const r = engine.check('https://lucky-shoppers-club.com/claim', {
      context: 'Lidl izloze! Laimē 500 € dāvanu karti – atbildi uz 3 jautājumiem', anchor: 'Piedalīties',
    });
    expect(r.verdict).toBe('danger');
    expect(r.brand?.id).toBe('lidl');
    expect(r.reasons.map((x) => x.code)).toEqual(expect.arrayContaining(['context-mismatch', 'giveaway']));
  });
  it('zīmols domēnā + izloze ierakstā -> bīstams', () => {
    expect(engine.check('https://lidl-davanas.top/claim', { context: 'Lidl izloze! Laimē dāvanu karti' }).verdict).toBe('danger');
  });
  it('saites teksts ar zīmolu -> aizdomīgs', () => {
    expect(engine.check('https://random-portal.net/', { anchor: 'Swedbank internetbanka' }).verdict).toBe('suspicious');
  });
  it('ziņa par zīmolu bez darbības vārdiem -> nebrīdina', () => {
    expect(engine.check('https://news-site-example.com/a', { context: 'Swedbank paaugstina procentu likmes', anchor: 'Lasīt vairāk' }).verdict).toBe('unknown');
  });
  it('oficiālā lapa no ieraksta par to pašu zīmolu -> oficiāla', () => {
    expect(engine.check('https://www.lidl.lv/akcijas', { context: 'Lidl izloze', anchor: 'lidl.lv' }).verdict).toBe('official');
  });
  it('saīsinātājs pats par sevi neitrāls', () => {
    const r = engine.check('https://bit.ly/3abcdEF', { context: 'Lidl izloze' });
    expect(r.verdict).toBe('unknown');
    expect(r.shortener).toBe(true);
  });
});

describe('jaunie zīmoli bez kļūdainiem brīdinājumiem', () => {
  it.each(['https://www.westernunion.com/', 'https://finance.yahoo.com/', 'https://www.shop-apotheke.com/', 'https://trezor.gov.rs/', 'https://www.portland.gov/', 'https://images-amazon.com/x', 'https://www.okx.cab/', 'https://www.lidlplus.com/'])('%s', (u) => {
    expect(['unknown', 'official', 'safe']).toContain(v(u));
  });
  it.each([['https://binance-verify-account.com/', 'binance'], ['https://lidl-davanas.top/', 'lidl'], ['https://metamask-wallet-restore.app/', 'metamask']])('%s -> %s', (u, b) => {
    const r = engine.check(u);
    expect(r.verdict).not.toBe('unknown');
    expect(r.brand?.id).toBe(b);
  });
});

describe('publiskie krāpnieku saraksti', () => {
  const e = new Engine({
    ...bundle,
    blocklist: { ...bundle.blocklist, suspect: ['random-shop-deals.com', 'citadele-bloketa.com', 'evil.duckdns.org'] },
  });
  it('tikai sarakstā -> aizdomīgs', () => {
    const r = e.check('https://random-shop-deals.com/');
    expect(r.verdict).toBe('suspicious');
    expect(r.reasons.map((x) => x.code)).toContain('feed-listed');
  });
  it('sarakstā + zīmola atdarinājums -> bīstams', () => {
    expect(e.check('https://citadele-bloketa.com/login').verdict).toBe('danger');
  });
  it('apakšdomēns uz koplietojama hostinga', () => {
    expect(e.check('https://evil.duckdns.org/x').verdict).not.toBe('unknown');
    expect(e.check('https://other.duckdns.org/').verdict).toBe('unknown');
  });
  it('oficiāls un baltais saraksts vienmēr uzvar', () => {
    const e2 = new Engine({ ...bundle, blocklist: { ...bundle.blocklist, suspect: ['swedbank.lv', 'lsm.lv'] } });
    expect(e2.check('https://www.swedbank.lv/').verdict).toBe('official');
    expect(e2.check('https://lsm.lv/').verdict).toBe('safe');
  });
});

describe('saderība ar vecākām versijām', () => {
  it('google.lv ir oficiāls arī dzinējam, kas nepazīst anyTld', () => {
    const old = structuredClone(bundle);
    for (const b of old.brands) delete (b as { anyTld?: string[] }).anyTld;
    const e = new Engine(old);
    for (const u of ['https://accounts.google.lv/accounts/SetSID', 'https://www.google.de/', 'https://www.dpd.de/', 'https://tele2.se/'])
      expect(e.check(u).verdict, u).toBe('official');
  });
  it('youtube.com.br – oficiāls', () => {
    expect(v('https://www.youtube.com.br/')).toBe('official');
  });
  it('accounts.google.lv – oficiāls (lietotāja ziņojums)', () => {
    expect(v('https://accounts.google.lv/accounts/SetSID?ssdc=1&continue=https://myaccount.google.com/')).toBe('official');
  });
});

describe('meklēšanas konteksts', () => {
  it('līdzīgs parasts vārds nav "krāpnieku" pat meklējot zīmolu', () => {
    const e2 = new Engine({ ...bundle, allowlist: [] });
    // veseliba.lv ≈ eveseliba, bet cita galotne (lv ≠ gov.lv) -> augstākais "aizdomīgs"
    expect(e2.check('https://veseliba.lv/patient', { query: 'eveselība' }).verdict).not.toBe('danger');
    expect(e2.check('https://www.eveseliba.lv/', { query: 'eveselība' }).verdict).not.toBe('danger');
  });
  it('baltais saraksts uzvar', () => {
    expect(v('https://veseliba.lv/patient', { query: 'eveselība' })).toBe('safe');
  });

  it('reklāma ar zīmola virsrakstu uz sveša domēna', () => {
    const r = engine.check('https://pakalpojumi-portals.top/', {
      query: 'eveselība', isAd: true, title: 'E-veselība – pieslēgties portālam',
    });
    expect(r.verdict).toBe('danger');
    expect(r.brand?.id).toBe('eveseliba');
  });
  it('parasta organiska ziņa ar zīmolu virsrakstā nav aizdomīga', () => {
    expect(v('https://www.tvnet.lv/123/swedbank', { query: 'swedbank', title: 'Swedbank ziņas' })).toBe('safe');
    expect(v('https://finanses.example.com/raksts', { query: 'swedbank', title: 'Swedbank ziņas' })).toBe('unknown');
  });
  it('meklēšanas sakritība palielina vērtējumu', () => {
    const a = engine.check('https://swedbank-ib.com/').score;
    const b = engine.check('https://swedbank-ib.com/', { query: 'swedbank' }).score;
    expect(b).toBeGreaterThan(a);
  });
  it('atpazīst zīmolu meklēšanas frāzē', () => {
    expect(engine.brandsInText('eveselība pieslēgties').map((b) => b.id)).toContain('eveseliba');
    expect(engine.brandsInText('seb internetbanka').map((b) => b.id)).toContain('seb');
    expect(engine.brandsInText('labākie video').map((b) => b.id)).not.toContain('vid');
  });
});

describe('lapas saturs', () => {
  it('pieslēgšanās forma uz līdzīga domēna -> bīstams', () => {
    const r = engine.checkPage('https://lmt-bonuss.com/', { title: 'LMT', text: 'Ievadiet Smart-ID', hasPassword: false, hasIdField: true });
    expect(r.verdict).toBe('danger');
  });
  it('zīmola pieslēgšanās klons uz pilnīgi cita domēna -> aizdomīgs', () => {
    const r = engine.checkPage('https://random-portal.com/a', {
      title: 'Swedbank internetbanka', text: 'Pieslēgties ar Smart-ID', hasPassword: true, hasIdField: false,
    });
    expect(r.verdict).toBe('suspicious');
    expect(r.brand?.id).toBe('swedbank');
  });
  it('oficiāla lapa ar Smart-ID paliek oficiāla', () => {
    const r = engine.checkPage('https://ib.swedbank.lv/', { title: 'Swedbank', text: 'Smart-ID', hasPassword: true, hasIdField: true });
    expect(r.verdict).toBe('official');
  });
});
