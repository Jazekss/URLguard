import { Engine } from './core/engine';
import { SCHEMA_VERSION, type Bundle, type CheckResult, type Verdict } from './core/types';
import { verifyBundle } from './core/signature';
import { initLang, t } from './i18n';
import { iconImages, type IconState } from './icon';
import { BUNDLE_URLS, DATA_REPO, PUBLIC_KEY_B64, STATS_ENDPOINT, TARGET, UPDATE_PERIOD_MIN } from './config';
import { cleanUrl, EMPTY_STATS, getSettings, isSiteDisabled, type LogEntry, type SerpItemIn, type SerpItemOut, type StatCounts } from './shared';

const RANK: Record<Verdict, number> = { official: 0, safe: 1, unknown: 2, suspicious: 3, danger: 4 };
const DNR_BASE_ID = 1000;
const DNR_CHUNK = 1000;
const LOG_MAX = 300;
const QUERY_TTL = 10 * 60_000;
const BYPASS_TTL = 60 * 60_000;

// ---------------------------------------------------------------- bāze / dzinējs
let enginePromise: Promise<Engine> | null = null;

function getEngine(): Promise<Engine> {
  if (!enginePromise) enginePromise = loadEngine().catch((e) => {
    enginePromise = null;
    throw e;
  });
  return enginePromise;
}

async function loadEngine(): Promise<Engine> {
  const builtin = (await (await fetch(chrome.runtime.getURL('data/bundle.json'))).json()) as Bundle;
  const { cachedBundle } = (await chrome.storage.local.get('cachedBundle')) as { cachedBundle?: Bundle };
  const useCached =
    cachedBundle?.version === SCHEMA_VERSION && Date.parse(cachedBundle.generated) > Date.parse(builtin.generated);
  const b = useCached ? cachedBundle! : builtin;
  await syncDnr(b);
  return new Engine(b);
}

/** Lejupielādē parakstīto bāzi no GitHub/CDN; pieņem tikai ar derīgu parakstu un jaunāku datumu. */
async function updateBundle(): Promise<'updated' | 'up-to-date' | 'failed' | 'not-configured'> {
  if (!DATA_REPO || DATA_REPO.includes('OWNER')) return 'not-configured';
  const current = (await getEngine()).bundle;
  for (const url of BUNDLE_URLS) {
    try {
      const [dataRes, sigRes] = await Promise.all([fetch(url, { cache: 'no-cache' }), fetch(url + '.sig', { cache: 'no-cache' })]);
      if (!dataRes.ok || !sigRes.ok) continue;
      const bytes = new Uint8Array(await dataRes.arrayBuffer());
      if (!(await verifyBundle(bytes, await sigRes.text(), PUBLIC_KEY_B64))) {
        console.warn('URLguard: nederīgs paraksts', url);
        continue;
      }
      const b = JSON.parse(new TextDecoder().decode(bytes)) as Bundle;
      if (b.version !== SCHEMA_VERSION) continue;
      await chrome.storage.local.set({ lastUpdateCheck: Date.now() });
      // Nepieņemam vecāku bāzi (aizsardzība pret "atritināšanu").
      if (Date.parse(b.generated) <= Date.parse(current.generated)) return 'up-to-date';
      await chrome.storage.local.set({ cachedBundle: b });
      await syncDnr(b);
      enginePromise = Promise.resolve(new Engine(b));
      return 'updated';
    } catch (e) {
      console.warn('URLguard: atjaunināšana neizdevās', url, e);
    }
  }
  return 'failed';
}

/** Zināmos krāpnieku domēnus bloķē declarativeNetRequest – vēl pirms lapas ielādes. */
async function syncDnr(b: Bundle): Promise<void> {
  const { dnrGenerated } = await chrome.storage.local.get('dnrGenerated');
  if (dnrGenerated === b.generated) return;
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const domains = b.blocklist.domains.filter((d) => /^[a-z0-9.-]+$/.test(d));
  const target = chrome.runtime.getURL('warning.html');
  const addRules = [];
  for (let i = 0; i < domains.length; i += DNR_CHUNK) {
    addRules.push({
      id: DNR_BASE_ID + i / DNR_CHUNK,
      priority: 1,
      action: { type: 'redirect', redirect: { regexSubstitution: `${target}#\\0` } },
      condition: { regexFilter: '^.+$', requestDomains: domains.slice(i, i + DNR_CHUNK), resourceTypes: ['main_frame'] },
    });
  }
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: addRules as chrome.declarativeNetRequest.Rule[],
  });
  await chrome.storage.local.set({ dnrGenerated: b.generated });
}

