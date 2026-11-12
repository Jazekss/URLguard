// Vienīgā vieta, kur norādīt GitHub repozitoriju un ziņojumu servisu.
declare const __PUBKEY__: string;
declare const __DATA_REPO__: string;

/** "īpašnieks/repo" – kur glabājas data/ un kur nonāk ziņojumi (issues). */
export const DATA_REPO = __DATA_REPO__;

/** Parakstītā bāze (CI to publicē zarā "dist"). Pirmais strādājošais avots uzvar. */
export const BUNDLE_URLS = [
  `https://cdn.jsdelivr.net/gh/${DATA_REPO}@dist/bundle.json`,
  `https://raw.githubusercontent.com/${DATA_REPO}/dist/bundle.json`,
];

/** Ed25519 publiskā atslēga (data/keys/public.b64), iebūvēta būvēšanas laikā. */
export const PUBLIC_KEY_B64 = __PUBKEY__;

/** Anonīmo ziņojumu relejs (relay/). Tukšs = atver GitHub issue formu pārlūkā. */
export const DEFAULT_REPORT_ENDPOINT = '';

export const ISSUE_FORM_URL = `https://github.com/${DATA_REPO}/issues/new`;

/** Cik bieži atjaunināt bāzi (minūtes). */
export const UPDATE_PERIOD_MIN = 360;
