export type BrandCategory =
  | 'bank' | 'gov' | 'telco' | 'utility' | 'post' | 'shop' | 'transport' | 'tech' | 'social' | 'auth' | 'health' | 'crypto' | 'other';

export interface Brand {
  id: string;
  name: string;
  category: BrandCategory;
  /** Oficiālā sākumlapa, ko piedāvājam brīdinājumā. */
  url: string;
  /** Reģistrējamie domēni vai hosti, kas pieder zīmolam. */
  official: string[];
  /** Atslēgvārdi (>=4 simboli): meklē kā apakšvirkni domēnā; >=5 arī drukas kļūdas. */
  keywords: string[];
  /** Īsi/divdomīgi vārdi (seb, lmt, vid): tikai precīzs domēna "tokens". */
  strictKeywords?: string[];
  /** Nosaukumi, kas oficiāli ar jebkuru galotni (google.ca, google.com.hk, microsoft.us). Tikai globāliem zīmoliem. */
  anyTld?: string[];
  /** Zīmols pats lieto daudzus domēnus ar savu nosaukumu (googlesource.com) – nosaukums domēnā vien nav pietiekams signāls. */
  weak?: boolean;
  /** Bez drukas kļūdu pārbaudes (vārds ir līdzīgs parastam vārdam: binance~finance). */
  noTypo?: boolean;
  region?: string;
}

export interface Bundle {
  version: number;
  generated: string;
  brands: Brand[];
  /** suspect (1.2.0+): domēni tikai vienā publiskā krāpnieku sarakstā -> "aizdomīgs", ne bloķēts. */
  blocklist: { domains: string[]; urls: string[]; suspect?: string[] };
  allowlist: string[];
  sharedHosting: string[];
  /** Saišu saīsinātāji (1.3.0+). */
  shorteners?: string[];
}

export type Verdict = 'official' | 'safe' | 'unknown' | 'suspicious' | 'danger';

/** Iemesls: kods + parametri. Tekstu izvēlētajā valodā saliek saskarne (i18n: reason.<code>). */
export interface Reason {
  code: string;
  params?: { brand?: string; domain?: string; tld?: string };
}

export interface BrandRef {
  id: string;
  name: string;
  url: string;
}

export interface CheckResult {
  url: string;
  host: string;
  domain: string;
  verdict: Verdict;
  score: number;
  reasons: Reason[];
  brand?: BrandRef;
  /** 'domain' = bloķēts ar DNR noteikumu jau pirms ielādes. */
  listed?: 'domain' | 'url';
  /** Saīsināta saite (bit.ly u.c.) – galamērķis zināms tikai pēc atvēršanas. */
  shortener?: boolean;
}

export interface CheckContext {
  /** Pēdējā meklēšanas frāze šajā cilnē. */
  query?: string;
  /** Saites/reklāmas virsraksts meklētājā. */
  title?: string;
  isAd?: boolean;
  /** Teksts, no kura saite tika atvērta (ieraksts soc. tīklā, e-pasts, lapa). */
  context?: string;
  /** Pašas saites teksts (enkurs). */
  anchor?: string;
}

export interface PageSignals {
  title: string;
  text: string;
  hasPassword: boolean;
  hasIdField: boolean;
}

export const SCHEMA_VERSION = 1;