// ---------------------------------------------------------------- stāvoklis (session storage)
type TabState = { result: CheckResult };

async function getTabState(tabId: number): Promise<TabState | undefined> {
  return (await chrome.storage.session.get(`tab:${tabId}`))[`tab:${tabId}`] as TabState | undefined;
}
async function setTabState(tabId: number, result: CheckResult) {
  await chrome.storage.session.set({ [`tab:${tabId}`]: { result } });
}
async function getTabQuery(tabId: number): Promise<string | undefined> {
  const v = (await chrome.storage.session.get(`q:${tabId}`))[`q:${tabId}`] as { q: string; t: number } | undefined;
  return v && Date.now() - v.t < QUERY_TTL ? v.q : undefined;
}
async function isBypassed(host: string): Promise<boolean> {
  const { bypass = {} } = (await chrome.storage.session.get('bypass')) as { bypass?: Record<string, number> };
  return (bypass[host] ?? 0) > Date.now();
}
async function addBypass(host: string) {
  const { bypass = {} } = (await chrome.storage.session.get('bypass')) as { bypass?: Record<string, number> };
  bypass[host] = Date.now() + BYPASS_TTL;
  await chrome.storage.session.set({ bypass });
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const id = rules.reduce((m, r) => Math.max(m, r.id), 0) + 1;
  await chrome.declarativeNetRequest.updateSessionRules({
    addRules: [
      {
        id,
        priority: 2,
        action: { type: 'allow' as chrome.declarativeNetRequest.RuleActionType },
        condition: { requestDomains: [host], resourceTypes: ['main_frame' as chrome.declarativeNetRequest.ResourceType] },
      },
    ],
  });
}

async function addLog(results: CheckResult[], source: LogEntry['source'], action: LogEntry['action']) {
  if (!results.length) return;
  const { log = [] } = (await chrome.storage.local.get('log')) as { log?: LogEntry[] };
  for (const r of results) {
    log.unshift({
      t: Date.now(),
      url: cleanUrl(r.url),
      host: r.host,
      verdict: r.verdict,
      brand: r.brand?.name,
      reasons: r.reasons.map((x) => x.code),
      source,
      action,
    });
  }
  await chrome.storage.local.set({ log: log.slice(0, LOG_MAX) });
  const field: Record<LogEntry['action'], keyof StatCounts> = {
    blocked: 'blocked', warned: 'warned', marked: 'serpMarked', hidden: 'serpHidden', bypassed: 'bypassed',
  };
  await countStat(field[action], results.length);
}

// ---------------------------------------------------------------- anonīmā statistika (tikai ar piekrišanu)
/** Lokāls skaitītājs; nekas netiek glabāts/sūtīts, ja lietotājs nav piekritis. */
async function countStat(field: keyof StatCounts, n = 1) {
  if ((await getSettings()).shareStats !== true) return;
  const { statsPending } = (await chrome.storage.local.get('statsPending')) as { statsPending?: StatCounts };
  const s = { ...EMPTY_STATS, ...statsPending };
  s[field] += n;
  await chrome.storage.local.set({ statsPending: s });
}

/** Reizi dienā nosūta TIKAI skaitļus (bez saitēm, laikiem, identifikatoriem). */
async function sendStats() {
  if ((await getSettings()).shareStats !== true) return;
  const { statsPending } = (await chrome.storage.local.get('statsPending')) as { statsPending?: StatCounts };
  const c = { ...EMPTY_STATS, ...statsPending };
  try {
    const res = await fetch(STATS_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ browser: TARGET, c }),
    });
    if (res.ok) await chrome.storage.local.set({ statsPending: EMPTY_STATS, statsLastSent: Date.now() });
  } catch {
    /* mēģināsim rīt */
  }
}

function ensureStatsAlarm() {
  chrome.alarms.get('stats-send', (a) => {
    // Nejauša nobīde, lai visi paplašinājumi nesūta vienlaicīgi
    if (!a) chrome.alarms.create('stats-send', { periodInMinutes: 1440, delayInMinutes: 60 + Math.floor(Math.random() * 600) });
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings && (changes.settings.newValue as { shareStats?: boolean } | undefined)?.shareStats !== true) {
    chrome.storage.local.remove(['statsPending']);
  }
});

