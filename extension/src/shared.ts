import type { CheckResult, Verdict } from './core/types';

export interface Settings {
  enabled: boolean;
  /** Meklētāju krāpnieku saites: atzīmēt vai paslēpt. */
  serpMode: 'mark' | 'hide';
  /** Rādīt ✓ pie oficiālajām lapām meklētājā. */
  serpOfficialBadge: boolean;
  /** Analizēt lapas saturu (pieslēgšanās formas, Smart-ID). Notiek lokāli. */
  pageChecks: boolean;
  reportEndpoint: string;
  /** Anonīmā statistika: null = vēl nav jautāts, true/false = lietotāja izvēle. */
  shareStats: boolean | null;
  /** Saskarnes valoda: 'auto' = pārlūka valoda. */
  lang: string;
  /** Reģistrējamie domēni, kuros lietotājs pārbaudi izslēdzis. */
  disabledSites: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  serpMode: 'mark',
  serpOfficialBadge: true,
  pageChecks: true,
  reportEndpoint: '',
  shareStats: null,
  lang: 'auto',
  disabledSites: [],
};

export async function getSettings(): Promise<Settings> {
  const s = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...((s.settings as Partial<Settings>) ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.sync.set({ settings: next });
  return next;
}

/** Vietnes atslēga izslēgšanai: reģistrējamais domēns (mail.google.com -> google.com). */
export function siteKey(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, '').split('.');
  const twoLevel = /^(com|co|org|net|gov|edu|ac)\.[a-z]{2}$/.test(parts.slice(-2).join('.'));
  return parts.slice(twoLevel ? -3 : -2).join('.');
}

export function isSiteDisabled(s: Settings, host: string): boolean {
  if (!host || !s.disabledSites?.length) return false;
  const h = host.toLowerCase();
  return s.disabledSites.some((d) => h === d || h.endsWith('.' + d));
}

export interface LogEntry {
  t: number;
  url: string;
  host: string;
  verdict: Verdict;
  brand?: string;
  reasons: string[];
  source: 'nav' | 'serp' | 'page';
  action: 'blocked' | 'warned' | 'hidden' | 'marked' | 'bypassed';
}

/** Skaitītāji, ko (ar piekrišanu) reizi dienā nosūta kā kopsummu. */
export interface StatCounts {
  blocked: number;
  warned: number;
  serpMarked: number;
  serpHidden: number;
  bypassed: number;
  reports: number;
}

export const EMPTY_STATS: StatCounts = { blocked: 0, warned: 0, serpMarked: 0, serpHidden: 0, bypassed: 0, reports: 0 };

export interface SerpItemIn {
  key: string;
  url: string;
  displayUrl?: string;
  title: string;
  isAd: boolean;
}

export interface SerpItemOut {
  key: string;
  verdict: Verdict;
  result: CheckResult;
  /** Šī ir meklētā zīmola oficiālā lapa. */
  officialMatch: boolean;
}

/** Saīsina saiti žurnālam/ziņojumam: bez parametriem un fragmenta. */
export function cleanUrl(raw: string, keepQuery = false): string {
  try {
    const u = new URL(raw);
    u.username = '';
    u.password = '';
    u.hash = '';
    if (!keepQuery) u.search = '';
    return u.href;
  } catch {
    return raw;
  }
}
