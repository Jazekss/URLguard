import type { CheckResult } from '../core/types';
import { getSettings, isSiteDisabled, saveSettings, siteKey, type LogEntry, type Settings } from '../shared';
import { applyDom, lang, LANGS, locale, reasonText, setLang, t } from '../i18n';
import { submitReport } from './report';
import { PRIVACY_URL, TARGET } from '../config';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const paramUrl = params.get('u');

interface Status {
  result: CheckResult | null;
  data: { generated: string; brands: number; domains: number; lastUpdateCheck?: number; repoConfigured: boolean };
  log: LogEntry[];
}

let activeTabId: number | undefined;

async function currentUrl(): Promise<string | undefined> {
  if (paramUrl) return paramUrl;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id;
  let url = tab?.url;
  // Ja cilnē ir mūsu brīdinājuma lapa – rādām sākotnējo saiti
  if (url?.startsWith(chrome.runtime.getURL('warning.html'))) {
    const u = new URL(url);
    const id = u.searchParams.get('id');
    if (id) url = ((await chrome.runtime.sendMessage({ type: 'getWarning', id })) as CheckResult | null)?.url;
    else url = decodeURIComponent(u.hash.slice(1));
  }
  return url;
}

function renderStatus(r: CheckResult | null, url?: string) {
  const box = $('status');
  const v = r?.verdict ?? 'unknown';
  box.className = `card status v-${v}`;
  $('statusSrc').textContent = t(paramUrl ? 'status.checkedLink' : 'status.thisPage');
  const http = !!url && /^https?:/.test(url);
  $('verdict').textContent = http ? t(`verdict.${v}`) : t('status.notChecked');
  $('host').textContent = r?.host || (url ? url.slice(0, 80) : '—');
  const ul = $('reasons');
  ul.innerHTML = '';
  for (const reason of r?.reasons ?? []) {
    const li = document.createElement('li');
    li.textContent = reasonText(reason);
    ul.append(li);
  }
  if (r?.verdict === 'official' && r.brand) {
    const li = document.createElement('li');
    li.textContent = t('status.officialOf', { brand: r.brand.name });
    ul.append(li);
  }
  if (r?.brand && r.verdict !== 'official') {
    $('officialBox').hidden = false;
    const a = $<HTMLAnchorElement>('officialLink');
    a.href = r.brand.url;
    a.textContent = `${r.brand.name} – ${new URL(r.brand.url).hostname}`;
  }
}

function renderLog(log: LogEntry[]) {
  const today = new Date().toDateString();
  $('statToday').textContent = String(
    log.filter((l) => new Date(l.t).toDateString() === today && ['blocked', 'hidden', 'marked'].includes(l.action)).length,
  );
  $('statTotal').textContent = String(log.filter((l) => l.action !== 'bypassed').length);
  const ul = $('log');
  ul.innerHTML = '';
  for (const l of log.slice(0, 40)) {
    const li = document.createElement('li');
    const time = document.createElement('span');
    time.className = 'muted';
    time.textContent = new Date(l.t).toLocaleString(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const h = document.createElement('span');
    h.className = 'h mono';
    h.textContent = l.host;
    h.title = `${l.url}${l.brand ? `\n${t('log.pretends', { brand: l.brand })}` : ''}`;
    const pill = document.createElement('span');
    pill.className = `pill v-${l.action === 'bypassed' ? 'unknown' : l.verdict}`;
    pill.textContent = t(`log.${l.action}`);
    li.append(time, h, pill);
    ul.append(li);
  }
  $('logEmpty').hidden = log.length > 0;
}

function renderData(d: Status['data']) {
  const date = new Date(d.generated).toLocaleDateString(locale());
  $('dataInfo').textContent =
    t('data.info', { date, brands: d.brands, domains: d.domains }) + (d.repoConfigured ? '' : ` · ${t('update.notConfigured')}`);
}

/** Vietnes izslēgšana: poga statusā + saraksts iestatījumos. */
function initSites(s: Settings, url: string | undefined) {
  const list = $('disabledList');
  const render = (sites: string[]) => {
    list.replaceChildren();
    if (!sites.length) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = t('settings.noDisabled');
      list.append(li);
    }
    for (const d of sites) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'mono';
      name.textContent = d;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'link small';
      b.textContent = t('settings.remove');
      b.onclick = async () => {
        await saveSettings({ disabledSites: sites.filter((x) => x !== d) });
        location.reload();
      };
      li.append(name, b);
      list.append(li);
    }
  };
  render(s.disabledSites ?? []);

  if (!url || paramUrl || !/^https?:/.test(url)) return;
  const host = new URL(url).hostname;
  const off = isSiteDisabled(s, host);
  const btn = $<HTMLButtonElement>('siteToggle');
  btn.hidden = false;
  btn.textContent = t(off ? 'popup.enableSite' : 'popup.disableSite');
  if (off) {
    $('verdict').textContent = t('status.disabledHere');
    $('status').className = 'card status v-unknown';
    $('reasons').replaceChildren();
    $('officialBox').hidden = true;
  }
  btn.onclick = async () => {
    const sites = s.disabledSites ?? [];
    const next = off ? sites.filter((d) => !(host === d || host.endsWith('.' + d))) : [...new Set([...sites, siteKey(host)])];
    await saveSettings({ disabledSites: next });
    location.reload();
  };
}

