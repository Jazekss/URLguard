# URLguard

Bezmaksas pārlūka paplašinājums (Chrome, Edge, Brave, Opera, Firefox, arī Firefox Android), kas brīdina, ja saite **tikai izliekas** par banku, e-veselību, VID, Latvijas Pastu vai citu uzticamu zīmolu. Meklētājā (Google, Bing, DuckDuckGo) tas atzīmē vai paslēpj krāpnieku reklāmas, bet oficiālajām lapām pieliek ✓.

Visas pārbaudes notiek **lokāli**. Saites netiek sūtītas uz serveri, izņemot gadījumu, kad lietotājs pats nospiež "Ziņot".

## Kā tas darbojas

| Līmenis | Kas notiek |
|---|---|
| Zināms krāpnieku domēns | To bloķē `declarativeNetRequest`, vēl pirms lapa sāk ielādēties, un parāda brīdinājuma lapu |
| Heuristika (`extension/src/core/engine.ts`) | Pārbauda šādas pazīmes: zīmols apakšdomēnā (`eveseliba.lv.xyz.com`), iestrādāts oficiālais domēns (`swedbank.lv-login.com`), drukas kļūdas (`swedbamk.lv`), homoglifi un punycode (`аррӏе.com`), cita galotne (`swedbank.top`), aizdomīgas galotnes, bezmaksas hostingi, vārdi `login`/`verify`/`atmaksa` |
| Meklētājs | Lietotājs meklēja "eveselība", bet saite ved uz citu domēnu. Reklāmas virsrakstā ir zīmola nosaukums, bet domēns nav oficiālais |
| Lapas saturs | Pieslēgšanās forma, Smart-ID vai personas koda lauks uz līdzīga domēna. Šādu lapu uzskata par bīstamu |
| Soc. tīkli un saīsinātās saites | Kad uzklikšķina uz saites, URLguard atceras, no kāda ieraksta tā atvērta ("Lidl izloze…"), un salīdzina to ar galamērķi. Tas strādā arī pēc bit.ly, t.co u.c. pāradresācijām. Facebook, Instagram, X, TikTok, LinkedIn, Reddit un YouTube ierakstos aizdomīgām saitēm pievieno ikonu |
| Izslēgšana | Pārbaudi var izslēgt visur ("Aizsardzība") vai atsevišķai vietnei (popup logā "Izslēgt šai vietnei"). Izslēgto vietņu saraksts ir iestatījumos |

Vērtējums: **bīstams** (≥70) nozīmē pilnekrāna brīdinājumu ar pogu "Doties uz oficiālo lapu". **Aizdomīgs** (≥40) nozīmē neuzbāzīgu joslu lapas augšā. Pārējos gadījumos nekas netiek rādīts.

## Struktūra

```
extension/   paplašinājums (TypeScript, esbuild)
  src/core/  pārbaudes dzinējs (bez pārlūka API, testējams)
  test/      vitest vienību testi + e2e (Brave/Chrome headless)
data/        bāze, kurai var pievienoties drošības speciālisti
  brands/    zīmoli: oficiālie domēni + atslēgvārdi (lv.json, vēlāk lt.json, ee.json)
  blocklist/ krāpnieku domēni un konkrētas saites
  allowlist/ kļūdaino brīdinājumu labojumi
  scripts/   build-bundle (apvieno + paraksta), validate, triage, apply-report, keygen
relay/       Cloudflare Worker anonīmiem ziņojumiem (nav obligāts)
.github/     CI, ikdienas publicēšana, ziņojumu apstrāde, issue forma
```

## Ziņošanas plūsma

1. Lietotājs nospiež **Ziņot** (popup logā, ar labo klikšķi uz saites vai joslā lapā).
2. Paplašinājums nosūta ziņojumu releju serverim (`relay/`, Cloudflare Worker). Relejs izveido GitHub issue, tāpēc lietotājam GitHub konts nav vajadzīgs. Ja relejs nav pieejams, paplašinājums atver aizpildītu GitHub formu.
3. `report-triage.yml` automātiski pievieno komentāru ar DNS, domēna vecumu (RDAP), informāciju, vai domēns jau ir sarakstā vai ir oficiāls, un, vai tajā ir zīmola nosaukums. Pievieno arī etiķetes.
4. Uzturētājs uzliek etiķeti **`approved`**. Tad `report-apply.yml` ieraksta saiti sarakstā, izveido commit, aizver issue un palaiž publicēšanu.
5. `data-publish.yml` uzbūvē bāzi (un pievieno OpenPhish plūsmu), **paraksta ar Ed25519** un publicē relejā (un zarā `dist`). Paplašinājumi to lejupielādē ik pēc 6 h un pieņem tikai ar derīgu parakstu.

## Statistika un privātums

Statistiku sūta tikai tad, ja lietotājs piekrīt. Reizi dienā tiek nosūtīti tikai skaitļi (bloķēts, brīdināts, ziņots), bez saitēm un identifikatoriem. Publiskās kopsummas ir [STATS.md](STATS.md), un tās katru dienu atjaunina `stats.yml`. Pilns apraksts: [PRIVACY.md](PRIVACY.md).

## Relejs (`relay/`)

