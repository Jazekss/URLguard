// URLguard relejs (Cloudflare Worker, bezmaksas plāns).
//   POST /report – lietotāja ziņojums -> GitHub issue (lietotājam nevajag GitHub kontu)
//   POST /stats  – anonīmas dienas kopsummas (tikai ar lietotāja piekrišanu, tikai skaitļi)
//   GET  /stats  – publiskā statistika (JSON)
// Privātums: IP adrese netiek glabāta. Pret ļaunprātīgu lietošanu glabājam tikai hash(IP + dienas sāls);
// sāli un hash dzēšam pēc 2 dienām – pēc tam tos nav iespējams sasaistīt ar IP.

interface Env {
  GITHUB_TOKEN: string; // fine-grained PAT: tikai "Issues: read & write" šim repo
  GITHUB_REPO: string; // "īpašnieks/repo"
  DB: D1Database;
  MAX_REPORTS_PER_HOUR?: string;
  MAX_STATS_PER_DAY?: string;
}

interface D1Result<T> {
  results: T[];
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}
interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown>;
}

const KIND_TEXT = {
  phishing: 'Krāpnieciska saite (phishing)',
  false_positive: 'Kļūdains brīdinājums (lapa ir droša)',
} as const;

const STAT_FIELDS = {
  blocked: 'blocked',
  warned: 'warned',
  serpMarked: 'serp_marked',
  serpHidden: 'serp_hidden',
  bypassed: 'bypassed',
  reports: 'reports',
} as const;

const isExt = (o: string | null) => !!o && /^(chrome|moz)-extension:\/\//.test(o);

function cors(origin: string | null, publicRead = false): Record<string, string> {
  return {
    'access-control-allow-origin': publicRead ? '*' : isExt(origin) ? origin! : 'null',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

const json = (data: unknown, status: number, origin: string | null, extra: Record<string, string> = {}, publicRead = false) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors(origin, publicRead), ...extra },
  });

/** Neitralizē @pieminējumus un HTML/markdown, lai ziņojums nevar nevienu "pingot" vai ievietot saites. */
const clean = (s: string, max: number) => s.slice(0, max).replace(/@/g, '@​').replace(/[<>`]/g, '').replace(/\r/g, '');

const today = () => new Date().toISOString().slice(0, 10);

async function sha256(s: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Dienas sāls (nejaušs, dzēsts pēc 2 dienām). */
async function dailySalt(env: Env, day: string): Promise<string> {
  const row = await env.DB.prepare('SELECT salt FROM salts WHERE day = ?').bind(day).first<{ salt: string }>();
  if (row) return row.salt;
  await env.DB.prepare('INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)').bind(day, crypto.randomUUID()).run();
  const again = await env.DB.prepare('SELECT salt FROM salts WHERE day = ?').bind(day).first<{ salt: string }>();
  return again!.salt;
}

/** Palielina skaitītāju (dienas, atslēgas) un atgriež jauno vērtību. */
async function hit(env: Env, req: Request, scope: string): Promise<number> {
  const day = today();
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  const key = `${scope}:${await sha256(ip + (await dailySalt(env, day)))}`;
  const row = await env.DB.prepare(
    'INSERT INTO ratelimit (day, key, n) VALUES (?, ?, 1) ON CONFLICT(day, key) DO UPDATE SET n = n + 1 RETURNING n',
  )
    .bind(day, key)
    .first<{ n: number }>();
  // Reizēm iztīram vecos ierakstus (sāli un hash) – pēc tam tie vairs nav sasaistāmi.
  if (Math.random() < 0.05) {
    const cutoff = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM ratelimit WHERE day < ?').bind(cutoff),
      env.DB.prepare('DELETE FROM salts WHERE day < ?').bind(cutoff),
    ]);
  }
  return row?.n ?? 1;
}

async function gh(env: Env, path: string, init: RequestInit = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'urlguard-relay',
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

// ---------------------------------------------------------------- /report
async function report(req: Request, env: Env, origin: string | null): Promise<Response> {
  // Ziņojumu ierobežojums: N stundā no vienas IP (skaitām dienā ar stundas atslēgu)
  const hour = new Date().getUTCHours();
  if ((await hit(env, req, `report-h${hour}`)) > Number(env.MAX_REPORTS_PER_HOUR ?? 10)) {
    return json({ error: 'Pārāk daudz ziņojumu, mēģiniet vēlāk.' }, 429, origin);
  }
  let body: { url?: string; kind?: string; brand?: string; note?: string; version?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400, origin);
  }
  let u: URL;
  try {
    u = new URL(String(body.url ?? ''));
  } catch {
    return json({ error: 'Nederīga saite' }, 400, origin);
  }
  if (!/^https?:$/.test(u.protocol) || u.href.length > 2000) return json({ error: 'Nederīga saite' }, 400, origin);
  const kind = body.kind === 'false_positive' ? 'false_positive' : body.kind === 'phishing' ? 'phishing' : null;
  if (!kind) return json({ error: 'Nederīgs veids' }, 400, origin);

  const host = u.hostname.toLowerCase();
  const title = `[${kind === 'phishing' ? 'phishing' : 'fp'}] ${host}`;

  // Dublikāts? -> +1 komentārs esošajam issue
  const q = encodeURIComponent(`repo:${env.GITHUB_REPO} is:issue is:open in:title "${title}"`);
  const search = await gh(env, `/search/issues?q=${q}&per_page=1`);
  if (search.ok) {
    const s = (await search.json()) as { items?: { number: number; html_url: string; title: string }[] };
    const existing = s.items?.find((i) => i.title === title);
    if (existing) {
      await gh(env, `/repos/${env.GITHUB_REPO}/issues/${existing.number}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          body: `➕ Vēl viens ziņojums (${clean(body.version ?? '', 20)})${body.note ? `: ${clean(body.note, 300)}` : ''}`,
        }),
      });
      return json({ ok: true, issueUrl: existing.html_url, duplicate: true }, 200, origin);
    }
  }

  const issueBody = [
    '### Saite', '', clean(u.href, 2000), '',
    '### Veids', '', KIND_TEXT[kind], '',
    '### Zīmols (ja zināms)', '', clean(body.brand ?? '', 100) || '_No response_', '',
    '### Piezīme', '', clean(body.note ?? '', 500) || '_No response_', '',
    `<sub>Iesūtīts caur URLguard paplašinājumu ${clean(body.version ?? '', 20)}</sub>`,
  ].join('\n');

  const res = await gh(env, `/repos/${env.GITHUB_REPO}/issues`, {
    method: 'POST',
    body: JSON.stringify({ title, body: issueBody, labels: ['report'] }),
  });
  if (!res.ok) return json({ error: `GitHub ${res.status}` }, 502, origin);
  const issue = (await res.json()) as { html_url: string };
  return json({ ok: true, issueUrl: issue.html_url }, 201, origin);
}

