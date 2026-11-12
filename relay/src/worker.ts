// URLguard ziņojumu relejs (Cloudflare Worker, bezmaksas plāns).
// Paplašinājums POST /report -> šeit izveido GitHub issue ar mūsu tokenu (lietotājam nevajag GitHub kontu).
// Aizsardzība: ievades validācija, IP ierobežojums (KV), dublikātu apvienošana (+1 komentārs).

interface Env {
  GITHUB_TOKEN: string; // fine-grained PAT ar "Issues: read & write" tikai šim repo
  GITHUB_REPO: string; // "īpašnieks/repo"
  RL: KVNamespace; // rate-limit KV
  MAX_PER_HOUR?: string;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

const KIND_TEXT = {
  phishing: 'Krāpnieciska saite (phishing)',
  false_positive: 'Kļūdains brīdinājums (lapa ir droša)',
} as const;

const cors = (origin: string | null) => ({
  'access-control-allow-origin': origin && /^(chrome|moz)-extension:\/\//.test(origin) ? origin : 'null',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
});

const json = (data: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...cors(origin) } });

/** Neitralizē @pieminējumus un markdown, lai ziņojums nevar nevienu "pingot" vai ievietot saites. */
const clean = (s: string, max: number) =>
  s.slice(0, max).replace(/@/g, '@​').replace(/[<>`]/g, '').replace(/\r/g, '');

async function sha256(s: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('origin');
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    if (req.method !== 'POST' || new URL(req.url).pathname !== '/report') return json({ error: 'not found' }, 404, origin);

    // Ierobežojums: N ziņojumi stundā no vienas IP (glabājam tikai hash).
    const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
    const hour = Math.floor(Date.now() / 3_600_000);
    const rlKey = `rl:${await sha256(ip + hour)}`;
    const count = Number((await env.RL.get(rlKey)) ?? 0);
    if (count >= Number(env.MAX_PER_HOUR ?? 10)) return json({ error: 'Pārāk daudz ziņojumu, mēģiniet vēlāk.' }, 429, origin);
    await env.RL.put(rlKey, String(count + 1), { expirationTtl: 3700 });

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
    const prefix = kind === 'phishing' ? 'phishing' : 'fp';
    const title = `[${prefix}] ${host}`;

    // Dublikāts? -> +1 komentārs esošajam issue
    const q = encodeURIComponent(`repo:${env.GITHUB_REPO} is:issue is:open in:title "${title}"`);
    const search = await gh(env, `/search/issues?q=${q}&per_page=1`);
    if (search.ok) {
      const s = (await search.json()) as { items?: { number: number; html_url: string }[] };
      const existing = s.items?.[0];
      if (existing) {
        await gh(env, `/repos/${env.GITHUB_REPO}/issues/${existing.number}/comments`, {
          method: 'POST',
          body: JSON.stringify({ body: `➕ Vēl viens ziņojums (${clean(body.version ?? '', 20)})${body.note ? `: ${clean(body.note, 300)}` : ''}` }),
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
  },
};
