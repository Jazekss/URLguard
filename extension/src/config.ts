// Vienīgā vieta, kur norādīt GitHub repozitoriju un ziņojumu servisu.
declare const __PUBKEY__: string;
declare const __DATA_REPO__: string;
declare const __TARGET__: 'chrome' | 'firefox';

export const TARGET = __TARGET__;

/** "īpašnieks/repo" – kur glabājas data/ un kur nonāk ziņojumi (issues). */
export const DATA_REPO = __DATA_REPO__;

/** Parakstītā bāze (CI to publicē zarā "dist"). Pirmais strādājošais avots uzvar. */
export const BUNDLE_URLS = [
  `https://cdn.jsdelivr.net/gh/${DATA_REPO}@dist/bundle.json`,
  `https://raw.githubusercontent.com/${DATA_REPO}/dist/bundle.json`,
];

/** Ed25519 publiskā atslēga (data/keys/public.b64), iebūvēta būvēšanas laikā. */
export const PUBLIC_KEY_B64 = __PUBKEY__;

/** Anonīmo ziņojumu relejs (relay/). Tukšs = atver GitHub issue formu pārlūkā. Iestatījumos var pārrakstīt. */
export const RELAY_BASE = 'https://urlguard-relay.urlguard-relay.workers.dev';
export const DEFAULT_REPORT_ENDPOINT = `${RELAY_BASE}/report`;

/** Anonīmā statistika (tikai ar piekrišanu): reizi dienā tikai skaitļi, bez saitēm un identifikatoriem. */
export const STATS_ENDPOINT = `${RELAY_BASE}/stats`;
export const PRIVACY_URL = `https://github.com/${__DATA_REPO__}/blob/main/PRIVACY.md`;

export const ISSUE_FORM_URL = `https://github.com/${DATA_REPO}/issues/new`;

/** Cik bieži atjaunināt bāzi (minūtes). */
export const UPDATE_PERIOD_MIN = 360;