// ---------------------------------------------------------------- /stats
async function postStats(req: Request, env: Env, origin: string | null): Promise<Response> {
  if (!isExt(origin)) return json({ error: 'forbidden' }, 403, origin);
  // Mājsaimniecībā aiz viena IP var būt vairākas ierīces – atļaujam dažus sūtījumus dienā.
  if ((await hit(env, req, 'stats')) > Number(env.MAX_STATS_PER_DAY ?? 20)) return json({ ok: true, ignored: true }, 200, origin);
  let body: { browser?: string; c?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400, origin);
  }
  const browser = body.browser === 'chrome' || body.browser === 'firefox' ? body.browser : 'other';
  const vals: number[] = [];
  for (const k of Object.keys(STAT_FIELDS) as (keyof typeof STAT_FIELDS)[]) {
    const n = Number(body.c?.[k] ?? 0);
    if (!Number.isInteger(n) || n < 0 || n > 5000) return json({ error: `bad ${k}` }, 400, origin);
    vals.push(n);
  }
  const cols = Object.values(STAT_FIELDS);
  await env.DB.prepare(
    `INSERT INTO daily (day, browser, installs, ${cols.join(', ')}) VALUES (?, ?, 1, ${cols.map(() => '?').join(', ')})
     ON CONFLICT(day, browser) DO UPDATE SET installs = installs + 1, ${cols.map((c) => `${c} = ${c} + excluded.${c}`).join(', ')}`,
  )
    .bind(today(), browser, ...vals)
    .run();
  return json({ ok: true }, 200, origin);
}

async function getStats(env: Env, origin: string | null): Promise<Response> {
  const cols = ['installs', ...Object.values(STAT_FIELDS)];
  const sum = cols.map((c) => `SUM(${c}) AS ${c}`).join(', ');
  const total = await env.DB.prepare(`SELECT MIN(day) AS since, ${sum} FROM daily`).first();
  const days = await env.DB.prepare(
    `SELECT day, ${sum} FROM daily WHERE day >= date('now', '-30 days') GROUP BY day ORDER BY day`,
  ).all();
  return json({ total, last30: days.results, generated: new Date().toISOString() }, 200, origin, { 'cache-control': 'public, max-age=600' }, true);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('origin');
    const path = new URL(req.url).pathname;
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin, path === '/stats' && !isExt(origin)) });
    try {
      if (req.method === 'POST' && path === '/report') return await report(req, env, origin);
      if (req.method === 'POST' && path === '/stats') return await postStats(req, env, origin);
      if (req.method === 'GET' && path === '/stats') return await getStats(env, origin);
    } catch (e) {
      console.error(e);
      return json({ error: 'server error' }, 500, origin);
    }
    return json({ error: 'not found' }, 404, origin);
  },
};