// ---------------------------------------------------------------- UI palīgi
// ---------------------------------------------------------------- rīkjoslas ikona
let accent: string | null = null; // Firefox tēmas akcenta krāsa (ja iestatījumos ieslēgts)

/** Firefox: pārlūka tēmas akcenta krāsa. Chromium pārlūki tēmas krāsas paplašinājumiem nedod. */
async function loadAccent() {
  accent = null;
  const s = await getSettings();
  const theme = (globalThis as unknown as { browser?: { theme?: { getCurrent(): Promise<{ colors?: Record<string, unknown> }> } } }).browser?.theme;
  if (!s.accentIcon || TARGET !== 'firefox' || !theme) return;
  try {
    const c = (await theme.getCurrent()).colors ?? {};
    const pick = [c.tab_line, c.icons_attention, c.toolbar_field_highlight, c.accentcolor].find((x) => typeof x === 'string' && x);
    accent = (pick as string | undefined) ?? null;
  } catch {
    accent = null;
  }
}

function paint(tabId: number | undefined, state: IconState) {
  const imageData = iconImages(state, state === 'ok' && accent ? accent : undefined);
  if (imageData) chrome.action.setIcon(tabId == null ? { imageData } : { tabId, imageData }).catch(() => {});
  const title = `URLguard – ${t(`icon.${state}`)}`;
  chrome.action.setTitle(tabId == null ? { title } : { tabId, title }).catch(() => {});
}

function stateOf(r: CheckResult | undefined, disabled: boolean): IconState {
  if (disabled) return 'off';
  return r?.verdict === 'danger' ? 'danger' : r?.verdict === 'suspicious' ? 'warn' : 'ok';
}

/** Cilnes ikona pēc pārbaudes rezultāta. */
function setBadge(tabId: number, r: CheckResult, disabled = false) {
  paint(tabId, stateOf(r, disabled));
}

/** Kopējā ikona (zaļa / pelēka) un visas atvērtās cilnes – pēc iestatījumu maiņas. */
async function refreshIcons() {
  await initLang();
  await loadAccent();
  const s = await getSettings();
  paint(undefined, s.enabled ? 'ok' : 'off');
  const tabs = await chrome.tabs.query({}).catch(() => [] as chrome.tabs.Tab[]);
  for (const tab of tabs) {
    if (tab.id == null) continue;
    const st = await getTabState(tab.id);
    paint(tab.id, stateOf(st?.result, !s.enabled || (!!st && isSiteDisabled(s, st.result.host))));
  }
}

async function showWarning(tabId: number, r: CheckResult) {
  const id = crypto.randomUUID();
  await chrome.storage.session.set({ [`w:${id}`]: r });
  await chrome.tabs.update(tabId, { url: chrome.runtime.getURL(`warning.html?id=${id}`) });
}

function openWindow(path: string) {
  chrome.windows.create({ url: chrome.runtime.getURL(path), type: 'popup', width: 440, height: 680 });
}

// ---------------------------------------------------------------- navigācija
// ---------------------------------------------------------------- saites konteksts (no kā saite atvērta)
interface LinkCtx { context: string; anchor: string; from: string; t: number }
const CTX_TTL = 20_000;
const pendingByUrl = new Map<string, LinkCtx>(); // uzklikšķinātā saite -> konteksts
const ctxByRequest = new Map<string, LinkCtx>(); // navigācija (arī pēc pāradresācijām) -> konteksts

function rememberClick(urls: string[], c: LinkCtx) {
  const now = Date.now();
  for (const [k, v] of pendingByUrl) if (now - v.t > CTX_TTL) pendingByUrl.delete(k);
  for (const u of urls) if (u) pendingByUrl.set(u, c);
}

function contextFor(requestId: string | undefined, url: string): LinkCtx | undefined {
  if (requestId && ctxByRequest.has(requestId)) return ctxByRequest.get(requestId);
  const c = pendingByUrl.get(url);
  if (c && Date.now() - c.t < CTX_TTL) {
    pendingByUrl.delete(url);
    if (requestId) {
      ctxByRequest.set(requestId, c);
      if (ctxByRequest.size > 200) ctxByRequest.delete(ctxByRequest.keys().next().value!);
    }
    return c;
  }
  return undefined;
}

