# Iesniegšana veikalos – kontrolsaraksts

Visi teksti: [listing.lv.md](listing.lv.md), [listing.en.md](listing.en.md), [permissions-and-privacy.md](permissions-and-privacy.md).
Attēli: [images/](images/) (pārģenerēt: `cd extension && node build.mjs --dev && node scripts/store-screens.mjs`).
ZIP faili: GitHub Release (tag `v1.0.0`) vai lokāli `BUILDS\`.

## 1. Chrome Web Store — https://chrome.google.com/webstore/devconsole
Konts: vienreizēja 5 $ reģistrācija.
1. **New item** → augšupielādē `URLguard_1.0.0_chrome_<datums>.zip`.
2. **Store listing:** apraksts (LV kā galvenā valoda, pievieno EN), kategorija, ikona 128 (jau ZIP), ekrānuzņēmumi `1-…5-*.png`, **small promo tile** `promo-440x280.png`.
3. **Privacy practices:** single purpose, katras atļaujas pamatojums, datu anketa, privātuma politikas URL – no `permissions-and-privacy.md`.
4. **Distribution:** Public; valstis – visas (vai sākumā Latvija, Lietuva, Igaunija).
5. **Submit for review.** Plašu atļauju dēļ pārbaude parasti 2–14 dienas.

## 2. Microsoft Edge Add-ons — https://partner.microsoft.com/dashboard/microsoftedge
Konts: bez maksas (Microsoft konts + Partner Center reģistrācija).
1. **Create new extension** → tas pats `…_chrome_….zip`.
2. Properties: kategorija Productivity, privātuma politikas URL.
3. Listings: LV/EN apraksts, logo `logo-300x300.png`, ekrānuzņēmumi, (neobligāti) promo.
4. Notes for certification – no `permissions-and-privacy.md`.

## 3. Firefox Add-ons (AMO) — https://addons.mozilla.org/developers/
Konts: bez maksas (Firefox konts).
1. **Submit a New Add-on** → "On this site" → `URLguard_1.0.0_firefox_<datums>.zip`.
2. Platformas: **Firefox** un **Firefox for Android** (abas!).
3. Pirmkods: jā – augšupielādē `URLguard_source_v1.0.0.zip` (vai norādi uz GitHub); būvēšanas instrukcija ir `permissions-and-privacy.md`.
4. Apraksts, kategorija "Privacy & Security", ekrānuzņēmumi, privātuma politika, piezīme pārbaudītājiem.

## Pēc apstiprināšanas
- Ieraksti veikalu saites README.md un mājaslapā.
- Jaunām versijām: palielini `extension/package.json` versiju → `git tag vX.Y.Z && git push origin vX.Y.Z` → augšupielādē jaunos ZIP visos trīs veikalos.
- Bāzes atjauninājumi (krāpnieku saraksts) NEPRASA jaunu versiju – tie nonāk lietotājiem automātiski.
