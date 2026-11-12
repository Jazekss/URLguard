# URLguard – privātums

URLguard ir veidots tā, lai **nekas par jums nepamestu jūsu datoru**, ja vien jūs to pats neizvēlaties.

## Kas notiek lokāli (nekad netiek sūtīts)

- Katras atvērtās saites pārbaude – zīmolu atdarināšana, drukas kļūdas, viltoti domēni.
- Meklētāju (Google, Bing, DuckDuckGo) rezultātu pārbaude.
- Lapas satura pārbaude (vai lapā ir pieslēgšanās forma, Smart-ID, personas koda lauks).
- Notikumu žurnāls popup logā – glabājas tikai jūsu pārlūkā.

## Ko URLguard lejupielādē

- **Krāpnieku saišu bāzi** no mūsu releja (rezerve – GitHub/jsDelivr) ik pēc 6 stundām. Tā ir viena un tā pati visiem lietotājiem – pēc tās nevar noteikt, ko jūs apmeklējat.

## Ko URLguard nosūta – tikai ar jūsu darbību vai piekrišanu

### 1. Ziņojums (tikai, ja nospiežat "Ziņot")
| Lauks | Piemērs |
|---|---|
| Saite (bez `?parametriem`, ja vien pats neatzīmējat) | `https://swedbank-login.example/ib` |
| Veids | krāpnieciska / kļūdains brīdinājums |
| Zīmols un piezīme (ja aizpildāt) | `Swedbank`, "atnāca SMS" |
| Paplašinājuma versija | `0.1.0` |

Ziņojums kļūst par **publisku** GitHub issue. Jūsu vārds, e-pasts vai konts netiek pievienots.

### 2. Anonīmā statistika (tikai, ja piekrītat; izslēdzama iestatījumos)
Reizi dienā tiek nosūtīti **tikai šie skaitļi**:

```json
{ "browser": "chrome", "c": { "blocked": 2, "warned": 1, "serpMarked": 3, "serpHidden": 0, "bypassed": 0, "reports": 1 } }
```

Netiek sūtītas saites, domēni, laiki, valoda, ierīces vai lietotāja identifikators.
Kopsummas ir publiski redzamas: [STATS.md](STATS.md).

## Serveris (relejs)

Ziņojumus un statistiku pieņem neliels Cloudflare Worker ([relay/src/worker.ts](relay/src/worker.ts) – viss kods ir atvērts).

- **IP adrese netiek glabāta.** Lai novērstu ļaunprātīgu lietošanu (piem., tūkstošiem viltus ziņojumu),
  glabājam tikai `SHA-256(IP + nejauša dienas sāls)`. Sāli un hash dzēšam pēc 2 dienām – pēc tam tos
  nav iespējams sasaistīt ar IP adresi, arī mums pašiem.
- Statistika tiek glabāta tikai kā dienas kopsummas (tabula `daily` – [relay/schema.sql](relay/schema.sql)).

## Atļaujas un kāpēc tās vajag

| Atļauja | Kāpēc |
|---|---|
| Piekļuve visām lapām | lai pārbaudītu saiti pirms lapas ielādes un parādītu brīdinājumu |
| `webRequest`, `declarativeNetRequest` | lai apturētu zināmas krāpnieku lapas pirms ielādes |
| `storage` | iestatījumi, žurnāls, bāze |
| `alarms` | bāzes atjaunināšana, statistikas sūtīšana |
| `contextMenus` | "Pārbaudīt / ziņot par saiti" ar labo klikšķi |

Jautājumi: atveriet [issue](https://github.com/Jazekss/URLguard/issues).
