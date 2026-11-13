import type { CheckResult } from '../core/types';
import { applyDom, initLang, rich, reasonText, t } from '../i18n';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function load(): Promise<CheckResult | null> {
  const id = new URLSearchParams(location.search).get('id');
  if (id) return chrome.runtime.sendMessage({ type: 'getWarning', id });
  // No DNR noteikuma: warning.html#<sākotnējā saite>
  let url = location.hash.slice(1);
  try {
    url = decodeURIComponent(url);
  } catch {
    /* jau atkodēts */
  }
  if (url) return chrome.runtime.sendMessage({ type: 'checkUrl', url });
  return null;
}

function renderUrl(r: CheckResult) {
  const el = $('url');
  const i = r.url.indexOf(r.domain);
  if (r.domain && i >= 0) {
    const dom = document.createElement('span');
    dom.className = 'dom';
    dom.textContent = r.domain;
    el.append(r.url.slice(0, i), dom, r.url.slice(i + r.domain.length));
  } else el.textContent = r.url;
}

async function main() {
  await initLang();
  applyDom();
  document.title = t('warn.pageTitle');
  const r = await load();
  if (!r) {
    $('url').textContent = t('warn.noInfo');
    return;
  }
  document.title = `URLguard – ${r.host}`;
  renderUrl(r);
  const ul = $('reasons');
  for (const reason of r.reasons) {
    const li = document.createElement('li');
    li.textContent = reasonText(reason);
    ul.append(li);
  }
  if (r.brand) {
    $('official').hidden = false;
    $('didYouMean').replaceChildren(...rich(t('warn.didYouMean', { brand: r.brand.name })));
    const a = $<HTMLAnchorElement>('officialLink');
    a.href = r.brand.url;
    a.textContent = r.brand.url;
    const go = $('goOfficial');
    go.hidden = false;
    go.onclick = () => location.replace(r.brand!.url);
  }
  $('back').onclick = () => {
    if (history.length > 1) history.back();
    else location.replace('about:blank');
  };
  $('proceed').onclick = async () => {
    if (!confirm(t('warn.confirm', { host: r.host }))) return;
    await chrome.runtime.sendMessage({ type: 'bypass', url: r.url });
    location.replace(r.url);
  };
  $('falsePositive').onclick = () => {
    chrome.runtime.sendMessage({ type: 'openReport', url: r.url, kind: 'false_positive' });
  };
}

main();
