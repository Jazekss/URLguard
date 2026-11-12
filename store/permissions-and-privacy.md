# Atļauju pamatojumi un privātuma anketas

Teksti angliski – veikalu pārbaudītāji tos lasa angliski. Kopē tieši laukos.

## Single purpose (Chrome "Single purpose description")
URLguard protects users from phishing websites: it checks the links the user opens and the results shown in search engines against a list of official brand domains and known phishing domains, and warns or blocks when a page impersonates a bank, government portal or other trusted brand.

## Permission justifications (Chrome "Permission justification" / Edge "Notes for certification")

| Permission | Justification |
|---|---|
| Host permissions `http://*/*`, `https://*/*` | The extension must check every top-level page the user opens (links from e-mail, messengers, any website) before it loads, mark phishing results on search engine pages, and show a warning bar on suspicious pages. Checks run locally; no browsing data leaves the device. |
| `webRequest` | Observe top-level (main_frame) navigations, including server redirects (e.g. ad click-trackers), so the final destination can be checked before the page renders. Non-blocking, read-only. |
| `declarativeNetRequest` | Redirect navigations to known phishing domains (signed public blocklist) to the extension's warning page before any network request is made. |
| `storage`, `unlimitedStorage` | Store settings, the local event log shown in the popup, and the signed phishing database (can exceed 5 MB when external feeds grow). |
| `alarms` | Refresh the phishing database every 6 hours; send the opt-in daily statistics. |
| `contextMenus` | "Check link" / "Report phishing link" on right-click. |
| Remote code | **No remote code.** Only a signed JSON data file (domain lists) is downloaded; its Ed25519 signature is verified before use. |

## Data usage (Chrome "Privacy practices" tab)

**Does the extension collect user data?** Only in two user-initiated cases:

| Data type | Collected? | Details |
|---|---|---|
| Personally identifiable information | No | |
| Health information | No | |
| Financial / payment information | No | |
| Authentication information | No | Pages are only checked for the *presence* of login fields; values are never read. |
| Personal communications | No | |
| Location | No | |
| Web history | No | Browsing is checked locally and never transmitted. |
| User activity | No | |
| Website content | **Yes – only when the user presses "Report"** | The single URL the user chooses to report (query string removed by default), the report type and an optional note. Published as a public GitHub issue so volunteers can review it. |

Optional, opt-in only: daily aggregate counters (number of blocked pages, warnings, reports) – no URLs, no identifiers.

Certifications (all three ticked):
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://github.com/Jazekss/URLguard/blob/main/PRIVACY.md

## Firefox (AMO)

- **Data collection** (manifest `data_collection_permissions`): required `none`; optional `technicalAndInteraction` (opt-in daily counters). Firefox shows its own consent dialog.
- **Source code:** the Firefox build is not minified. Reviewers can rebuild with:
  `pnpm install && cd extension && node build.mjs` (Node 24+, pnpm 12). Output: `extension/dist/firefox`.
- **Notes to reviewer:**
  > URLguard is an open-source anti-phishing extension (https://github.com/Jazekss/URLguard). The bundled `data/bundle.json` is a list of official brand domains and known phishing domains; updates are fetched from our relay (Cloudflare Worker) and verified with an Ed25519 signature before use. No remote code is executed. To test: open http://phishing-test.urlguard.invalid/ (test entry in the blocklist) – the warning page appears; search Google for "swedbank" or "eveselība" to see result markers.

## Edge Add-ons

Edge uses the same Chrome package (`URLguard_<ver>_chrome_<date>.zip`). Fields:
- **Privacy policy:** same URL as above.
- **Notes for certification:** paste the Firefox reviewer note above + the permission table.
- **Search terms:** phishing, scam, security, bank, Latvia, safe browsing, anti-phishing.
