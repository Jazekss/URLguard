#!/usr/bin/env node
// Lejupielādē publisko statistiku no releja un uzģenerē STATS.md (GitHub Action katru dienu).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR, readBrands, readList } from './lib.mjs';

const URL_ = process.env.STATS_URL ?? 'https://urlguard-relay.urlguard-relay.workers.dev/stats';
const res = await fetch(URL_);
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const { total = {}, last30 = [] } = await res.json();
const n = (v) => Number(v ?? 0).toLocaleString('lv-LV');
const sum = (k) => last30.reduce((a, d) => a + Number(d[k] ?? 0), 0);

const lines = [
  '# URLguard statistika',
  '',
  `Atjaunināts: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · automātiski katru dienu.`,
  '',
  'Skaitļi ir tikai no lietotājiem, kuri **paši piekrituši** anonīmai statistikai ([kas tiek sūtīts](PRIVACY.md)),',
  'tāpēc īstais aizsargāto gadījumu skaits ir lielāks.',
  '',
  '## Kopā' + (total.since ? ` (kopš ${total.since})` : ''),
  '',
  '| | |',
  '|---|---:|',
  `| 🛑 Bloķētas bīstamās lapas | **${n(total.blocked)}** |`,
  `| ⚠️ Brīdinājumi par aizdomīgām lapām | ${n(total.warned)} |`,
  `| 🔎 Krāpnieku saites meklētājā (atzīmētas + paslēptas) | ${n(Number(total.serp_marked ?? 0) + Number(total.serp_hidden ?? 0))} |`,
  `| 📨 Lietotāju ziņojumi | ${n(total.reports)} |`,
  '',
  '## Pēdējās 30 dienas',
  '',
  `| | |`,
  '|---|---:|',
  `| Bloķētas lapas | ${n(sum('blocked'))} |`,
  `| Brīdinājumi | ${n(sum('warned'))} |`,
  `| Krāpnieku saites meklētājā | ${n(sum('serp_marked') + sum('serp_hidden'))} |`,
  `| Ziņojumi | ${n(sum('reports'))} |`,
  `| Vidēji aktīvo paplašinājumu dienā (ar statistiku) | ${n(last30.length ? Math.round(sum('installs') / last30.length) : 0)} |`,
  '',
  '## Bāze',
  '',
  `- Aizsargāti zīmoli: **${readBrands().length}**`,
  `- Mūsu pašu bloķētie domēni: ${readList('blocklist/domains.txt').length} (+ ārējās plūsmas)`,
  '',
];
writeFileSync(join(ROOT_DIR, 'STATS.md'), lines.join('\n'));
console.log(lines.join('\n'));
