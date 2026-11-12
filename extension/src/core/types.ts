export type BrandCategory =
  | 'bank' | 'gov' | 'telco' | 'utility' | 'post' | 'shop' | 'transport' | 'tech' | 'social' | 'auth' | 'other';

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
  region?: string;
}

export interface Bundle {
  version: number;
  generated: string;
  brands: Brand[];
  blocklist: { domains: string[]; urls: string[] };
  allowlist: string[];
  sharedHosting: string[];
}

export type Verdict = 'official' | 'safe' | 'unknown' | 'suspicious' | 'danger';

export interface Reason {
  code: string;
  text: string;
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
}

export interface CheckContext {
  /** Pēdējā meklēšanas frāze šajā cilnē. */
  query?: string;
  /** Saites/reklāmas virsraksts meklētājā. */
  title?: string;
  isAd?: boolean;
}

export interface PageSignals {
  title: string;
  text: string;
  hasPassword: boolean;
  hasIdField: boolean;
}

export const SCHEMA_VERSION = 1;
