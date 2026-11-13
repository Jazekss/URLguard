// node build.mjs [--dev] [--repo īpašnieks/repo]
// Rezultāts: dist/chrome, dist/firefox + ZIP faili ../BUILDS/URLguard_<ver>_<platform>_<datums>.zip
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createPublicKey, verify } from 'node:crypto';
import { zipSync } from 'fflate';
import { shieldPng } from './scripts/icons.mjs';
import { buildBundle } from '../data/scripts/build-bundle.mjs';

const args = process.argv.slice(2);
const dev = args.includes('--dev');
const repoArg = args.indexOf('--repo');
const REPO = repoArg >= 0 ? args[repoArg + 1] : process.env.URLGUARD_REPO || 'Jazekss/URLguard';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const VERSION = pkg.version;
const PUBKEY = readFileSync('../data/keys/public.b64', 'utf8').trim();

const SEARCH_MATCHES = [
  ...['com', 'lv', 'lt', 'ee', 'fi', 'se', 'no', 'dk', 'de', 'pl', 'co.uk', 'fr', 'es', 'it', 'nl', 'ie', 'ru'].map(
    (t) => `*://*.google.${t}/search*`,
  ),
  '*://*.bing.com/search*',
  '*://duckduckgo.com/*',
];

function manifest(target) {
  const m = {
    manifest_version: 3,
    name: '__MSG_extName__',
    description: '__MSG_extDesc__',
    default_locale: 'en',
    version: VERSION,
    icons: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
    action: { default_popup: 'popup.html', default_title: 'URLguard', default_icon: { 16: 'icons/icon16.png', 32: 'icons/icon32.png' } },
    permissions: ['storage', 'unlimitedStorage', 'webRequest', 'declarativeNetRequest', 'alarms', 'contextMenus'],
    host_permissions: ['http://*/*', 'https://*/*'],
    content_scripts: [
      { matches: SEARCH_MATCHES, js: ['serp.js'], run_at: 'document_idle' },
      { matches: ['http://*/*', 'https://*/*'], exclude_matches: SEARCH_MATCHES, js: ['page.js'], run_at: 'document_idle' },
    ],
    web_accessible_resources: [{ resources: ['warning.html'], matches: ['http://*/*', 'https://*/*'] }],
  };
  if (target === 'chrome') {
    m.background = { service_worker: 'background.js' };
    m.minimum_chrome_version = '120';
  } else {
    m.background = { scripts: ['background.js'] };
    m.browser_specific_settings = {
      gecko: { id: 'urlguard@urlguard.app', strict_min_version: '140.0', data_collection_permissions: { required: ['none'], optional: ['technicalAndInteraction'] } },
      gecko_android: { strict_min_version: '142.0' },
    };
  }
  return m;
}

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// Iebūvētā bāze: jaunākā parakstītā no releja (ar paraksta pārbaudi); ja nav pieejama – lokālā ar datumu 1970,
// lai jebkura tīklā publicēta parakstīta bāze to aizstātu pirmajā atjaunināšanā.
async function embeddedBundle() {
  const relay = 'https://urlguard-relay.urlguard-relay.workers.dev';
  try {
    const [b, s] = await Promise.all([fetch(`${relay}/bundle.json`), fetch(`${relay}/bundle.json.sig`)]);
    if (b.ok && s.ok) {
      const body = Buffer.from(await b.arrayBuffer());
      const pub = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(PUBKEY, 'base64')]), format: 'der', type: 'spki' });
      if (verify(null, body, pub, Buffer.from((await s.text()).trim(), 'base64'))) {
        const j = JSON.parse(body.toString('utf8'));
        console.log(`Iebūvēta publicētā bāze (${j.generated}, ${j.blocklist.domains.length + j.blocklist.urls.length} bloķēti)`);
        return j;
      }
      console.warn('⚠ Releja bāzes paraksts nederīgs – izmantoju lokālo');
    }
  } catch (e) {
    console.warn(`⚠ Relejs nav pieejams (${e.message}) – izmantoju lokālo bāzi`);
  }
  return { ...(await buildBundle()), generated: '1970-01-01T00:00:00.000Z' };
}
const bundle = args.includes('--local-data')
  ? { ...(await buildBundle()), generated: '1970-01-01T00:00:00.000Z' }
  : await embeddedBundle();
const icons = Object.fromEntries([16, 32, 48, 128].map((s) => [s, shieldPng(s)]));
const date = new Date().toISOString().slice(0, 10);

for (const target of ['chrome', 'firefox']) {
  const out = join('dist', target);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'icons'), { recursive: true });
  mkdirSync(join(out, 'data'), { recursive: true });

  await build({
    entryPoints: {
      background: 'src/background.ts',
      serp: 'src/content/serp.ts',
      page: 'src/content/page.ts',
      popup: 'src/ui/popup.ts',
      warning: 'src/ui/warning.ts',
    },
    outdir: out,
    bundle: true,
    format: 'iife',
    target: ['chrome120', 'firefox140'],
    minify: !dev && target === 'chrome', // Firefox (AMO) – neminificēts, lai pārbaudītāji var lasīt kodu
    sourcemap: dev ? 'inline' : false,
    legalComments: 'none',
    define: { __PUBKEY__: JSON.stringify(PUBKEY), __DATA_REPO__: JSON.stringify(REPO), __TARGET__: JSON.stringify(target) },
    logLevel: 'warning',
  });

  cpSync('static', out, { recursive: true });
  // Pārlūka _locales (nosaukums un apraksts veikalā/izvēlnē) no tiem pašiem tulkojumu failiem
  for (const f of readdirSync('src/i18n').filter((x) => x.endsWith('.json'))) {
    const code = f.replace('.json', '');
    const d = JSON.parse(readFileSync(join('src/i18n', f), 'utf8'));
    mkdirSync(join(out, '_locales', code), { recursive: true });
    writeFileSync(
      join(out, '_locales', code, 'messages.json'),
      JSON.stringify({ extName: { message: d['ext.name'] }, extDesc: { message: d['ext.desc'] } }, null, 2),
    );
  }
  for (const [s, buf] of Object.entries(icons)) writeFileSync(join(out, 'icons', `icon${s}.png`), buf);
  writeFileSync(join(out, 'data', 'bundle.json'), JSON.stringify(bundle));
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest(target), null, 2));

  if (!dev) {
    const files = Object.fromEntries(walk(out).map((f) => [relative(out, f).replace(/\\/g, '/'), readFileSync(f)]));
    const buildsDir = join('..', 'BUILDS');
    if (!existsSync(buildsDir)) mkdirSync(buildsDir);
    const zipName = `URLguard_${VERSION}_${target}_${date}.zip`;
    writeFileSync(join(buildsDir, zipName), zipSync(files, { level: 9 }));
    console.log(`✓ ${target}: dist/${target}  ->  BUILDS/${zipName}`);
  } else console.log(`✓ ${target}: dist/${target} (dev)`);
}
console.log(`Repo: ${REPO}${REPO.includes('OWNER') ? '  (⚠ norādi ar --repo vai URLGUARD_REPO)' : ''}`);