async function onMainFrame(tabId: number, url: string, requestId?: string) {
  const settings = await getSettings();
  if (!settings.enabled) return;
  const lc = contextFor(requestId, url);
  if (isSiteDisabled(settings, new URL(url).hostname)) {
    paint(tabId, 'off');
    return;
  }
  const engine = await getEngine();
  // Konteksts no soc. tīkla ieraksta / e-pasta, ja saite atvērta no tāda (arī pēc bit.ly pāradresācijas)
  const r = engine.check(url, { query: await getTabQuery(tabId), context: lc?.context, anchor: lc?.anchor });
  await setTabState(tabId, r);
  setBadge(tabId, r);
  if (await isBypassed(r.host)) return;
  if (r.verdict === 'danger') {
    await addLog([r], 'nav', 'blocked');
    if (r.listed !== 'domain') await showWarning(tabId, r); // domēnu sarakstu jau apstrādā DNR
  } else if (r.verdict === 'suspicious') {
    await addLog([r], 'nav', 'warned');
  }
}

chrome.webRequest.onBeforeRequest.addListener(
  (d) => {
    if (d.tabId >= 0 && d.type === 'main_frame') onMainFrame(d.tabId, d.url, d.requestId).catch(console.error);
    return undefined;
  },
  { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] },
);

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove([`tab:${tabId}`, `q:${tabId}`]).catch(() => {});
});

// ---------------------------------------------------------------- ziņojumi
type Msg =
  | { type: 'serpCheck'; query: string; items: SerpItemIn[] }
  | { type: 'pageInit' }
  | { type: 'pageSignals'; signals: import('./core/types').PageSignals }
  | { type: 'getWarning'; id: string }
  | { type: 'checkUrl'; url: string }
  | { type: 'bypass'; url: string }
  | { type: 'getStatus'; url?: string; tabId?: number }
  | { type: 'updateNow' }
  | { type: 'getBrands' }
  | { type: 'openReport'; url: string; kind?: 'phishing' | 'false_positive' }
  | { type: 'reportSent' }
  | { type: 'checkUpdate' }
  | { type: 'linkContext'; url: string; raw: string; context: string; anchor: string; from: string }
  | { type: 'contextCheck'; items: { key: string; url: string; context: string; anchor: string }[] };

/** Popup: ja cilnei jau ir rezultāts (piem. no lapas satura pārbaudes) – rādām to. */
async function statusFor(engine: Engine, url: string, tabId?: number): Promise<CheckResult> {
  const st = tabId != null ? await getTabState(tabId) : undefined;
  return st && st.result.url === url ? st.result : engine.check(url);
}

