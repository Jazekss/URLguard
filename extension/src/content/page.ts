// Katrā lapā: parāda neuzbāzīgu joslu aizdomīgām lapām un (lokāli) pārbauda pieslēgšanās formas.
import type { CheckResult } from '../core/types';
import { detectEngine } from './serp-scan';
import { initLang, reasonText, t } from '../i18n';

const ID_FIELD = /personas\s*kod|personal\s*code|isikukood|asmens\s*kod|smart-?id|user\s*id|lietot[aā]j|tālr|talr|phone/i;
const AUTH_TEXT = /smart-?id|e-?paraksts|mobile-?id|internetbank|personas\s*kod/i;

let bannerShown = false;

function showBanner(r: CheckResult) {
  if (bannerShown || !document.body) return;
  bannerShown = true;
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;right:0;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  const brand = r.brand;
  root.innerHTML = `
    <style>
      .bar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px 16px;background:#fffbeb;color:#78350f;
        border-bottom:2px solid #f59e0b;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.12)}
      .msg{flex:1 1 320px;min-width:0}
      b{font-weight:700}
      a{color:#1d4ed8}
      button{font:inherit;border-radius:8px;padding:5px 12px;cursor:pointer;border:1px solid #d97706;background:#fff;color:#78350f}
      button.primary{background:#b45309;border-color:#b45309;color:#fff}
      @media (prefers-color-scheme: dark){.bar{background:#422006;color:#fde68a;border-color:#d97706}a{color:#93c5fd}
        button{background:#1c1917;color:#fde68a}}
    </style>
    <div class="bar" role="alert">
      <span>🛡</span>
      <div class="msg"><b class="title"></b> <span class="why"></span> <span class="off"></span></div>
      <button class="primary report"></button>
      <button class="close"></button>
    </div>`;
  root.querySelector('.title')!.textContent = t('banner.title');
  root.querySelector('.report')!.textContent = t('banner.report');
  root.querySelector('.close')!.textContent = t('banner.close');
  root.querySelector('.why')!.textContent = r.reasons[0] ? reasonText(r.reasons[0]) : '';
  if (brand) {
    const off = root.querySelector('.off')!;
    off.append(t('banner.official') + ' ');
    const a = document.createElement('a');
    a.href = brand.url;
    a.textContent = new URL(brand.url).hostname;
    off.append(a);
  }
  root.querySelector('.close')!.addEventListener('click', () => host.remove());
  root.querySelector('.report')!.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'openReport', url: location.href });
  });
  document.documentElement.append(host);
}

function collect() {
  const inputs = [...document.querySelectorAll<HTMLInputElement>('input')];
  const hasPassword = inputs.some((i) => i.type === 'password');
  const hasIdField = inputs.some((i) =>
    ID_FIELD.test([i.name, i.id, i.placeholder, i.getAttribute('aria-label'), i.autocomplete].join(' ')),
  );
  const title = document.title.slice(0, 300);
  const text = (document.body?.innerText ?? '').slice(0, 4000);
  const relevant = hasPassword || hasIdField || AUTH_TEXT.test(title + ' ' + text);
  return { relevant, signals: { title, text, hasPassword, hasIdField } };
}

async function main() {
  if (window.top !== window) return;
  if (detectEngine(location.hostname)) return; // meklētājus apstrādā serp.ts
  await initLang();
  const init = (await chrome.runtime.sendMessage({ type: 'pageInit' }).catch(() => null)) as {
    enabled: boolean;
    pageChecks: boolean;
    result?: CheckResult;
    bypassed: boolean;
  } | null;
  if (!init?.enabled) return;
  const v = init.result?.verdict;
  if (v === 'suspicious' && !init.bypassed) showBanner(init.result!);
  if (!init.pageChecks || v === 'official' || v === 'safe' || v === 'danger') return;

  let tries = 0;
  const probe = async () => {
    tries++;
    const c = collect();
    if (c.relevant) {
      const r = (await chrome.runtime.sendMessage({ type: 'pageSignals', signals: c.signals }).catch(() => null)) as CheckResult | null;
      if (r?.verdict === 'suspicious' && !init.bypassed) showBanner(r);
      return;
    }
    if (tries < 3) setTimeout(probe, 2500); // SPA formas ielādējas vēlāk
  };
  setTimeout(probe, 600);
}

main();
