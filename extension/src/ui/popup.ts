import type { CheckResult } from '../core/types';
import { getSettings, saveSettings, VERDICT_LABEL, type LogEntry, type Settings } from '../shared';
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
  $('statusSrc').textContent = paramUrl ? 'Pārbaudītā saite' : 'Šī lapa';
  const http = !!url && /^https?:/.test(url);
  $('verdict').textContent = http ? VERDICT_LABEL[v] : 'Netiek pārbaudīta';
  $('host').textContent = r?.host || (url ? url.slice(0, 80) : '—');
  const ul = $('reasons');
  ul.innerHTML = '';
  for (const reason of r?.reasons ?? []) {
    const li = document.createElement('li');
    li.textContent = reason.text;
    ul.append(li);
  }
  if (r?.verdict === 'official' && r.brand) {
    const li = document.createElement('li');
    li.textContent = `Šī ir ${r.brand.name} oficiālā lapa.`;
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
  const actionText: Record<LogEntry['action'], string> = {
    blocked: 'bloķēta', warned: 'brīdinājums', hidden: 'paslēpta', marked: 'atzīmēta', bypassed: 'atvērta tomēr',
  };
  for (const l of log.slice(0, 40)) {
    const li = document.createElement('li');
    const time = document.createElement('span');
    time.className = 'muted';
    time.textContent = new Date(l.t).toLocaleString('lv-LV', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const h = document.createElement('span');
    h.className = 'h mono';
    h.textContent = l.host;
    h.title = `${l.url}${l.brand ? `\nIzliekas par: ${l.brand}` : ''}`;
    const pill = document.createElement('span');
    pill.className = `pill v-${l.action === 'bypassed' ? 'unknown' : l.verdict}`;
    pill.textContent = actionText[l.action];
    li.append(time, h, pill);
    ul.append(li);
  }
  $('logEmpty').hidden = log.length > 0;
}

function renderData(d: Status['data']) {
  const date = new Date(d.generated).toLocaleDateString('lv-LV');
  $('dataInfo').textContent = `Bāze: ${date} · ${d.brands} zīmoli · ${d.domains} bloķēti${d.repoConfigured ? '' : ' · (repo nav iestatīts)'}`;
}

async function initSettings(s: Settings) {
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
    b.textContent = 'Atjaunina…';
    const r = await chrome.runtime.sendMessage({ type: 'updateNow' });
    const text: Record<string, string> = {
      updated: 'Atjaunināts ✓', 'up-to-date': 'Jau jaunākā ✓', failed: 'Neizdevās', 'not-configured': 'Repo nav iestatīts',
    };
    b.textContent = text[r] ?? String(r);
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
  for (const b of brands.sort((a, b) => a.name.localeCompare(b.name, 'lv'))) sel.add(new Option(b.name, b.name));
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
        res.via === 'relay'
          ? 'Paldies! Ziņojums nosūtīts pārbaudei.'
          : 'Atvērta GitHub forma – pārbaudiet un nospiediet “Submit new issue”.';
    } else {
      msg.className = 'msg err';
      msg.textContent = `Neizdevās: ${res.error}`;
      btn.disabled = false;
    }
  };
  if (params.get('report')) $('reportForm').scrollIntoView({ block: 'center' });
}

async function main() {
  if (paramUrl) document.body.classList.add('window');
  const [url, settings] = await Promise.all([currentUrl(), getSettings()]);
  const st = (await chrome.runtime.sendMessage({
    type: 'getStatus',
    url: url && /^https?:/.test(url) ? url : undefined,
    tabId: activeTabId,
  })) as Status;
  renderStatus(st.result, url);
  renderLog(st.log);
  renderData(st.data);
  await initSettings(settings);
  await initReport(url, settings);
}

main();
