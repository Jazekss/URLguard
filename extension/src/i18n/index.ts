// Daudzvalodība. Tulkojumi: src/i18n/<valoda>.json (atslēga -> teksts ar {parametriem}, **treknraksts**).
// Valodu izvēlas iestatījumos (settings.lang); "auto" = pārlūka valoda; rezerve – angļu.
import type { Reason } from '../core/types';
import en from './en.json';
import lv from './lv.json';
import ru from './ru.json';
import lt from './lt.json';
import et from './et.json';

export const LANGS = { lv: 'Latviešu', en: 'English', ru: 'Русский', lt: 'Lietuvių', et: 'Eesti' } as const;
export type Lang = keyof typeof LANGS;

const DICTS: Record<Lang, Record<string, string>> = { lv, en, ru, lt, et };
const LOCALE: Record<Lang, string> = { lv: 'lv-LV', en: 'en-GB', ru: 'ru-RU', lt: 'lt-LT', et: 'et-EE' };

let current: Lang = 'en';

export function isLang(l: unknown): l is Lang {
  return typeof l === 'string' && l in DICTS;
}

export function detectLang(): Lang {
  let ui = 'en';
  try {
    ui = chrome.i18n?.getUILanguage?.() || (typeof navigator !== 'undefined' ? navigator.language : 'en');
  } catch {
    /* ignore */
  }
  const code = ui.slice(0, 2).toLowerCase();
  return isLang(code) ? code : 'en';
}

/** Iestata valodu ("auto" vai nederīga -> pārlūka valoda). */
export function setLang(l?: string): Lang {
  current = l && l !== 'auto' && isLang(l) ? l : detectLang();
  if (typeof document !== 'undefined') document.documentElement.lang = current;
  return current;
}

export function lang(): Lang {
  return current;
}

export function locale(): string {
  return LOCALE[current];
}

/** Iestatījumu valoda no storage (der arī satura skriptos un fona darbā). */
export async function initLang(): Promise<Lang> {
  try {
    const s = await chrome.storage.sync.get('settings');
    return setLang((s.settings as { lang?: string } | undefined)?.lang);
  } catch {
    return setLang();
  }
}

export function t(key: string, params: Record<string, string | number | undefined> = {}): string {
  const s = DICTS[current][key] ?? DICTS.en[key] ?? DICTS.lv[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ''));
}

export function reasonText(r: Reason): string {
  return t(`reason.${r.code}`, r.params ?? {});
}

/** Teksts ar **treknrakstu** -> DOM mezgli (bez innerHTML). */
export function rich(text: string): Node[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => {
    if (i % 2 === 0) return document.createTextNode(part);
    const b = document.createElement('b');
    b.textContent = part;
    return b;
  });
}

/**
 * Aizpilda HTML: data-i18n (teksts, atbalsta **treknrakstu**), data-i18n-ph (placeholder),
 * data-i18n-title (title), data-i18n-label (aria-label).
 */
export function applyDom(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.replaceChildren(...rich(t(el.dataset.i18n!)));
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-ph]').forEach((el) => {
    (el as HTMLInputElement).placeholder = t(el.dataset.i18nPh!);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle!);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nLabel!));
  });
}
