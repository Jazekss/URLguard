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
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  serpMode: 'mark',
  serpOfficialBadge: true,
  pageChecks: true,
  reportEndpoint: '',
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

export const VERDICT_LABEL: Record<Verdict, string> = {
  official: 'Oficiālā lapa',
  safe: 'Droša lapa',
  unknown: 'Nav zināmu draudu',
  suspicious: 'Aizdomīga lapa',
  danger: 'Bīstama lapa',
};