async function handle(msg: Msg, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const tabId = sender.tab?.id;
  switch (msg.type) {
    case 'linkContext': {
      rememberClick([msg.url, msg.raw], {
        context: String(msg.context ?? '').slice(0, 600),
        anchor: String(msg.anchor ?? '').slice(0, 200),
        from: String(msg.from ?? ''),
        t: Date.now(),
      });
      return true;
    }
    case 'contextCheck': {
      const settings = await getSettings();
      if (!settings.enabled || (sender.url && isSiteDisabled(settings, new URL(sender.url).hostname))) return [];
      const engine = await getEngine();
      const out = msg.items.slice(0, 100).map((it) => {
        const result = engine.check(it.url, { context: it.context, anchor: it.anchor });
        const shortenerBrand =
          result.shortener && /izloz|laim|balv|dāvan|giveaway|prize|login|pieslēd|apstiprin/i.test(`${it.anchor} ${it.context}`)
            ? engine.brandsInText(`${it.anchor}\n${it.context}`)[0]?.name
            : undefined;
        return { key: it.key, result, shortenerBrand };
      });
      const bad = out.filter((o) => o.result.verdict === 'danger').map((o) => o.result);
      await addLog(bad, 'page', 'marked');
      return out;
    }
    case 'serpCheck': {
      const settings = await getSettings();
      if (!settings.enabled || (sender.url && isSiteDisabled(settings, new URL(sender.url).hostname))) return [];
      const engine = await getEngine();
      if (tabId != null && msg.query) await chrome.storage.session.set({ [`q:${tabId}`]: { q: msg.query, t: Date.now() } });
      const qBrands = engine.brandsInText(msg.query ?? '').map((b) => b.id);
      const out: SerpItemOut[] = msg.items.map((it) => {
        const ctx = { query: msg.query, title: it.title, isAd: it.isAd };
        let r = engine.check(it.url, ctx);
        if (it.displayUrl) {
          const r2 = engine.check(it.displayUrl, ctx);
          if (RANK[r2.verdict] > RANK[r.verdict]) r = r2;
        }
        // Organiskos rezultātus meklētājs jau filtrē – bez saraksta trāpījuma tie nav "bīstami", tikai "aizdomīgi".
        if (!it.isAd && r.verdict === 'danger' && !r.listed) r = { ...r, verdict: 'suspicious' };
        const officialMatch = r.verdict === 'official' && !!r.brand && qBrands.includes(r.brand.id);
        return { key: it.key, verdict: r.verdict, result: r, officialMatch };
      });
      const bad = out.filter((o) => o.verdict === 'danger').map((o) => o.result);
      await addLog(bad, 'serp', settings.serpMode === 'hide' ? 'hidden' : 'marked');
      return out;
    }
    case 'pageInit': {
      const settings = await getSettings();
      let state = tabId != null ? await getTabState(tabId) : undefined;
      // Ja dienests tika pārstartēts vai lapa atvērta no kešatmiņas – pārbaudām no jauna.
      if (sender.url && (!state || state.result.url !== sender.url)) {
        const r = (await getEngine()).check(sender.url, { query: tabId != null ? await getTabQuery(tabId) : undefined });
        state = { result: r };
        if (tabId != null) await setTabState(tabId, r);
      }
      if (tabId != null && state) setBadge(tabId, state.result);
      return {
        enabled: settings.enabled && !(sender.url && isSiteDisabled(settings, new URL(sender.url).hostname)),
        pageChecks: settings.pageChecks,
        result: state?.result,
        bypassed: state ? await isBypassed(state.result.host) : false,
      };
    }
    case 'pageSignals': {
      if (tabId == null || !sender.url) return null;
      const engine = await getEngine();
      const prev = (await getTabState(tabId))?.result;
      const r = engine.checkPage(sender.url, msg.signals);
      if (prev && RANK[r.verdict] <= RANK[prev.verdict]) return prev;
      await setTabState(tabId, r);
      setBadge(tabId, r);
      if (await isBypassed(r.host)) return r;
      if (r.verdict === 'danger') {
        await addLog([r], 'page', 'blocked');
        await showWarning(tabId, r);
      } else if (r.verdict === 'suspicious') await addLog([r], 'page', 'warned');
      return r;
    }
    case 'getWarning': {
      const key = `w:${msg.id}`;
      return (await chrome.storage.session.get(key))[key] ?? null;
    }
    case 'checkUrl':
      return (await getEngine()).check(msg.url, { query: tabId != null ? await getTabQuery(tabId) : undefined });
    case 'bypass': {
      const host = new URL(msg.url).hostname;
      await addBypass(host);
      await addLog([{ url: msg.url, host, domain: host, verdict: 'danger', score: 0, reasons: [] }], 'nav', 'bypassed');
      return true;
    }
    case 'getStatus': {
      const engine = await getEngine();
      const { lastUpdateCheck, log = [], latestRelease } = await chrome.storage.local.get(['lastUpdateCheck', 'log', 'latestRelease']);
      return {
        result: msg.url ? await statusFor(engine, msg.url, msg.tabId) : null,
        data: {
          generated: engine.bundle.generated,
          brands: engine.bundle.brands.length,
          domains: engine.bundle.blocklist.domains.length + engine.bundle.blocklist.urls.length,
          lastUpdateCheck,
          repoConfigured: !!DATA_REPO && !DATA_REPO.includes('OWNER'),
        },
        log,
        update: { current: chrome.runtime.getManifest().version, latest: latestRelease ?? null, installType: await installType() },
      };
    }
    case 'updateNow':
      return updateBundle();
    case 'checkUpdate': {
      const type = await installType();
      let status = 'unsupported';
      if (type === 'normal' || type === 'admin') {
        // No veikala: pārlūks lejupielādē; onUpdateAvailable to uzreiz piemēro
        try {
          const r = (await chrome.runtime.requestUpdateCheck()) as unknown as { status: string } | string;
          status = typeof r === 'string' ? r : r.status;
        } catch (e) {
          status = 'error';
        }
      }
      await checkLatestRelease();
      const { latestRelease } = await chrome.storage.local.get('latestRelease');
      return { status, installType: type, latest: latestRelease ?? null, current: chrome.runtime.getManifest().version };
    }
    case 'reportSent':
      await countStat('reports');
      return true;
    case 'getBrands':
      return (await getEngine()).brands.map((b) => ({ id: b.id, name: b.name }));
    case 'openReport':
      openWindow(`popup.html?u=${encodeURIComponent(msg.url)}&report=1${msg.kind === 'false_positive' ? '&kind=fp' : ''}`);
      return true;
  }
  return null;
}