async function initSettings(s: Settings) {
  // Valoda: maiņa uzreiz pārzīmē popup
  const langSel = $<HTMLSelectElement>('lang');
  for (const [code, name] of Object.entries(LANGS)) langSel.add(new Option(name, code));
  langSel.value = s.lang || 'auto';
  langSel.onchange = async () => {
    await saveSettings({ lang: langSel.value });
    location.reload();
  };
  const enabled = $<HTMLInputElement>('enabled');
  enabled.checked = s.enabled;
  enabled.onchange = () => saveSettings({ enabled: enabled.checked });
  const serpMode = $<HTMLSelectElement>('serpMode');
  serpMode.value = s.serpMode;
  serpMode.onchange = () => saveSettings({ serpMode: serpMode.value as Settings['serpMode'] });
  for (const k of ['serpOfficialBadge', 'pageChecks'] as const) {
    const el = $<HTMLInputElement>(k);
    el.checked = s[k];
    el.onchange = () => saveSettings({ [k]: el.checked });
  }
  // Anonīmā statistika – tikai ar piekrišanu
  const share = $<HTMLInputElement>('shareStats');
  share.checked = s.shareStats === true;
  const setShare = async (on: boolean) => {
    if (on && TARGET === 'firefox') {
      // Firefox: iebūvētais datu vākšanas piekrišanas dialogs
      try {
        const ok = await chrome.permissions.request({ data_collection: ['technicalAndInteraction'] } as chrome.permissions.Permissions);
        if (!ok) on = false;
      } catch {
        /* vecāka Firefox versija – pietiek ar mūsu piekrišanu */
      }
    }
    await saveSettings({ shareStats: on });
    share.checked = on;
    $('consent').hidden = true;
  };
  share.onchange = () => setShare(share.checked);
  $<HTMLAnchorElement>('privacyLink').href = PRIVACY_URL;
  if (s.shareStats === null && !paramUrl) {
    $('consent').hidden = false;
    $('consentYes').onclick = () => setShare(true);
    $('consentNo').onclick = () => setShare(false);
  }

  const ep = $<HTMLInputElement>('reportEndpoint');
  ep.value = s.reportEndpoint;
  ep.onchange = () => saveSettings({ reportEndpoint: ep.value.trim() });
  $('updateNow').onclick = async () => {
    const b = $<HTMLButtonElement>('updateNow');
    b.disabled = true;
    b.textContent = t('settings.updating');
    const r = await chrome.runtime.sendMessage({ type: 'updateNow' });
    const key: Record<string, string> = {
      updated: 'update.updated', 'up-to-date': 'update.upToDate', failed: 'update.failed', 'not-configured': 'update.notConfigured',
    };
    b.textContent = key[r] ? t(key[r]) : String(r);
    const st = (await chrome.runtime.sendMessage({ type: 'getStatus' })) as Status;
    renderData(st.data);
  };
  // Firefox MV3: piekļuve lapām jāatļauj lietotājam
  const all = { origins: ['http://*/*', 'https://*/*'] };
  if (!(await chrome.permissions.contains(all))) {
    const g = $('grant');
    g.hidden = false;
    g.onclick = () => chrome.permissions.request(all).then((ok) => ok && (g.hidden = true));
    document.querySelector('details')!.open = true;
  }
}

async function initReport(url: string | undefined, settings: Settings) {
  $<HTMLInputElement>('rUrl').value = url && /^https?:/.test(url) ? url : '';
  if (params.get('kind') === 'fp') (document.querySelector('input[value=false_positive]') as HTMLInputElement).checked = true;
  const brands = (await chrome.runtime.sendMessage({ type: 'getBrands' })) as { id: string; name: string }[];
  const sel = $<HTMLSelectElement>('rBrand');
  for (const b of brands.sort((a, b) => a.name.localeCompare(b.name, lang()))) sel.add(new Option(b.name, b.name));
  $('reportForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $<HTMLButtonElement>('rSend');
    const msg = $('rMsg');
    btn.disabled = true;
    const kind = (document.querySelector('input[name=kind]:checked') as HTMLInputElement).value as 'phishing' | 'false_positive';
    const res = await submitReport(
      {
        url: $<HTMLInputElement>('rUrl').value.trim(),
        kind,
        brand: sel.value,
        note: $<HTMLTextAreaElement>('rNote').value.trim(),
        includeQuery: $<HTMLInputElement>('rQuery').checked,
      },
      settings.reportEndpoint,
    );
    msg.hidden = false;
    if (res.ok) {
      chrome.runtime.sendMessage({ type: 'reportSent' });
      msg.className = 'msg ok';
      msg.textContent =
        res.via === 'relay' ? t('report.ok') : t('report.okGithub');
    } else {
      msg.className = 'msg err';
      msg.textContent = t('report.fail', { error: res.error });
      btn.disabled = false;
    }
  };
  if (params.get('report')) $('reportForm').scrollIntoView({ block: 'center' });
}

async function main() {
  if (paramUrl) document.body.classList.add('window');
  const [url, settings] = await Promise.all([currentUrl(), getSettings()]);
  setLang(settings.lang);
  applyDom();
  const st = (await chrome.runtime.sendMessage({
    type: 'getStatus',
    url: url && /^https?:/.test(url) ? url : undefined,
    tabId: activeTabId,
  })) as Status;
  renderStatus(st.result, url);
  renderLog(st.log);
  renderData(st.data);
  initSites(settings, url);
  await initSettings(settings);
  await initReport(url, settings);
}

main();