| | |
|---|---|
| Adrese | `https://urlguard-relay.urlguard-relay.workers.dev` (`/report`, `/stats`, `/bundle.json`) |
| Bāze | `POST /bundle` pieņem tikai bāzi ar derīgu Ed25519 parakstu un jaunāku datumu (augšupielādē `data-publish.yml`) |
| Glabātuve | Cloudflare D1 `urlguard-stats` (shēma `relay/schema.sql`) |
| Secret | `GITHUB_TOKEN`: fine-grained, tikai "Issues: Read and write" šim repozitorijam |
| Publicēšana | automātiski ar `relay-deploy.yml` (Secret `CLOUDFLARE_API_TOKEN`), lokāli: `cd relay && node scripts/wrangler.mjs deploy` |
| Tokena maiņa | `node scripts/wrangler.mjs secret put GITHUB_TOKEN` |

`scripts/wrangler.mjs` glabā Cloudflare pieslēgšanās datus mapē `F:\Projects\_deps\wrangler\config`.

## Saraksts citiem rīkiem

Mūsu cilvēku pārbaudītie krāpnieku domēni tiek publicēti katru dienu. Tos var pievienot savam rīkam ar vienu saiti:

| Rīks | Saite |
|---|---|
| AdGuard, uBlock Origin | `https://cdn.jsdelivr.net/gh/Jazekss/URLguard@dist/lists/adguard.txt` |
| Pi-hole, hosts fails | `https://cdn.jsdelivr.net/gh/Jazekss/URLguard@dist/lists/hosts.txt` |
| NextDNS, citi (tikai domēni) | `https://cdn.jsdelivr.net/gh/Jazekss/URLguard@dist/lists/domains.txt` |

Ārējo plūsmu (OpenPhish, Phishing.Database, Phishing Army) dati šajos sarakstos **nav iekļauti**. Tie tiek izmantoti tikai paplašinājumā, pēc šāda likuma: bloķē, ja domēns ir vismaz divos sarakstos; ja tikai vienā sarakstā un adresē ir zīmola nosaukums, tas ir aizdomīgs. Populārās lapas un `.gov.lv` nekad netiek bloķētas. Baltijas domēni, kas ir tikai vienā sarakstā, nonāk `review.txt` pārbaudei ar roku.

## Valodas

Saskarne ir pieejama latviešu, angļu, krievu, lietuviešu un igauņu valodā. Pēc noklusējuma tiek izmantota pārlūka valoda, un to var mainīt iestatījumos.

- **Tulkojumi:** `extension/src/i18n/<valoda>.json`. No šiem failiem tiek ģenerēti arī pārlūka `_locales` (nosaukums un apraksts).
- **Jauna valoda:** nokopē `en.json`, iztulko vērtības un pievieno valodu sarakstam `LANGS` failā `src/i18n/index.ts`.
- **Pārbaude:** `test/i18n.test.ts` pārbauda, vai visās valodās ir visas atslēgas, vai sakrīt `{parametri}` un vai apraksts nav garāks par 132 simboliem.
- **Iemesli:** dzinējs atgriež iemesla kodu un parametrus, un tekstu saliek saskarne (`reason.<kods>`).

Lietuviešu un igauņu tulkojumiem vēl vajag dzimtās valodas runātāja pārbaudi. Labojumus var iesniegt ar pull request.

## Veikali

Iesniegšanas kontrolsaraksts, teksti un attēli: [store/](store/README.md). Izlaidums: `git tag v1.0.0 && git push origin v1.0.0`. Tas izveido GitHub Release ar ZIP failiem.

## Izstrāde

```bash
pnpm install
```
```bash
pnpm test
```
```bash
cd extension && node build.mjs
```
```bash
cd extension && node build.mjs --dev --local-data && node test/e2e.mjs
```

Būves nonāk `BUILDS/URLguard_<versija>_<chrome|firefox>_<datums>.zip`, bet neiepakotā versija atrodas `extension/dist/chrome`. To var ielādēt sadaļā `chrome://extensions` → Developer mode → Load unpacked.

## Palaišana GitHub (vienreiz)

1. Izveido repozitoriju (piem., `URLguard`) un iepušo kodu.
2. Pievieno Secret `URLGUARD_SIGNING_KEY`, kurā ir faila `.keys/signing-private.pem` saturs. Fails jau ir uzģenerēts un nav git.
3. Izveido etiķetes `report` un `approved`.
4. Palaid workflow **Publicēt bāzi** (Actions → Run workflow). Tas izveidos zaru `dist`.
5. Būvē paplašinājumu (`node build.mjs`, repozitorijs pēc noklusējuma `Jazekss/URLguard`).
6. ✅ Relejs ir uzstādīts (skat. sadaļu "Relejs").

> ⚠️ Neizdzēs `.keys/signing-private.pem`. Ja atslēga pazūd, jau instalētie paplašinājumi vairs nepieņems jaunu bāzi, kamēr neiznāks jauna versija.

## Licence

- **Kods** (paplašinājums, relejs, skripti): [MIT](LICENSE). To drīkst brīvi izmantot, mainīt un izplatīt, arī komerciāli, ja tiek saglabāts autortiesību paziņojums.
- **Projekta dati** (zīmoli, pārbaudītie saraksti, publiskie `lists/*.txt`): [CC0 1.0](data/LICENSE.md), tas ir, publiskais īpašums.
- **Ārējo plūsmu dati** paplašinājuma bāzē paliek savās licencēs (skatīt [data/LICENSE.md](data/LICENSE.md)).
