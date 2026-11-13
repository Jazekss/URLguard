import { DATA_REPO, DEFAULT_REPORT_ENDPOINT, ISSUE_FORM_URL } from '../config';
import { cleanUrl } from '../shared';
import { t } from '../i18n';

// Šie divi teksti nonāk GitHub issue un tos nolasa robots – tie paliek latviski neatkarīgi no saskarnes valodas.
export const KIND_PHISH = 'Krāpnieciska saite (phishing)';
export const KIND_FP = 'Kļūdains brīdinājums (lapa ir droša)';

export interface Report {
  url: string;
  kind: 'phishing' | 'false_positive';
  brand?: string;
  note?: string;
  includeQuery: boolean;
}

export type ReportResult = { ok: true; via: 'relay'; issueUrl?: string } | { ok: true; via: 'github' } | { ok: false; error: string };

/**
 * Nosūta ziņojumu. Ar releju (Cloudflare Worker) – anonīmi, bez GitHub konta.
 * Bez releja – atver aizpildītu GitHub issue formu (vajag GitHub kontu).
 * Saite tiek nosūtīta TIKAI pēc lietotāja klikšķa; parametri (?…) pēc noklusējuma noņemti.
 */
export async function submitReport(r: Report, endpoint: string): Promise<ReportResult> {
  const url = cleanUrl(r.url, r.includeQuery);
  const kindText = r.kind === 'phishing' ? KIND_PHISH : KIND_FP;
  const ep = endpoint || DEFAULT_REPORT_ENDPOINT;
  if (ep) {
    try {
      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, kind: r.kind, brand: r.brand ?? '', note: r.note ?? '', version: chrome.runtime.getManifest().version }),
      });
      const j = (await res.json().catch(() => ({}))) as { issueUrl?: string; error?: string };
      if (!res.ok) return { ok: false, error: j.error ?? `HTTP ${res.status}` };
      return { ok: true, via: 'relay', issueUrl: j.issueUrl };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
  if (!DATA_REPO || DATA_REPO.includes('OWNER')) return { ok: false, error: t('report.noRepo') };
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    /* ignore */
  }
  const params = new URLSearchParams({
    template: 'report.yml',
    title: `[${r.kind === 'phishing' ? 'phishing' : 'fp'}] ${host}`,
    labels: 'report',
    url,
    kind: kindText,
    brand: r.brand ?? '',
    note: r.note ?? '',
  });
  await chrome.tabs.create({ url: `${ISSUE_FORM_URL}?${params}` });
  return { ok: true, via: 'github' };
}