chrome.runtime.onMessage.addListener((msg: Msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, (e) => sendResponse({ error: String(e) }));
  return true;
});

// ---------------------------------------------------------------- konteksta izvēlne
chrome.contextMenus.onClicked.addListener((info) => {
  const url = info.linkUrl ?? info.pageUrl;
  if (!url) return;
  const report = info.menuItemId === 'ug-report';
  openWindow(`popup.html?u=${encodeURIComponent(url)}${report ? '&report=1' : ''}`);
});

// ---------------------------------------------------------------- paplašinājuma atjauninājumi
// Veikala versijas pārlūks atjaunina pats; mēs jauno versiju piemērojam UZREIZ (negaidot pārlūka restartu).
chrome.runtime.onUpdateAvailable.addListener(() => chrome.runtime.reload());

function newer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

/** Publicētā jaunākā versija (GitHub Releases). Ja jaunāka – ikonai "!" un paziņojums popup logā. */
async function checkLatestRelease() {
  try {
    const res = await fetch(`https://api.github.com/repos/${DATA_REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json' } });
    if (!res.ok) return;
    const j = (await res.json()) as { tag_name?: string; html_url?: string };
    const version = (j.tag_name ?? '').replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+$/.test(version)) return;
    const current = chrome.runtime.getManifest().version;
    const available = newer(version, current) ? { version, url: j.html_url } : null;
    await chrome.storage.local.set({ latestRelease: available });
    chrome.action.setBadgeText({ text: available ? '!' : '' }).catch(() => {});
    if (available) chrome.action.setBadgeBackgroundColor({ color: '#1d5fd1' }).catch(() => {});
  } catch {
    /* tīkla kļūda – mēģināsim vēlāk */
  }
}

async function installType(): Promise<string> {
  try {
    return (await chrome.management.getSelf()).installType ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------- dzīves cikls
/** Labā klikšķa izvēlne lietotāja valodā (pārveido, mainot valodu iestatījumos). */
async function createMenus() {
  await initLang();
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: 'ug-check', title: t('menu.check'), contexts: ['link'] });
  chrome.contextMenus.create({ id: 'ug-report', title: t('menu.report'), contexts: ['link', 'page'] });
}

chrome.storage.onChanged.addListener((changes, area) => {
  const oldLang = (changes.settings?.oldValue as { lang?: string } | undefined)?.lang;
  const newLang = (changes.settings?.newValue as { lang?: string } | undefined)?.lang;
  if (area === 'sync' && changes.settings && oldLang !== newLang) createMenus().catch(() => {});
  if (area === 'sync' && changes.settings) refreshIcons().catch(() => {});
});

chrome.runtime.onInstalled.addListener(async () => {
  await createMenus();
  chrome.alarms.create('bundle-update', { periodInMinutes: UPDATE_PERIOD_MIN, delayInMinutes: 1 });
  ensureStatsAlarm();
  refreshIcons().catch(() => {});
  checkLatestRelease();
  await getEngine();
});

chrome.runtime.onStartup.addListener(() => {
  refreshIcons().catch(() => {});
  checkLatestRelease();
  chrome.alarms.get('bundle-update', (a) => {
    if (!a) chrome.alarms.create('bundle-update', { periodInMinutes: UPDATE_PERIOD_MIN, delayInMinutes: 1 });
  });
  ensureStatsAlarm();
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'bundle-update') {
    updateBundle().then((r) => console.log('URLguard bāze:', r));
    checkLatestRelease();
  }
  if (a.name === 'stats-send') sendStats();
});
